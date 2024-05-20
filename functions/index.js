const vision = require("@google-cloud/vision");
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { NlpManager } = require('node-nlp');
const Jimp = require('jimp');
const axios = require('axios');
const cors = require('cors')({ origin: true });
const PDFPoppler = require('pdf-poppler');
const { v4: uuidv4 } = require('uuid');
const { join } = require('path');
const { unlink } = require('fs/promises');

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

  // Add custom entity patterns for quantities and prices
  manager.addRegexEntity('quantity', 'en', /\d+\s*(KG|LBS)/gi);
  manager.addRegexEntity('price', 'en', /Rs\s*\.\s*\d+\.\d+/gi);
  manager.addRegexEntity('tax', 'en', /Rs\s*\.\s*\d+\.\d+\s*\(\s*\d+\s*%\s*\)/gi);
  manager.addRegexEntity('amount', 'en', /Rs\s*\.\s*\d+\.\d+/gi);

  // Train the model
  await manager.train();

  // Save the model
  await manager.save();

  console.log('Model trained and saved');
  return true;
}


// Ensure the model is trained before handling requests

exports.extractProducts = functions.https.onRequest(async (req, res) => {

  cors(req, res, async () => {
    trainAndSaveModel().catch(console.error);


    try {
      const {datas} = req.body;

      if (!datas || !Array.isArray(datas)) {
        return res.status(400).send("No valid data provided.");
      }

      const products = {};

      for (const item of datas) {
        const response = await manager.process('en', item.Items);

        const productEntity = response.entities.find(entity => entity.entity === 'product');

        if (productEntity) {
          const category = Object.keys(referenceProducts).find(cat => referenceProducts[cat].includes(productEntity.option));

          if (category) {
            if (!products[category]) {
              products[category] = [];
            }
            products[category].push(item.Items);
          }
        }
      }

      return res.send(JSON.stringify(products, null, 2));
    } catch (error) {
      console.error(error);
      return res.status(500).send("An error occurred during product extraction.");
    }
  });
});

const client = new vision.ImageAnnotatorClient();

