// invoiceController.js

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { sql, poolPromise } = require('../db');
const generateInvoicePDF = require('../invoices/generateInvoicePDF');
const generateBonLivraisonPDF = require('../invoices/generateBonLivraisonPDF');

exports.generateAndDownloadInvoice = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  try {
    const pool = await poolPromise;

    const commandeResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`SELECT * FROM PIECE WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice`);

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
          A.GA_PVTTC,
          A.GA_CODEARTICLE,
          A.GA_CODEBARRE
        FROM LIGNE L
        LEFT JOIN ARTICLE A ON A.GA_ARTICLE = L.GL_ARTICLE
        WHERE L.GL_NATUREPIECEG=@nature AND L.GL_SOUCHE=@souche AND L.GL_NUMERO=@numero AND L.GL_INDICEG=@indice
      `);

    const lignes = [];
    for (const ligne of lignesResult.recordset) {
      const { GL_ARTICLE, GL_QTEFACT = 0, GA_PVTTC = 0 } = ligne;
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

    const filePath = path.join(__dirname, `../invoices/facture_${numero}.pdf`);
    await generateInvoicePDF(commande, lignes, filePath);

    setTimeout(() => {
      res.download(filePath, (err) => {
        if (err) console.error('Erreur lors du téléchargement du fichier PDF', err);
        fs.unlink(filePath, () => {});
      });
    }, 1000);

  } catch (err) {
    res.status(500).json({ message: 'Erreur génération facture.', error: err.message });
  }
};

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
        A.GA_CODEARTICLE
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
exports.generateBonLivraison = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  let { depot, depotsParArticle } = req.query;

  try {
    const pool = await poolPromise;

    // 1. Charger la commande source (ex: nature = 'CC')
    const commandeResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE 
        WHERE GP_NATUREPIECEG = @nature 
          AND GP_SOUCHE = @souche 
          AND GP_NUMERO = @numero 
          AND GP_INDICEG = @indice
      `);

    if (commandeResult.recordset.length === 0) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const commande = commandeResult.recordset[0];

    // 2. Mode dépôt personnalisé
    let parsedDepots = null;
    if (depotsParArticle) {
      try {
        parsedDepots = JSON.parse(depotsParArticle);
      } catch (err) {
        return res.status(400).json({ message: "Format invalide pour depotsParArticle" });
      }

      for (const [article, articleDepot] of Object.entries(parsedDepots)) {
        await pool.request()
          .input('depot', sql.NVarChar(10), articleDepot)
          .input('article', sql.NVarChar(50), article)
          .input('nature', sql.NVarChar(3), nature)
          .input('souche', sql.NVarChar(6), souche)
          .input('numero', sql.Int, parseInt(numero))
          .input('indice', sql.NVarChar(3), indice)
          .query(`
            UPDATE LIGNE
            SET GL_DEPOT = @depot
            WHERE GL_ARTICLE = @article
              AND GL_NATUREPIECEG = @nature
              AND GL_SOUCHE = @souche
              AND GL_NUMERO = @numero
              AND GL_INDICEG = @indice
          `);
      }

    } else {
      // 3. Dépôt unique global
      if (!depot && commande.GP_DEPOT) {
        depot = commande.GP_DEPOT;
      }

      if (depot) {
        await pool.request()
          .input('depot', sql.NVarChar(10), depot)
          .input('nature', sql.NVarChar(3), nature)
          .input('souche', sql.NVarChar(6), souche)
          .input('numero', sql.Int, parseInt(numero))
          .input('indice', sql.NVarChar(3), indice)
          .query(`
            UPDATE PIECE 
            SET GP_DEPOT = @depot 
            WHERE GP_NATUREPIECEG = @nature 
              AND GP_SOUCHE = @souche 
              AND GP_NUMERO = @numero 
              AND GP_INDICEG = @indice
          `);

        await pool.request()
          .input('depot', sql.NVarChar(10), depot)
          .input('nature', sql.NVarChar(3), nature)
          .input('souche', sql.NVarChar(6), souche)
          .input('numero', sql.Int, parseInt(numero))
          .input('indice', sql.NVarChar(3), indice)
          .query(`
            UPDATE LIGNE
            SET GL_DEPOT = @depot
            WHERE GL_NATUREPIECEG = @nature
              AND GL_SOUCHE = @souche
              AND GL_NUMERO = @numero
              AND GL_INDICEG = @indice
          `);

        commande.GP_DEPOT = depot;
      }
    }

    // 4. Charger les lignes originales
    const lignesResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM LIGNE 
        WHERE GL_NATUREPIECEG = @nature 
          AND GL_SOUCHE = @souche 
          AND GL_NUMERO = @numero 
          AND GL_INDICEG = @indice
      `);

    const lignes = lignesResult.recordset;

    // ================================
    // 5.1 Créer une nouvelle pièce BL
    // ================================
    const blNumeroRes = await pool.request().query(`
      SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS NewNumero 
      FROM PIECE WHERE GP_NATUREPIECEG = 'BL'
    `);
    const newBLNumero = blNumeroRes.recordset[0].NewNumero;

    const blSouche = 'BL001'; // adapte si nécessaire
    const blIndice = '1';

    await pool.request()
      .input('nature', sql.NVarChar(3), 'BL')
      .input('souche', sql.NVarChar(6), blSouche)
      .input('numero', sql.Int, newBLNumero)
      .input('indice', sql.NVarChar(3), blIndice)
      .input('tiers', sql.NVarChar(50), commande.GP_TIERS)
      .input('depot', sql.NVarChar(10), commande.GP_DEPOT)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DEPOT, GP_DATEPIECE)
        VALUES (@nature, @souche, @numero, @indice, @tiers, @depot, GETDATE())
      `);

    // ================================
    // 5.2 Copier les lignes
    // ================================
    for (const ligne of lignes) {
      await pool.request()
        .input('nature', sql.NVarChar(3), 'BL')
        .input('souche', sql.NVarChar(6), blSouche)
        .input('numero', sql.Int, newBLNumero)
        .input('indice', sql.NVarChar(3), blIndice)
        .input('article', sql.NVarChar(50), ligne.GL_ARTICLE)
        .input('quantite', sql.Decimal(18, 2), ligne.GL_QTEFACT || 1)
        .input('depot', sql.NVarChar(10), ligne.GL_DEPOT)
        .query(`
          INSERT INTO LIGNE (GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG, GL_ARTICLE, GL_QTEFACT, GL_DEPOT)
          VALUES (@nature, @souche, @numero, @indice, @article, @quantite, @depot)
        `);
    }

    // 6. Générer le PDF
    const filePath = path.join(__dirname, `../invoices/bl_${newBLNumero}.pdf`);
    const depotInfo = parsedDepots || commande.GP_DEPOT || '—';
    await generateBonLivraisonPDF(commande, lignes, filePath, depotInfo);

    // 7. Téléchargement + suppression
    setTimeout(() => {
      res.download(filePath, (err) => {
        if (err) console.error('Erreur téléchargement BL', err);
        fs.unlink(filePath, () => {});
      });
    }, 500);

  } catch (err) {
    console.error('Erreur génération BL', err);
    res.status(500).json({ message: 'Erreur génération PDF BL', error: err.message });
  }
};
function getDepotUniqueIfAllSame(depotsMap) {
  if (!depotsMap || typeof depotsMap !== 'object') return null;
  const depots = Object.values(depotsMap);
  const unique = [...new Set(depots)];
  return unique.length === 1 ? unique[0] : null;
}

