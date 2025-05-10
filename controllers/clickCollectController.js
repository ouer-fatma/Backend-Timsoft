//clickCollectController.js
const { sql, poolPromise } = require('../db');

// ✅ Afficher le stock d’un article par magasin
exports.getStockByArticle = async (req, res) => {
  const { articleCode } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('article', sql.NVarChar(50), articleCode.trim())
      .query(`
        SELECT D.GQ_DEPOT, DEPOT.GDE_LIBELLE, ISNULL(D.GQ_PHYSIQUE, 0) AS STOCK
        FROM DISPO D
        JOIN DEPOT ON D.GQ_DEPOT = DEPOT.GDE_DEPOT
        WHERE REPLACE(D.GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND GQ_CLOTURE = 'X'
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Valider un retrait Click & Collect
exports.confirmClickCollect = async (req, res) => {
  const { article, quantite, depotRetrait, utilisateur } = req.body;

  if (!article || !quantite || !depotRetrait) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // 🔄 Vérifier stock
    const stockRequest = new sql.Request(transaction)
      .input('article', sql.NVarChar(50), article.trim())
      .input('depot', sql.NVarChar(6), depotRetrait.trim());

      const stockResult = await stockRequest.query(`
        SELECT SUM(ISNULL(GQ_PHYSIQUE, 0)) AS STOCK
        FROM DISPO
        WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
      `);
      

    const stock = parseFloat(stockResult.recordset[0]?.STOCK || 0);
    if (stock < quantite) {
      await transaction.rollback();
      return res.status(409).json({ error: "❌ Stock insuffisant dans ce magasin." });
    }

    const pieceId = `CC-${depotRetrait}-${Date.now()}`;

    // 🧾 Créer entête PIECE
    await new sql.Request(transaction)
      .input('GP_NUMPIECE', sql.NVarChar(40), pieceId)
      .input('GP_TIERS', sql.NVarChar(17), utilisateur || 'CLIENT_WEB')
      .input('GP_DATEPIECE', sql.DateTime, new Date())
      .input('GP_SOUCHE', sql.NVarChar(6), 'CC')
      .query(`
        INSERT INTO PIECE (GP_NUMPIECE, GP_TIERS, GP_DATEPIECE, GP_SOUCHE)
        VALUES (@GP_NUMPIECE, @GP_TIERS, @GP_DATEPIECE, @GP_SOUCHE)
      `);

    // 🧾 Créer LIGNE
    await new sql.Request(transaction)
      .input('GL_PIECEPRECEDENTE', sql.NVarChar(40), pieceId)
      .input('GL_ARTICLE', sql.NVarChar(50), article.trim())
      .input('GL_QTEFACT', sql.Numeric(19, 4), quantite)
      .input('GL_DEPOT', sql.NVarChar(6), depotRetrait)
      .query(`
        INSERT INTO LIGNE (GL_PIECEPRECEDENTE, GL_ARTICLE, GL_QTEFACT, GL_DEPOT)
        VALUES (@GL_PIECEPRECEDENTE, @GL_ARTICLE, @GL_QTEFACT, @GL_DEPOT)
      `);

    // 🔁 Mise à jour du stock
    await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), article.trim())
      .input('depot', sql.NVarChar(6), depotRetrait)
      .input('quantite', sql.Numeric(19, 4), quantite)
      .query(`
        UPDATE DISPO
        SET GQ_PHYSIQUE = ISNULL(GQ_PHYSIQUE, 0) - @quantite
        WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
      `);

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
