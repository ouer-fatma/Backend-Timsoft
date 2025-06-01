const { sql, poolPromise } = require('../db');

exports.initPanier = async (req, res) => {
  let { codeTiers } = req.body;

  if (!codeTiers) {
    return res.status(400).json({ message: 'CodeTiers est requis.' });
  }

  const cleanCodeTiers = codeTiers.trim().toUpperCase();

  try {
    const pool = await poolPromise;

    // 🔍 Vérifie s'il y a déjà un panier existant pour ce client
    const checkPanier = await pool.request()
      .input('codeTiers', sql.NVarChar(50), cleanCodeTiers)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND UPPER(GP_TIERS) = @codeTiers
      `);

    if (checkPanier.recordset.length > 0) {
      return res.status(200).json({ message: 'Panier déjà existant.', panier: checkPanier.recordset[0] });
    }

    // 🔢 Récupération du numéro suivant pour le panier
    const numeroResult = await pool.request()
      .input('codeTiers', sql.NVarChar(50), cleanCodeTiers)
      .query(`
        SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS newNumero
        FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND UPPER(GP_TIERS) = @codeTiers
      `);

    const newNumero = numeroResult.recordset[0].newNumero;

    // 🧾 Insertion du nouveau panier
    await pool.request()
      .input('nature', sql.NVarChar(3), 'PAN')
      .input('souche', sql.NVarChar(6), 'PAN001')
      .input('numero', sql.Int, newNumero)
      .input('indice', sql.Int, 0)
      .input('tiers', sql.NVarChar(50), cleanCodeTiers)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
        VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
      `);

    res.status(201).json({
      message: 'Panier créé avec succès.',
      panier: {
        GP_NATUREPIECEG: 'PAN',
        GP_SOUCHE: 'PAN001',
        GP_NUMERO: newNumero,
        GP_INDICEG: '0',
        GP_TIERS: cleanCodeTiers
      }
    });

  } catch (err) {
    console.error("Erreur création panier :", err);
    res.status(500).json({ message: 'Erreur lors de la création du panier.', error: err.message });
  }
};
exports.ajouterAuPanier = async (req, res) => {
  console.log("\ud83d\udce6 Donn\u00e9es re\u00e7ues du front :", req.body);

  const {
    codeTiers,
    codeArticle,
    quantite,
    dim1Libelle: dim1,
    dim2Libelle: dim2,
    grilleDim1,
    grilleDim2
  } = req.body;

  if (!codeTiers || !codeArticle || !quantite || !dim1 || !dim2 || !grilleDim1 || !grilleDim2) {
    return res.status(400).json({
      message: 'Champs requis : codeTiers, codeArticle, quantite, dim1, dim2, grilleDim1, grilleDim2.',
    });
  }

  try {
    const pool = await poolPromise;

    const cleanTiers = codeTiers.trim().toUpperCase();
    const cleanCodeArticle = codeArticle.trim().toUpperCase();
    const cleanDim1 = dim1.trim().toUpperCase();
    const cleanDim2 = dim2.trim().toUpperCase();
    const cleanGrille1 = grilleDim1.trim().toUpperCase();
    const cleanGrille2 = grilleDim2.trim().toUpperCase();

    const getDimCode = async (libelle, typeDim, grille) => {
      const result = await pool.request()
        .input('libelle', sql.NVarChar, libelle)
        .input('type', sql.NVarChar, typeDim)
        .input('grille', sql.NVarChar, grille)
        .query(`
          SELECT TOP 1 GDI_CODEDIM
          FROM DIMENSION
          WHERE GDI_LIBELLE = @libelle
            AND GDI_TYPEDIM = @type
            AND GDI_GRILLEDIM = @grille
        `);
      return result.recordset[0]?.GDI_CODEDIM;
    };

    const codeDim1 = await getDimCode(cleanDim1, 'DI1', cleanGrille1);
    const codeDim2 = await getDimCode(cleanDim2, 'DI2', cleanGrille2);

    if (!codeDim1 || !codeDim2) {
      return res.status(400).json({ message: 'Dimensions invalides ou non trouv\u00e9es.' });
    }

    const codeSDIM = `${codeDim1}-${codeDim2}`;

    const gaArticleResult = await pool.request()
      .input('codeArticle', sql.NVarChar, cleanCodeArticle)
      .input('dim1', sql.NVarChar, codeDim1)
      .input('dim2', sql.NVarChar, codeDim2)
      .query(`
        SELECT GA_ARTICLE
        FROM ARTICLE
        WHERE GA_CODEARTICLE = @codeArticle
          AND GA_CODEDIM1 = @dim1
          AND GA_CODEDIM2 = @dim2
      `);

    const gaArticle = gaArticleResult.recordset[0]?.GA_ARTICLE;
    if (!gaArticle) {
      return res.status(404).json({ message: "Aucun article trouv\u00e9 avec ces dimensions." });
    }

    // \u2705 Cr\u00e9er un panier si aucun n'existe
    let panierResult = await pool.request()
      .input('codeTiers', sql.NVarChar, cleanTiers)
      .query(`
        SELECT TOP 1 *
        FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
        ORDER BY GP_DATEPIECE DESC
      `);

    if (panierResult.recordset.length === 0) {
      const numeroResult = await pool.request()
        .input('codeTiers', sql.NVarChar, cleanTiers)
        .query(`
          SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS newNumero
          FROM PIECE
          WHERE GP_NATUREPIECEG = 'PAN'
        `);

      const newNumero = numeroResult.recordset[0].newNumero;
      await pool.request()
        .input('nature', sql.NVarChar, 'PAN')
        .input('souche', sql.NVarChar, 'PAN001')
        .input('numero', sql.Int, newNumero)
        .input('indice', sql.Int, 0)
        .input('tiers', sql.NVarChar, cleanTiers)
        .query(`
          INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
          VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
        `);

      panierResult = await pool.request()
        .input('codeTiers', sql.NVarChar, cleanTiers)
        .query(`
          SELECT TOP 1 *
          FROM PIECE
          WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
          ORDER BY GP_DATEPIECE DESC
        `);
    }

    const { GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG } = panierResult.recordset[0];

    const request = pool.request()
      .input('nature', sql.NVarChar, GP_NATUREPIECEG)
      .input('souche', sql.NVarChar, GP_SOUCHE)
      .input('numero', sql.Int, GP_NUMERO)
      .input('indice', sql.NVarChar, GP_INDICEG.toString())
      .input('article', sql.NVarChar, gaArticle)
      .input('qte', sql.Numeric(19, 4), quantite)
      .input('codesdim', sql.NVarChar, codeSDIM)
      .input('codeTiers', sql.NVarChar, cleanTiers);

    const ligneExist = await request.query(`
      SELECT TOP 1 GL_QTEFACT 
      FROM LIGNE
      WHERE GL_NATUREPIECEG = @nature
        AND GL_SOUCHE = @souche
        AND GL_NUMERO = @numero
        AND GL_INDICEG = @indice
        AND GL_ARTICLE = @article
        AND GL_CODESDIM = @codesdim
        AND GL_TIERS = @codeTiers
    `);

    if (ligneExist.recordset.length > 0) {
      const existingQty = ligneExist.recordset[0].GL_QTEFACT;
      const newQty = existingQty + quantite;

      await request.input('qteNew', sql.Numeric(19, 4), newQty).query(`
        UPDATE LIGNE
        SET GL_QTEFACT = @qteNew
        WHERE GL_NATUREPIECEG = @nature
          AND GL_SOUCHE = @souche
          AND GL_NUMERO = @numero
          AND GL_INDICEG = @indice
          AND GL_ARTICLE = @article
          AND GL_CODESDIM = @codesdim
          AND GL_TIERS = @codeTiers
      `);

      return res.status(200).json({ message: 'Quantit\u00e9 mise \u00e0 jour pour cet article avec dimensions.' });
    }

    await request.query(`
      INSERT INTO LIGNE (
        GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG,
        GL_ARTICLE, GL_QTEFACT, GL_CODESDIM, GL_TIERS
      )
      VALUES (
        @nature, @souche, @numero, @indice,
        @article, @qte, @codesdim, @codeTiers
      )
    `);

    res.status(201).json({ message: 'Article ajout\u00e9 au panier avec dimensions.' });

  } catch (err) {
    console.error("\ud83d\udd25 ERREUR AJOUT PANIER :", err);
    res.status(500).json({ message: 'Erreur lors de l\u2019ajout au panier.', error: err.message });
  }
};



