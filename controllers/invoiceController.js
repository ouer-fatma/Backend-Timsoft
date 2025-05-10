exports.generateAndDownloadInvoice = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  const { sql, poolPromise } = require('../db'); // <-- rajoute cette ligne
  const PDFDocument = require('pdfkit');
  const fs = require('fs');
  const path = require('path');
  const generateInvoicePDF = require('../invoices/generateInvoicePDF'); // pour utiliser ta fonction
  
  try {
    const pool = await poolPromise;

    const commandeResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query('SELECT * FROM PIECE WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice');

    if (commandeResult.recordset.length === 0) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const commande = commandeResult.recordset[0];
    const GP_TIERS = commande.GP_TIERS?.trim();

    const lignesResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT 
          L.*, 
          A.GA_LIBELLE, 
          A.GA_PVTTC
        FROM LIGNE L
        LEFT JOIN ARTICLE A ON A.GA_ARTICLE = L.GL_ARTICLE
        WHERE L.GL_NATUREPIECEG=@nature AND L.GL_SOUCHE=@souche AND L.GL_NUMERO=@numero AND L.GL_INDICEG=@indice
      `);

    const lignes = [];

    for (const ligne of lignesResult.recordset) {
      const { GL_ARTICLE, GL_QTEFACT = 0, GA_PVTTC = 0 } = ligne;

      // Chercher la remise
      const remiseResult = await pool.request()
        .input('gaArticle', sql.NVarChar, GL_ARTICLE.trim())
        .input('codeTiers', sql.NVarChar, GP_TIERS)
        .input('dateCommande', sql.DateTime, commande.GP_DATECREATION)
        .query(`
          SELECT TOP 1 MLR_REMISE, MLR_CODECOND
          FROM REMISE
          WHERE RTRIM(MLR_ORGREMISE) = @gaArticle
            AND RTRIM(MLR_CODECOND) = @codeTiers
            AND MLR_DATEPIECE <= @dateCommande
          ORDER BY MLR_DATEPIECE DESC
        `);

      const promo = remiseResult.recordset[0] || { MLR_REMISE: 0, MLR_CODECOND: 'N/A' };

      const remisePourcent = promo.MLR_REMISE || 0;
      const prixAvantRemise = GA_PVTTC;
      const montantRemise = (prixAvantRemise * GL_QTEFACT * remisePourcent) / 100;
      const prixApresRemise = (prixAvantRemise * GL_QTEFACT) - montantRemise;

      lignes.push({
        ...ligne,
        PROMO: {
          REMISE: `${remisePourcent}%`,
          CODE_COND: promo?.MLR_CODECOND || '',
          REMISE_MONTANT: montantRemise.toFixed(2),
        },
        TOTAL_AVANT_REMISE: (prixAvantRemise * GL_QTEFACT).toFixed(2),
        TOTAL_APRES_REMISE: prixApresRemise.toFixed(2)
      });
    }

    // Générer le PDF
    const filePath = path.join(__dirname, `../invoices/facture_${numero}.pdf`);
    generateInvoicePDF(commande, lignes, filePath);

    setTimeout(() => {
      res.download(filePath, (err) => {
        if (err) {
          console.error('Erreur lors du téléchargement du fichier PDF', err);
        }
        fs.unlink(filePath, (err) => {
          if (err) console.error('Erreur suppression fichier temporaire', err);
        });
      });
    }, 1000);

  } catch (err) {
    res.status(500).json({ message: 'Erreur génération facture.', error: err.message });
  }
};
const nodemailer = require('nodemailer');
const generateInvoicePDF = require('../invoices/generateInvoicePDF');
const path = require('path');
const fs = require('fs');
const { sql, poolPromise } = require('../db');

exports.sendInvoiceByEmail = async (req, res) => {
const { nature, souche, numero, indice, email } = req.body;

try {
  const pool = await poolPromise;

  // Récupérer la commande
  const commandeResult = await pool.request()
    .input('nature', sql.NVarChar(3), nature)
    .input('souche', sql.NVarChar(6), souche)
    .input('numero', sql.Int, parseInt(numero))
    .input('indice', sql.NVarChar(3), indice)
    .query('SELECT * FROM PIECE WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice');

  if (commandeResult.recordset.length === 0) {
    return res.status(404).json({ message: "Commande introuvable." });
  }

  const commande = commandeResult.recordset[0];
  const GP_TIERS = commande.GP_TIERS?.trim();

  // Récupérer les lignes
  const lignesResult = await pool.request()
    .input('nature', sql.NVarChar(3), nature)
    .input('souche', sql.NVarChar(6), souche)
    .input('numero', sql.Int, parseInt(numero))
    .input('indice', sql.NVarChar(3), indice)
    .query(`
      SELECT 
        L.*, 
        A.GA_LIBELLE, 
        A.GA_PVTTC
      FROM LIGNE L
      LEFT JOIN ARTICLE A ON A.GA_ARTICLE = L.GL_ARTICLE
      WHERE L.GL_NATUREPIECEG=@nature AND L.GL_SOUCHE=@souche AND L.GL_NUMERO=@numero AND L.GL_INDICEG=@indice
    `);

  const lignes = [];

  // Pour chaque ligne, recalculer les remises et totaux
  for (const ligne of lignesResult.recordset) {
    const { GL_ARTICLE, GL_QTEFACT = 0, GA_PVTTC = 0 } = ligne;

    // Récupérer la remise si elle existe
    const remiseResult = await pool.request()
      .input('gaArticle', sql.NVarChar, GL_ARTICLE.trim())
      .input('codeTiers', sql.NVarChar, GP_TIERS)
      .input('dateCommande', sql.DateTime, commande.GP_DATECREATION)
      .query(`
        SELECT TOP 1 MLR_REMISE, MLR_CODECOND
        FROM REMISE
        WHERE RTRIM(MLR_ORGREMISE) = @gaArticle
          AND RTRIM(MLR_CODECOND) = @codeTiers
          AND MLR_DATEPIECE <= @dateCommande
        ORDER BY MLR_DATEPIECE DESC
      `);

    const promo = remiseResult.recordset[0] || { MLR_REMISE: 0, MLR_CODECOND: 'N/A' };

    const remisePourcent = promo.MLR_REMISE || 0;
    const prixAvantRemise = GA_PVTTC;
    const montantRemise = (prixAvantRemise * GL_QTEFACT * remisePourcent) / 100;
    const prixApresRemise = (prixAvantRemise * GL_QTEFACT) - montantRemise;

    lignes.push({
      ...ligne,
      PROMO: {
        REMISE: `${remisePourcent}%`,
        CODE_COND: promo?.MLR_CODECOND || '',
        REMISE_MONTANT: montantRemise.toFixed(2),
      },
      TOTAL_AVANT_REMISE: (prixAvantRemise * GL_QTEFACT).toFixed(2),
      TOTAL_APRES_REMISE: prixApresRemise.toFixed(2)
    });
  }

  // 1. Générer le PDF temporaire
  const pdfPath = path.join(__dirname, `../invoices/facture_${numero}.pdf`);
  generateInvoicePDF(commande, lignes, pdfPath);

  // 2. Envoyer l'email après que le fichier soit généré
  setTimeout(async () => {

    // Configurer nodemailer
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'tonemail@gmail.com', // <-- Ton email expéditeur
        pass: 'tonMotDePasseApp'    // <-- Mot de passe d'application Gmail
      }
    });

    // Définir le contenu de l'email
    const mailOptions = {
      from: 'tonemail@gmail.com',
      to: email,
      subject: `Votre facture n°${commande.GP_NUMERO}`,
      text: 'Bonjour,\n\nVeuillez trouver ci-joint votre facture.\n\nMerci.',
      attachments: [
        {
          filename: `facture_${numero}.pdf`,
          path: pdfPath
        }
      ]
    };

    // Envoyer l'email
    await transporter.sendMail(mailOptions);

    // Supprimer le fichier PDF temporaire après envoi
    fs.unlinkSync(pdfPath);

    res.status(200).json({ message: "Facture envoyée par email avec succès." });

  }, 1000);

} catch (err) {
  res.status(500).json({ message: "Erreur lors de l'envoi de la facture.", error: err.message });
}
};