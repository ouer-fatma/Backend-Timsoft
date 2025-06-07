const { sql, poolPromise } = require('../db');
const fs = require('fs');
const path = require('path');


exports.getAllArticles = async (req, res) => {
  try {
    const pool = await poolPromise;

    // 1. Récupérer les 100 derniers articles
    const articlesResult = await pool.request().query(`
      SELECT TOP 10 *
      FROM ARTICLE
      ORDER BY GA_DATECREATION DESC
    `);

    const articles = articlesResult.recordset;

    // 2. Lire les fichiers d'images pour matching local
    const uploadsPath = path.join(__dirname, '..', 'uploads');
    const files = fs.existsSync(uploadsPath) ? fs.readdirSync(uploadsPath) : [];

    const normalize = str => str?.toLowerCase()?.replace(/\s+/g, '');

    const articlesWithExtras = await Promise.all(
      articles.map(async (article) => {
        // 3. Récupérer la remise générale depuis LIGNEREMISE (la plus récente)
        const remiseQuery = await pool.request()
          .input('codeArticle', sql.NVarChar, article.GA_CODEARTICLE)
          .query(`
            SELECT TOP 1 MLR_REMISE, MLR_DATEPIECE
            FROM LIGNEREMISE
            WHERE MLR_ORGREMISE = @codeArticle
              AND MLR_CODECOND IS NULL
              AND MLR_DATEPIECE <= GETDATE()
            ORDER BY MLR_DATEPIECE DESC
          `);

        const remise = remiseQuery.recordset[0];

        // 4. Image match (plus récente)
        const matchedFile = files
          .filter(file => normalize(file).includes(normalize(article.GA_CODEARTICLE)))
          .sort((a, b) => {
            const aTime = fs.statSync(path.join(uploadsPath, a)).mtime.getTime();
            const bTime = fs.statSync(path.join(uploadsPath, b)).mtime.getTime();
            return bTime - aTime;
          })[0];

        const imageUrl = matchedFile
          ? `http://localhost:3000/uploads/${matchedFile}`
          : null;

        return {
          ...article,
          GA_IMAGE_URL: imageUrl,
          REMISE: remise ? {
            pourcentage: remise.MLR_REMISE,
            dateEffet: remise.MLR_DATEPIECE
          } : null
        };
      })
    );

    res.status(200).json(articlesWithExtras);

  } catch (err) {
    console.error('❌ Erreur getAllArticles:', err);
    res.status(500).json({
      message: 'Erreur lors de la récupération des articles.',
      error: err.message
    });
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

  // Champs supplémentaires
  const GA_FAMILLENIV1 = req.body.GA_FAMILLENIV1?.trim() || '';
  const GA_CODEDIM1 = req.body.GA_CODEDIM1?.trim() || '';
  const GA_GRILLEDIM1 = req.body.GA_GRILLEDIM1?.trim() || '';
  const GA_CODEDIM2 = req.body.GA_CODEDIM2?.trim() || '';
  const GA_GRILLEDIM2 = req.body.GA_GRILLEDIM2?.trim() || '';
  const imageFile = req.file;

  if (!GA_ARTICLE || !GA_CODEARTICLE || !GA_LIBELLE) {
    return res.status(400).json({ message: 'Champs obligatoires manquants.' });
  }

  try {
    const pool = await poolPromise;

    await pool.request()
      .input('GA_ARTICLE', sql.NVarChar, GA_ARTICLE)
      .input('GA_CODEARTICLE', sql.NVarChar, GA_CODEARTICLE)
      .input('GA_CODEBARRE', sql.NVarChar, GA_CODEBARRE)
      .input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE)
      .input('GA_PVHT', sql.Numeric(19, 4), GA_PVHT)
      .input('GA_PVTTC', sql.Numeric(19, 4), GA_PVTTC)
      .input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK)
      .input('GA_FAMILLENIV1', sql.NVarChar, GA_FAMILLENIV1) // ✅ Ne surtout pas limiter la taille ici
      .input('GA_CODEDIM1', sql.NVarChar, GA_CODEDIM1)
      .input('GA_GRILLEDIM1', sql.NVarChar, GA_GRILLEDIM1)
      .input('GA_CODEDIM2', sql.NVarChar, GA_CODEDIM2)
      .input('GA_GRILLEDIM2', sql.NVarChar, GA_GRILLEDIM2)
      .query(`
        INSERT INTO ARTICLE (
          GA_ARTICLE, GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE,
          GA_PVHT, GA_PVTTC, GA_TENUESTOCK, GA_DATECREATION,
          GA_FAMILLENIV1, GA_CODEDIM1, GA_GRILLEDIM1,
          GA_CODEDIM2, GA_GRILLEDIM2
        )
        VALUES (
          @GA_ARTICLE, @GA_CODEARTICLE, @GA_CODEBARRE, @GA_LIBELLE,
          @GA_PVHT, @GA_PVTTC, @GA_TENUESTOCK, GETDATE(),
          @GA_FAMILLENIV1, @GA_CODEDIM1, @GA_GRILLEDIM1,
          @GA_CODEDIM2, @GA_GRILLEDIM2
        )
      `);

    const imageURL = imageFile
      ? `http://localhost:3000/uploads/${imageFile.filename}`
      : null;

    res.status(201).json({
      message: 'Article créé avec succès.',
      image: imageURL,
    });
  } catch (err) {
    console.error('❌ Erreur createArticle :', err);
    res.status(500).json({
      message: 'Erreur serveur.',
      error: err.message,
    });
  }
};


  

