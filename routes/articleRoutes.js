const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const upload = require('../middlewares/upload');
const { poolPromise } = require('../db');

// Routes
router.get('/familles', articleController.getAllFamilles);
router.get('/', articleController.getAllArticles);
router.get('/search/:query', articleController.searchArticles);
router.get('/:gaArticle', articleController.getArticleByGA); // identifiant GA_ARTICLE (VARCHAR)
router.post('/', upload.single('image'), articleController.createArticle);
router.put('/:id', upload.single('image'), articleController.updateArticle);

router.delete('/:id', articleController.deleteArticle);

router.get('/dimensions/:codeArticle', articleController.getDimensionsByArticle);


// 🔹 Routes d'affichage par catégorie

router.get('/categories/:famille', articleController.getCategoriesByFamille);
router.get('/categorie/:categorie', articleController.getArticlesByCategorie);

router.get('/articles/:codeArticle/quantite/:dim1/:dim2', articleController.getQuantiteParDimensions);



module.exports = router;