exports.analyzeImageHttp = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const {imageUrl} = req.body;

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
                  xstart: Math.min(...xPositions) - 10,
                  xend: Math.max(...xPositions) + 10,
                  ystart: Math.min(...yPositions) - 5,
                  yend: Math.max(...yPositions) + 5
                });
                currentHeader = '';
                currentCoordinates = [];
              }
            });
          });
        });
      });

      const columnBoundaries = {};
      headerCoordinates.forEach((header, index) => {
        const nextHeader = headerCoordinates[index + 1];
        columnBoundaries[header.header] = {
          xstart: header.xstart - 10,
          xend: nextHeader ? nextHeader.xstart - 10 : header.xend + 10,
          ystart: header.ystart - 5,
          yend: header.yend + 5
        };
      });

      // Load the image using Jimp
      const imageResponse = await axios({url: imageUrl, responseType: 'arraybuffer'});
      const image = await Jimp.read(imageResponse.data);

      // Draw borders around the headers
      const drawBorder = (image, coordinates, color) => {
        for (let x = coordinates.xstart; x <= coordinates.xend; x++) {
          image.setPixelColor(color, x, coordinates.ystart);
          image.setPixelColor(color, x, coordinates.yend);
        }
        for (let y = coordinates.ystart; y <= coordinates.yend; y++) {
          image.setPixelColor(color, coordinates.xstart, y);
          image.setPixelColor(color, coordinates.xend, y);
        }
      };

      const colors = {
        "Items": Jimp.rgbaToInt(0, 255, 0, 255), // Green color
        "Quantity": Jimp.rgbaToInt(0, 0, 255, 255), // Blue color
        "Price per Unit": Jimp.rgbaToInt(255, 255, 0, 255), // Yellow color
        "Tax per Unit": Jimp.rgbaToInt(255, 0, 0, 255), // Red color
        "Amount": Jimp.rgbaToInt(255, 0, 255, 255) // Purple color
      };

      headerCoordinates.forEach(coord => {
        const color = colors[coord.header];
        drawBorder(image, coord, color);
      });

      // Identify content rows
      const contentCoordinates = [];
      let currentRow = [];
      let currentY = null;
      const rowThreshold = 10; // Threshold to determine if a word belongs to the current row
      const headerYEnd = Math.max(...headerCoordinates.map(header => header.yend));
      let stopProcessing = false;

      const allWords = [];

      pages.forEach(page => {
        page.blocks.forEach(block => {
          block.paragraphs.forEach(paragraph => {
            paragraph.words.forEach(word => {
              if (!word.boundingBox || !word.boundingBox.vertices) return; // Skip words without bounding box
              allWords.push(word);
            });
          });
        });
      });

      // Sort all words by their vertical position
      allWords.sort((a, b) => a.boundingBox.vertices[0].y - b.boundingBox.vertices[0].y);

      // Process sorted words to group them into rows
      allWords.forEach(word => {
        if (stopProcessing) return;

        const wordX = word.boundingBox.vertices[0].x;
        const wordY = word.boundingBox.vertices[0].y;
        const wordText = word.symbols.map(symbol => symbol.text).join('');

        if (wordText === "Sub" && allWords.some(w => w.symbols.map(s => s.text).join('') === "Total" && Math.abs(w.boundingBox.vertices[0].y - wordY) < rowThreshold)) {
          stopProcessing = true;
          return;
        }

        if (wordY <= headerYEnd) return; // Skip rows that are part of the header

        if (currentY === null) {
          currentY = wordY;
        }

        if (Math.abs(wordY - currentY) > rowThreshold) {
          // Sort the current row by horizontal position before pushing it to rows
          currentRow.sort((a, b) => a.boundingBox.vertices[0].x - b.boundingBox.vertices[0].x);
          contentCoordinates.push(currentRow);
          currentRow = [];
          currentY = wordY;
        }
        currentRow.push(word);
      });

      // Add the last row if not empty
      if (currentRow.length > 0) {
        currentRow.sort((a, b) => a.boundingBox.vertices[0].x - b.boundingBox.vertices[0].x);
        contentCoordinates.push(currentRow);
      }

      // Group words in each row by their horizontal proximity
      const groupWords = (words, threshold) => {
        const groups = [];
        let currentGroup = [];

        words.forEach((word, index) => {
          if (currentGroup.length === 0) {
            currentGroup.push(word);
          } else {
            const previousWord = currentGroup[currentGroup.length - 1];
            const currentX = word.boundingBox.vertices[0].x;
            const previousXEnd = previousWord.boundingBox.vertices[1].x;

            if (currentX - previousXEnd <= threshold) {
              currentGroup.push(word);
            } else {
              groups.push(currentGroup);
              currentGroup = [word];
            }
          }

          if (index === words.length - 1) {
            groups.push(currentGroup);
          }
        });

        return groups;
      };

      // Create an array to hold extracted data
      const extractedData = [];

      // Draw borders around the content cells and collect data
      contentCoordinates.forEach(row => {
        const wordGroups = groupWords(row, 15); // Adjust the threshold as needed

        const rowData = {};

        wordGroups.forEach(group => {
          const xStart = Math.min(...group.map(word => word.boundingBox.vertices[0].x)) - 5;
          const xEnd = Math.max(...group.map(word => word.boundingBox.vertices[1].x)) + 5;
          const yStart = Math.min(...group.map(word => word.boundingBox.vertices[0].y)) - 5;
          const yEnd = Math.max(...group.map(word => word.boundingBox.vertices[3].y)) + 5;

          const column = Object.keys(columnBoundaries).find(header =>
              xStart >= columnBoundaries[header].xstart && xEnd <= columnBoundaries[header].xend
          );

          if (column) {
            const color = colors[column];
            drawBorder(image, {xstart: xStart, xend: xEnd, ystart: yStart, yend: yEnd}, color);
            rowData[column] = group.map(word => word.symbols.map(s => s.text).join('')).join(' ');
          }
        });

        if (Object.keys(rowData).length > 0) {
          extractedData.push(rowData);
        }
      });

      // Convert the image to a base64 string
      const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
      const base64Image = buffer.toString('base64');

      // Return the image and extracted data as JSON
      const data = {
        image: base64Image,
        data: extractedData
      };

      /*return new Response(
          JSON.stringify(data),
          { headers: { "Content-Type": "application/json" } },
      );*/
      /*return res.json({
         image: base64Image,
         data: extractedData
       });*/

      return res.send(data);

    } catch (error) {
      console.error(error);
      return res.status(500).send("An error occurred during image analysis.");
    }
  });
});


