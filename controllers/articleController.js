// controllers/articleController.js
const { sql, poolPromise } = require('../db');

// Récupérer tous les articles
exports.getAllArticles = async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request().query('SELECT TOP 100 * FROM ARTICLE');
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Erreur lors de la récupération des articles.', error: err.message });
    }
  };
  

// Récupérer un article par code
exports.getArticleByCode = async (req, res) => {
  const { codeArticle } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GA_CODEARTICLE', sql.NVarChar, codeArticle)
      .query('SELECT * FROM ARTICLE WHERE GA_CODEARTICLE = @GA_CODEARTICLE');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Article non trouvé." });
    }
    res.status(200).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la récupération de l\'article.', error: err.message });
  }
};

// Créer un nouvel article
exports.createArticle = async (req, res) => {
  const { GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE, GA_PVHT, GA_PVTTC, GA_TENUESTOCK } = req.body;

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('GA_CODEARTICLE', sql.NVarChar, GA_CODEARTICLE)
      .input('GA_CODEBARRE', sql.NVarChar, GA_CODEBARRE)
      .input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE)
      .input('GA_PVHT', sql.Numeric(19,4), GA_PVHT)
      .input('GA_PVTTC', sql.Numeric(19,4), GA_PVTTC)
      .input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK)
      .query(`INSERT INTO ARTICLE (GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE, GA_PVHT, GA_PVTTC, GA_TENUESTOCK, GA_DATECREATION)
              VALUES (@GA_CODEARTICLE, @GA_CODEBARRE, @GA_LIBELLE, @GA_PVHT, @GA_PVTTC, @GA_TENUESTOCK, GETDATE())`);

    res.status(201).json({ message: 'Article créé avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la création de l\'article.', error: err.message });
  }
};

// Mettre à jour un article existant
exports.updateArticle = async (req, res) => {
  const { codeArticle } = req.params;
  const { GA_LIBELLE, GA_PVHT, GA_PVTTC, GA_TENUESTOCK } = req.body;

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('GA_CODEARTICLE', sql.NVarChar, codeArticle)
      .input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE)
      .input('GA_PVHT', sql.Numeric(19,4), GA_PVHT)
      .input('GA_PVTTC', sql.Numeric(19,4), GA_PVTTC)
      .input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK)
      .query(`UPDATE ARTICLE
              SET GA_LIBELLE = @GA_LIBELLE, GA_PVHT = @GA_PVHT, GA_PVTTC = @GA_PVTTC, GA_TENUESTOCK = @GA_TENUESTOCK
              WHERE GA_CODEARTICLE = @GA_CODEARTICLE`);

    res.status(200).json({ message: 'Article mis à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la mise à jour de l\'article.', error: err.message });
  }
};


// Supprimer un article avec vérification
exports.deleteArticle = async (req, res) => {
    let { codeArticle } = req.params;
  
    codeArticle = codeArticle.trim(); // ✅ important fix
  
    console.log(`CodeArticle reçu: "${codeArticle}", longueur après trim: ${codeArticle.length}`);
  
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input('GA_CODEARTICLE', sql.NVarChar(18), codeArticle)
        .query('DELETE FROM ARTICLE WHERE RTRIM(LTRIM(GA_CODEARTICLE)) = RTRIM(LTRIM(@GA_CODEARTICLE))');
  
      console.log("Rows affected:", result.rowsAffected);
  
      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ message: "Article non trouvé ou déjà supprimé." });
      }
  
      res.status(200).json({ message: 'Article supprimé avec succès.' });
    } catch (err) {
      res.status(500).json({ message: 'Erreur lors de la suppression de l\'article.', error: err.message });
    }
  };
  