// ✅ 4. Mise à jour d’un article
exports.updateArticle = async (req, res) => {
  const { id } = req.params;
  const {
    GA_LIBELLE,
    GA_PVHT,
    GA_PVTTC,
    GA_TENUESTOCK,
    GA_CODEBARRE,
    GA_FAMILLENIV1,
    GA_CODEDIM1,
    GA_GRILLEDIM1,
    GA_CODEDIM2,
    GA_GRILLEDIM2
  } = req.body;

  const imageFile = req.file;

  if (!id || !GA_LIBELLE) {
    return res.status(400).json({ message: 'ID et libellé requis.' });
  }

  try {
    const pool = await poolPromise;

    // Vérifier que l’article existe
    const exists = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT 1 FROM ARTICLE WHERE GA_ARTICLE = @id');

    if (exists.recordset.length === 0) {
      return res.status(404).json({ message: 'Article non trouvé.' });
    }

    // Mettre à jour
    const request = pool.request()
      .input('GA_ARTICLE', sql.NVarChar, id)
      .input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE.trim())
      .input('GA_PVHT', sql.Numeric(19, 4), parseFloat(GA_PVHT) || 0)
      .input('GA_PVTTC', sql.Numeric(19, 4), parseFloat(GA_PVTTC) || 0)
      .input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK?.trim() || 'O')
      .input('GA_CODEBARRE', sql.NVarChar, GA_CODEBARRE?.trim() || '')
      .input('GA_FAMILLENIV1', sql.NVarChar, GA_FAMILLENIV1?.trim() || '')
      .input('GA_CODEDIM1', sql.NVarChar, GA_CODEDIM1?.trim() || '')
      .input('GA_GRILLEDIM1', sql.NVarChar, GA_GRILLEDIM1?.trim() || '')
      .input('GA_CODEDIM2', sql.NVarChar, GA_CODEDIM2?.trim() || '')
      .input('GA_GRILLEDIM2', sql.NVarChar, GA_GRILLEDIM2?.trim() || '');

    // Exécution de la requête SQL
    await request.query(`
      UPDATE ARTICLE
      SET 
        GA_LIBELLE = @GA_LIBELLE,
        GA_PVHT = @GA_PVHT,
        GA_PVTTC = @GA_PVTTC,
        GA_TENUESTOCK = @GA_TENUESTOCK,
        GA_CODEBARRE = @GA_CODEBARRE,
        GA_FAMILLENIV1 = @GA_FAMILLENIV1,
        GA_CODEDIM1 = @GA_CODEDIM1,
        GA_GRILLEDIM1 = @GA_GRILLEDIM1,
        GA_CODEDIM2 = @GA_CODEDIM2,
        GA_GRILLEDIM2 = @GA_GRILLEDIM2
      WHERE GA_ARTICLE = @GA_ARTICLE
    `);

    const imageURL = imageFile
      ? `http://localhost:3000/uploads/${imageFile.filename}`
      : null;

    res.status(200).json({
      message: 'Article mis à jour avec succès.',
      image: imageURL,
    });

  } catch (err) {
    console.error('❌ Erreur updateArticle:', err);
    res.status(500).json({
      message: 'Erreur lors de la mise à jour.',
      error: err.message,
    });
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

  if (!categorie) {
    return res.status(400).json({ message: 'Catégorie manquante.' });
  }

  try {
    const pool = await poolPromise;

    // 1. Récupérer les articles
    const result = await pool.request()
      .input('categorie', sql.NVarChar, categorie)
      .query(`
        SELECT TOP 100 *
        FROM ARTICLE
        WHERE GA_FAMILLENIV2 = @categorie
        ORDER BY GA_DATECREATION DESC
      `);

    const articles = result.recordset;

    // 2. Ajouter les dimensions
    const articlesWithDimensions = await Promise.all(
      articles.map(async (article) => {
        const dimensions = [];

        for (let i = 1; i <= 5; i++) {
          const codeDim = article[`GA_CODEDIM${i}`];
          const grilleDim = article[`GA_GRILLEDIM${i}`];
          const typeDim = article[`GA_TYPEDIM${i}`];

          if (codeDim && grilleDim && typeDim) {
            const dimResult = await pool.request()
              .input('codeDim', sql.NVarChar, codeDim)
              .input('grilleDim', sql.NVarChar, grilleDim)
              .input('typeDim', sql.NVarChar, typeDim)
              .query(`
                SELECT GDI_TYPEDIM, GDI_LIBELLE
                FROM DIMENSION
                WHERE GDI_CODEDIM = @codeDim
                  AND GDI_GRILLEDIM = @grilleDim
                  AND GDI_TYPEDIM = @typeDim
              `);

            if (dimResult.recordset.length > 0) {
              const dim = dimResult.recordset[0];
              dimensions.push({
                type: dim.GDI_TYPEDIM,
                libelle: dim.GDI_LIBELLE,
              });
            }
          }
        }

        return {
          ...article,
          dimensions,
        };
      })
    );

    res.status(200).json(articlesWithDimensions);
  } catch (err) {
    res.status(500).json({
      message: 'Erreur récupération des articles avec dimensions.',
      error: err.message,
    });
  }
};


