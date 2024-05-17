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

exports.analyzeImageHttp = functions.https.onRequest(async (req, res) => {
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
    const imageResponse = await axios({ url: imageUrl, responseType: 'arraybuffer' });
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
          drawBorder(image, { xstart: xStart, xend: xEnd, ystart: yStart, yend: yEnd }, color);
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
    return res.json({
      image: base64Image,
      data: extractedData
    });

  } catch (error) {
    console.error(error);
    return res.status(500).send("An error occurred during image analysis.");
  }
});


exports.extractProducts = functions.https.onRequest(async (req, res) => {


  try {
    const { rows } = req.body;

    if (!rows || !Array.isArray(rows)) {
      return res.status(400).send("No valid rows provided.");
    }

    trainAndSaveModel();


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