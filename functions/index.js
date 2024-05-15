const functions = require("firebase-functions");
const admin = require("firebase-admin");
const vision = require("@google-cloud/vision");

admin.initializeApp();
const client = new vision.ImageAnnotatorClient();

exports.analyzeImage = functions.storage.object().onFinalize(async (object) => {
  const bucket = admin.storage().bucket(object.bucket);
  const filePath = object.name;

  if (!filePath) {
    console.log("No file path provided.");
    return null;
  }

  const [result] = await client.labelDetection(`gs://${bucket.name}/${filePath}`);
  const labels = result.labelAnnotations;

  console.log("Labels:");
  labels.forEach((label) => console.log(label.description));

  // Optionally, you can save the results back to Firestore or Realtime Database
  // const db = admin.firestore();
  // await db.collection('images').doc(filePath).set({ labels });

  return null;
});



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