exports.getPanier = async (req, res) => {
  const { codeTiers } = req.params;

  if (!codeTiers) {
    return res.status(400).json({ message: 'CodeTiers est requis.' });
  }

  try {
    const pool = await poolPromise;
    const cleanTiers = codeTiers.trim().toUpperCase();

    // 1. Récupérer le panier actif
    const panierResult = await pool.request()
      .input('codeTiers', sql.NVarChar, cleanTiers)
      .query(`
        SELECT TOP 1 GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG
        FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
        ORDER BY GP_DATEPIECE DESC
      `);

    if (panierResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucun panier trouvé pour ce client.' });
    }

    const { GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG } = panierResult.recordset[0];

    // 2. Récupérer les lignes du panier avec les grilles
    const lignesResult = await pool.request()
      .input('nature', sql.NVarChar, GP_NATUREPIECEG)
      .input('souche', sql.NVarChar, GP_SOUCHE)
      .input('numero', sql.Int, GP_NUMERO)
      .input('indice', sql.NVarChar, GP_INDICEG.toString())
      .input('tiers', sql.NVarChar, cleanTiers)
      .query(`
        SELECT 
          L.GL_ARTICLE,
          L.GL_CODESDIM,
          A.GA_LIBELLE,
          A.GA_PVTTC,
          A.GA_CODEARTICLE,
          A.GA_GRILLEDIM1,
          A.GA_GRILLEDIM2,
          SUM(L.GL_QTEFACT) AS GL_QTEFACT,
          SUM(L.GL_QTEFACT * A.GA_PVTTC) AS TotalLigne
        FROM LIGNE L
        INNER JOIN ARTICLE A ON A.GA_ARTICLE = L.GL_ARTICLE
        INNER JOIN PIECE P ON 
          P.GP_NATUREPIECEG = L.GL_NATUREPIECEG AND
          P.GP_SOUCHE = L.GL_SOUCHE AND
          P.GP_NUMERO = L.GL_NUMERO AND
          P.GP_INDICEG = L.GL_INDICEG
        WHERE 
          P.GP_TIERS = @tiers AND
          P.GP_NATUREPIECEG = @nature AND
          P.GP_SOUCHE = @souche AND
          P.GP_NUMERO = @numero AND
          P.GP_INDICEG = @indice AND
          ISNULL(L.GL_CODESDIM, '') <> ''
        GROUP BY 
          L.GL_ARTICLE, L.GL_CODESDIM, A.GA_LIBELLE, A.GA_PVTTC, A.GA_CODEARTICLE,
          A.GA_GRILLEDIM1, A.GA_GRILLEDIM2
      `);

    const lignes = lignesResult.recordset;

    const lignesAvecDimensions = await Promise.all(lignes.map(async (ligne) => {
      let dim1Libelle = '', dim2Libelle = '';

      if (ligne.GL_CODESDIM?.includes('-')) {
        const [codeDim1, codeDim2] = ligne.GL_CODESDIM.split('-');

        const dim1Req = pool.request()
          .input('code1', sql.NVarChar, codeDim1)
          .input('type1', sql.NVarChar, 'DI1')
          .input('grille1', sql.NVarChar, ligne.GA_GRILLEDIM1)
          .query(`SELECT TOP 1 GDI_LIBELLE FROM DIMENSION WHERE GDI_CODEDIM = @code1 AND GDI_TYPEDIM = @type1 AND GDI_GRILLEDIM = @grille1`);

        const dim2Req = pool.request()
          .input('code2', sql.NVarChar, codeDim2)
          .input('type2', sql.NVarChar, 'DI2')
          .input('grille2', sql.NVarChar, ligne.GA_GRILLEDIM2)
          .query(`SELECT TOP 1 GDI_LIBELLE FROM DIMENSION WHERE GDI_CODEDIM = @code2 AND GDI_TYPEDIM = @type2 AND GDI_GRILLEDIM = @grille2`);

        const [dim1Res, dim2Res] = await Promise.all([dim1Req, dim2Req]);

        dim1Libelle = dim1Res.recordset[0]?.GDI_LIBELLE || '';
        dim2Libelle = dim2Res.recordset[0]?.GDI_LIBELLE || '';
      }

      return {
        ...ligne,
        dim1Libelle,
        dim2Libelle
      };
    }));

    res.status(200).json({ panier: lignesAvecDimensions });

  } catch (err) {
    console.error("🔥 ERREUR GET PANIER :", err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};



  exports.retirerDuPanier = async (req, res) => {
    const { codeTiers, codeArticle } = req.body;
  
    if (!codeTiers || !codeArticle) {
      return res.status(400).json({ message: 'Champs requis : codeTiers, codeArticle.' });
    }
  
    try {
      const pool = await poolPromise;
  
      const cleanTiers = codeTiers.trim().toUpperCase();
      const cleanArticle = codeArticle.trim().toUpperCase();
  
      // 🔍 Récupérer le panier le plus récent
      const panierResult = await pool.request()
        .input('codeTiers', sql.NVarChar, cleanTiers)
        .query(`
          SELECT TOP 1 GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG
          FROM PIECE
          WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
          ORDER BY GP_DATEPIECE DESC
        `);
  
      if (panierResult.recordset.length === 0) {
        return res.status(404).json({ message: 'Aucun panier trouvé.' });
      }
  
      const panier = panierResult.recordset[0];
  
      // ❌ Supprimer l'article ciblé du panier
      const deleteResult = await pool.request()
        .input('nature', sql.NVarChar, panier.GP_NATUREPIECEG)
        .input('souche', sql.NVarChar, panier.GP_SOUCHE)
        .input('numero', sql.Int, panier.GP_NUMERO)
        .input('indice', sql.NVarChar, panier.GP_INDICEG.toString())
        .input('article', sql.NVarChar, cleanArticle)
        .query(`
          DELETE FROM LIGNE
          WHERE GL_NATUREPIECEG = @nature AND GL_SOUCHE = @souche
            AND GL_NUMERO = @numero AND GL_INDICEG = @indice
            AND GL_ARTICLE = @article
        `);
  
      if (deleteResult.rowsAffected[0] === 0) {
        return res.status(404).json({ message: 'Article non trouvé dans le panier.' });
      }
  
      res.status(200).json({ message: 'Article retiré du panier.' });
  
    } catch (err) {
      console.error('🔥 ERREUR RETRAIT PANIER :', err);
      res.status(500).json({ message: 'Erreur lors du retrait de l’article.', error: err.message });
    }
  };

  exports.validerCommande = async (req, res) => {
  const { codeTiers } = req.body;

  if (!codeTiers) {
    return res.status(400).json({ message: 'codeTiers requis' });
  }

  const pool = await poolPromise;
  const cleanTiers = codeTiers.trim().toUpperCase();

  try {
    // 🔎 Récupérer le panier actif
    const panier = await pool.request()
      .input('codeTiers', sql.NVarChar, cleanTiers)
      .query(`
        SELECT TOP 1 * FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
        ORDER BY GP_DATEPIECE DESC
      `);

    if (panier.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucun panier trouvé.' });
    }

    const p = panier.recordset[0];

    // 🔢 Générer nouveau numéro commande
    const numeroResult = await pool.request().query(`
      SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS newNumero FROM PIECE WHERE GP_NATUREPIECEG = 'CMD'
    `);
    const newCmdNum = numeroResult.recordset[0].newNumero;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    // 🧾 Créer commande
    await new sql.Request(transaction)
      .input('nature', sql.NVarChar, 'CMD')
      .input('souche', sql.NVarChar, 'CMD001')
      .input('numero', sql.Int, newCmdNum)
      .input('indice', sql.Int, 0)
      .input('tiers', sql.NVarChar, cleanTiers)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
        VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
      `);

    // 🔄 Copier les lignes du panier dans la commande
    const lignes = await pool.request()
      .input('nature', sql.NVarChar, p.GP_NATUREPIECEG)
      .input('souche', sql.NVarChar, p.GP_SOUCHE)
      .input('numero', sql.Int, p.GP_NUMERO)
      .input('indice', sql.Int, p.GP_INDICEG)
      .query(`
        SELECT GL_ARTICLE, GL_QTEFACT FROM LIGNE
        WHERE GL_NATUREPIECEG = @nature AND GL_SOUCHE = @souche AND GL_NUMERO = @numero AND GL_INDICEG = @indice
      `);

    for (const ligne of lignes.recordset) {
      await new sql.Request(transaction)
        .input('nature', sql.NVarChar, 'CMD')
        .input('souche', sql.NVarChar, 'CMD001')
        .input('numero', sql.Int, newCmdNum)
        .input('indice', sql.Int, 0)
        .input('article', sql.NVarChar, ligne.GL_ARTICLE)
        .input('qte', sql.Numeric(19, 4), ligne.GL_QTEFACT)
        .query(`
          INSERT INTO LIGNE (GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG, GL_ARTICLE, GL_QTEFACT)
          VALUES (@nature, @souche, @numero, @indice, @article, @qte)
        `);
    }

    await transaction.commit();

      await pool.request()
  .input('nature', sql.NVarChar, p.GP_NATUREPIECEG)
  .input('souche', sql.NVarChar, p.GP_SOUCHE)
  .input('numero', sql.Int, p.GP_NUMERO)
  .input('indice', sql.Int, p.GP_INDICEG)
  .query(`DELETE FROM LIGNE WHERE GL_NATUREPIECEG=@nature AND GL_SOUCHE=@souche AND GL_NUMERO=@numero AND GL_INDICEG=@indice`);

await pool.request()
  .input('nature', sql.NVarChar, p.GP_NATUREPIECEG)
  .input('souche', sql.NVarChar, p.GP_SOUCHE)
  .input('numero', sql.Int, p.GP_NUMERO)
  .input('indice', sql.Int, p.GP_INDICEG)
  .query(`DELETE FROM PIECE WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice`);

    res.status(200).json({ message: 'Commande validée.', numeroCommande: newCmdNum });
  } catch (err) {
    console.error('Erreur validation commande:', err);
    res.status(500).json({ message: 'Erreur validation commande.', error: err.message });
  }

};

  
  
  