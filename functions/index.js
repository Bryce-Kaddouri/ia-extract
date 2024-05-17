const vision = require("@google-cloud/vision");
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { NlpManager } = require('node-nlp');
const Jimp = require('jimp');
const axios = require('axios');

admin.initializeApp();

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

  for (const [category, products] of Object.entries(referenceProducts)) {
    for (const product of products) {
      manager.addNamedEntityText('product', product, ['en'], [product]);
    }
  }




    // Train the model
    await manager.train();

    // Save the model
    await manager.save();

    console.log('Model trained and saved');
    return;
}


const client = new vision.ImageAnnotatorClient();



/*exports.analyzeImageHttp = functions.https.onRequest(async (req, res) => {
  try {
    const { imageUrl, squareCoordinates } = req.body;

    if (!imageUrl) {
      return res.status(400).send("No image URL provided.");
    }

    const [result] = await client.textDetection(imageUrl);
    const detections = result.fullTextAnnotation;

    if (!detections) {
      return res.status(200).send("No text detected in the image.");
    }

    // Example coordinates for the square
    // squareCoordinates should be an object with x, y, width, and height properties
    const { x, y, width, height } = squareCoordinates || { x: 50, y: 50, width: 100, height: 100 };

    // Load the image using Jimp
    const imageResponse = await axios({ url: imageUrl, responseType: 'arraybuffer' });
    const image = await Jimp.read(imageResponse.data);

    // Draw the square on the image
    image.scan(x, y, width, height, function (ix, iy, idx) {
      this.bitmap.data[idx + 0] = 255; // Red
      this.bitmap.data[idx + 1] = 0;   // Green
      this.bitmap.data[idx + 2] = 0;   // Blue
      this.bitmap.data[idx + 3] = 255; // Alpha
    });

    // Convert the image to a buffer and send it as a response
    const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    res.set('Content-Type', Jimp.MIME_JPEG);
    return res.send(buffer);

  } catch (error) {
    console.error(error);
    return res.status(500).send("An error occurred during image analysis.");
  }
});*/