exports.analyzeImageHttpCustom = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const {imageUrl, headers, breakWorld} = req.body;

      if (!imageUrl) {
        return res.status(400).send("No image URL provided.");
      }

      if (!breakWorld) {
        return res.status(400).send("No breakWorld provided.");
      }

        if (!headers) {
        return res.status(400).send("No headers provided.");

        }else{
          console.log(headers);
          if(!Array.isArray(headers)){
            return res.status(400).send("Headers should be an array.");
          }
        }

        // check the extension of the image by downloading the image

        // Make a HEAD request to get the content type
              const headResponse = await axios.head(imageUrl);
              const contentType = headResponse.headers['content-type'];

        const isPdf = contentType === 'application/pdf';
        let images = [];

        if(isPdf){
            console.log("PDF file detected");

            return res.status(400).send("PDF files are not supported.");
        }else{





      const [result] = await client.textDetection(imageUrl);
      const detections = result.fullTextAnnotation;

      if (!detections) {
        return res.status(200).send("No text detected in the image.");
      }

      const pages = detections.pages;
      /*const headers = ["Items", "Quantity", "Price per Unit", "Tax per Unit", "Amount"];*/
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
                  xstart: Math.min(...xPositions) - 10,
                  xend: Math.max(...xPositions) + 10,
                  ystart: Math.min(...yPositions) - 5,
                  yend: Math.max(...yPositions) + 5
                });
                currentHeader = '';
                currentCoordinates = [];
              }
            });
          });
        });
      });

      const columnBoundaries = {};
      headerCoordinates.forEach((header, index) => {
        const nextHeader = headerCoordinates[index + 1];
        columnBoundaries[header.header] = {
          xstart: header.xstart - 10,
          xend: nextHeader ? nextHeader.xstart - 10 : header.xend + 10,
          ystart: header.ystart - 5,
          yend: header.yend + 5
        };
      });

      // Load the image using Jimp
      const imageResponse = await axios({url: imageUrl, responseType: 'arraybuffer'});
      const image = await Jimp.read(imageResponse.data);

      // Draw borders around the headers
      const drawBorder = (image, coordinates, color) => {
        for (let x = coordinates.xstart; x <= coordinates.xend; x++) {
          image.setPixelColor(color, x, coordinates.ystart);
          image.setPixelColor(color, x, coordinates.yend);
        }
        for (let y = coordinates.ystart; y <= coordinates.yend; y++) {
          image.setPixelColor(color, coordinates.xstart, y);
          image.setPixelColor(color, coordinates.xend, y);
        }
      };

      /*const colors = {
        "Items": Jimp.rgbaToInt(0, 255, 0, 255), // Green color
        "Quantity": Jimp.rgbaToInt(0, 0, 255, 255), // Blue color
        "Price per Unit": Jimp.rgbaToInt(255, 255, 0, 255), // Yellow color
        "Tax per Unit": Jimp.rgbaToInt(255, 0, 0, 255), // Red color
        "Amount": Jimp.rgbaToInt(255, 0, 255, 255) // Purple color
      };*/

        const colors = {};
        headers.forEach((header, index) => {
          colors[header] = Jimp.rgbaToInt(255, 0, 0, 255); // Red color
        });

      headerCoordinates.forEach(coord => {
        const color = colors[coord.header];
        drawBorder(image, coord, color);
      });

      // Identify content rows
      const contentCoordinates = [];
      let currentRow = [];
      let currentY = null;
      const rowThreshold = 10; // Threshold to determine if a word belongs to the current row
      const headerYEnd = Math.max(...headerCoordinates.map(header => header.yend));
      let stopProcessing = false;

      const allWords = [];

      pages.forEach(page => {
        page.blocks.forEach(block => {
          block.paragraphs.forEach(paragraph => {
            paragraph.words.forEach(word => {
              if (!word.boundingBox || !word.boundingBox.vertices) return; // Skip words without bounding box
              allWords.push(word);
            });
          });
        });
      });

      // Sort all words by their vertical position
      allWords.sort((a, b) => a.boundingBox.vertices[0].y - b.boundingBox.vertices[0].y);

      // Process sorted words to group them into rows
      allWords.forEach(word => {
        if (stopProcessing) return;

        const wordX = word.boundingBox.vertices[0].x;
        const wordY = word.boundingBox.vertices[0].y;
        const wordText = word.symbols.map(symbol => symbol.text).join('');

        /*if (wordText === "Sub" && allWords.some(w => w.symbols.map(s => s.text).join('') === "Total" && Math.abs(w.boundingBox.vertices[0].y - wordY) < rowThreshold)) {
          stopProcessing = true;
          return;
        }*/

        breakWorldList = breakWorld.split(" ");
        if (breakWorldList.includes(wordText)) {
          stopProcessing = true;
          return;
        }

        if (wordY <= headerYEnd) return; // Skip rows that are part of the header

        if (currentY === null) {
          currentY = wordY;
        }

        if (Math.abs(wordY - currentY) > rowThreshold) {
          // Sort the current row by horizontal position before pushing it to rows
          currentRow.sort((a, b) => a.boundingBox.vertices[0].x - b.boundingBox.vertices[0].x);
          contentCoordinates.push(currentRow);
          currentRow = [];
          currentY = wordY;
        }
        currentRow.push(word);
      });

      // Add the last row if not empty
      if (currentRow.length > 0) {
        currentRow.sort((a, b) => a.boundingBox.vertices[0].x - b.boundingBox.vertices[0].x);
        contentCoordinates.push(currentRow);
      }

      // Group words in each row by their horizontal proximity
      const groupWords = (words, threshold) => {
        const groups = [];
        let currentGroup = [];

        words.forEach((word, index) => {
          if (currentGroup.length === 0) {
            currentGroup.push(word);
          } else {
            const previousWord = currentGroup[currentGroup.length - 1];
            const currentX = word.boundingBox.vertices[0].x;
            const previousXEnd = previousWord.boundingBox.vertices[1].x;

            if (currentX - previousXEnd <= threshold) {
              currentGroup.push(word);
            } else {
              groups.push(currentGroup);
              currentGroup = [word];
            }
          }

          if (index === words.length - 1) {
            groups.push(currentGroup);
          }
        });

        return groups;
      };

      // Create an array to hold extracted data
      const extractedData = [];

      // Draw borders around the content cells and collect data
      contentCoordinates.forEach(row => {
        const wordGroups = groupWords(row, 15); // Adjust the threshold as needed

        const rowData = {};

        wordGroups.forEach(group => {
          const xStart = Math.min(...group.map(word => word.boundingBox.vertices[0].x)) - 5;
          const xEnd = Math.max(...group.map(word => word.boundingBox.vertices[1].x)) + 5;
          const yStart = Math.min(...group.map(word => word.boundingBox.vertices[0].y)) - 5;
          const yEnd = Math.max(...group.map(word => word.boundingBox.vertices[3].y)) + 5;

          const column = Object.keys(columnBoundaries).find(header =>
              xStart >= columnBoundaries[header].xstart && xEnd <= columnBoundaries[header].xend
          );

          if (column) {
            const color = colors[column];
            drawBorder(image, {xstart: xStart, xend: xEnd, ystart: yStart, yend: yEnd}, color);
            rowData[column] = group.map(word => word.symbols.map(s => s.text).join('')).join(' ');
          }
        });

        if (Object.keys(rowData).length > 0) {
          extractedData.push(rowData);
        }
      });

      // Convert the image to a base64 string
      const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
      const base64Image = buffer.toString('base64');

      // Return the image and extracted data as JSON
      const data = {
        image: base64Image,
        data: extractedData
      };
      }

      /*return new Response(
          JSON.stringify(data),
          { headers: { "Content-Type": "application/json" } },
      );*/
      /*return res.json({
         image: base64Image,
         data: extractedData
       });*/


      return res.send(JSON.stringify(data, null, 2));


    } catch (error) {
      console.error(error);
      return res.status(500).send("An error occurred during image analysis.");
    }
  });
});


