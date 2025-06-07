const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const upload = require('../middlewares/upload');

// ✅ Articles complets et liste
router.get('/complet', articleController.getArticlesComplet);
router.get('/', articleController.getAllArticles); // Fallback général

// ✅ Recherche et filtres
router.get('/search/:query', articleController.searchArticles);
router.get('/familles', articleController.getAllFamilles);
router.get('/categories/:famille', articleController.getCategoriesByFamille);
router.get('/categorie/:categorie', articleController.getArticlesByCategorie);

// ✅ CRUD
router.post('/', upload.single('image'), articleController.createArticle);
router.put('/:id', upload.single('image'), articleController.updateArticle);
router.delete('/:id', articleController.deleteArticle);

// ✅ Détails spécifiques (placer AVANT routes avec /:id ou /:codeArticle pour éviter les conflits)
router.get('/:codeArticle/details', articleController.getArticleDetails);
router.get('/:codeArticle/depots', articleController.getDepotsByArticleDimensions);
router.get('/:codeArticle/quantite/:dim1/:dim2', articleController.getQuantiteParDimensions);

// ✅ Dimensions & recherche GA
router.get('/dimensions/:codeArticle', articleController.getDimensionsByArticle);
router.get('/articles/:gaArticle', articleController.getArticleByGA); // <- ⚠️ à placer tout en bas si non renommée

module.exports = router;