exports.getDimensionsByArticle = async (req, res) => {
  const { codeArticle } = req.params;
  if (!codeArticle) {
    return res.status(400).json({ message: 'Code article requis.' });
  }

  try {
    const pool = await poolPromise;

    // 1. Récupère toutes les lignes de l'article
    const result = await pool.request()
      .input('codeArticle', sql.NVarChar, codeArticle)
      .query(`
        SELECT GA_CODEARTICLE, GA_LIBELLE,
               GA_CODEDIM1, GA_GRILLEDIM1,
               GA_CODEDIM2, GA_GRILLEDIM2,
               GA_CODEDIM3, GA_GRILLEDIM3,
               GA_CODEDIM4, GA_GRILLEDIM4,
               GA_CODEDIM5, GA_GRILLEDIM5
        FROM ARTICLE
        WHERE GA_CODEARTICLE = @codeArticle
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Article non trouvé.' });
    }

    const articleLibelle = result.recordset[0].GA_LIBELLE;
    const allDimensions = new Map(); // Pour éviter les doublons

    // 2. Récupère toutes les combinaisons (GA_CODEDIMx, GA_GRILLEDIMx)
    for (const row of result.recordset) {
      for (let i = 1; i <= 5; i++) {
        const codeDim = row[`GA_CODEDIM${i}`];
        const grilleDim = row[`GA_GRILLEDIM${i}`];

        if (codeDim && grilleDim) {
          const key = `${codeDim}_${grilleDim}`;
          allDimensions.set(key, { codeDim, grilleDim });
        }
      }
    }

    // 3. Requête sur DIMENSION pour récupérer les libellés
    const dimensions = [];
    for (const { codeDim, grilleDim } of allDimensions.values()) {
      const dimResult = await pool.request()
        .input('codeDim', sql.NVarChar, codeDim)
        .input('grilleDim', sql.NVarChar, grilleDim)
        .query(`
          SELECT GDI_TYPEDIM, GDI_LIBELLE
          FROM DIMENSION
          WHERE GDI_CODEDIM = @codeDim AND GDI_GRILLEDIM = @grilleDim
        `);

      if (dimResult.recordset.length > 0) {
        dimensions.push({
          type: dimResult.recordset[0].GDI_TYPEDIM,
          libelle: dimResult.recordset[0].GDI_LIBELLE
        });
      }
    }

    res.status(200).json({
      article: articleLibelle,
      dimensions
    });

  } catch (err) {
    res.status(500).json({
      message: 'Erreur récupération des dimensions.',
      error: err.message
    });
  }
};

exports.getQuantiteParDimensions = async (req, res) => {
  const { codeArticle, dim1, dim2 } = req.params;

  if (!codeArticle || !dim1 || !dim2) {
    return res.status(400).json({ message: 'Paramètres requis : codeArticle, dim1, dim2' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('codeArticle', sql.NVarChar, codeArticle)
      .input('dim1Libelle', sql.NVarChar, dim1)
      .input('dim2Libelle', sql.NVarChar, dim2)
      .query(`
        SELECT SUM(D.GQ_PHYSIQUE) AS QUANTITE
        FROM DISPO D
        JOIN ARTICLE A ON D.GQ_ARTICLE = A.GA_ARTICLE
        LEFT JOIN DIMENSION D1 ON D1.GDI_CODEDIM = A.GA_CODEDIM1 
                                AND D1.GDI_TYPEDIM = 'DI1' 
                                AND D1.GDI_GRILLEDIM = A.GA_GRILLEDIM1
        LEFT JOIN DIMENSION D2 ON D2.GDI_CODEDIM = A.GA_CODEDIM2 
                                AND D2.GDI_TYPEDIM = 'DI2' 
                                AND D2.GDI_GRILLEDIM = A.GA_GRILLEDIM2
        WHERE A.GA_CODEARTICLE = @codeArticle
          AND D1.GDI_LIBELLE = @dim1Libelle
          AND D2.GDI_LIBELLE = @dim2Libelle
          AND D.GQ_CLOTURE = 'X'
      `);

    const quantite = result.recordset[0]?.QUANTITE ?? 0;

    res.status(200).json({
      article: codeArticle,
      dim1,
      dim2,
      quantite
    });

  } catch (err) {
    res.status(500).json({
      message: 'Erreur lors de la récupération de la quantité.',
      error: err.message
    });
  }
};

exports.getArticleDetails = async (req, res) => {
  const { codeArticle } = req.params;
  const { dim1, dim2 } = req.query;

  if (!codeArticle || !dim1 || !dim2) {
    return res.status(400).json({ message: 'Paramètres requis : codeArticle, dim1, dim2' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('codeArticle', sql.NVarChar, codeArticle)
      .input('dim1Libelle', sql.NVarChar, dim1)
      .input('dim2Libelle', sql.NVarChar, dim2)
      .query(`
        SELECT 
          A.GA_CODEARTICLE AS codeArticle,
          A.GA_LIBELLE AS libelle,
          A.GA_PVTTC AS prixTTC,
          D1.GDI_LIBELLE AS dim1_libelle,
          D2.GDI_LIBELLE AS dim2_libelle,
          SUM(D.GQ_PHYSIQUE) AS quantite
        FROM ARTICLE A
        JOIN DISPO D ON A.GA_ARTICLE = D.GQ_ARTICLE
        LEFT JOIN DIMENSION D1 
          ON D1.GDI_CODEDIM = A.GA_CODEDIM1 
          AND D1.GDI_TYPEDIM = 'DI1' 
          AND D1.GDI_GRILLEDIM = A.GA_GRILLEDIM1
        LEFT JOIN DIMENSION D2 
          ON D2.GDI_CODEDIM = A.GA_CODEDIM2 
          AND D2.GDI_TYPEDIM = 'DI2' 
          AND D2.GDI_GRILLEDIM = A.GA_GRILLEDIM2
        WHERE A.GA_CODEARTICLE = @codeArticle
          AND D1.GDI_LIBELLE = @dim1Libelle
          AND D2.GDI_LIBELLE = @dim2Libelle
          AND D.GQ_CLOTURE = 'X'
        GROUP BY 
          A.GA_CODEARTICLE, A.GA_LIBELLE, A.GA_PVTTC, 
          D1.GDI_LIBELLE, D2.GDI_LIBELLE
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucune donnée trouvée.' });
    }

    res.status(200).json(result.recordset[0]);

  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la récupération.', error: err.message });
  }
};



