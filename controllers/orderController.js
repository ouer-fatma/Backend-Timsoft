const Order = require('../models/Order');
const { sql, poolPromise } = require('../db');

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

    // 3. Appliquer les remises article/tiers
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

      lignes.push({
        ...ligne,
        GL_TOTALLIGNE: parseFloat((GA_PVTTC * GL_QTEFACT - montantRemise).toFixed(2)),
        GL_NUMPIECE: `${nature}/${souche}/${numero}/${indice}`,
        PROMO: {
          REMISE: `${remisePourcent}%`,
          LIBELLE: promo?.GTR_LIBELLE || '',
          CODE_COND: promo?.MLR_CODECOND || '',
          REMISE_MONTANT: parseFloat(montantRemise.toFixed(2))
        }
      });
    }

    res.status(200).json({ commande, lignes });
  } catch (err) {
    res.status(500).json({
      message: 'Erreur lors de la récupération des détails de la commande.',
      error: err.message
    });
  }
};


// Créer une commande + lignes de commande avec calcul auto + remises
exports.createOrder = async (req, res) => {
  const {
    GP_NATUREPIECEG,
    GP_SOUCHE,
    GP_NUMERO,
    GP_INDICEG,
    GP_DATECREATION,
    GP_DEPOT,
    lignes = []
  } = req.body;

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "Utilisateur non authentifié." });
  }

  try {
    const pool = await poolPromise;

    const userResult = await pool.request()
      .input('id', sql.Int, userId)
      .query('SELECT CodeTiers FROM Utilisateur WHERE ID_Utilisateur = @id');

    if (userResult.recordset.length === 0 || !userResult.recordset[0].CodeTiers) {
      return res.status(400).json({ message: "CodeTiers manquant pour l'utilisateur." });
    }

    const GP_TIERS = userResult.recordset[0].CodeTiers;

    if (!GP_NATUREPIECEG || !GP_SOUCHE || !GP_NUMERO || !GP_INDICEG || !GP_DATECREATION || !GP_DEPOT) {
      return res.status(400).json({ message: 'Champs obligatoires manquants.' });
    }

    if (!Array.isArray(lignes) || lignes.length === 0) {
      return res.status(400).json({ message: 'Lignes de commande invalides ou absentes.' });
    }

    let GP_TOTALHT = 0;
    let GP_TOTALTTC = 0;
    const lignesAvecPrixEtRemise = [];

    for (const ligne of lignes) {
      const { GL_ARTICLE, GL_QTEFACT } = ligne;
      if (!GL_ARTICLE|| !GL_QTEFACT) continue;

      const prixResult = await pool.request()
        .input('code', sql.NVarChar, GL_ARTICLE)
        .query('SELECT GA_PVHT, GA_PVTTC FROM ARTICLE WHERE GA_ARTICLE = @code');

      if (prixResult.recordset.length === 0) {
        return res.status(404).json({ message: `Article non trouvé: ${GL_ARTICLE}` });
      }

      const { GA_PVHT, GA_PVTTC } = prixResult.recordset[0];

      // ✅ Remise via les bons noms : MLR_ORGREMISE, MLR_CODECOND, MLR_REMISE, MLR_DATEPIECE
      const remiseResult = await pool.request()
        .input('gaArticle', sql.NVarChar, GL_ARTICLE.trim())
        .input('codeTiers', sql.NVarChar, GP_TIERS.trim())
        .input('dateCommande', sql.DateTime, GP_DATECREATION)
        .query(`
          SELECT TOP 1 MLR_REMISE
          FROM REMISE
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

      lignesAvecPrixEtRemise.push({
        ...ligne,
        remise,
        remiseMontant
      });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    const request = new sql.Request(transaction);

    await request
      .input('GP_NATUREPIECEG', sql.NVarChar(3), GP_NATUREPIECEG)
      .input('GP_SOUCHE', sql.NVarChar(6), GP_SOUCHE)
      .input('GP_NUMERO', sql.Int, GP_NUMERO)
      .input('GP_INDICEG', sql.Int, GP_INDICEG)
      .input('GP_TIERS', sql.NVarChar(17), GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19, 4), GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19, 4), GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), GP_DEPOT)
      .query(`
        INSERT INTO PIECE (
          GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG,
          GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT
        ) VALUES (
          @GP_NATUREPIECEG, @GP_SOUCHE, @GP_NUMERO, @GP_INDICEG,
          @GP_TIERS, @GP_TOTALHT, @GP_TOTALTTC, @GP_DATECREATION, @GP_DEPOT
        )
      `);

    for (let i = 0; i < lignesAvecPrixEtRemise.length; i++) {
      const { GL_ARTICLE, GL_QTEFACT, remise, remiseMontant } = lignesAvecPrixEtRemise[i];
      const GL_NUMLIGNE = i + 1;

      const ligneRequest = new sql.Request(transaction);

      await ligneRequest
        .input('GL_NATUREPIECEG', sql.NVarChar(3), GP_NATUREPIECEG)
        .input('GL_SOUCHE', sql.NVarChar(6), GP_SOUCHE)
        .input('GL_NUMERO', sql.Int, GP_NUMERO)
        .input('GL_INDICEG', sql.Int, GP_INDICEG)
        .input('GL_ARTICLE', sql.NVarChar(18), GL_ARTICLE)
        .input('GL_QTEFACT', sql.Numeric(19, 4), GL_QTEFACT)
        .input('GL_NUMLIGNE', sql.Int, GL_NUMLIGNE)
        .input('GL_REMISELIGNE', sql.Float, remise)
        .input('GL_TOTREMLIGNE', sql.Numeric(19, 4), remiseMontant)
        .query(`
          INSERT INTO LIGNE (
            GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG,
            GL_ARTICLE, GL_QTEFACT, GL_NUMLIGNE,
            GL_REMISELIGNE, GL_TOTREMLIGNE
          ) VALUES (
            @GL_NATUREPIECEG, @GL_SOUCHE, @GL_NUMERO, @GL_INDICEG,
            @GL_ARTICLE, @GL_QTEFACT, @GL_NUMLIGNE,
            @GL_REMISELIGNE, @GL_TOTREMLIGNE
          )
        `);
    }

    await transaction.commit();
    res.status(201).json({
      message: 'Commande et lignes créées avec succès.',
      GP_TOTALHT,
      GP_TOTALTTC
    });

  } catch (err) {
    res.status(500).json({
      message: 'Erreur lors de la création de la commande.',
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
