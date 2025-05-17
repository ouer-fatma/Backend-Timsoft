//clickCollectController.js
const { sql, poolPromise } = require('../db');

// ✅ Afficher stock article par dépôt
exports.getStockByArticle = async (req, res) => {
  const { articleCode } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('article', sql.NVarChar(50), articleCode.trim())
      .query(`
        SELECT 
          D.GQ_DEPOT, DEPOT.GDE_LIBELLE,
          SUM(ISNULL(D.GQ_PHYSIQUE, 0)) AS STOCK,
          SUM(ISNULL(D.GQ_RESERVECLI, 0)) AS RESERVECLI,
          SUM(ISNULL(D.GQ_PHYSIQUE, 0) - ISNULL(D.GQ_RESERVECLI, 0)) AS DISPONIBLE
        FROM DISPO D
        JOIN DEPOT ON D.GQ_DEPOT = DEPOT.GDE_DEPOT
        WHERE REPLACE(D.GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND GQ_CLOTURE = 'X'
        GROUP BY D.GQ_DEPOT, DEPOT.GDE_LIBELLE
      `);
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Réservation Click & Collect
exports.confirmClickCollect = async (req, res) => {
  const { article, quantite, mode, depotRetrait, utilisateur } = req.body;

  if (!article || !quantite || !mode) {
    return res.status(400).json({ error: 'Champs requis manquants (article, quantite, mode).' });
  }

  if (mode === 'retrait' && !depotRetrait) {
    return res.status(400).json({ error: 'Dépôt de retrait obligatoire pour le mode retrait.' });
  }

  const depot = mode === 'retrait' ? depotRetrait.trim() : null;

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    if (mode === 'retrait') {
      // ✅ Vérifier le stock uniquement si c'est un retrait
      const checkStock = await new sql.Request(transaction)
        .input('article', sql.NVarChar(50), article.trim())
        .input('depot', sql.NVarChar(6), depot)
        .query(`
          SELECT 
            SUM(ISNULL(GQ_PHYSIQUE, 0)) AS PHYSIQUE,
            SUM(ISNULL(GQ_RESERVECLI, 0)) AS RESERVECLI
          FROM DISPO
          WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
            AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
        `);

      if (checkStock.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({ error: "Article non trouvé dans ce dépôt." });
      }

      const { PHYSIQUE, RESERVECLI } = checkStock.recordset[0];
      const disponible = PHYSIQUE - RESERVECLI;

      if (disponible < quantite) {
        await transaction.rollback();
        return res.status(409).json({ error: "❌ Stock insuffisant pour la réservation." });
      }
    }

    const pieceId = `CC-${depot || 'LIV'}-${Date.now()}`;

    // ✅ Création de la pièce (commande)
    await new sql.Request(transaction)
      .input('GP_NUMPIECE', sql.NVarChar(40), pieceId)
      .input('GP_TIERS', sql.NVarChar(17), utilisateur || 'CLIENT_WEB')
      .input('GP_DATEPIECE', sql.DateTime, new Date())
      .input('GP_SOUCHE', sql.NVarChar(6), 'CC')
      .input('GP_STATUTPIECE', sql.NVarChar(3), 'ENR')
      .input('GP_DEPOT', sql.NVarChar(6), depot)                        // 🧠 dépôt = null si livraison
      .input('GP_LIBRETIERS1', sql.NVarChar(50), mode)                 // ⬅️ on stocke "livraison" ou "retrait"
      .query(`
        INSERT INTO PIECE (GP_NUMPIECE, GP_TIERS, GP_DATEPIECE, GP_SOUCHE, GP_STATUTPIECE, GP_DEPOT, GP_LIBRETIERS1)
        VALUES (@GP_NUMPIECE, @GP_TIERS, @GP_DATEPIECE, @GP_SOUCHE, @GP_STATUTPIECE, @GP_DEPOT, @GP_LIBRETIERS1)
      `);

    // ✅ Ajouter la ligne article
    await new sql.Request(transaction)
      .input('GL_PIECEPRECEDENTE', sql.NVarChar(40), pieceId)
      .input('GL_ARTICLE', sql.NVarChar(50), article.trim())
      .input('GL_QTEFACT', sql.Numeric(19, 4), quantite)
      .input('GL_DEPOT', sql.NVarChar(6), depot)
      .query(`
        INSERT INTO LIGNE (GL_PIECEPRECEDENTE, GL_ARTICLE, GL_QTEFACT, GL_DEPOT)
        VALUES (@GL_PIECEPRECEDENTE, @GL_ARTICLE, @GL_QTEFACT, @GL_DEPOT)
      `);

    // ✅ Réserver le stock si c'est un retrait
    if (mode === 'retrait') {
      await new sql.Request(transaction)
        .input('article', sql.NVarChar(50), article.trim())
        .input('depot', sql.NVarChar(6), depot)
        .input('quantite', sql.Numeric(19, 4), quantite)
        .query(`
          UPDATE DISPO
          SET GQ_RESERVECLI = GQ_RESERVECLI + @quantite
          WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
            AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
        `);
    }

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: "✅ Commande enregistrée avec succès.",
      piece: pieceId
    });

  } catch (err) {
    await transaction.rollback();
    console.error("Erreur ClickCollect:", err);
    res.status(500).json({ error: err.message });
  }
};


// ✅ Confirmation du retrait en magasin
exports.confirmerRetraitClient = async (req, res) => {
  const { pieceId, article, depot, quantite } = req.body;

  if (!pieceId || !article || !depot || !quantite) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), article.trim())
      .input('depot', sql.NVarChar(6), depot.trim())
      .input('quantite', sql.Numeric(19, 4), quantite)
      .query(`
        UPDATE DISPO
        SET 
          GQ_PHYSIQUE = GQ_PHYSIQUE - @quantite,
          GQ_RESERVECLI = GQ_RESERVECLI - @quantite
        WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
      `);

    await new sql.Request(transaction)
      .input('pieceId', sql.NVarChar(40), pieceId)
      .query(`
        UPDATE PIECE
        SET GP_STATUTPIECE = 'RET'
        WHERE GP_NUMPIECE = @pieceId
      `);

    await transaction.commit();

    res.status(200).json({ success: true, message: "✅ Retrait confirmé, stock mis à jour." });

  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
};