exports.generateBonLivraison = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  let { depot, depotsParArticle } = req.query;

  try {
    const pool = await poolPromise;

    // 1. Charger la commande source
    const commandeResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE 
        WHERE GP_NATUREPIECEG = @nature 
          AND GP_SOUCHE = @souche 
          AND GP_NUMERO = @numero 
          AND GP_INDICEG = @indice
      `);

    if (commandeResult.recordset.length === 0) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    const commande = commandeResult.recordset[0];
    let parsedDepots = null;

    // 2. Mise à jour des dépôts
    if (depotsParArticle) {
      try {
        parsedDepots = JSON.parse(depotsParArticle);
      } catch (err) {
        return res.status(400).json({ message: "Format invalide pour depotsParArticle" });
      }

      for (const [article, articleDepot] of Object.entries(parsedDepots)) {
        await pool.request()
          .input('depot', sql.NVarChar(10), articleDepot)
          .input('article', sql.NVarChar(50), article)
          .input('nature', sql.NVarChar(3), nature)
          .input('souche', sql.NVarChar(6), souche)
          .input('numero', sql.Int, parseInt(numero))
          .input('indice', sql.NVarChar(3), indice)
          .query(`
            UPDATE LIGNE
            SET GL_DEPOT = @depot
            WHERE GL_ARTICLE = @article
              AND GL_NATUREPIECEG = @nature
              AND GL_SOUCHE = @souche
              AND GL_NUMERO = @numero
              AND GL_INDICEG = @indice
          `);
      }
    } else {
      if (!depot && commande.GP_DEPOT) depot = commande.GP_DEPOT;

      if (depot) {
        await pool.request()
          .input('depot', sql.NVarChar(10), depot)
          .input('nature', sql.NVarChar(3), nature)
          .input('souche', sql.NVarChar(6), souche)
          .input('numero', sql.Int, parseInt(numero))
          .input('indice', sql.NVarChar(3), indice)
          .query(`
            UPDATE PIECE 
            SET GP_DEPOT = @depot 
            WHERE GP_NATUREPIECEG = @nature 
              AND GP_SOUCHE = @souche 
              AND GP_NUMERO = @numero 
              AND GP_INDICEG = @indice
          `);

        await pool.request()
          .input('depot', sql.NVarChar(10), depot)
          .input('nature', sql.NVarChar(3), nature)
          .input('souche', sql.NVarChar(6), souche)
          .input('numero', sql.Int, parseInt(numero))
          .input('indice', sql.NVarChar(3), indice)
          .query(`
            UPDATE LIGNE
            SET GL_DEPOT = @depot
            WHERE GL_NATUREPIECEG = @nature
              AND GL_SOUCHE = @souche
              AND GL_NUMERO = @numero
              AND GL_INDICEG = @indice
          `);

        commande.GP_DEPOT = depot;
      }
    }

    // 3. Récupérer les lignes
    const lignesResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT 
          L.*, 
          A.GA_LIBELLE, 
          A.GA_PVTTC, 
          A.GA_CODEARTICLE, 
          A.GA_CODEBARRE
        FROM LIGNE L
        LEFT JOIN ARTICLE A ON A.GA_ARTICLE = L.GL_ARTICLE
        WHERE L.GL_NATUREPIECEG = @nature
          AND L.GL_SOUCHE = @souche
          AND L.GL_NUMERO = @numero
          AND L.GL_INDICEG = @indice
      `);

    const lignes = lignesResult.recordset;

    // 4. Créer le BL
    const blNumeroRes = await pool.request().query(`
      SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS NewNumero 
      FROM PIECE WHERE GP_NATUREPIECEG = 'BL'
    `);

    const newBLNumero = blNumeroRes.recordset[0].NewNumero;
    const blSouche = 'BL001';
    const blIndice = '1';
    const depotBL = parsedDepots ? getDepotUniqueIfAllSame(parsedDepots) : commande.GP_DEPOT;

    await pool.request()
      .input('nature', sql.NVarChar(3), 'BL')
      .input('souche', sql.NVarChar(6), blSouche)
      .input('numero', sql.Int, newBLNumero)
      .input('indice', sql.NVarChar(3), blIndice)
      .input('tiers', sql.NVarChar(50), commande.GP_TIERS)
      .input('depot', sql.NVarChar(10), depotBL)
      .input('statut', sql.NVarChar(20), 'ATT') // Nouveau statut initial
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DEPOT, GP_DATEPIECE, GP_STATUTPIECE)
        VALUES (@nature, @souche, @numero, @indice, @tiers, @depot, GETDATE(), @statut)
      `);

    // 5. Copier les lignes vers le BL
    for (const ligne of lignes) {
      await pool.request()
        .input('nature', sql.NVarChar(3), 'BL')
        .input('souche', sql.NVarChar(6), blSouche)
        .input('numero', sql.Int, newBLNumero)
        .input('indice', sql.NVarChar(3), blIndice)
        .input('article', sql.NVarChar(50), ligne.GL_ARTICLE)
        .input('quantite', sql.Decimal(18, 2), ligne.GL_QTEFACT || 1)
        .input('depot', sql.NVarChar(10), ligne.GL_DEPOT)
        .query(`
          INSERT INTO LIGNE (
            GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG,
            GL_ARTICLE, GL_QTEFACT, GL_DEPOT
          )
          VALUES (
            @nature, @souche, @numero, @indice,
            @article, @quantite, @depot
          )
        `);
    }

    // 6. Générer le PDF
    const filePath = path.join(__dirname, `../invoices/bl_${newBLNumero}.pdf`);
    const depotInfo = parsedDepots || depotBL || '---';
    await generateBonLivraisonPDF({
      ...commande,
      GP_NATUREPIECEG: 'BL',
      GP_SOUCHE: blSouche,
      GP_NUMERO: newBLNumero,
      GP_INDICEG: blIndice,
      GP_DEPOT: depotBL
    }, lignes, filePath, depotInfo);

    // 7. Téléchargement
    setTimeout(() => {
      res.download(filePath, (err) => {
        if (err) console.error('Erreur téléchargement BL', err);
        fs.unlink(filePath, () => {});
      });
    }, 500);

  } catch (err) {
    console.error('Erreur génération BL', err);
    res.status(500).json({ message: 'Erreur génération PDF BL', error: err.message });
  }
};
exports.marquerBLCommeExpedie = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    if (!nature || !souche || !numero || !indice) {
      return res.status(400).json({ message: "Paramètres manquants." });
    }

    const pool = await poolPromise;

    // Vérifier si le BL existe
    const blCheck = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG = @nature
          AND GP_SOUCHE = @souche
          AND GP_NUMERO = @numero
          AND GP_INDICEG = @indice
      `);

    if (blCheck.recordset.length === 0) {
      return res.status(404).json({ message: "BL introuvable." });
    }

    // Mettre à jour le statut
    await pool.request()
      .input('statut', sql.NVarChar(20), 'EXP')
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        UPDATE PIECE
        SET GP_STATUTPIECE = @statut
        WHERE GP_NATUREPIECEG = @nature
          AND GP_SOUCHE = @souche
          AND GP_NUMERO = @numero
          AND GP_INDICEG = @indice
      `);

    res.status(200).json({ message: "BL marqué comme expédié." });

  } catch (err) {
    console.error("Erreur mise à jour statut :", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
exports.downloadExistingBonLivraison = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  const filePath = path.join(__dirname, `../invoices/bl_${numero}.pdf`);
  
  if (fs.existsSync(filePath)) {
    return res.download(filePath);
  } else {
    return res.status(404).json({ message: "BL introuvable" });
  }
};
