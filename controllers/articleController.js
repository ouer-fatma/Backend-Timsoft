const { sql, poolPromise } = require('../db');
const fs = require('fs');
const path = require('path');
const { appliquerRemise } = require('../utils/remiseUtil');
const sendNotification = require('../utils/sendNotification');

// ✅ 1. Récupérer les 100 premiers articles avec leur remise générale
exports.getAllArticles = async (req, res) => {
  try {
    const pool = await poolPromise;

    const articlesResult = await pool.request().query(`
      SELECT TOP 100 *
      FROM ARTICLE_IMAGE_MODE
      ORDER BY GA_DATECREATION DESC
    `);

    const articles = articlesResult.recordset;

    const articlesWithExtras = await Promise.all(
      articles.map(async (article) => {
        const codeArticle = article.GA_CODEARTICLE;

        // 🔹 Récupération de la remise
        const remiseQuery = await pool.request()
       .input('codeArticle', sql.NVarChar, codeArticle)
.query(`
  SELECT TOP 1 MLR_REMISE, MLR_DATEPIECE
  FROM LIGNEREMISE
  WHERE MLR_ORGREMISE = @codeArticle
    AND MLR_CODECOND IS NULL
    AND MLR_DATEPIECE <= GETDATE()
  ORDER BY MLR_DATEPIECE DESC
`);


        const remise = remiseQuery.recordset[0];

        // 🔹 Conversion image
        let imageBase64 = null;
        if (article.LO_OBJET) {
          const buffer = Buffer.from(article.LO_OBJET, 'binary');
          imageBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }

        // 🔹 Récupération des variantes
        const variantesQuery = await pool.request()
          .input('codeArticle', sql.NVarChar, codeArticle)
          .query(`
            SELECT TOP 10
              A.GA_ARTICLE,
              A.GA_CODEDIM1, A.GA_GRILLEDIM1,
              A.GA_CODEDIM2, A.GA_GRILLEDIM2,
              D.GQ_DEPOT
            FROM ARTICLE A
            LEFT JOIN DISPO D
              ON REPLACE(D.GQ_ARTICLE, ' ', '') = REPLACE(A.GA_ARTICLE, ' ', '')
            WHERE A.GA_CODEARTICLE = @codeArticle
              AND A.GA_CODEDIM1 IS NOT NULL AND A.GA_CODEDIM1 <> ''
              AND A.GA_CODEDIM2 IS NOT NULL AND A.GA_CODEDIM2 <> ''
          `);

        const variantesRaw = variantesQuery.recordset;

        const variantes = await Promise.all(
          variantesRaw.map(async (v) => {
            const [tailleLabel, couleurLabel] = await Promise.all([
              getDimensionLabel(pool, v.GA_CODEDIM1, v.GA_GRILLEDIM1),
              getDimensionLabel(pool, v.GA_CODEDIM2, v.GA_GRILLEDIM2),
            ]);

            return {
              GA_ARTICLE: v.GA_ARTICLE,
              taille: tailleLabel,
              couleur: couleurLabel,
              depot: v.GQ_DEPOT,
            };
          })
        );

        return {
          ...article,
          GA_IMAGE_BASE64: imageBase64,
          REMISE: remise
            ? {
                pourcentage: remise.MLR_REMISE,
                dateEffet: remise.MLR_DATEPIECE,
              }
            : null,
          variantes // 🆕 Ajouté ici
        };
      })
    );

    res.status(200).json(articlesWithExtras);
  } catch (err) {
    console.error('❌ Erreur getAllArticles:', err);
    res.status(500).json({
      message: 'Erreur lors de la récupération des articles.',
      error: err.message,
    });
  }
};


