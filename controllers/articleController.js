const { sql, poolPromise } = require('../db');
const fs = require('fs');
const path = require('path');

// ✅ 1. Récupérer les 100 premiers articles avec leur remise générale
exports.getAllArticles = async (req, res) => {
  try {
    const pool = await poolPromise;
    const articlesResult = await pool.request().query('SELECT TOP 10 * FROM ARTICLE ORDER BY GA_DATECREATION DESC');
    const articles = articlesResult.recordset;

    const articlesWithRemises = await Promise.all(
      articles.map(async (article) => {
        const remiseResult = await pool.request()
          .input('codeArticle', sql.NVarChar, article.GA_CODEARTICLE)
          .query(`
            SELECT MLR_REMISE, MLR_DATEPIECE
            FROM REMISE
            WHERE MLR_ORGREMISE = @codeArticle
              AND MLR_CODECOND IS NULL
              AND MLR_DATEPIECE <= GETDATE()
          `);

        const remise = remiseResult.recordset[0];

           // 🔍 Recherche de l'image correspondante dans /uploads
    const uploadsPath = path.join(__dirname, '..', 'uploads');
    const files = fs.readdirSync(uploadsPath);
    const matchedFile = files.find(file =>
      file.toLowerCase().includes(article.GA_CODEARTICLE.toLowerCase())
    );
    const imageUrl = matchedFile
      ? `http://localhost:3000/uploads/${matchedFile}`
      : null;

      return {
        ...article,
        GA_IMAGE_URL: imageUrl, // ✅ image ajoutée ici
        REMISE: remise ? {
          MLR_REMISE: remise.MLR_REMISE,
          DATE_EFFET: remise.MLR_DATEPIECE
        } : null
      };
      
      })
    );

    res.status(200).json(articlesWithRemises);

  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la récupération des articles.', error: err.message });
  }
};

// ✅ 2. Récupérer un article par GA_ARTICLE (identifiant en NVARCHAR)
exports.getArticleByGA = async (req, res) => {
  const { gaArticle } = req.params;

  if (!gaArticle) {
    return res.status(400).json({ message: 'Identifiant GA_ARTICLE requis.' });
  }

  try {
    const pool = await poolPromise;

    // Requête principale + LEFT JOIN avec DISPO + SUM(GQ_PHYSIQUE)
    const result = await pool.request()
      .input('GA_ARTICLE', sql.NVarChar, `%${gaArticle.trim()}%`)
      .query(`
        SELECT 
          A.GA_ARTICLE,
          A.GA_CODEARTICLE,
          A.GA_LIBELLE,
          A.GA_PVHT,
          A.GA_PVTTC,
          A.GA_TENUESTOCK,
          ISNULL(SUM(D.GQ_PHYSIQUE), 0) AS QUANTITE_PHYSIQUE
        FROM ARTICLE A
        LEFT JOIN DISPO D ON REPLACE(A.GA_ARTICLE, ' ', '') = REPLACE(D.GQ_ARTICLE, ' ', '')
          AND D.GQ_CLOTURE = 'X'
        WHERE REPLACE(A.GA_ARTICLE, ' ', '') LIKE REPLACE(@GA_ARTICLE, ' ', '')
        GROUP BY 
          A.GA_ARTICLE, A.GA_CODEARTICLE, A.GA_LIBELLE, 
          A.GA_PVHT, A.GA_PVTTC, A.GA_TENUESTOCK
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Article non trouvé.' });
    }

    res.status(200).json(result.recordset);

  } catch (err) {
    res.status(500).json({
      message: 'Erreur lors de la récupération de l\'article.',
      error: err.message
    });
  }
};


// 🔍 Rechercher des articles par libellé uniquement
exports.searchArticles = async (req, res) => {
  const { query } = req.params;

  if (!query || query.trim() === '') {
    return res.status(400).json({ message: 'Requête vide.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('query', sql.NVarChar, `%${query}%`)
      .query(`
        SELECT TOP 20 * FROM ARTICLE
        WHERE GA_LIBELLE LIKE @query
        ORDER BY GA_DATECREATION DESC
      `);

    const articles = result.recordset;

    const uploadsPath = path.join(__dirname, '..', 'uploads');
    const files = fs.readdirSync(uploadsPath);

    const articlesWithImages = articles.map((article) => {
      const matchedFile = files.find(file =>
        file.toLowerCase().includes(article.GA_CODEARTICLE.toLowerCase())
      );

      const imageUrl = matchedFile
        ? `http://localhost:3000/uploads/${matchedFile}`
        : null;

      return {
        ...article,
        GA_IMAGE_URL: imageUrl,
      };
    });

    res.status(200).json(articlesWithImages);
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la recherche.', error: err.message });
  }
};



