const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const upload = require('../middlewares/upload');
const { poolPromise } = require('../db');

// Routes
router.get('/', async (req, res) => {
  try {
    console.log("✅ Requête reçue sur /articles");
    const pool = await poolPromise;
    const result = await pool.query('SELECT TOP 10 * FROM ARTICLE'); // 👈 teste avec une ligne

    console.log("Résultat Article:", result.recordset[0]); // 👈 affiche une ligne seulement

    res.json(result.recordset); // on renvoie quand même tout pour tester
  } catch (error) {
    console.error("❌ Erreur dans /articles :", error.message);
    res.status(500).json({ error: "Erreur interne" });
  }
});
router.get('/familles', articleController.getAllFamilles);
router.get('/', articleController.getAllArticles);
router.get('/search/:query', articleController.searchArticles);
router.get('/:gaArticle', articleController.getArticleByGA); // identifiant GA_ARTICLE (VARCHAR)
router.post('/', upload.single('image'), articleController.createArticle);
router.put('/:id', articleController.updateArticle);
router.delete('/:id', articleController.deleteArticle);


// 🔹 Routes d'affichage par catégorie

router.get('/categories/:famille', articleController.getCategoriesByFamille);
router.get('/categorie/:categorie', articleController.getArticlesByCategorie);

module.exports = router;