/*exports.analyzeImageHttp = functions.https.onRequest(async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).send("No image URL provided.");
    }

    const [result] = await client.textDetection(imageUrl);
    const detections = result.fullTextAnnotation;

    if (!detections) {
      return res.status(200).send("No text detected in the image.");
    }

    const pages = detections.pages;
    const headers = ["Items", "Quantity", "Price per Unit", "Tax per Unit", "Amount"];
    const headerCoordinates = [];

    pages.forEach(page => {
      page.blocks.forEach(block => {
        block.paragraphs.forEach(paragraph => {
          let currentHeader = '';
          let currentCoordinates = [];

          paragraph.words.forEach(word => {
            const wordText = word.symbols.map(symbol => symbol.text).join('');
            currentHeader = currentHeader ? `${currentHeader} ${wordText}` : wordText;
            currentCoordinates = currentCoordinates.concat(word.boundingBox.vertices || []);

            if (headers.includes(currentHeader)) {
              const xPositions = currentCoordinates.map(v => v.x);
              const yPositions = currentCoordinates.map(v => v.y);
              headerCoordinates.push({
                header: currentHeader,
                xstart: Math.min(...xPositions),
                xend: Math.max(...xPositions),
                ystart: Math.min(...yPositions),
                yend: Math.max(...yPositions)
              });
              currentHeader = '';
              currentCoordinates = [];
            }
          });
        });
      });
    });

    // Adjust the end value of each column to the start value of the next column minus a buffer space of 10 units
    const bufferSpace = 10;

    // Ensure the last column end value covers the rest of the line

    const columnBoundaries = {};
    headerCoordinates.forEach(header => {
      columnBoundaries[header.header] = {
        xstart: header.xstart,
        xend: header.xend,
        ystart: header.ystart,
        yend: header.yend
      };
    });



    const imageResponse = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const image = await Jimp.read(imageResponse.data);
        headerCoordinates.forEach(coord => {

            // draw green square for the name of product
            const greenColor = Jimp.rgbaToInt(0, 255, 0, 255); // Green color
            const nameCoordinates = headerCoordinates.find(coord => coord.header === "Items");
            for (let x = nameCoordinates.xstart; x <= nameCoordinates.xend; x++) {
              image.setPixelColor(greenColor, x, nameCoordinates.ystart);
              image.setPixelColor(greenColor, x, nameCoordinates.yend);
            }
            for (let y = nameCoordinates.ystart; y <= nameCoordinates.yend; y++) {
                image.setPixelColor(greenColor, nameCoordinates.xstart, y);
                image.setPixelColor(greenColor, nameCoordinates.xend, y);
            }

            // draw blue square for the quantity of product
            const blueColor = Jimp.rgbaToInt(0, 0, 255, 255); // Blue color
            const quantityCoordinates = headerCoordinates.find(coord => coord.header === "Quantity");
            for (let x = quantityCoordinates.xstart; x <= quantityCoordinates.xend; x++) {
              image.setPixelColor(blueColor, x, quantityCoordinates.ystart);
              image.setPixelColor(blueColor, x, quantityCoordinates.yend);
            }

            for (let y = quantityCoordinates.ystart; y <= quantityCoordinates.yend; y++) {
                image.setPixelColor(blueColor, quantityCoordinates.xstart, y);
                image.setPixelColor(blueColor, quantityCoordinates.xend, y);
            }

            // draw yellow square for the price of product
            const yellowColor = Jimp.rgbaToInt(255, 255, 0, 255); // Yellow color
            const priceCoordinates = headerCoordinates.find(coord => coord.header === "Price per Unit");
            for (let x = priceCoordinates.xstart; x <= priceCoordinates.xend; x++) {
              image.setPixelColor(yellowColor, x, priceCoordinates.ystart);
              image.setPixelColor(yellowColor, x, priceCoordinates.yend);
            }
            for (let y = priceCoordinates.ystart; y <= priceCoordinates.yend; y++) {
                image.setPixelColor(yellowColor, priceCoordinates.xstart, y);
                image.setPixelColor(yellowColor, priceCoordinates.xend, y);
            }

            // draw red square for the tax of product
            const redColor = Jimp.rgbaToInt(255, 0, 0, 255); // Red color
            const taxCoordinates = headerCoordinates.find(coord => coord.header === "Tax per Unit");
            for (let x = taxCoordinates.xstart; x <= taxCoordinates.xend; x++) {
              image.setPixelColor(redColor, x, taxCoordinates.ystart);
              image.setPixelColor(redColor, x, taxCoordinates.yend);
            }
            for (let y = taxCoordinates.ystart; y <= taxCoordinates.yend; y++) {
                image.setPixelColor(redColor, taxCoordinates.xstart, y);
                image.setPixelColor(redColor, taxCoordinates.xend, y);
            }

            // draw purple square for the amount of product
            const purpleColor = Jimp.rgbaToInt(255, 0, 255, 255); // Purple color
            const amountCoordinates = headerCoordinates.find(coord => coord.header === "Amount");
            for (let x = amountCoordinates.xstart; x <= amountCoordinates.xend; x++) {
              image.setPixelColor(purpleColor, x, amountCoordinates.ystart);
              image.setPixelColor(purpleColor, x, amountCoordinates.yend);
            }
            for (let y = amountCoordinates.ystart; y <= amountCoordinates.yend; y++) {
                image.setPixelColor(purpleColor, amountCoordinates.xstart, y);
                image.setPixelColor(purpleColor, amountCoordinates.xend, y);
            }
        });


        // Convert the image to a buffer and send it as a response
        const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
        res.set('Content-Type', Jimp.MIME_JPEG);

    return res.send(buffer);

    } catch (error) {
    console.error(error);
    return res.status(500).send("An error occurred during image analysis.");
    }
});*/

exports.extractProducts = functions.https.onRequest(async (req, res) => {
  try {

    trainAndSaveModel();
   const { rows } = req.body;

    if (!rows || !Array.isArray(rows)) {
      return res.status(400).send("No valid rows provided.");
    }

    const products = {};

    for (const row of rows) {
      const response = await manager.process('en', row);

      const productEntity = response.entities.find(entity => entity.entity === 'product');
      const quantityEntity = response.entities.find(entity => entity.entity === 'quantity');
      const priceEntity = response.entities.find(entity => entity.entity === 'price');
      const taxEntity = response.entities.find(entity => entity.entity === 'tax');
      const amountEntity = response.entities.find(entity => entity.entity === 'amount');

      if (productEntity) {
        const category = Object.keys(referenceProducts).find(cat => referenceProducts[cat].includes(productEntity.option));
        const productData = {
          Items: productEntity ? productEntity.sourceText : '',
          Quantity: quantityEntity ? quantityEntity.sourceText : '',
          "Price per Unit": priceEntity ? priceEntity.sourceText : '',
          "Tax per Unit": taxEntity ? taxEntity.sourceText : '',
          Amount: amountEntity ? amountEntity.sourceText : ''
        };

        if (category) {
          if (!products[category]) {
            products[category] = [];
          }
          products[category].push(productData.Items);
        }
      }
    }

    return res.json({ data: products });
  } catch (error) {
    console.error(error);
    return res.status(500).send("An error occurred during product extraction.");
  }
});