// ✅ 3. Créer un nouvel article

  exports.createArticle = async (req, res) => {
    const GA_ARTICLE = req.body.GA_ARTICLE?.trim();
    const GA_CODEARTICLE = req.body.GA_CODEARTICLE?.trim();
    const GA_CODEBARRE = req.body.GA_CODEBARRE?.trim() || '';
    const GA_LIBELLE = req.body.GA_LIBELLE?.trim();
    const GA_PVHT = parseFloat(req.body.GA_PVHT) || 0;
    const GA_PVTTC = parseFloat(req.body.GA_PVTTC) || 0;
    const GA_TENUESTOCK = req.body.GA_TENUESTOCK?.trim() || 'O';
    const imageFile = req.file;
    
    if (!GA_ARTICLE || !GA_CODEARTICLE || !GA_LIBELLE) {
      return res.status(400).json({ message: 'Champs obligatoires manquants.' });
    }
    
  
    try {
      const pool = await poolPromise;
  
      await pool.request()
        .input('GA_ARTICLE', sql.NVarChar, GA_ARTICLE)
        .input('GA_CODEARTICLE', sql.NVarChar, GA_CODEARTICLE)
        .input('GA_CODEBARRE', sql.NVarChar, GA_CODEBARRE || '')
        .input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE)
        .input('GA_PVHT', sql.Numeric(19, 4), GA_PVHT || 0)
        .input('GA_PVTTC', sql.Numeric(19, 4), GA_PVTTC || 0)
        .input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK || 'O')
        .query(`
          INSERT INTO ARTICLE (
            GA_ARTICLE, GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE,
            GA_PVHT, GA_PVTTC, GA_TENUESTOCK, GA_DATECREATION
          )
          VALUES (
            @GA_ARTICLE, @GA_CODEARTICLE, @GA_CODEBARRE, @GA_LIBELLE,
            @GA_PVHT, @GA_PVTTC, @GA_TENUESTOCK, GETDATE()
          )
        `);

        const imageURL = imageFile ? `http://localhost:3000/uploads/${imageFile.filename}` : null;
  
      res.status(201).json({ message: 'Article créé avec succès.', 
        image: imageURL
       });
  
    } catch (err) { 
      res.status(500).json({
        message: 'Erreur lors de la création de l\'article.',
        error: err.message
      });
    }
  };
  

// ✅ 4. Mise à jour d’un article
exports.updateArticle = async (req, res) => {
  const { id } = req.params;
  const { GA_LIBELLE, GA_PVHT, GA_PVTTC, GA_TENUESTOCK } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GA_ARTICLE', sql.NVarChar, id)
      .input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE)
      .input('GA_PVHT', sql.Numeric(19,4), GA_PVHT)
      .input('GA_PVTTC', sql.Numeric(19,4), GA_PVTTC)
      .input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK)
      .query(`
        UPDATE ARTICLE
        SET GA_LIBELLE = @GA_LIBELLE,
            GA_PVHT = @GA_PVHT,
            GA_PVTTC = @GA_PVTTC,
            GA_TENUESTOCK = @GA_TENUESTOCK
        WHERE GA_ARTICLE = @GA_ARTICLE
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "Article non trouvé." });
    }

    res.status(200).json({ message: 'Article mis à jour avec succès.' });

  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la mise à jour.', error: err.message });
  }
};

// ✅ 5. Supprimer un article
exports.deleteArticle = async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GA_ARTICLE', sql.NVarChar, id)
      .query('DELETE FROM ARTICLE WHERE GA_ARTICLE = @GA_ARTICLE');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Article non trouvé ou déjà supprimé.' });
    }

    res.status(200).json({ message: 'Article supprimé avec succès.' });

  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la suppression.', error: err.message });
  }
};
exports.getAllFamilles = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query(`
        SELECT DISTINCT GA_FAMILLENIV1 
        FROM ARTICLE 
        WHERE GA_FAMILLENIV1 IN ('FIL','GAR','FEM','HOM')       
      `);

    res.status(200).json(result.recordset.map(row => row.GA_FAMILLENIV1));
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération des familles.', error: err.message });
  }
};



exports.getCategoriesByFamille = async (req, res) => {
  const { famille } = req.params;

  if (!famille) return res.status(400).json({ message: 'Famille manquante.' });

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('famille', sql.NVarChar, famille)
      .query(`SELECT DISTINCT GA_FAMILLENIV2 FROM ARTICLE WHERE GA_FAMILLENIV1 = @famille AND GA_FAMILLENIV2 IS NOT NULL`);

    res.status(200).json(result.recordset.map(row => row.GA_FAMILLENIV2));
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération des catégories.', error: err.message });
  }
};
exports.getArticlesByCategorie = async (req, res) => {
  const { categorie } = req.params;

  if (!categorie) return res.status(400).json({ message: 'Catégorie manquante.' });

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('categorie', sql.NVarChar, categorie)
      .query(`
        SELECT TOP 100 * FROM ARTICLE
        WHERE GA_FAMILLENIV2 = @categorie
        ORDER BY GA_DATECREATION DESC
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération des articles par catégorie.', error: err.message });
  }
};
