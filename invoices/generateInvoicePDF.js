const PDFDocument = require('pdfkit');
const fs = require('fs');

function generateInvoicePDF(commande, lignes, outputPath) {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(outputPath));

  // (Optionnel) Ajouter un logo
  // doc.image('path/to/logo.png', 50, 45, { width: 100 }); 

  // Titre
  doc.fontSize(26).text('Facture', { align: 'center' });
  doc.moveDown();

  // Infos commande
  doc.fontSize(12);
  doc.text(`Numéro : ${commande.GP_NUMERO}`);
  doc.text(`Date : ${new Date(commande.GP_DATECREATION).toLocaleDateString()}`);
  doc.text(`Client : ${commande.GP_TIERS}`);
  doc.moveDown();

  // Ligne de séparation
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(1);

  // Titre Articles
  doc.fontSize(14).font('Helvetica-Bold').text('Articles :');
  doc.moveDown(0.5);

  // Tableau en-tête
  const tableTop = doc.y;
  const itemX = 50;
  const quantityX = 220;
  const unitPriceX = 300;
  const remiseX = 390;
  const totalX = 460;

  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('Article', itemX, tableTop);
  doc.text('Quantité', quantityX, tableTop);
  doc.text('Prix Unitaire', unitPriceX, tableTop);
  doc.text('Remise', remiseX, tableTop);
  doc.text('Total Après Remise', totalX, tableTop);

  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11);

  lignes.forEach((ligne, i) => {
    const y = tableTop + 25 + (i * 20);
    doc.text(ligne.GL_ARTICLE, itemX, y);
    doc.text(ligne.GL_QTEFACT.toString(), quantityX, y);
    doc.text(`${ligne.GA_PVTTC} DT`, unitPriceX, y);
    doc.text(ligne.PROMO.REMISE, remiseX, y);
    doc.text(`${ligne.TOTAL_APRES_REMISE} DT`, totalX, y);
  });

  // Redessiner une ligne sous les articles
  const tableBottom = tableTop + 25 + (lignes.length * 20) + 10;
  doc.moveTo(50, tableBottom).lineTo(550, tableBottom).stroke();

  doc.moveDown(2);

  // Total TTC
  doc.font('Helvetica-Bold')
    .fontSize(14)
    .text(`Total TTC Facture : ${commande.GP_TOTALTTC} DT`, { align: 'right' });

  doc.end();
}
/*function generateReturnPDF(retour, lignes, outputPath) {
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
}*/
module.exports = generateInvoicePDF;