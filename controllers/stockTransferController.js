const { sql, poolPromise } = require('../db');

exports.transferStock = async (req, res) => {
  const { codeArticle, quantite, depotSource, depotDestination, reference } = req.body;

  // 1. Validation de base
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

    // 2. Vérifier que l'article existe dans ARTICLE
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

    const articleData = articleInfo.recordset[0];

    // 3. Vérifier stock disponible dans le dépôt source
    const dispoSource = await new sql.Request(transaction)
  .input('article', sql.NVarChar(50), codeArticle.trim())
  .input('depot', sql.NVarChar(10), depotSource.trim())
  .query(`
    SELECT SUM(ISNULL(GQ_PHYSIQUE, 0)) AS stock
    FROM DISPO
    WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
      AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
  `);


    if (dispoSource.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "❌ Article non trouvé dans le dépôt source." });
    }

    const stockDisponible = parseFloat(dispoSource.recordset[0].stock || 0);

    if (stockDisponible < quantite) {
      await transaction.rollback();
      return res.status(409).json({
        error: "❌ Stock insuffisant dans le dépôt source.",
        stockDisponible,
        quantiteDemandee: quantite
      });
    }

    // 4. Générer un numéro de pièce unique
    const numPiece = `TRF-${depotSource}-${depotDestination}-${Date.now()}`;

    // 5. Décrémenter le stock du dépôt source
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

    // 6. Ajouter ou mettre à jour le stock du dépôt destination
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

    // 7. Commit de la transaction
    await transaction.commit();

    // 8. Réponse finale
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
