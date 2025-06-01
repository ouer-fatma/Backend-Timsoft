const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { generateBarcodeImage } = require('../utils/barcodeUtil');

async function generateInvoicePDF(commande, lignes, outputPath) {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(outputPath));

  doc.fontSize(20).font('Helvetica-Bold').text('FACTURE', { align: 'center' });
  doc.moveDown();

  doc.fontSize(9).font('Helvetica');
  doc.text(`Numéro de facture : ${commande.GP_NUMERO}`);
  doc.text(`Date de facture : ${new Date(commande.GP_DATECREATION).toLocaleDateString()}`);
  doc.text(`Client : ${commande.GP_TIERS}`);
  doc.moveDown(1.5);

  const tableTop = doc.y;
  const colX = {
    description: 50,
    code: 180,
    codeBarre: 250,
    tva: 370,
    pu: 410,
    qte: 460,
    totalHT: 500,
  };

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Description', colX.description, tableTop);
  doc.text('Code', colX.code, tableTop);
  doc.text('Code-B', colX.codeBarre, tableTop);
  doc.text('TVA', colX.tva, tableTop);
  doc.text('PU', colX.pu, tableTop);
  doc.text('Qté', colX.qte, tableTop);
  doc.text('HT', colX.totalHT, tableTop);

  doc.moveTo(50, tableTop + 12).lineTo(550, tableTop + 12).stroke();

  let y = tableTop + 20;
  let totalHT = 0;
  const tauxTVA = 0.19;

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    const libelle = ligne.GA_LIBELLE || '';
    const codeArticle = ligne.GA_CODEARTICLE || ligne.GL_ARTICLE;
    const codeBarre = ligne.GA_CODEBARRE || '';
    const pu = parseFloat(ligne.GA_PVTTC || 0);
    const remise = parseFloat(ligne.PROMO?.REMISE?.replace('%', '') || 0);
    const qte = parseFloat(ligne.GL_QTEFACT || 0);
    const totalTTC = pu * qte * (1 - remise / 100);
    const totalHTLigne = +(totalTTC / (1 + tauxTVA)).toFixed(3);
    totalHT += totalHTLigne;

    doc.font('Helvetica').fontSize(8);
    doc.text(libelle, colX.description, y);
    doc.text(codeArticle, colX.code, y);

    if (codeBarre) {
      const barcodePath = await generateBarcodeImage(codeBarre, `barcode_${i}`);
      if (fs.existsSync(barcodePath)) {
        doc.image(barcodePath, colX.codeBarre, y, { width: 90, height: 25 });
      } else {
        doc.text(codeBarre, colX.codeBarre, y);
      }
    }

    doc.text(`${(tauxTVA * 100).toFixed(0)}%`, colX.tva, y);
    doc.text(`${pu.toFixed(2)} DT`, colX.pu, y);
    doc.text(qte.toString(), colX.qte, y);
    doc.text(`${totalHTLigne.toFixed(2)} DT`, colX.totalHT, y);

    y += 30;
  }

  doc.moveTo(50, y).lineTo(550, y).stroke();

  const totalTVA = +(totalHT * tauxTVA).toFixed(3);
  const totalTTC = +(totalHT + totalTVA).toFixed(3);

  y += 30;
  doc.font('Helvetica-Bold').fontSize(9).text('TVA APPLIQUÉE', 50, y);
  y += 15;

  doc.font('Helvetica-Bold');
  doc.text('PRIX H.T.', 50, y);
  doc.text('TVA', 200, y);
  doc.text('MONTANT TVA', 300, y);
  y += 15;
  doc.moveTo(50, y).lineTo(550, y).stroke();

  y += 5;
  doc.font('Helvetica');
  doc.text(`${totalHT.toFixed(2)}`, 50, y);
  doc.text(`${(tauxTVA * 100).toFixed(2)}%`, 200, y);
  doc.text(`${totalTVA.toFixed(2)}`, 300, y);

  y += 30;
  doc.font('Helvetica-Bold').text('TOTAL', 50, y);
  y += 15;

  doc.rect(50, y, 200, 20).stroke();
  doc.text('MONTANT EUR (T.T.C)', 55, y + 5);

  doc.rect(250, y, 100, 20).fillAndStroke('#eeeeee', 'black');
  doc.fillColor('black').text(`${totalTTC.toFixed(2)}`, 255, y + 5);

  doc.end();
}

module.exports = generateInvoicePDF;
