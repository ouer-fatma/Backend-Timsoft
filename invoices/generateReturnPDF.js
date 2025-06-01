const PDFDocument = require('pdfkit');
const fs = require('fs');

function generateReturnPDF(retour, lignes, outputPath) {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(outputPath));

  doc.fontSize(20).text('Avoir Client (Retour)', { align: 'center' });
  doc.moveDown();

  doc.fontSize(10);
  doc.text(`N° Avoir : ${retour.GP_NUMERO}`);
  doc.text(`Date : ${new Date(retour.GP_DATEPIECE).toLocaleDateString()}`);
  doc.text(`Client : ${retour.GP_TIERS}`);
  doc.text(`Mode de retour : ${retour.GP_MODERETOUR}`);
  doc.text(`Statut : ${retour.GP_STATUTRETOUR}`);
  doc.moveDown(1.5);

  // Table headers
  const tableTop = doc.y;
  const x = { article: 50, libelle: 130, qte: 300, pu: 350, ht: 420 };

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Code', x.article, tableTop);
  doc.text('Libellé', x.libelle, tableTop);
  doc.text('Qté', x.qte, tableTop);
  doc.text('PU', x.pu, tableTop);
  doc.text('HT', x.ht, tableTop);
  doc.moveTo(50, tableTop + 12).lineTo(550, tableTop + 12).stroke();

  // Variables
  const tauxTVA = 0.19;
  let y = tableTop + 20;
  let totalHT = 0;

  // Articles
  lignes.forEach(ligne => {
    const pu = parseFloat(ligne.GA_PVTTC ?? 0);
    const qte = Math.abs(parseFloat(ligne.GL_QTEFACT ?? 0));
    const totalLigneTTC = pu * qte;
    const totalLigneHT = +(totalLigneTTC / (1 + tauxTVA)).toFixed(3);
    totalHT += totalLigneHT;

    doc.font('Helvetica').fontSize(9);
    doc.text(ligne.GA_CODEARTICLE || ligne.GL_ARTICLE, x.article, y);
    doc.text(ligne.GA_LIBELLE || '', x.libelle, y);
    doc.text(qte.toString(), x.qte, y);
    doc.text(`${pu.toFixed(2)} DT`, x.pu, y);
    doc.text(`${totalLigneHT.toFixed(2)} DT`, x.ht, y);

    y += 18;
  });

  doc.moveTo(50, y).lineTo(550, y).stroke();

  // Totaux
  const totalTVA = +(totalHT * tauxTVA).toFixed(3);
  const totalTTC = +(totalHT + totalTVA).toFixed(3);

  y += 25;
  doc.font('Helvetica-Bold').fontSize(9).text('RÉCAPITULATIF', 50, y);
  y += 15;

  doc.font('Helvetica');
  doc.text(`Sous-total HT : ${totalHT.toFixed(2)} DT`, 50, y);
  y += 15;
  doc.text(`TVA (19%) : ${totalTVA.toFixed(2)} DT`, 50, y);
  y += 15;
  doc.font('Helvetica-Bold').text(`Total TTC : ${totalTTC.toFixed(2)} DT`, 50, y);

  doc.end();
}

module.exports = generateReturnPDF;
