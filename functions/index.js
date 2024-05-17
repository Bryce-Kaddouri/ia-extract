const vision = require("@google-cloud/vision");
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { NlpManager } = require('node-nlp');

admin.initializeApp();

const referenceCompanies = ["Walmart", "Target", "Costco", "Kroger", "Safeway", "Whole Foods", "Market Store", "Akash Enterprises"];

const referenceProducts = {
  "Apple": ["Apple normal", "Apple fresh", "Green Apple"],
  "Orange": ["Orange", "Mandarin", "Tangerine"],
  "Banana": ["Banana", "Banana ripe", "Plantain"],
  "Butter": ["Butter", "Margarine"],
  "Milk": ["Milk", "Soy Milk", "Almond Milk"],
  "Bread": ["Bread", "Whole Wheat Bread", "White Bread"],
  "Cheese": ["Cheese", "Cheddar", "Mozzarella"]
};

const manager = new NlpManager({ languages: ['en'] });

async function trainAndSaveModel() {
  // Add named entities for reference products

  // get company name
    for (const company of referenceCompanies) {
        manager.addNamedEntityText('company', company, ['en'], [company]);
    }


  for (const [category, products] of Object.entries(referenceProducts)) {
    for (const product of products) {
      manager.addNamedEntityText('product', product, ['en'], [product]);
    }
  }

 // Add custom entity patterns for quantities and prices
  manager.addRegexEntity('quantity', 'en', /\d+\s*(KG|LBS)/gi);
    manager.addNamedEntityText('price', 'price', ['en'], ['price']);
    manager.addRegexEntity('tax', 'en', /tax/gi);
    manager.addRegexEntity('amount', 'en', /\$\d+\.\d+/gi);



    // Train the model
    await manager.train();

    // Save the model
    await manager.save();

    console.log('Model trained and saved');
    return;
}


const client = new vision.ImageAnnotatorClient();

exports.analyzeImageHttp = functions.https.onRequest(async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).send("No image URL provided.");
    }

    const [result] = await client.textDetection(imageUrl);
    const detections = result.textAnnotations;

    if (detections.length === 0) {
      return res.status(200).send("No text detected in the image.");
    }

    // Process full text detection and words separately
    const fullText = detections[0].description;  // The entire detected text
    const wordAnnotations = detections.slice(1); // Individual word annotations

    // Sort wordAnnotations by their vertical position
    wordAnnotations.sort((a, b) => a.boundingPoly.vertices[0].y - b.boundingPoly.vertices[0].y);

    // Group words by rows
    const rows = [];
    let currentRow = [];
    let currentY = wordAnnotations[0].boundingPoly.vertices[0].y;
    const rowThreshold = 10; // Threshold to determine if a word belongs to the current row

    wordAnnotations.forEach(annotation => {
      const wordY = annotation.boundingPoly.vertices[0].y;
      if (Math.abs(wordY - currentY) > rowThreshold) {
        // Sort the current row by horizontal position before pushing it to rows
        currentRow.sort((a, b) => a.boundingPoly.vertices[0].x - b.boundingPoly.vertices[0].x);
        rows.push(currentRow);
        currentRow = [];
        currentY = wordY;
      }
      currentRow.push(annotation);
    });
    // Sort the last row by horizontal position and push it to rows
    currentRow.sort((a, b) => a.boundingPoly.vertices[0].x - b.boundingPoly.vertices[0].x);
    rows.push(currentRow);

    // Join words in each row
    const rowTexts = rows.map(row => row.map(annotation => annotation.description).join(' '));

    return res.status(200).send({ fullText, rows: rowTexts });
  } catch (error) {
    console.error(error);
    return res.status(500).send("An error occurred during image analysis.");
  }
});

exports.extractProducts = functions.https.onRequest(async (req, res) => {
trainAndSaveModel();

  try {
    const rows = req.body.rows || [];

    // Initialize detected products object
    const detectedProducts = {};
    const detectedCompanies = [];

    // Process each row
    for (const row of rows) {
      // Process the row with NLP.js
      const response = await manager.process('en', row);

      const companyEntities = response.entities.filter(entity => entity.entity === 'company');
      if (companyEntities.length > 0) {
        detectedCompanies.push(companyEntities[0].option);
      }



      const productEntities = response.entities.filter(entity => entity.entity === 'product');
       const quantityEntities = response.entities.filter(entity => entity.entity === 'quantity');
        const priceEntities = response.entities.filter(entity => entity.entity === 'price');



      productEntities.forEach(productEntity => {
        const productName = productEntity.option;
        const productCategory = Object.keys(referenceProducts).find(category =>
          referenceProducts[category].includes(productName)
        );

        if (!detectedProducts[productCategory]) {
          detectedProducts[productCategory] = [];
        }

        const productDetails = {
          name: productName,
          quantity: '',
          price: '',
          tax: '',
          amount: ''
        };

        if (quantityEntities.length > 0) {
          productDetails.quantity = quantityEntities[0].sourceText;
        }

        if (priceEntities.length > 0) {
            productDetails.price = priceEntities[0].sourceText;
        }


        detectedProducts[productCategory].push(productDetails);
      });
    }

    // Send the response only once after processing all rows
    res.json(detectedProducts);

  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred during processing: " + error.message);
  }
});
