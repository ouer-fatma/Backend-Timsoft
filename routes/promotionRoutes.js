const express = require('express');
const router = express.Router();
const { poolPromise } = require('../db');
const promotionController = require('../controllers/promotionController');

// ✅ Routes via controller (CRUD standard)
router.get('/', promotionController.getAll);
router.post('/', promotionController.create);
router.put('/:id', promotionController.update);
router.delete('/:id', promotionController.remove);


/// 🔹 Récupérer les promotions liées à un article
router.get('/by-article/:codeArticle', async (req, res) => {
  const codeArticle = req.params.codeArticle;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('code', codeArticle)
      .query(`
        SELECT TR.*
        FROM TYPEREMISE TR
        JOIN ARTICLECOMPL AC ON TR.GTR_TYPEREMISE = AC.GA2_TYPEREMISE
        WHERE AC.GA2_CODEARTICLE = @code
      `);
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/// 🔹 Récupérer les promotions liées à une catégorie
router.get('/by-category/:category', async (req, res) => {
  const category = req.params.category;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('cat', category)
      .query(`
        SELECT DISTINCT TR.*
        FROM TYPEREMISE TR
        JOIN ARTICLECOMPL AC ON TR.GTR_TYPEREMISE = AC.GA2_TYPEREMISE
        JOIN ARTICLE A ON A.GA_CODEARTICLE = AC.GA2_CODEARTICLE
        WHERE A.GA_FAMILLENIV1 = @cat
           OR A.GA_FAMILLENIV2 = @cat
           OR A.GA_FAMILLENIV3 = @cat
      `);
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/// 🔹 Toutes les catégories
router.get('/categories', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DISTINCT GA_FAMILLENIV1 AS Categorie FROM ARTICLE
      UNION
      SELECT DISTINCT GA_FAMILLENIV2 FROM ARTICLE
      UNION
      SELECT DISTINCT GA_FAMILLENIV3 FROM ARTICLE
    `);
    const categories = result.recordset.map(row => row.Categorie);
    res.json(categories);
  } catch (error) {
    console.error("Erreur récupération catégories :", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/// 🔹 Tous les types de remise
router.get('/remise-types', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT GTR_TYPEREMISE, GTR_LIBELLE FROM TYPEREMISE WHERE GTR_LIBELLE IS NOT NULL
    `);
    const types = result.recordset.map(row => ({
      id: row.GTR_TYPEREMISE,
      libelle: row.GTR_LIBELLE
    }));
    res.json(types);
  } catch (error) {
    console.error("Erreur récupération types de remise :", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});



/// 🔹 Lier une promotion à un article
router.post('/promo-article', async (req, res) => {
  const { codeArticle, typeRemise } = req.body;

  try {
    const pool = await poolPromise;

    // 🔹 1. Créer dynamiquement le type de remise s’il n'existe pas
    await pool.request()
      .input('typeRemise', typeRemise)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM TYPEREMISE WHERE GTR_TYPEREMISE = @typeRemise
        )
        INSERT INTO TYPEREMISE (
          GTR_TYPEREMISE,
          GTR_LIBELLE,
          GTR_ABREGE,
          GTR_IMPRIMABLE
        )
        VALUES (
          @typeRemise,
          @typeRemise,
          @typeRemise,
          'X'
        )
      `);

    // 🔹 2. Associer ce type à l’article
    await pool.request()
      .input('code', codeArticle)
      .input('promo', typeRemise)
      .query(`
        UPDATE ARTICLECOMPL
        SET GA2_TYPEREMISE = @promo
        WHERE GA2_CODEARTICLE = @code
      `);

    res.status(200).json({ message: 'Promotion liée à l’article' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/// 🔹 Modifier la promotion d’un article
router.put('/promo-article/:codeArticle', async (req, res) => {
  const { typeRemise } = req.body;
  const { codeArticle } = req.params;

  try {
    const pool = await poolPromise;

    // 🔹 Étape 1 : Insérer la remise si elle n'existe pas dans TYPEREMISE
    await pool.request()
      .input('typeRemise', typeRemise)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM TYPEREMISE WHERE GTR_TYPEREMISE = @typeRemise
        )
        BEGIN
          INSERT INTO TYPEREMISE (GTR_TYPEREMISE, GTR_LIBELLE, GTR_ABREGE, GTR_IMPRIMABLE)
          VALUES (@typeRemise, @typeRemise, @typeRemise, 'X')
        END
      `);

    // 🔹 Étape 2 : Mettre à jour l’article avec la remise
    await pool.request()
      .input('code', codeArticle)
      .input('promo', typeRemise)
      .query(`
        UPDATE ARTICLECOMPL
        SET GA2_TYPEREMISE = @promo
        WHERE GA2_CODEARTICLE = @code
      `);

    res.status(200).json({ message: 'Promotion mise à jour pour l’article' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/// 🔹 Supprimer la promotion d’un article
router.delete('/promo-article/:codeArticle', async (req, res) => {
  const { codeArticle } = req.params;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('code', codeArticle)
      .query(`
        UPDATE ARTICLECOMPL
        SET GA2_TYPEREMISE = NULL
        WHERE GA2_CODEARTICLE = @code
      `);
    res.status(200).json({ message: 'Promotion supprimée de l’article' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/// 🔹 Créer une promo pour une catégorie
router.post('/promo-category', async (req, res) => {
  const { category, typeRemise } = req.body;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('cat', category)
      .input('promo', typeRemise)
      .query(`
        UPDATE ARTICLECOMPL
        SET GA2_TYPEREMISE = @promo
        WHERE GA2_CODEARTICLE IN (
          SELECT GA_CODEARTICLE
          FROM ARTICLE
          WHERE GA_FAMILLENIV1 = @cat
             OR GA_FAMILLENIV2 = @cat
             OR GA_FAMILLENIV3 = @cat
        )
      `);
    res.status(200).json({ message: 'Promotion appliquée à la catégorie' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/// 🔹 Modifier la promo d’une catégorie
router.put('/promo-category/:category', async (req, res) => {
  const { typeRemise } = req.body;
  const { category } = req.params;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('cat', category)
      .input('promo', typeRemise)
      .query(`
        UPDATE ARTICLECOMPL
        SET GA2_TYPEREMISE = @promo
        WHERE GA2_CODEARTICLE IN (
          SELECT GA_CODEARTICLE
          FROM ARTICLE
          WHERE GA_FAMILLENIV1 = @cat
             OR GA_FAMILLENIV2 = @cat
             OR GA_FAMILLENIV3 = @cat
        )
      `);
    res.status(200).json({ message: 'Promotion mise à jour pour la catégorie' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/// 🔹 Supprimer la promo d’une catégorie
router.delete('/promo-category/:category', async (req, res) => {
  const { category } = req.params;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('cat', category)
      .query(`
        UPDATE ARTICLECOMPL
        SET GA2_TYPEREMISE = NULL
        WHERE GA2_CODEARTICLE IN (
          SELECT GA_CODEARTICLE
          FROM ARTICLE
          WHERE GA_FAMILLENIV1 = @cat
             OR GA_FAMILLENIV2 = @cat
             OR GA_FAMILLENIV3 = @cat
        )
      `);
    res.status(200).json({ message: 'Promotions supprimées pour la catégorie' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
