const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { generateBarcodeImage } = require('../utils/barcodeUtil');

async function generateBonLivraisonPDF(commande, lignes, outputPath, depotInfo) {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(outputPath));

  // 🧾 Titre
  doc.fontSize(20).font('Helvetica-Bold').text('BON DE LIVRAISON', { align: 'center' });
  doc.moveDown();

  // 🔁 Déterminer si depotInfo est un mapping ou un dépôt global
  const isMapping = typeof depotInfo === 'object' && depotInfo !== null;
  const depotGlobal = isMapping ? null : depotInfo;
  const depotMapping = isMapping ? depotInfo : {};

  // 📋 En-tête
  doc.fontSize(9).font('Helvetica');
  doc.text(`Référence BL : ${commande.GP_NATUREPIECEG}/${commande.GP_SOUCHE}/${commande.GP_NUMERO}/${commande.GP_INDICEG}`);
  doc.text(`Date : ${new Date(commande.GP_DATECREATION).toLocaleDateString()}`);
  doc.text(`Client : ${commande.GP_TIERS}`);
  doc.text(`Adresse : ${commande.GP_ADRESSELIV || 'Non disponible'}`);
  doc.text(`Dépôt de préparation : ${depotGlobal ?? 'Variable par ligne'}`);
  doc.moveDown(1.5);

  // 📊 Colonnes
  const tableTop = doc.y;
  const colX = {
    designation: 50,
    code: 160,
    codeBarre: 230,
    depot: 310,
    qte: 370,
    pu: 410,
    tva: 460,
    total: 500,
  };

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Description', colX.designation, tableTop);
  doc.text('Code', colX.code, tableTop);
  doc.text('Code-B', colX.codeBarre, tableTop);
  doc.text('Dépôt', colX.depot, tableTop);
  doc.text('Qté', colX.qte, tableTop);
  doc.text('PU HT', colX.pu, tableTop);
  doc.text('TVA', colX.tva, tableTop);
  doc.text('Total', colX.total, tableTop);

  doc.moveTo(50, tableTop + 12).lineTo(550, tableTop + 12).stroke();

  // 📦 Lignes
  let y = tableTop + 20;
  let totalHT = 0;
  const tauxTVA = 0.19;

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    const libelle = ligne.GA_LIBELLE || '';
    const codeArticle = ligne.GL_ARTICLE.toString(); // 🔑 DOIT correspondre à la clé envoyée depuis Flutter
    const codeBarre = ligne.GA_CODEBARRE || '';
    const pu = parseFloat(ligne.GA_PVTTC || 0);
    const qte = parseFloat(ligne.GL_QTEFACT || 0);
    const remise = parseFloat(ligne.PROMO?.REMISE?.replace('%', '') || 0);
    const totalTTC = pu * qte * (1 - remise / 100);
    const totalHTLigne = +(totalTTC / (1 + tauxTVA)).toFixed(3);
    totalHT += totalHTLigne;

    const depotLigne = isMapping ? depotMapping[codeArticle] || '—' : depotGlobal || '—';

    doc.font('Helvetica').fontSize(8);
    doc.text(libelle, colX.designation, y);
    doc.text(codeArticle, colX.code, y);

    if (codeBarre) {
      const barcodePath = await generateBarcodeImage(codeBarre, `bl_barcode_${i}`);
      if (fs.existsSync(barcodePath)) {
        doc.image(barcodePath, colX.codeBarre, y, { width: 90, height: 25 });
      } else {
        doc.text(codeBarre, colX.codeBarre, y);
      }
    }

    doc.text(depotLigne, colX.depot, y);
    doc.text(qte.toString(), colX.qte, y);
    doc.text(`${pu.toFixed(2)}`, colX.pu, y);
    doc.text(`${(tauxTVA * 100).toFixed(0)}%`, colX.tva, y);
    doc.text(`${totalHTLigne.toFixed(2)}`, colX.total, y);

    y += 30;
  }

  // ➕ Total
  doc.moveTo(50, y).lineTo(550, y).stroke();
  y += 20;
  doc.font('Helvetica-Bold').text(`Total HT : ${totalHT.toFixed(2)} EUR`, { align: 'right' });

  // ✍️ Pied de page
  y += 40;
  doc.text('Préparé par : __________________________', 50, y);
  doc.text('Signature magasinier : _______________', 50, y + 20);
  doc.text('Date de préparation : ________________', 50, y + 40);

  doc.end();
}

module.exports = generateBonLivraisonPDF;
