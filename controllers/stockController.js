//stockController.js
const { sql, poolPromise } = require('../db');

exports.getStockByArticle = async (req, res) => {
  const { codeArticle } = req.params;

  try {
    const pool = await poolPromise;

    // Étape 1 : Chercher tous les GA_ARTICLE correspondant à ce GA_CODEARTICLE
    const articlesResult = await pool.request()
      .input('GA_CODEARTICLE', sql.NVarChar, codeArticle.trim())
      .query(`
        SELECT GA_ARTICLE
        FROM ARTICLE
        WHERE GA_CODEARTICLE = @GA_CODEARTICLE
      `);

    const articles = articlesResult.recordset.map(row => row.GA_ARTICLE.trim().replace(/\s+/g, ''));

    if (articles.length === 0) {
      return res.status(404).json({ message: "Aucun article trouvé pour ce code article." });
    }

    // Étape 2 : Construire dynamiquement une clause IN
    const queryParams = articles.map((_, i) => `@article${i}`).join(', ');
    const stockQuery = `
      SELECT 
        GQ_ARTICLE AS CodeArticle,
        GQ_DEPOT AS Depot,
        GQ_CLOTURE AS Cloture,
        GQ_DATECLOTURE AS DateCloture,
        GQ_PHYSIQUE AS StockPhysique
      FROM DISPO
      WHERE REPLACE(GQ_ARTICLE, ' ', '') IN (${queryParams})
        AND GQ_CLOTURE = 'X'
        AND GQ_PHYSIQUE > 0
    `;

    const request = pool.request();
    articles.forEach((value, i) => {
      request.input(`article${i}`, sql.NVarChar, value);
    });

    const stockResult = await request.query(stockQuery);
    res.status(200).json(stockResult.recordset);

  } catch (err) {
    res.status(500).json({
      message: "Erreur lors de la récupération du stock.",
      error: err.message
    });
  }
};