// ✅ 2. Récupérer un article par GA_ARTICLE (identifiant en NVARCHAR)
exports.getArticleByGA = async (req, res) => {
  const { gaArticle } = req.query;


  if (!gaArticle) {
    return res.status(400).json({ message: 'Identifiant GA_ARTICLE requis.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('GA_ARTICLE', sql.NVarChar, `%${gaArticle.trim()}%`)
      .query(`
        SELECT
          A.GA_ARTICLE,
          A.GA_CODEARTICLE,
          A.GA_LIBELLE,
          A.GA_PVTTC,
          A.GA_CODEDIM1, A.GA_GRILLEDIM1,
          A.GA_CODEDIM2, A.GA_GRILLEDIM2,
          AIM.LO_OBJET AS IMAGE,
          ISNULL(D.GQ_PHYSIQUE, 0) AS QUANTITE,
          D.GQ_DEPOT
        FROM ARTICLE A
        LEFT JOIN ARTICLE_IMAGE_MODE AIM
          ON A.GA_CODEARTICLE = AIM.GA_CODEARTICLE
        LEFT JOIN DISPO D
          ON REPLACE(D.GQ_ARTICLE, ' ', '') = REPLACE(A.GA_ARTICLE, ' ', '')
        WHERE REPLACE(A.GA_ARTICLE, ' ', '') LIKE REPLACE(@GA_ARTICLE, ' ', '')
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
  const GA_FAMILLENIV1 = req.body.GA_FAMILLENIV1?.trim() || '';
  const GA_FAMILLENIV2 = req.body.GA_FAMILLENIV2?.trim() || '';


  let dimensions = [];
  let quantities = [];
  const imageFile = req.file;

  try {
    if (typeof req.body.dimensions === 'string') {
      dimensions = JSON.parse(req.body.dimensions);
    } else if (Array.isArray(req.body.dimensions)) {
      dimensions = req.body.dimensions;
    }

    if (typeof req.body.quantities === 'string') {
      quantities = JSON.parse(req.body.quantities);
    } else if (Array.isArray(req.body.quantities)) {
      quantities = req.body.quantities;
    }
  } catch (parseError) {
    return res.status(400).json({
      message: "Erreur de format JSON dans 'dimensions' ou 'quantities'.",
      error: parseError.message
    });
  }

  if (!GA_ARTICLE || !GA_CODEARTICLE || !GA_LIBELLE) {
    return res.status(400).json({ message: 'Champs obligatoires manquants.' });
  }

  try {
    const pool = await poolPromise;

    // Par défaut
    let GA_CODEDIM1 = null;
    let GA_GRILLEDIM1 = null;
    let GA_CODEDIM2 = null;
    let GA_GRILLEDIM2 = null;

    // Chercher les codes dimension/grille pour taille (DI1) et couleur (DI2)
    for (const dim of dimensions) {
      const { taille, couleur } = dim;

      // Taille
      if (taille) {
        const result = await pool.request()
          .input('libelle', sql.NVarChar, taille)
          .query(`
            SELECT TOP 1 GDI_CODEDIM, GDI_GRILLEDIM
            FROM DIMENSION
            WHERE GDI_LIBELLE = @libelle AND GDI_TYPEDIM = 'DI1'
          `);
        if (result.recordset[0]) {
          GA_CODEDIM1 = result.recordset[0].GDI_CODEDIM;
          GA_GRILLEDIM1 = result.recordset[0].GDI_GRILLEDIM;
        }
      }

      // Couleur
      if (couleur) {
        const result = await pool.request()
          .input('libelle', sql.NVarChar, couleur)
          .query(`
            SELECT TOP 1 GDI_CODEDIM, GDI_GRILLEDIM
            FROM DIMENSION
            WHERE GDI_LIBELLE = @libelle AND GDI_TYPEDIM = 'DI2'
          `);
        if (result.recordset[0]) {
          GA_CODEDIM2 = result.recordset[0].GDI_CODEDIM;
          GA_GRILLEDIM2 = result.recordset[0].GDI_GRILLEDIM;
        }
      }
    }

    // Insertion dans ARTICLE
    await pool.request()
      .input('GA_ARTICLE', sql.NVarChar, GA_ARTICLE)
      .input('GA_CODEARTICLE', sql.NVarChar, GA_CODEARTICLE)
      .input('GA_CODEBARRE', sql.NVarChar, GA_CODEBARRE)
      .input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE)
      .input('GA_PVHT', sql.Numeric(19, 4), GA_PVHT)
      .input('GA_PVTTC', sql.Numeric(19, 4), GA_PVTTC)
      .input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK)
      .input('GA_CODEDIM1', sql.NVarChar, GA_CODEDIM1)
      .input('GA_GRILLEDIM1', sql.NVarChar, GA_GRILLEDIM1)
      .input('GA_CODEDIM2', sql.NVarChar, GA_CODEDIM2)
      .input('GA_GRILLEDIM2', sql.NVarChar, GA_GRILLEDIM2)
      .input('GA_FAMILLENIV1', sql.NVarChar, GA_FAMILLENIV1)
      .input('GA_FAMILLENIV2', sql.NVarChar, GA_FAMILLENIV2)
      .query(`
        INSERT INTO ARTICLE (
          GA_ARTICLE, GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE,
          GA_PVHT, GA_PVTTC, GA_TENUESTOCK, GA_DATECREATION,
          GA_CODEDIM1, GA_GRILLEDIM1, GA_CODEDIM2, GA_GRILLEDIM2,GA_FAMILLENIV1,GA_FAMILLENIV2
        )
        VALUES (
          @GA_ARTICLE, @GA_CODEARTICLE, @GA_CODEBARRE, @GA_LIBELLE,
          @GA_PVHT, @GA_PVTTC, @GA_TENUESTOCK, GETDATE(),
          @GA_CODEDIM1, @GA_GRILLEDIM1, @GA_CODEDIM2, @GA_GRILLEDIM2 ,@GA_FAMILLENIV1,@GA_FAMILLENIV2
        )
      `);

    // Insertion dans DISPO
    for (const entry of quantities) {
      const { depot, quantite } = entry;
      await pool.request()
        .input('article', sql.NVarChar, GA_ARTICLE)
        .input('depot', sql.NVarChar, depot)
        .input('qte', sql.Int, quantite)
        .query(`
          INSERT INTO DISPO (GQ_ARTICLE, GQ_DEPOT, GQ_PHYSIQUE, GQ_CLOTURE)
          VALUES (@article, @depot, @qte, 'X')
        `);
    }

    // Image
    const imageURL = imageFile ? `http://localhost:3000/uploads/${imageFile.filename}` : null;

    res.status(201).json({
      message: 'Article créé avec succès.',
      image: imageURL
    });

  } catch (err) {
    console.error("Erreur createArticle:", err);
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

    // 📥 Log image reçue
  console.log("📥 Fichier image reçu :", req.file?.filename);

  // 📦 Log données texte
  console.log("📦 Corps reçu :", req.body);
  const imageFile = req.file;

  try {
    const pool = await poolPromise;
    const request = pool.request();

    request.input('GA_ARTICLE', sql.NVarChar, id);
    request.input('GA_LIBELLE', sql.NVarChar, GA_LIBELLE);
    request.input('GA_PVHT', sql.Numeric(19, 4), GA_PVHT);
    request.input('GA_PVTTC', sql.Numeric(19, 4), GA_PVTTC);
    request.input('GA_TENUESTOCK', sql.NVarChar, GA_TENUESTOCK);

    // ✅ Update image file logic (optionnel)
    if (imageFile) {
      console.log('🖼️ Nouvelle image uploadée :', imageFile.filename);
      // Tu peux ici stocker le nom dans une colonne ou juste garder dans /uploads/
    }

    const result = await request.query(`
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
    console.error('❌ Erreur updateArticle:', err);
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


exports.createRemise = async (req, res) => {
  try {
    const pool = await poolPromise;
    const body = req.body;

    // Nettoyage du code article
    const inputArticle = (body.GA_ARTICLE || '').replace(/[\s\u00A0\u202F]+/g, '');


    // Recherche de l'article
    const articleResult = await pool.request()
      .input('cleanArticle', sql.NVarChar, inputArticle)

      .query(`
        SELECT TOP 1 * FROM ARTICLE
        WHERE REPLACE(GA_ARTICLE, ' ', '') = @cleanArticle
      `);

    if (articleResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Article non trouvé.' });
    }

    const article = articleResult.recordset[0];
    const mlr_orgremise = article.GA_ARTICLE.replace(/[\s\u00A0\u202F]+/g, '');


    // Génération automatique du numéro unique MLR_NUMERO
    const souche = '001'; // ou dynamiquement selon ton contexte
    const naturePiece = 'FA '; // exemple : Facture
    const etablissement = '001'; // si besoin pour futur index

    const numeroResult = await pool.request()
      .input('MLR_SOUCHE', sql.NVarChar(6), souche)
      .input('MLR_NATUREPIECEG', sql.NChar(3), naturePiece)
      .query(`
        SELECT ISNULL(MAX(MLR_NUMERO), 1000) + 1 AS nextNumero
        FROM LIGNEREMISE
        WHERE MLR_SOUCHE = @MLR_SOUCHE AND MLR_NATUREPIECEG = @MLR_NATUREPIECEG
      `);

    const nextNumero = numeroResult.recordset[0].nextNumero;

    // Insertion
    await pool.request()
      .input('MLR_ORGREMISE', sql.NVarChar(6), mlr_orgremise)
      .input('MLR_TYPEREMISE', sql.NVarChar(6), body.MLR_TYPEREMISE)
      .input('MLR_REMISE', sql.Float, body.MLR_REMISE)
      .input('MLR_VALEURREMDEV', sql.Float, body.MLR_VALEURREMDEV)
      .input('MLR_MONTANTHTDEV', sql.Float, body.MLR_MONTANTHTDEV)
      .input('MLR_MONTANTTTCDEV', sql.Float, body.MLR_MONTANTTTCDEV)
      .input('MLR_CODECOND', sql.NVarChar(17), body.MLR_CODECOND)
      .input('MLR_TOTALBASE', sql.Float, body.MLR_totalbase)
      .input('MLR_DATEPIECE', sql.DateTime, new Date(body.MLR_DATEPIECE))
      // Ajout des colonnes pour MLR_CLE1
      .input('MLR_NATUREPIECEG', sql.NChar(3), naturePiece)
      .input('MLR_SOUCHE', sql.NVarChar(6), souche)
      .input('MLR_NUMERO', sql.Int, nextNumero)
      .input('MLR_INDICEG', sql.Int, 0)
      .input('MLR_NUMORDRE', sql.Int, 1)
      .input('MLR_RANG', sql.Int, 1)
      .query(`
        INSERT INTO LIGNEREMISE (
            MLR_ORGREMISE,
            MLR_TYPEREMISE,
            MLR_REMISE,
            MLR_VALEURREMDEV,
            MLR_MONTANTHTDEV,
            MLR_MONTANTTTCDEV,
            MLR_CODECOND,
            MLR_TOTALBASE,
            MLR_DATEPIECE,
            MLR_NATUREPIECEG,
            MLR_SOUCHE,
            MLR_NUMERO,
            MLR_INDICEG,
            MLR_NUMORDRE,
            MLR_RANG
        )
        VALUES (
            @MLR_ORGREMISE,
            @MLR_TYPEREMISE,
            @MLR_REMISE,
            @MLR_VALEURREMDEV,
            @MLR_MONTANTHTDEV,
            @MLR_MONTANTTTCDEV,
            @MLR_CODECOND,
            @MLR_TOTALBASE,
            @MLR_DATEPIECE,
            @MLR_NATUREPIECEG,
            @MLR_SOUCHE,
            @MLR_NUMERO,
            @MLR_INDICEG,
            @MLR_NUMORDRE,
            @MLR_RANG
        );
      `);

    // Notification
    await sendNotification(
      'Nouvelle remise disponible 🎁',
      `Une remise de ${body.MLR_REMISE}% a été appliquée à "${article.GA_LIBELLE}".`
    );

    res.status(201).json({ message: 'Remise créée avec succès.' });

  } catch (err) {
    console.error('Erreur createRemise:', err);
    res.status(500).json({
      message: 'Erreur lors de la création de la remise.',
      error: err.message
    });
  }
};


exports.updateRemise = async (req, res) => {
  try {
    const pool = await poolPromise;
    const {
      GA_ARTICLE,
      MLR_TYPEREMISE,
      MLR_REMISE,
      MLR_VALEURREMDEV,
      MLR_MONTANTHTDEV,
      MLR_MONTANTTTCDEV,
      MLR_CODECOND,
      MLR_totalbase,
      MLR_DATEPIECE
    } = req.body;

    // Nettoyage du code article
    const cleanArticle = GA_ARTICLE.replace(/[\s\u00A0\u202F]+/g, ''); // NE PAS .substring(0, 6)


    // Données supplémentaires pour satisfaire la clé unique
    const souche = '001';
    const naturePiece = 'FA ';
    const indiceG = 0;
    const numOrdre = 1;
    const rang = 1;

    // Vérifie si une remise existe déjà pour ce couple
    const existing = await pool.request()
      .input('cleanCode', sql.NVarChar(6), cleanArticle)
      .input('MLR_DATEPIECE', sql.DateTime, new Date(MLR_DATEPIECE))
      .query(`
        SELECT TOP 1 *
        FROM LIGNEREMISE
        WHERE 
            REPLACE(REPLACE(REPLACE(MLR_ORGREMISE, ' ', ''), CHAR(160), ''), CHAR(8239), '') = @cleanCode
            AND CAST(MLR_DATEPIECE AS DATE) = CAST(@MLR_DATEPIECE AS DATE)
            AND MLR_CODECOND IS NULL;
      `);

    const baseRequest = pool.request()
      .input('MLR_ORGREMISE', sql.NVarChar(6), cleanArticle)
      .input('MLR_TYPEREMISE', sql.NVarChar(6), MLR_TYPEREMISE)
      .input('MLR_REMISE', sql.Float, MLR_REMISE)
      .input('MLR_VALEURREMDEV', sql.Float, MLR_VALEURREMDEV)
      .input('MLR_MONTANTHTDEV', sql.Float, MLR_MONTANTHTDEV)
      .input('MLR_MONTANTTTCDEV', sql.Float, MLR_MONTANTTTCDEV)
      .input('MLR_CODECOND', sql.NVarChar(17), MLR_CODECOND)
      .input('MLR_TOTALBASE', sql.Float, MLR_totalbase)
      .input('MLR_DATEPIECE', sql.DateTime, new Date(MLR_DATEPIECE))
      .input('MLR_NATUREPIECEG', sql.NChar(3), naturePiece)
      .input('MLR_SOUCHE', sql.NVarChar(6), souche)
      .input('MLR_INDICEG', sql.Int, indiceG)
      .input('MLR_NUMORDRE', sql.Int, numOrdre)
      .input('MLR_RANG', sql.Int, rang);

    if (existing.recordset.length > 0) {
      const existingRow = existing.recordset[0];
      await baseRequest
        .input('MLR_NUMERO', sql.Int, existingRow.MLR_NUMERO)
        .query(`
          UPDATE LIGNEREMISE
          SET
              MLR_TYPEREMISE     = @MLR_TYPEREMISE,
              MLR_REMISE         = @MLR_REMISE,
              MLR_VALEURREMDEV   = @MLR_VALEURREMDEV,
              MLR_MONTANTHTDEV   = @MLR_MONTANTHTDEV,
              MLR_MONTANTTTCDEV  = @MLR_MONTANTTTCDEV,
              MLR_CODECOND       = @MLR_CODECOND,
              MLR_TOTALBASE      = @MLR_TOTALBASE
          WHERE 
              MLR_NATUREPIECEG   = @MLR_NATUREPIECEG AND
              MLR_SOUCHE         = @MLR_SOUCHE AND
              MLR_NUMERO         = @MLR_NUMERO AND
              MLR_INDICEG        = @MLR_INDICEG AND
              MLR_NUMORDRE       = @MLR_NUMORDRE AND
              MLR_RANG           = @MLR_RANG;
        `);

      return res.status(200).json({ message: 'Remise mise à jour avec succès.' });
    } else {
      // Générer le prochain numéro si la remise n'existe pas
      const numeroResult = await pool.request()
        .input('MLR_SOUCHE', sql.NVarChar(6), souche)
        .input('MLR_NATUREPIECEG', sql.NChar(3), naturePiece)
        .query(`
          SELECT ISNULL(MAX(MLR_NUMERO), 1000) + 1 AS nextNumero
          FROM LIGNEREMISE
          WHERE MLR_SOUCHE = @MLR_SOUCHE AND MLR_NATUREPIECEG = @MLR_NATUREPIECEG
        `);

      const nextNumero = numeroResult.recordset[0].nextNumero;

      await baseRequest
        .input('MLR_NUMERO', sql.Int, nextNumero)
        .query(`
          INSERT INTO LIGNEREMISE (
              MLR_ORGREMISE,
              MLR_TYPEREMISE,
              MLR_REMISE,
              MLR_VALEURREMDEV,
              MLR_MONTANTHTDEV,
              MLR_MONTANTTTCDEV,
              MLR_CODECOND,
              MLR_TOTALBASE,
              MLR_DATEPIECE,
              MLR_NATUREPIECEG,
              MLR_SOUCHE,
              MLR_NUMERO,
              MLR_INDICEG,
              MLR_NUMORDRE,
              MLR_RANG
          )
          VALUES (
              @MLR_ORGREMISE,
              @MLR_TYPEREMISE,
              @MLR_REMISE,
              @MLR_VALEURREMDEV,
              @MLR_MONTANTHTDEV,
              @MLR_MONTANTTTCDEV,
              @MLR_CODECOND,
              @MLR_TOTALBASE,
              @MLR_DATEPIECE,
              @MLR_NATUREPIECEG,
              @MLR_SOUCHE,
              @MLR_NUMERO,
              @MLR_INDICEG,
              @MLR_NUMORDRE,
              @MLR_RANG
          );
        `);

      return res.status(201).json({ message: 'Nouvelle remise créée.' });
    }
  } catch (err) {
    console.error('Erreur updateRemise:', err);
    res.status(500).json({
      message: 'Erreur lors de la mise à jour ou de la création de la remise.',
      error: err.message
    });
  }
};


// classification hiérarchique (dictionnaire custom)
const classificationLabels = {
  // Niveau 1
  MA2: 'Mode Adulte',
  ME1: 'Mobilier',
  TEL: 'Téléphonie',
  COS: 'Cosmétique',
  BO: 'Boissons',
  PR1: 'Prêt-à-porter',
  ZJA: 'Zone Jardin',

  // Niveau 2
  FO1: 'Fourniture',
  ACC: 'Accessoires',
  SDV: 'Soins Visage',
  MSC: 'Miscellaneous',
  ZCE: 'Chaises',
  ZCA: 'Canapé',

  // Niveau 3
  ZB1: 'Boutons',
  CHA: 'Chaussures',
  FEM: 'Femme',
  HOM: 'Homme',
  ENF: 'Enfant',
  LUN: 'Lunettes',
  GLO: 'Gants / Lunettes',
  BEA: 'Beauté',
  SAM: 'Samsung',
  C2P: 'Canapés 2 places',
  BAG: 'Bagagerie',
  AR1: 'Confort & Maison',
  MIX: 'Textiles et Essentiels',
  DE8: 'Articles variés',
  AC3: 'Prêt-à-porter',
  SAN: 'Canapés d’angle',
  SAU: 'Canapés en U',
  ZAR: 'Armoires',
  ZBI: 'Bibliothèques',
  ZCO: 'Commodités',
  

};

exports.getClassificationFamilles = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DISTINCT
        GA_FAMILLENIV1,
        GA_FAMILLENIV2,
        GA_FAMILLENIV3
      FROM ARTICLE
      WHERE GA_FAMILLENIV1 IS NOT NULL
    `);

    const rows = result.recordset;

    // Construction hiérarchique
    const tree = {};

    for (const row of rows) {
      const level1 = row.GA_FAMILLENIV1?.trim();
      const level2 = row.GA_FAMILLENIV2?.trim();
      const level3 = row.GA_FAMILLENIV3?.trim();

      if (!level1) continue;

      if (!tree[level1]) {
        tree[level1] = {
          code: level1,
          label: classificationLabels[level1] || level1,
          children: {}
        };
      }

      if (level2) {
        if (!tree[level1].children[level2]) {
          tree[level1].children[level2] = {
            code: level2,
            label: classificationLabels[level2] || level2,
            children: {}
          };
        }

        if (level3) {
          tree[level1].children[level2].children[level3] = {
            code: level3,
            label: classificationLabels[level3] || level3
          };
        }
      }
    }

    // Convertir en tableau structuré
    const formatted = Object.values(tree).map(l1 => ({
      code: l1.code,
      label: l1.label,
      children: Object.values(l1.children).map(l2 => ({
        code: l2.code,
        label: l2.label,
        children: Object.values(l2.children)
      }))
    }));

    res.status(200).json(formatted);
  } catch (err) {
    console.error('Erreur classification familles :', err);
    res.status(500).json({
      message: 'Erreur lors de la classification des familles.',
      error: err.message
    });
  }
};


exports.getCategoriesByFamille = async (req, res) => {
  const { famille } = req.params;
  if (!famille) return res.status(400).json({ message: 'Famille manquante.' });

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('famille', sql.NVarChar, famille)
      .query(`
        SELECT DISTINCT GA_FAMILLENIV2 
        FROM ARTICLE 
        WHERE GA_FAMILLENIV3 = @famille AND GA_FAMILLENIV2 IS NOT NULL
      `);

    const categories = result.recordset.map(row => {
      const code = row.GA_FAMILLENIV2?.trim();
      return {
        code,
        label: classificationLabels[code] || `Libellé inconnu (${code})`
      };
    });

    res.status(200).json(categories);
  } catch (err) {
    console.error('❌ Erreur getCategoriesByFamille :', err);
    res.status(500).json({
      message: 'Erreur récupération des catégories.',
      error: err.message
    });
  }
}

exports.getArticlesByCategorie = async (req, res) => {
  const { categorie } = req.params;
  if (!categorie) {
    return res.status(400).json({ message: 'Catégorie manquante.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('categorie', sql.NVarChar, categorie)
      .query(`
        SELECT
          A.GA_ARTICLE,
          A.GA_CODEARTICLE,
          A.GA_LIBELLE,
          A.GA_PVTTC,
          A.GA_FAMILLENIV1,
          A.GA_FAMILLENIV2,
          A.GA_FAMILLENIV3,
          A.GA_CODEDIM1, A.GA_GRILLEDIM1,
          A.GA_CODEDIM2, A.GA_GRILLEDIM2,
          AIM.LO_OBJET AS IMAGE,
          ISNULL(D.GQ_PHYSIQUE, 0) AS QUANTITE,
          D.GQ_DEPOT
        FROM ARTICLE A
        LEFT JOIN ARTICLE_IMAGE_MODE AIM
          ON A.GA_CODEARTICLE = AIM.GA_CODEARTICLE
        LEFT JOIN DISPO D
          ON REPLACE(D.GQ_ARTICLE, ' ', '') = REPLACE(A.GA_ARTICLE, ' ', '')
        WHERE (
          A.GA_FAMILLENIV1 = @categorie OR
          A.GA_FAMILLENIV2 = @categorie OR
          A.GA_FAMILLENIV3 = @categorie
        )
      
      `);

    const articles = result.recordset;

    const grouped = {};

    for (const row of articles) {
      const key = row.GA_CODEARTICLE;

      if (!grouped[key]) {
        grouped[key] = {
          GA_CODEARTICLE: row.GA_CODEARTICLE,
          GA_LIBELLE: row.GA_LIBELLE,
          GA_PVTTC: row.GA_PVTTC,
          GA_FAMILLENIV1: row.GA_FAMILLENIV1,
          GA_FAMILLENIV2: row.GA_FAMILLENIV2,
          GA_FAMILLENIV3: row.GA_FAMILLENIV3,
          IMAGE: row.IMAGE ? `data:image/jpeg;base64,${Buffer.from(row.IMAGE).toString('base64')}` : null,
          QUANTITE_TOTALE: 0,
          variantes: []
        };
      }

      grouped[key].QUANTITE_TOTALE += row.QUANTITE;

      grouped[key].variantes.push({
        GA_ARTICLE: row.GA_ARTICLE,
        tailleCode: row.GA_CODEDIM1,
        tailleGrille: row.GA_GRILLEDIM1,
        couleurCode: row.GA_CODEDIM2,
        couleurGrille: row.GA_GRILLEDIM2,
        depot: row.GQ_DEPOT,
      });
    }

    // Appel groupé aux libellés des dimensions
    async function resolveVariantes(article) {
      const variantes = await Promise.all(article.variantes.map(async (v) => {
        const [tailleLabel, couleurLabel] = await Promise.all([
          getDimensionLabel(pool, v.tailleCode, v.tailleGrille),
          getDimensionLabel(pool, v.couleurCode, v.couleurGrille)
        ]);

        return {
          GA_ARTICLE: v.GA_ARTICLE,
          taille: tailleLabel,
          couleur: couleurLabel,
          depot: v.depot
        };
      }));
      article.variantes = variantes;
    }

    await Promise.all(Object.values(grouped).map(resolveVariantes));

    res.status(200).json(Object.values(grouped));

  } catch (err) {
    console.error('❌ Erreur getArticlesByCategorie :', err);
    res.status(500).json({ message: 'Erreur lors de la récupération des articles.', error: err.message });
  }
};

async function getDimensionLabel(pool, codeDim, grilleDim) {
  if (!codeDim || !grilleDim) return null;

  const result = await pool.request()
    .input('codeDim', sql.NVarChar, codeDim)
    .input('grilleDim', sql.NVarChar, grilleDim)
    .query(`
      SELECT TOP 1 GDI_LIBELLE
      FROM DIMENSION
      WHERE GDI_CODEDIM = @codeDim AND GDI_GRILLEDIM = @grilleDim
    `);

  return result.recordset[0]?.GDI_LIBELLE || null;
}


exports.getDimensionsByArticle = async (req, res) => {
  const { codeArticle } = req.params;
  if (!codeArticle) {
    return res.status(400).json({ message: 'Code article requis.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('codeArticle', sql.NVarChar, codeArticle)
      .query(`
        SELECT GA_CODEARTICLE, GA_LIBELLE,
               GA_CODEDIM1, GA_GRILLEDIM1,
               GA_CODEDIM2, GA_GRILLEDIM2,
               GA_CODEDIM3, GA_GRILLEDIM3,
               GA_CODEDIM4, GA_GRILLEDIM4,
               GA_CODEDIM5, GA_GRILLEDIM5
        FROM ARTICLE_MODE
        WHERE GA_CODEARTICLE = @codeArticle
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Article non trouvé.' });
    }

    const article = result.recordset[0];

    const uniqueDims = new Map();
    for (let i = 1; i <= 5; i++) {
      const code = article[`GA_CODEDIM${i}`];
      const grille = article[`GA_GRILLEDIM${i}`];
      if (code && grille) {
        uniqueDims.set(`${code}_${grille}`, { codeDim: code, grilleDim: grille });
      }
    }

    const dimensions = await Promise.all([...uniqueDims.values()].map(async ({ codeDim, grilleDim }) => {
      const dimResult = await pool.request()
        .input('codeDim', sql.NVarChar, codeDim)
        .input('grilleDim', sql.NVarChar, grilleDim)
        .query(`
          SELECT GDI_TYPEDIM, GDI_LIBELLE
          FROM DIMENSION
          WHERE GDI_CODEDIM = @codeDim AND GDI_GRILLEDIM = @grilleDim
        `);
      return dimResult.recordset[0] || null;
    }));

    res.status(200).json({
      article: {
        code: article.GA_CODEARTICLE,
        libelle: article.GA_LIBELLE,
      },
      dimensions: dimensions.filter(Boolean),
    });

  } catch (err) {
    console.error('❌ Erreur getDimensionsByArticle :', err);
    res.status(500).json({ message: 'Erreur récupération des dimensions.', error: err.message });
  }
};


exports.getQuantiteParDimensions = async (req, res) => {
  const { codeArticle } = req.params;
  const dim1 = req.params.dim1?.trim() || '';
  const dim2 = req.params.dim2?.trim() || '';

  if (!codeArticle) {
    return res.status(400).json({ message: 'Paramètre requis : codeArticle' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('codeArticle', sql.NVarChar, codeArticle)
      .input('dim1', sql.NVarChar, dim1)
      .input('dim2', sql.NVarChar, dim2)
      .query(`
        SELECT TOP 1 D.GQ_PHYSIQUE AS QUANTITE, D.GQ_DEPOT
        FROM DISPO D
        INNER JOIN ARTICLE A ON REPLACE(D.GQ_ARTICLE, ' ', '') = REPLACE(A.GA_ARTICLE, ' ', '')
        WHERE A.GA_CODEARTICLE = @codeArticle
        AND D.GQ_PHYSIQUE > 0
        AND (
          @dim1 = '' OR EXISTS (
            SELECT 1 FROM DIMENSION
            WHERE GDI_LIBELLE = @dim1
              AND GDI_CODEDIM = A.GA_CODEDIM1
              AND GDI_GRILLEDIM = A.GA_GRILLEDIM1
          )
        )
        AND (
          @dim2 = '' OR EXISTS (
            SELECT 1 FROM DIMENSION
            WHERE GDI_LIBELLE = @dim2
              AND GDI_CODEDIM = A.GA_CODEDIM2
              AND GDI_GRILLEDIM = A.GA_GRILLEDIM2
          )
        )
        ORDER BY D.GQ_PHYSIQUE DESC
      `);

    const record = result.recordset[0];
    const quantite = record?.QUANTITE || 0;
    const depot = record?.GQ_DEPOT || null;

    res.status(200).json({ article: codeArticle, dim1, dim2, quantite, depot });

  } catch (err) {
    console.error('❌ Erreur getQuantiteParDimensions :', err);
    res.status(500).json({ message: 'Erreur récupération de la quantité.', error: err.message });
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
          @dim1Libelle AS dim1_libelle,
          @dim2Libelle AS dim2_libelle,
          SUM(ISNULL(D.GQ_PHYSIQUE, 0)) AS quantite
        FROM ARTICLE A
        INNER JOIN DISPO D 
          ON REPLACE(A.GA_ARTICLE, ' ', '') = REPLACE(D.GQ_ARTICLE, ' ', '')
        INNER JOIN DIMENSION DM1 
          ON DM1.GDI_CODEDIM = A.GA_CODEDIM1 
         AND DM1.GDI_GRILLEDIM = A.GA_GRILLEDIM1 
         AND DM1.GDI_LIBELLE = @dim1Libelle
        INNER JOIN DIMENSION DM2 
          ON DM2.GDI_CODEDIM = A.GA_CODEDIM2 
         AND DM2.GDI_GRILLEDIM = A.GA_GRILLEDIM2 
         AND DM2.GDI_LIBELLE = @dim2Libelle
        WHERE A.GA_CODEARTICLE = @codeArticle
        GROUP BY A.GA_CODEARTICLE, A.GA_LIBELLE, A.GA_PVTTC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucune donnée trouvée pour cet article avec ces dimensions.' });
    }

    res.status(200).json(result.recordset[0]);

  } catch (err) {
    console.error('❌ Erreur getArticleDetails :', err);
    res.status(500).json({ message: 'Erreur lors de la récupération.', error: err.message });
  }
};


exports.getDepotsByArticleDimensions = async (req, res) => {
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
          D.GQ_DEPOT AS depot,
          SUM(ISNULL(D.GQ_PHYSIQUE, 0)) AS quantite
        FROM ARTICLE A
        INNER JOIN DISPO D 
          ON REPLACE(A.GA_ARTICLE, ' ', '') = REPLACE(D.GQ_ARTICLE, ' ', '')
        INNER JOIN DIMENSION DM1 
          ON DM1.GDI_CODEDIM = A.GA_CODEDIM1 
         AND DM1.GDI_GRILLEDIM = A.GA_GRILLEDIM1 
         AND DM1.GDI_LIBELLE = @dim1Libelle
        INNER JOIN DIMENSION DM2 
          ON DM2.GDI_CODEDIM = A.GA_CODEDIM2 
         AND DM2.GDI_GRILLEDIM = A.GA_GRILLEDIM2 
         AND DM2.GDI_LIBELLE = @dim2Libelle
        WHERE A.GA_CODEARTICLE = @codeArticle
        GROUP BY D.GQ_DEPOT
      `);

    res.status(200).json({
      article: codeArticle,
      dim1,
      dim2,
      depots: result.recordset
    });

  } catch (err) {
    console.error('❌ Erreur getDepotsByArticleDimensions :', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
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
            ON A.GA_ARTICLE = D.GQ_ARTICLE
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


exports.getPromotionsByArticle = async (req, res) => {
  const { codeArticle } = req.params;

  try {
    const pool = await poolPromise;
    const cleanedCode = (codeArticle || '').replace(/[\s\u00A0\u202F]+/g, '').substring(0, 6);

    const result = await pool.request()
      .input('codeArticle', sql.NVarChar(6), cleanedCode)
      .query(`
        SELECT TOP 5 
            TR.GTR_LIBELLE AS libelle_remise,
            R.MLR_REMISE,
            R.MLR_DATEPIECE
        FROM dbo.LIGNEREMISE R
        LEFT JOIN dbo.TYPEREMISE TR ON R.MLR_TYPEREMISE = TR.GTR_TYPEREMISE
        WHERE 
            REPLACE(REPLACE(REPLACE(R.MLR_ORGREMISE, ' ', ''), CHAR(160), ''), CHAR(8239), '') = @codeArticle
            AND R.MLR_DATEPIECE <= GETDATE()
            AND R.MLR_REMISE IS NOT NULL
        ORDER BY R.MLR_REMISE DESC;
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('Erreur getPromotionsByArticle:', err);
    res.status(500).json({
      message: 'Erreur lors de la récupération des promotions pour l’article.',
      error: err.message
    });
  }
};

exports.getArticlesPromoted = async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT 
          A.GA_ARTICLE,
          A.GA_LIBELLE,
          A.GA_PVTTC,
          R.MLR_REMISE,
          R.MLR_DATEPIECE,
          TR.GTR_LIBELLE AS LIBELLE_TYPE_REMISE,
          R.MLR_TYPEREMISE
      FROM dbo.ARTICLE A
      LEFT JOIN dbo.LIGNEREMISE R 
          ON REPLACE(REPLACE(REPLACE(R.MLR_ORGREMISE, ' ', ''), CHAR(160), ''), CHAR(8239), '') 
             = REPLACE(REPLACE(REPLACE(A.GA_ARTICLE, ' ', ''), CHAR(160), ''), CHAR(8239), '')
         AND R.MLR_REMISE IS NOT NULL
         AND R.MLR_DATEPIECE <= GETDATE()
         AND R.MLR_CODECOND IS NULL
      LEFT JOIN dbo.TYPEREMISE TR ON R.MLR_TYPEREMISE = TR.GTR_TYPEREMISE;
    `);

    const articles = result.recordset;

    const articlesWithRemises = articles.map(article => {
      const prixBase = article.GA_PVTTC ?? 0;
      const remisePourcent = article.MLR_REMISE ?? 0;
      const prixRemise = +(prixBase - (prixBase * remisePourcent / 100)).toFixed(2);

      return {
        code: article.GA_ARTICLE,
        libelle: article.GA_LIBELLE,
        prix_base: prixBase,
        prix_remise: prixRemise,
        remise: article.MLR_REMISE ? {
          pourcentage: remisePourcent,
          libelle: article.LIBELLE_TYPE_REMISE,
          type: article.MLR_TYPEREMISE,
          date_effet: article.MLR_DATEPIECE
        } : null
      };
    });

    res.status(200).json(articlesWithRemises);
  } catch (err) {
    console.error('Erreur getArticlesPromoted:', err);
    res.status(500).json({
      message: 'Erreur lors de la récupération des articles en promotion.',
      error: err.message
    });
  }
};

// ✅ Récupérer 3 articles spécifiques par leur GA_CODEARTICLE
exports.getThreeSpecificArticles = async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        A.GA_ARTICLE,
        A.GA_CODEARTICLE,
        A.GA_LIBELLE,
        A.GA_PVTTC,
        A.GA_CODEDIM1, A.GA_GRILLEDIM1,
        A.GA_CODEDIM2, A.GA_GRILLEDIM2,
        AIM.LO_OBJET AS IMAGE,
        ISNULL(D.GQ_PHYSIQUE, 0) AS QUANTITE,
        D.GQ_DEPOT
      FROM ARTICLE A
      LEFT JOIN ARTICLE_IMAGE_MODE AIM
        ON A.GA_CODEARTICLE = AIM.GA_CODEARTICLE
      LEFT JOIN DISPO D
        ON REPLACE(D.GQ_ARTICLE, ' ', '') = REPLACE(A.GA_ARTICLE, ' ', '')
      WHERE A.GA_CODEARTICLE IN ('B101133', 'E12899', 'MP0910')
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucun des articles trouvés.' });
    }

    res.status(200).json(result.recordset);

  } catch (err) {
    res.status(500).json({
      message: 'Erreur lors de la récupération des articles.',
      error: err.message
    });
  }
};

