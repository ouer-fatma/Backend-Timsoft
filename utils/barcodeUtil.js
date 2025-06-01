// 📁 utils/barcodeUtil.js
const bwipjs = require('bwip-js');
const fs = require('fs');
const path = require('path');

async function generateBarcodeImage(code, filename) {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',       // Barcode type
    text: code,            // Text to encode
    scale: 2,              // 2x scaling
    height: 10,            // Bar height, in millimeters
    includetext: true,     // Show human-readable text
    textxalign: 'center',
  });

  const barcodeDir = path.join(__dirname, '../barcodes');
  if (!fs.existsSync(barcodeDir)) {
    fs.mkdirSync(barcodeDir);
  }

  const fullPath = path.join(barcodeDir, `${filename}.png`);
  fs.writeFileSync(fullPath, png);
  return fullPath;
}

module.exports = { generateBarcodeImage };