exports.getDepotsByArticleDimensions = async (req, res) => {
  const { codeArticle } = req.params;
  const { dim1, dim2 } = req.query;

  if (!codeArticle || !dim1 || !dim2) {
    return res.status(400).json({
      message: 'Paramètres requis : codeArticle, dim1, dim2'
    });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('codeArticle', sql.NVarChar, codeArticle)
      .input('dim1Libelle', sql.NVarChar, dim1)
      .input('dim2Libelle', sql.NVarChar, dim2)
      .query(`
        SELECT 
          D.GQ_DEPOT AS depot,
          SUM(D.GQ_PHYSIQUE) AS quantite
        FROM ARTICLE A
        JOIN DISPO D ON A.GA_ARTICLE = D.GQ_ARTICLE AND D.GQ_CLOTURE = 'X'
        LEFT JOIN DIMENSION D1 
          ON D1.GDI_CODEDIM = A.GA_CODEDIM1 
          AND D1.GDI_TYPEDIM = 'DI1' 
          AND D1.GDI_GRILLEDIM = A.GA_GRILLEDIM1
        LEFT JOIN DIMENSION D2 
          ON D2.GDI_CODEDIM = A.GA_CODEDIM2 
          AND D2.GDI_TYPEDIM = 'DI2' 
          AND D2.GDI_GRILLEDIM = A.GA_GRILLEDIM2
        WHERE A.GA_CODEARTICLE = @codeArticle
          AND D1.GDI_LIBELLE = @dim1Libelle
          AND D2.GDI_LIBELLE = @dim2Libelle
        GROUP BY D.GQ_DEPOT
      `);

    res.status(200).json({
      article: codeArticle,
      dim1,
      dim2,
      depots: result.recordset
    });

  } catch (err) {
    console.error("❌ Erreur getDepotsByArticleDimensions:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};


exports.getArticlesComplet = async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('limit', sql.Int, parseInt(limit))
      .input('offset', sql.Int, parseInt(offset))
      .query(`
        WITH ArticleData AS (
          SELECT
            LTRIM(RTRIM(A.GA_CODEBARRE)) AS GA_CODEBARRE,
            A.GA_CODEARTICLE AS GA_CODEARTICLE1,
            A.GA_ARTICLE AS GA_ARTICLE1,
            A.GA_LIBELLE AS GA_LIBELLE1,
            A.GA_FAMILLENIV1,
            A.GA_PVTTC,
            D1.GDI_LIBELLE AS GA_CODEDIM1,
            D2.GDI_LIBELLE AS GA_CODEDIM2,
            ISNULL(SUM(D.GQ_PHYSIQUE), 0) AS GQ_PHYSIQUE,
            ROW_NUMBER() OVER (ORDER BY A.GA_LIBELLE) AS RowNum
          FROM ARTICLE A
          LEFT JOIN DISPO D 
            ON A.GA_ARTICLE = D.GQ_ARTICLE AND D.GQ_CLOTURE = 'X'
          LEFT JOIN DIMENSION D1 
            ON D1.GDI_CODEDIM = A.GA_CODEDIM1 
            AND A.GA_GRILLEDIM1 = D1.GDI_GRILLEDIM 
            AND D1.GDI_TYPEDIM = 'DI1'
          LEFT JOIN DIMENSION D2 
            ON D2.GDI_CODEDIM = A.GA_CODEDIM2 
            AND A.GA_GRILLEDIM2 = D2.GDI_GRILLEDIM 
            AND D2.GDI_TYPEDIM = 'DI2'
          GROUP BY 
            A.GA_CODEBARRE, A.GA_CODEARTICLE, A.GA_ARTICLE,
            A.GA_LIBELLE, A.GA_FAMILLENIV1, A.GA_PVTTC,
            D1.GDI_LIBELLE, D2.GDI_LIBELLE
        )
        SELECT * 
        FROM ArticleData
        WHERE GA_CODEBARRE IS NOT NULL AND GA_CODEBARRE <> ''
          AND RowNum BETWEEN @offset + 1 AND @offset + @limit
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('❌ Erreur getArticlesComplet:', err);
    res.status(500).json({
      message: 'Erreur récupération des articles complets.',
      error: err.message,
    });
  }
};

exports.deleteArticle = async (req, res) => {
  const { id } = req.params;

  if (!id?.trim()) {
    return res.status(400).json({ message: 'Identifiant article manquant.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('GA_ARTICLE', sql.NVarChar, id.trim())
      .query(`
        DELETE FROM ARTICLE
        WHERE GA_ARTICLE = @GA_ARTICLE
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Article non trouvé ou déjà supprimé.' });
    }

    res.status(200).json({ message: 'Article supprimé avec succès.' });

  } catch (err) {
    console.error('❌ Erreur deleteArticle:', err);
    res.status(500).json({
      message: 'Erreur lors de la suppression de l\'article.',
      error: err.message
    });
  }
};



