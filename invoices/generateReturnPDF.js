const PDFDocument = require('pdfkit');
const fs = require('fs');

function generateReturnPDF(retour, lignes, outputPath) {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(outputPath));

  doc.fontSize(26).text('Confirmation de Retour', { align: 'center' });
  doc.moveDown();

  doc.fontSize(12);
  doc.text(`N° Retour : ${retour.GP_NUMERO}`);
  doc.text(`Date : ${new Date(retour.GP_DATEPIECE).toLocaleDateString()}`);
  doc.text(`Client : ${retour.GP_TIERS}`);
  doc.moveDown();

  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(1);

  doc.fontSize(14).font('Helvetica-Bold').text('Articles retournés :');
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const itemX = 50;
  const quantityX = 300;

  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('Article', itemX, tableTop);
  doc.text('Quantité', quantityX, tableTop);

  doc.font('Helvetica').fontSize(11);
  lignes.forEach((ligne, i) => {
    const y = tableTop + 25 + (i * 20);
    doc.text(ligne.GL_ARTICLE, itemX, y);
    doc.text(Math.abs(ligne.GL_QTEFACT).toString(), quantityX, y);
  });

  doc.end();
}

module.exports = generateReturnPDF;
