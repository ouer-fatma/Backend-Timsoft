const { sql, poolPromise } = require('../db');

exports.initPanier = async (req, res) => {
  const { codeTiers } = req.body;

  if (!codeTiers) {
    return res.status(400).json({ message: 'CodeTiers est requis.' });
  }

  try {
    const pool = await poolPromise;

    // 🔍 Vérifier si un panier existe déjà pour ce codeTiers
    const checkPanier = await pool.request()
      .input('codeTiers', sql.NVarChar, codeTiers.trim().toUpperCase()) // normalisation
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
      `);

    if (checkPanier.recordset.length > 0) {
      return res.status(200).json({ message: 'Panier déjà existant.', panier: checkPanier.recordset[0] });
    }

    // 🆕 Générer le nouveau numéro
    const cleanCodeTiers = codeTiers.trim().toUpperCase();
    const numeroResult = await pool.request()
    .input('codeTiers', sql.NVarChar, cleanCodeTiers)
    .query(`
    SELECT ISNULL(MAX(GP_NUMERO), 0) + 1 AS newNumero
    FROM PIECE
    WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers

    `);
  
    const newNumero = numeroResult.recordset[0].newNumero;

    // 🧾 Créer le panier


    await pool.request()
      .input('nature', sql.NVarChar, 'PAN')
      .input('souche', sql.NVarChar, 'PAN001')
      .input('numero', sql.Int, newNumero)
      .input('indice', sql.Int, 0)
      .input('tiers', sql.NVarChar, cleanCodeTiers)
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
    const { codeTiers, codeArticle, quantite } = req.body;
  
    if (!codeTiers || !codeArticle || !quantite) {
      return res.status(400).json({ message: 'Champs requis : codeTiers, codeArticle, quantite.' });
    }
  
    try {
      const pool = await poolPromise;
  
      const cleanTiers = codeTiers.trim().toUpperCase();
      const cleanArticle = codeArticle.trim().toUpperCase();
  
      // 🔍 Récupération du panier le plus récent
      const panierResult = await pool.request()
        .input('codeTiers', sql.NVarChar, cleanTiers)
        .query(`
          SELECT TOP 1 * FROM PIECE
          WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
          ORDER BY GP_DATEPIECE DESC
        `);
  
      if (panierResult.recordset.length === 0) {
        return res.status(404).json({ message: 'Aucun panier trouvé pour cet utilisateur.' });
      }
  
      const panier = panierResult.recordset[0];
      const { GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG } = panier;
  
      // 🔄 Requête unique avec le même request object
      const request = pool.request()
        .input('nature', sql.NVarChar, GP_NATUREPIECEG)
        .input('souche', sql.NVarChar, GP_SOUCHE)
        .input('numero', sql.Int, GP_NUMERO)
        .input('indice', sql.NVarChar, GP_INDICEG.toString())
        .input('article', sql.NVarChar, cleanArticle)
        .input('qte', sql.Numeric(19, 4), quantite);
  
      // 🧾 Vérifier si l'article est déjà dans le panier
      const ligneExist = await request.query(`
        SELECT TOP 1 GL_QTEFACT FROM LIGNE
        WHERE GL_NATUREPIECEG = @nature AND GL_SOUCHE = @souche 
          AND GL_NUMERO = @numero AND GL_INDICEG = @indice
          AND GL_ARTICLE = @article
      `);
  
      if (ligneExist.recordset.length > 0) {
        const existingQty = ligneExist.recordset[0].GL_QTEFACT;
        const newQty = existingQty + quantite;
  
        await request.input('qteNew', sql.Numeric(19, 4), newQty).query(`
          UPDATE LIGNE
          SET GL_QTEFACT = @qteNew
          WHERE GL_NATUREPIECEG = @nature AND GL_SOUCHE = @souche 
            AND GL_NUMERO = @numero AND GL_INDICEG = @indice
            AND GL_ARTICLE = @article
        `);
  
        return res.status(200).json({ message: 'Quantité mise à jour.' });
      }
  
      // ➕ Insertion si pas encore présent
      await request.query(`
        INSERT INTO LIGNE (GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG, GL_ARTICLE, GL_QTEFACT)
        VALUES (@nature, @souche, @numero, @indice, @article, @qte)
      `);
  
      res.status(201).json({ message: 'Article ajouté au panier.' });
  
    } catch (err) {
      console.error("🔥 ERREUR AJOUT PANIER :", err);
      res.status(500).json({ message: 'Erreur lors de l’ajout au panier.', error: err.message });
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
  
      const panierResult = await pool.request()
      .input('codeTiers', sql.NVarChar, cleanTiers)
      .query(`
        SELECT TOP 1 GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG
        FROM PIECE
        WHERE GP_NATUREPIECEG = 'PAN' AND GP_TIERS = @codeTiers
        ORDER BY GP_NUMERO DESC
      `);
    
  
      if (panierResult.recordset.length === 0) {
        return res.status(404).json({ message: 'Aucun panier trouvé pour ce client.' });
      }
  
      const { GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG } = panierResult.recordset[0];
  
      const lignesResult = await pool.request()
        .input('nature', sql.NVarChar, GP_NATUREPIECEG)
        .input('souche', sql.NVarChar, GP_SOUCHE)
        .input('numero', sql.Int, GP_NUMERO)
        .input('indice', sql.NVarChar, GP_INDICEG.toString())
        .input('tiers', sql.NVarChar, cleanTiers)  // 👈 Ajout sécurité
        .query(`
        SELECT 
    L.GL_ARTICLE,
    SUM(L.GL_QTEFACT) AS GL_QTEFACT,
    A.GA_LIBELLE,
    A.GA_PVTTC,
    SUM(L.GL_QTEFACT * A.GA_PVTTC) AS TotalLigne
FROM LIGNE L
INNER JOIN ARTICLE A 
    ON A.GA_CODEARTICLE = L.GL_ARTICLE
INNER JOIN PIECE P 
    ON P.GP_NATUREPIECEG = L.GL_NATUREPIECEG
    AND P.GP_SOUCHE = L.GL_SOUCHE
    AND P.GP_NUMERO = L.GL_NUMERO
    AND P.GP_INDICEG = L.GL_INDICEG
WHERE 
    P.GP_TIERS = @tiers
    AND P.GP_NATUREPIECEG = @nature
    AND P.GP_SOUCHE = @souche
    AND P.GP_NUMERO = @numero
    AND P.GP_INDICEG = @indice
GROUP BY 
    L.GL_ARTICLE, A.GA_LIBELLE, A.GA_PVTTC
        `);
  
      res.status(200).json({ panier: lignesResult.recordset });
  
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
  
  
  