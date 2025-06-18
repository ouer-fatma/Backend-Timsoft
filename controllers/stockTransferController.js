//stockTransferController.js
const { sql, poolPromise } = require('../db');

exports.transferStock = async (req, res) => {
  const { codeArticle, quantite, depotSource, depotDestination, reference, utilisateur } = req.body;

  if (!codeArticle || !quantite || !depotSource || !depotDestination) {
    return res.status(400).json({
      error: "Champs obligatoires manquants.",
      required: ["codeArticle", "quantite", "depotSource", "depotDestination"]
    });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const articleInfo = await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), codeArticle.trim())
      .query(`
        SELECT GA_ARTICLE, GA_LIBELLE, ISNULL(GA_PVTTC, 0) AS prix_vente
        FROM ARTICLE
        WHERE REPLACE(GA_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
      `);

    if (articleInfo.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "❌ Article non trouvé dans la table ARTICLE." });
    }

    const dispoSource = await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), codeArticle.trim())
      .input('depot', sql.NVarChar(10), depotSource.trim())
      .query(`
        SELECT SUM(ISNULL(GQ_PHYSIQUE, 0)) AS stock
        FROM DISPO
        WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
      `);

    const stockDisponible = parseFloat(dispoSource.recordset[0].stock || 0);
    if (stockDisponible < quantite) {
      await transaction.rollback();
      return res.status(409).json({
        error: "❌ Stock insuffisant dans le dépôt source.",
        stockDisponible,
        quantiteDemandee: quantite
      });
    }

    const numPiece = `TRF-${depotSource}-${depotDestination}-${Date.now()}`;

    // Décrémenter le stock source
    await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), codeArticle.trim())
      .input('depot', sql.NVarChar(10), depotSource.trim())
      .input('quantite', sql.Numeric(19, 4), quantite)
      .query(`
        UPDATE DISPO
        SET GQ_PHYSIQUE = ISNULL(GQ_PHYSIQUE, 0) - @quantite
        WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
      `);

    // Ajouter ou mettre à jour stock dans le dépôt destination
    await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), codeArticle.trim())
      .input('depot', sql.NVarChar(10), depotDestination.trim())
      .input('quantite', sql.Numeric(19, 4), quantite)
      .query(`
        MERGE INTO DISPO WITH (HOLDLOCK) AS target
        USING (SELECT @article AS GQ_ARTICLE, @depot AS GQ_DEPOT) AS source
        ON REPLACE(target.GQ_ARTICLE, ' ', '') = REPLACE(source.GQ_ARTICLE, ' ', '')
        AND REPLACE(target.GQ_DEPOT, ' ', '') = REPLACE(source.GQ_DEPOT, ' ', '')
        WHEN MATCHED THEN 
          UPDATE SET GQ_PHYSIQUE = ISNULL(GQ_PHYSIQUE, 0) + @quantite
        WHEN NOT MATCHED THEN 
          INSERT (GQ_ARTICLE, GQ_DEPOT, GQ_PHYSIQUE, GQ_CLOTURE)
          VALUES (@article, @depot, @quantite, 'X');
      `);

    // 🔴 Ajouter une ligne pour historiser ce transfert
    await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), codeArticle.trim())
      .input('depot', sql.NVarChar(10), depotDestination.trim())
      .input('quantite', sql.Numeric(19, 4), quantite)
      .input('utilisateur', sql.NVarChar(50), utilisateur || 'SYSTÈME')
      .input('reference', sql.NVarChar(100), reference || numPiece)
      .query(`
        INSERT INTO DISPO (
          GQ_ARTICLE, GQ_DEPOT, GQ_PHYSIQUE, GQ_TRANSFERT, GQ_UTILISATEUR,
          GQ_DATECREATION, GQ_CLOTURE, GQ_RESERVETRF
        )
        VALUES (
          @article, @depot, @quantite, @quantite, @utilisateur,
          GETDATE(), 'T', 1
        )
      `);

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: "✅ Transfert effectué avec succès.",
      numPiece,
      article: codeArticle,
      quantite,
      depotSource,
      depotDestination,
      reference: reference || null
    });

  } catch (error) {
    await transaction.rollback();
    console.error("Erreur transfert:", error);
    res.status(500).json({ error: "❌ Erreur serveur.", details: error.message });
  }
};

exports.getDepotsWithStock = async (req, res) => {
  const { article } = req.params;

  if (!article) {
    return res.status(400).json({ message: 'Code article manquant.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('article', sql.NVarChar(50), article.trim())
      .query(`
        SELECT 
          GQ_DEPOT,
          SUM(ISNULL(GQ_PHYSIQUE, 0)) AS stockDisponible
        FROM DISPO
        WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
        GROUP BY GQ_DEPOT
        HAVING SUM(ISNULL(GQ_PHYSIQUE, 0)) > 0
        ORDER BY GQ_DEPOT
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('Erreur récupération des dépôts avec stock :', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};
exports.getTransfertsRecents = async (req, res) => {
  try {
    const userDepot = req.query.depot;

    // Validation : dépôt requis
    if (!userDepot) {
      return res.status(400).json({
        error: "Le paramètre 'depot' est requis pour filtrer les transferts."
      });
    }

    const pool = await poolPromise;

    const result = await pool.request()
      .input('depot', sql.NVarChar(10), userDepot.trim())
      .query(`
        SELECT TOP 50
          LTRIM(RTRIM(GQ_ARTICLE)) AS article,
          GQ_PHYSIQUE AS quantite,
          LTRIM(RTRIM(GQ_DEPOT)) AS depotDestination,
          LTRIM(RTRIM(GQ_UTILISATEUR)) AS utilisateur,
          GQ_DATECREATION AS date
        FROM DISPO
        WHERE 
          GQ_ARTICLE IS NOT NULL
          AND GQ_PHYSIQUE > 0
          AND GQ_DEPOT = @depot
          AND GQ_CLOTURE = 'T'
          AND GQ_RESERVETRF = 1
        ORDER BY GQ_DATECREATION DESC
      `);

    return res.status(200).json(result.recordset);

  } catch (err) {
    console.error("Erreur récupération transferts:", err);
    return res.status(500).json({
      error: "Erreur récupération des transferts",
      details: err.message
    });
  }
};
