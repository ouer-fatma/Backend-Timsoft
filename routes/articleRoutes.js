const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const upload = require('../middlewares/upload');

// ✅ Routes d’articles complets
 // fusionnée
router.get('/complet', articleController.getArticlesComplet); // ultra détaillée

// ✅ Recherche et filtres
router.get('/search/:query', articleController.searchArticles);
router.get('/familles', articleController.getAllFamilles);
router.get('/categories/:famille', articleController.getCategoriesByFamille);
router.get('/categorie/:categorie', articleController.getArticlesByCategorie);

// ✅ CRUD
router.post('/', upload.single('image'), articleController.createArticle);
router.put('/:id', upload.single('image'), articleController.updateArticle);
router.delete('/:id', articleController.deleteArticle);

// ✅ Détails d’un article (à placer après routes spécifiques !)
router.get('/:codeArticle/details', articleController.getArticleDetails);
router.get('/:codeArticle/depots', articleController.getDepotsByArticleDimensions);
router.get('/:codeArticle/quantite/:dim1/:dim2', articleController.getQuantiteParDimensions);
router.get('/dimensions/:codeArticle', articleController.getDimensionsByArticle);
router.get('/articles/:gaArticle', articleController.getArticleByGA);

// ✅ Fallback général
router.get('/', articleController.getAllArticles);

module.exports = router;
