//orderController
const Order = require('../models/Order');
const { sql, poolPromise, dbConfig } = require('../db');


// Récupérer toutes les commandes
exports.getAllOrders = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT TOP 100 * FROM PIECE');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commandes.', error: err.message });
  }
};

// Récupérer une commande par son identifiant composite
exports.getOrderById = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GP_SOUCHE', sql.NVarChar(6), souche)
      .input('GP_NUMERO', sql.Int, parseInt(numero))
      .input('GP_INDICEG', sql.NVarChar(3), indice)
      .query('SELECT * FROM PIECE WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commande.', error: err.message });
  }
};



exports.getOrdersByCodeTiers = async (req, res) => {
  const codeTiers = req.params.codeTiers;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
  .input('codeTiers', sql.NVarChar, codeTiers)
  .query(`
    SELECT 
      GP_NUMERO,
      GP_TIERS,
      GP_DATECREATION,
      GP_STATUTPIECE,
      GP_SOUCHE,
      GP_NATUREPIECEG,
      GP_INDICEG
    FROM PIECE 
    WHERE GP_TIERS = @codeTiers 
      AND GP_NATUREPIECEG = 'CC' 
    ORDER BY GP_DATECREATION DESC
  `);

    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commandes client.', error: err.message });
  }
};



exports.getOrderDetails = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;

    // 1. Récupérer la commande
    const pieceResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice
      `);

    if (pieceResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    const commande = pieceResult.recordset[0];
    const GP_TIERS = commande.GP_TIERS?.trim();

    // 2. Récupérer les lignes
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
    let totalApresRemise = 0; // <-- Nouveau : total après remise

    for (const ligne of lignesResult.recordset) {
      const { GL_ARTICLE, GL_QTEFACT = 0, GA_PVTTC = 0 } = ligne;

      const remiseResult = await pool.request()
        .input('gaArticle', sql.NVarChar, GL_ARTICLE.trim())
        .input('codeTiers', sql.NVarChar, GP_TIERS)
        .input('dateCommande', sql.DateTime, commande.GP_DATECREATION)
        .query(`
          SELECT TOP 1 MLR_REMISE, GTR_LIBELLE, MLR_CODECOND, MLR_MONTANTTTCDEV
          FROM REMISE
          WHERE RTRIM(MLR_ORGREMISE) = @gaArticle
            AND RTRIM(MLR_CODECOND) = @codeTiers
            AND MLR_DATEPIECE <= @dateCommande
          ORDER BY MLR_DATEPIECE DESC
        `);

      const promo = remiseResult.recordset[0] || {
        MLR_REMISE: 0,
        GTR_LIBELLE: 'Aucune remise',
        MLR_CODECOND: 'N/A',
        MLR_MONTANTTTCDEV: 0
      };

      const remisePourcent = promo.MLR_REMISE || 0;
      const montantRemise = (GA_PVTTC * GL_QTEFACT * remisePourcent) / 100;
      const totalLigneApresRemise = parseFloat((GA_PVTTC * GL_QTEFACT - montantRemise).toFixed(2));

      totalApresRemise += totalLigneApresRemise; // <-- On additionne ligne par ligne

      lignes.push({
        ...ligne,
        GL_TOTALLIGNE: totalLigneApresRemise,
        GL_NUMPIECE: `${nature}/${souche}/${numero}/${indice}`,
        PROMO: {
          REMISE: `${remisePourcent}%`,
          LIBELLE: promo?.GTR_LIBELLE || '',
          CODE_COND: promo?.MLR_CODECOND || '',
          REMISE_MONTANT: parseFloat(montantRemise.toFixed(2))
        }
      });
    }

    res.status(200).json({
      commande,
      lignes,
      TOTAL_APRES_REMISE: parseFloat(totalApresRemise.toFixed(2)) // <-- Ici on l'affiche dans la réponse
    });

  } catch (err) {
    res.status(500).json({
      message: 'Erreur lors de la récupération des détails de la commande.',
      error: err.message
    });
  }
};

exports.getNextOrderNumero = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query(`SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS nextNumero FROM PIECE WHERE GP_NATUREPIECEG = 'CMD'`);

    res.status(200).json({ nextNumero: result.recordset[0].nextNumero }); // ✅ ← important
  } catch (err) {
    console.error("Erreur génération numéro commande :", err);
    res.status(500).json({ message: 'Erreur génération numéro' });
  }
};



// Créer une commande + lignes de commande avec calcul auto + remises
exports.createOrder = async (req, res) => {
  const {
    GP_NATUREPIECEG = 'CC',
    GP_SOUCHE,
    GP_INDICEG = 1,
    GP_DATECREATION,
    GP_LIBRETIERS1,
    GP_DEPOT
  } = req.body;

  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Utilisateur non authentifié." });

  const isRetrait = GP_LIBRETIERS1?.startsWith('S');
  if (!GP_LIBRETIERS1 || (isRetrait && !GP_DEPOT)) {
    return res.status(400).json({ message: 'Mode de livraison ou dépôt retrait manquant.' });
  }

  if (!GP_SOUCHE || !GP_DATECREATION) {
    return res.status(400).json({ message: 'Champs obligatoires manquants.' });
  }

  try {
    const pool = await poolPromise;

    const userResult = await pool.request()
      .input('id', sql.Int, userId)
      .query('SELECT CodeTiers FROM Utilisateur WHERE ID_Utilisateur = @id');

    const GP_TIERS = userResult.recordset[0]?.CodeTiers;
    if (!GP_TIERS) return res.status(400).json({ message: "CodeTiers manquant pour l'utilisateur." });

    // Générer un numéro unique de commande
    const numeroResult = await pool.request()
      .input('nature', sql.NVarChar(3), GP_NATUREPIECEG)
      .query(`
        SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS nextNumero
        FROM PIECE WHERE GP_NATUREPIECEG = @nature
      `);

    const GP_NUMERO = numeroResult.recordset[0].nextNumero;

    const panierResult = await pool.request()
      .input('codeTiers', sql.NVarChar, GP_TIERS)
      .query(`
        SELECT TOP 1 GP_SOUCHE, GP_NUMERO, GP_INDICEG
        FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
        ORDER BY GP_DATEPIECE DESC
      `);

    if (panierResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucun panier trouvé pour ce client.' });
    }

    const { GP_SOUCHE: PAN_SOUCHE, GP_NUMERO: PAN_NUMERO, GP_INDICEG: PAN_INDICEG } = panierResult.recordset[0];

    const lignesResult = await pool.request()
      .input('nature', sql.NVarChar, 'PAN')
      .input('souche', sql.NVarChar, PAN_SOUCHE)
      .input('numero', sql.BigInt, PAN_NUMERO)
      .input('indice', sql.NVarChar, PAN_INDICEG.toString())
      .input('tiers', sql.NVarChar, GP_TIERS)
      .query(`
        SELECT * FROM LIGNE
        WHERE GL_NATUREPIECEG = @nature AND GL_SOUCHE = @souche
          AND GL_NUMERO = @numero AND GL_INDICEG = @indice
          AND GL_TIERS = @tiers
      `);

    const lignes = lignesResult.recordset;
    if (!Array.isArray(lignes) || lignes.length === 0) {
      return res.status(400).json({ message: 'Panier vide.' });
    }

    let GP_TOTALHT = 0;
    let GP_TOTALTTC = 0;
    const lignesAvecPrixEtRemise = [];
    let commandeStatut = 'ENR';

    if (isRetrait) {
      for (const ligne of lignes) {
        const { GL_ARTICLE, GL_QTEFACT } = ligne;
        const checkStock = await pool.request()
          .input('article', sql.NVarChar(50), GL_ARTICLE.trim())
          .input('depot', sql.NVarChar(6), GP_DEPOT.trim())
          .query(`
            SELECT SUM(ISNULL(GQ_PHYSIQUE, 0)) AS PHYSIQUE, SUM(ISNULL(GQ_RESERVECLI, 0)) AS RESERVECLI
            FROM DISPO
            WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
              AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
          `);

        const { PHYSIQUE = 0, RESERVECLI = 0 } = checkStock.recordset[0] || {};
        if ((PHYSIQUE - RESERVECLI) < GL_QTEFACT) {
          commandeStatut = 'ATT';
          break;
        }
      }
    }

    for (const ligne of lignes) {
      const { GL_ARTICLE, GL_QTEFACT } = ligne;
      const prixResult = await pool.request()
        .input('code', sql.NVarChar(50), GL_ARTICLE)
        .query('SELECT GA_PVHT, GA_PVTTC FROM ARTICLE WHERE GA_ARTICLE = @code');

      const { GA_PVHT = 0, GA_PVTTC = 0 } = prixResult.recordset[0] || {};
      const remiseResult = await pool.request()
        .input('gaArticle', sql.NVarChar(50), GL_ARTICLE.trim())
        .input('codeTiers', sql.NVarChar(50), GP_TIERS.trim())
        .input('dateCommande', sql.DateTime, GP_DATECREATION)
        .query(`
          SELECT TOP 1 MLR_REMISE FROM REMISE
          WHERE MLR_ORGREMISE = @gaArticle
            AND MLR_CODECOND = @codeTiers
            AND MLR_DATEPIECE <= @dateCommande
          ORDER BY MLR_DATEPIECE DESC
        `);

      const remise = remiseResult.recordset[0]?.MLR_REMISE || 0;
      const prixHTRemise = GA_PVHT * (1 - remise / 100);
      const prixTTCRemise = GA_PVTTC * (1 - remise / 100);
      const totalHT = prixHTRemise * GL_QTEFACT;
      const totalTTC = prixTTCRemise * GL_QTEFACT;
      const remiseMontant = GA_PVHT * GL_QTEFACT * remise / 100;

      GP_TOTALHT += totalHT;
      GP_TOTALTTC += totalTTC;

      lignesAvecPrixEtRemise.push({ ...ligne, remise, remiseMontant });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    await new sql.Request(transaction)
      .input('GP_NATUREPIECEG', sql.NVarChar(3), GP_NATUREPIECEG)
      .input('GP_SOUCHE', sql.NVarChar(6), GP_SOUCHE)
      .input('GP_NUMERO', sql.BigInt, GP_NUMERO)
      .input('GP_INDICEG', sql.Int, GP_INDICEG)
      .input('GP_TIERS', sql.NVarChar(50), GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19, 4), GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19, 4), GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), isRetrait ? GP_DEPOT : null)
      .input('GP_LIBRETIERS1', sql.NVarChar(50), GP_LIBRETIERS1)
      .input('GP_STATUTPIECE', sql.NVarChar(10), commandeStatut)
      .query(`
        INSERT INTO PIECE (
          GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG,
          GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION,
          GP_DEPOT, GP_LIBRETIERS1, GP_STATUTPIECE
        ) VALUES (
          @GP_NATUREPIECEG, @GP_SOUCHE, @GP_NUMERO, @GP_INDICEG,
          @GP_TIERS, @GP_TOTALHT, @GP_TOTALTTC, @GP_DATECREATION,
          @GP_DEPOT, @GP_LIBRETIERS1, @GP_STATUTPIECE
        )
      `);

    for (let i = 0; i < lignesAvecPrixEtRemise.length; i++) {
      const { GL_ARTICLE, GL_QTEFACT, remise, remiseMontant, GL_CODESDIM, GL_LIBELLE, GL_LIBCOMPL } = lignesAvecPrixEtRemise[i];

      await new sql.Request(transaction)
        .input('GL_NATUREPIECEG', sql.NVarChar(3), GP_NATUREPIECEG)
        .input('GL_SOUCHE', sql.NVarChar(6), GP_SOUCHE)
        .input('GL_NUMERO', sql.BigInt, GP_NUMERO)
        .input('GL_INDICEG', sql.Int, GP_INDICEG)
        .input('GL_ARTICLE', sql.NVarChar(50), GL_ARTICLE)
        .input('GL_QTEFACT', sql.Numeric(19, 4), GL_QTEFACT)
        .input('GL_NUMLIGNE', sql.Int, i + 1)
        .input('GL_REMISELIGNE', sql.Float, remise)
        .input('GL_TOTREMLIGNE', sql.Numeric(19, 4), remiseMontant)
        .input('GL_CODESDIM', sql.NVarChar(50), GL_CODESDIM ?? '')
        .input('GL_LIBELLE', sql.NVarChar(255), GL_LIBELLE ?? '')
        .input('GL_LIBCOMPL', sql.NVarChar(255), GL_LIBCOMPL ?? '')
        .input('GL_TIERS', sql.NVarChar(50), GP_TIERS)
        .query(`
          INSERT INTO LIGNE (
            GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG,
            GL_ARTICLE, GL_QTEFACT, GL_NUMLIGNE,
            GL_REMISELIGNE, GL_TOTREMLIGNE,
            GL_CODESDIM, GL_LIBELLE, GL_LIBCOMPL, GL_TIERS
          ) VALUES (
            @GL_NATUREPIECEG, @GL_SOUCHE, @GL_NUMERO, @GL_INDICEG,
            @GL_ARTICLE, @GL_QTEFACT, @GL_NUMLIGNE,
            @GL_REMISELIGNE, @GL_TOTREMLIGNE,
            @GL_CODESDIM, @GL_LIBELLE, @GL_LIBCOMPL, @GL_TIERS
          )
        `);
    }

    if (commandeStatut !== 'ATT') {
      await new sql.Request(transaction)
        .input('codeTiers', sql.NVarChar(50), GP_TIERS)
        .query(`
          DELETE FROM LIGNE WHERE GL_NATUREPIECEG = 'PAN' AND GL_TIERS = @codeTiers;
          DELETE FROM PIECE WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers;
        `);
    }

    await transaction.commit();

    res.status(201).json({
      message: commandeStatut === 'ATT'
        ? '🕐 Commande enregistrée mais en attente de stock.'
        : '✅ Commande créée avec succès.',
      GP_TOTALHT,
      GP_TOTALTTC,
      statut: commandeStatut
    });

  } catch (err) {
    res.status(500).json({
      message: '❌ Erreur lors de la création de la commande.',
      error: err.message
    });
  }
};



// Modifier une commande
exports.updateOrder = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  const { GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GP_SOUCHE', sql.NVarChar(6), souche)
      .input('GP_NUMERO', sql.Int, parseInt(numero))
      .input('GP_INDICEG', sql.NVarChar(3), indice)
      .input('GP_TIERS', sql.NVarChar(17), GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19, 4), GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19, 4), GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), GP_DEPOT)
      .query(`
        UPDATE PIECE SET GP_TIERS=@GP_TIERS, GP_TOTALHT=@GP_TOTALHT, GP_TOTALTTC=@GP_TOTALTTC,
        GP_DATECREATION=@GP_DATECREATION, GP_DEPOT=@GP_DEPOT
        WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json({ message: 'Commande mise à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur mise à jour commande.', error: err.message });
  }
};

