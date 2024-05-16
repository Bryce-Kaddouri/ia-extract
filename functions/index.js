const vision = require("@google-cloud/vision");
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { NlpManager } = require('node-nlp');

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
  await manager.train();
  manager.save();
}

// Ensure the model is trained before handling requests


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

    const fullText = detections[0].description;  // The entire detected text
    const words = detections.slice(1).map(annotation => annotation.description);  // Individual words

    return res.status(200).send({ fullText, words });
  } catch (error) {
    console.error(error);
    return res.status(500).send("An error occurred during image analysis.");
  }
});

exports.extractProducts = functions.https.onRequest(async (req, res) => {
    trainAndSaveModel();

  const text = req.body.text || '';

  // Process the text with NLP.js
  const response = await manager.process('en', text);
  const entities = response.entities.filter(entity => entity.entity === 'product');

  // Create a result object to map detected products to reference categories
  const detectedProducts = {};
  for (const [category, products] of Object.entries(referenceProducts)) {
    detectedProducts[category] = [];
    for (const product of products) {
      if (entities.some(entity => entity.option === product)) {
        detectedProducts[category].push(product);
      }
    }
  }

  // Filter out empty lists
  const filteredProducts = Object.fromEntries(
    Object.entries(detectedProducts).filter(([key, value]) => value.length > 0)
  );

  res.json(filteredProducts);
});