// Supprimer une commande
exports.deleteOrder = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;

    await pool.request()
      .input('GL_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GL_SOUCHE', sql.NVarChar(6), souche)
      .input('GL_NUMERO', sql.Int, parseInt(numero))
      .input('GL_INDICEG', sql.NVarChar(3), indice)
      .query('DELETE FROM LIGNE WHERE GL_NATUREPIECEG=@GL_NATUREPIECEG AND GL_SOUCHE=@GL_SOUCHE AND GL_NUMERO=@GL_NUMERO AND GL_INDICEG=@GL_INDICEG');

    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GP_SOUCHE', sql.NVarChar(6), souche)
      .input('GP_NUMERO', sql.Int, parseInt(numero))
      .input('GP_INDICEG', sql.NVarChar(3), indice)
      .query('DELETE FROM PIECE WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json({ message: 'Commande supprimée avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur suppression commande.', error: err.message });
  }
};
exports.getOrdersEnAttente = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query(`SELECT * FROM PIECE WHERE GP_STATUTPIECE = 'ATT' ORDER BY GP_DATECREATION DESC`);

    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commandes en attente.', error: err.message });
  }
};
exports.marquerCommandeCommePrete = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GP_SOUCHE', sql.NVarChar(6), souche)
      .input('GP_NUMERO', sql.Int, numero)
      .input('GP_INDICEG', sql.Int, indice)
      .query(`
        UPDATE PIECE
        SET GP_STATUTPIECE = 'ENR'
        WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG
      `);

    res.status(200).json({ message: 'Commande marquée comme prête.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur mise à jour commande.', error: err.message });
  }
};
exports.createBonDeLivraisonSansLien = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;

    // 1. Récupérer la commande source
    const commandeRes = await pool.request()
      .input('nature', sql.NVarChar, nature)
      .input('souche', sql.NVarChar, souche)
      .input('numero', sql.Int, numero)
      .input('indice', sql.NVarChar, indice)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG = @nature AND GP_SOUCHE = @souche 
          AND GP_NUMERO = @numero AND GP_INDICEG = @indice
      `);

    if (commandeRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    const commande = commandeRes.recordset[0];

    // 2. Générer un nouveau numéro de BL
    const blNumeroRes = await pool.request().query(`
      SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS newNumero 
      FROM PIECE WHERE GP_NATUREPIECEG = 'BL'
    `);
    const newBLNumero = blNumeroRes.recordset[0].newNumero;

    // ⚠️ GP_LIBRETIERS1 est de type nvarchar(6), on doit limiter la longueur
    const origineLabel = numero.toString().slice(-6); // max 6 caractères

    // 3. Créer l'en-tête du BL
    await pool.request()
      .input('nature', sql.NVarChar, 'BL')
      .input('souche', sql.NVarChar, commande.GP_SOUCHE)
      .input('numero', sql.Int, newBLNumero)
      .input('indice', sql.Int, 1)
      .input('tiers', sql.NVarChar, commande.GP_TIERS)
      .input('date', sql.DateTime, new Date())
      .input('origine', sql.NVarChar(6), origineLabel) // ✅ longueur respectée
      .query(`
        INSERT INTO PIECE (
          GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG,
          GP_TIERS, GP_DATECREATION, GP_LIBRETIERS1
        )
        VALUES (
          @nature, @souche, @numero, @indice,
          @tiers, @date, @origine
        )
      `);

    // 4. Copier les lignes de la commande
    const lignesRes = await pool.request()
      .input('nature', sql.NVarChar, nature)
      .input('souche', sql.NVarChar, souche)
      .input('numero', sql.Int, numero)
      .input('indice', sql.NVarChar, indice)
      .query(`
        SELECT * FROM LIGNE
        WHERE GL_NATUREPIECEG = @nature AND GL_SOUCHE = @souche 
          AND GL_NUMERO = @numero AND GL_INDICEG = @indice
      `);

    const lignes = lignesRes.recordset;

    for (let i = 0; i < lignes.length; i++) {
      const ligne = lignes[i];
      await pool.request()
        .input('nature', sql.NVarChar, 'BL')
        .input('souche', sql.NVarChar, commande.GP_SOUCHE)
        .input('numero', sql.Int, newBLNumero)
        .input('indice', sql.Int, 1)
        .input('article', sql.NVarChar, ligne.GL_ARTICLE)
        .input('qte', sql.Numeric(19, 4), ligne.GL_QTEFACT)
        .input('numligne', sql.Int, i + 1)
        .input('codesdim', sql.NVarChar, ligne.GL_CODESDIM ?? '')
        .input('tiers', sql.NVarChar, ligne.GL_TIERS)
        .query(`
          INSERT INTO LIGNE (
            GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG,
            GL_ARTICLE, GL_QTEFACT, GL_NUMLIGNE, GL_CODESDIM, GL_TIERS
          )
          VALUES (
            @nature, @souche, @numero, @indice,
            @article, @qte, @numligne, @codesdim, @tiers
          )
        `);
    }

    res.status(201).json({
      message: 'Bon de livraison généré avec succès.',
      BL: `${commande.GP_SOUCHE}/${newBLNumero}/1`
    });

  } catch (err) {
    console.error("❌ Erreur création BL :", err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};


exports.getBonsDeLivraison = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT * FROM PIECE
      WHERE GP_NATUREPIECEG = 'BL'
      ORDER BY GP_DATECREATION DESC
    `);
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération BL.', error: err.message });
  }
};
exports.marquerBLCommePrepare = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar, nature)
      .input('GP_SOUCHE', sql.NVarChar, souche)
      .input('GP_NUMERO', sql.Int, numero)
      .input('GP_INDICEG', sql.Int, indice)
      .query(`
        UPDATE PIECE
        SET GP_STATUTPIECE = 'PRE'
        WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE
          AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "Bon de livraison introuvable." });
    }

    res.status(200).json({ message: "Bon de livraison marqué comme prêt." });

  } catch (err) {
    res.status(500).json({ message: "Erreur lors de la mise à jour.", error: err.message });
  }
};
exports.getBonDeLivraisonDetails = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
   
  try {
    const pool = await poolPromise;

    // 1. Vérifier que le BL existe
    const pieceResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice
      `);

    if (pieceResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Bon de livraison non trouvé.' });
    }

    const piece = pieceResult.recordset[0];

    // 2. Récupérer les lignes + article
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

    res.status(200).json({
      bonLivraison: piece,
      lignes: lignesResult.recordset
    });

  } catch (err) {
    res.status(500).json({
      message: 'Erreur récupération détails BL.',
      error: err.message
    });
  }
};
exports.getDepotsDisponiblesPourCommande = async (req, res) => {
  const { numero, souche } = req.params;

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('numero', sql.Int, numero)
      .input('souche', sql.NVarChar, souche)
      .query(`
        SELECT 
          D.GQ_DEPOT AS depot,
          SUM(D.GQ_PHYSIQUE) AS quantite
        FROM LIGNE L
        JOIN DISPO D ON D.GQ_ARTICLE = L.GL_ARTICLE
        WHERE L.GL_NUMERO = @numero AND L.GL_SOUCHE = @souche
          AND D.GQ_CLOTURE = 'X'
        GROUP BY D.GQ_DEPOT
        HAVING SUM(D.GQ_PHYSIQUE) > 0
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: "Erreur récupération dépôts", error: err.message });
  }
};
exports.updateOrderStatus = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  const { status } = req.body;

  try {
    const pool = await poolPromise;

    await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .input('status', sql.NVarChar(3), status)
      .query(`
        UPDATE PIECE
        SET GP_STATUTPIECE = @status
        WHERE GP_NATUREPIECEG = @nature AND GP_SOUCHE = @souche
          AND GP_NUMERO = @numero AND GP_INDICEG = @indice
      `);

    res.status(200).json({ message: "Statut mis à jour avec succès" });
  } catch (error) {
    console.error("Erreur mise à jour statut:", error);
    res.status(500).json({ message: "Erreur serveur lors de la mise à jour du statut" });
  }
};
exports.getReservationsPourDepot = async (req, res) => {
  const { depot } = req.params;

  try {
    await sql.connect(dbConfig);

    const query = `
      SELECT *
      FROM PIECE
      WHERE GP_LIBRETIERS1 = 'S01'
        AND GP_DEPOT = @depot
        AND GP_STATUTPIECE = 'ATT'
    `;

    const request = new sql.Request();
    request.input('depot', sql.VarChar, depot);

    const result = await request.query(query);
    res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Erreur getReservationsPourDepot:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};


// controllers/orderController.js
// controllers/orderController.js

exports.getReservationsPourMagasinier = async (req, res) => {
  const { codeCommercial } = req.user;

  if (!codeCommercial) {
    return res.status(403).json({ message: 'CodeCommercial manquant.' });
  }

  try {
    const pool = await poolPromise;

    // Obtenir le GCL_ETABLISSEMENT à partir du codeCommercial
    const etabResult = await pool.request()
      .input('CodeCommercial', sql.VarChar, codeCommercial)
      .query(`
        SELECT GCL_ETABLISSEMENT 
        FROM Commercial 
        WHERE GCL_COMMERCIAL = @CodeCommercial
      `);

    if (etabResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Commercial introuvable.' });
    }

    const etablissement = etabResult.recordset[0].GCL_ETABLISSEMENT;

    // Récupérer les réservations pour ce dépôt
    const result = await pool.request()
      .input('Depot', sql.VarChar, etablissement)
      .query(`
        SELECT *
        FROM PIECE
        WHERE GP_LIBRETIERS1 = 'S01'
          AND GP_DEPOT = @Depot
          AND GP_STATUTPIECE = 'ATT'
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Erreur getReservationsPourMagasinier:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
exports.getReservationDetails = async (req, res) => {
  const { souche, numero, indice } = req.params;

  try {
    const nature = 'CC'; // 🔥 Réservations sont de type CC
    const pool = await poolPromise;

    // 1. Récupération de la commande
    const pieceResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice
      `);

    if (pieceResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Réservation non trouvée.' });
    }

    const commande = pieceResult.recordset[0];
    const GP_TIERS = commande.GP_TIERS?.trim();

    // 2. Récupération des lignes
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
    let totalApresRemise = 0;

    for (const ligne of lignesResult.recordset) {
      const { GL_ARTICLE, GL_QTEFACT = 0, GA_PVTTC = 0 } = ligne;

      const remiseResult = await pool.request()
        .input('gaArticle', sql.NVarChar, GL_ARTICLE.trim())
        .input('codeTiers', sql.NVarChar, GP_TIERS)
        .input('dateCommande', sql.DateTime, commande.GP_DATECREATION)
        .query(`
          SELECT TOP 1 MLR_REMISE, GTR_LIBELLE, MLR_CODECOND, MLR_MONTANTTTCDEV
          FROM REMISE
          WHERE RTRIM(MLR_ORGREMISE) = @gaArticle
            AND RTRIM(MLR_CODECOND) = @codeTiers
            AND MLR_DATEPIECE <= @dateCommande
          ORDER BY MLR_DATEPIECE DESC
        `);

      const promo = remiseResult.recordset[0] || {
        MLR_REMISE: 0,
        GTR_LIBELLE: 'Aucune remise',
        MLR_CODECOND: 'N/A',
        MLR_MONTANTTTCDEV: 0
      };

      const remisePourcent = promo.MLR_REMISE || 0;
      const montantRemise = (GA_PVTTC * GL_QTEFACT * remisePourcent) / 100;
      const totalLigneApresRemise = parseFloat((GA_PVTTC * GL_QTEFACT - montantRemise).toFixed(2));

      totalApresRemise += totalLigneApresRemise;

      lignes.push({
        ...ligne,
        GL_TOTALLIGNE: totalLigneApresRemise,
        GL_NUMPIECE: `CC/${souche}/${numero}/${indice}`,
        PROMO: {
          REMISE: `${remisePourcent}%`,
          LIBELLE: promo?.GTR_LIBELLE || '',
          CODE_COND: promo?.MLR_CODECOND || '',
          REMISE_MONTANT: parseFloat(montantRemise.toFixed(2))
        }
      });
    }

    res.status(200).json({
      commande,
      lignes,
      TOTAL_APRES_REMISE: parseFloat(totalApresRemise.toFixed(2))
    });

  } catch (err) {
    res.status(500).json({
      message: 'Erreur serveur lors de la récupération des détails de la réservation.',
      error: err.message
    });
  }
};
exports.getDepotsDisponiblesPourArticleCommande = async (req, res) => {
  const { souche, numero, article } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('souche', sql.NVarChar, souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('article', sql.NVarChar, article)
      .query(`
      SELECT 
          D.GQ_DEPOT AS depot,
          SUM(D.GQ_PHYSIQUE) AS quantite
        FROM LIGNE L
        JOIN DISPO D ON REPLACE(LTRIM(RTRIM(D.GQ_ARTICLE)), ' ', '') = REPLACE(LTRIM(RTRIM(L.GL_ARTICLE)), ' ', '')
        WHERE L.GL_NUMERO = @numero
          AND L.GL_SOUCHE = @souche
          AND REPLACE(LTRIM(RTRIM(D.GQ_ARTICLE)), ' ', '') = REPLACE(LTRIM(RTRIM(@article)), ' ', '')
          AND D.GQ_CLOTURE = 'X'
        GROUP BY D.GQ_DEPOT
        HAVING SUM(D.GQ_PHYSIQUE) > 0

      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: "Erreur récupération dépôts", error: err.message });
  }
};
