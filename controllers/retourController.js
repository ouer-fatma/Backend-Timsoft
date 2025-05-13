const { sql, poolPromise } = require('../db');
const fs = require('fs');

// ✅ Récupération de tous les retours clients
exports.getAllRetours = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT P.GP_NUMERO, P.GP_TIERS, P.GP_DATEPIECE, L.GL_ARTICLE, L.GL_QTEFACT, L.GL_DEPOT
      FROM PIECE P
      JOIN LIGNE L ON 
        P.GP_NUMERO = L.GL_NUMERO AND
        P.GP_SOUCHE = L.GL_SOUCHE AND
        P.GP_NATUREPIECEG = L.GL_NATUREPIECEG
      WHERE P.GP_NATUREPIECEG = 'FFO' AND L.GL_QTEFACT < 0
    `);
    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('❌ Erreur SQL lors du retour :', err);
    res.status(500).json({ error: err.message });
  }
};


exports.processRetour = async (req, res) => {
  const { article, quantite, depot, utilisateur, modeRetour } = req.body;

  if (!article || !quantite || !depot || !utilisateur || !modeRetour) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  try {
    const pool = await poolPromise;

    // Vérifie la date de la dernière vente
    const venteResult = await pool.request()
      .input('article', sql.NVarChar, article.trim())
      .input('tiers', sql.NVarChar, utilisateur)
      .query(`
        SELECT TOP 1 GP_DATECREATION
        FROM PIECE
        JOIN LIGNE ON LIGNE.GL_NUMERO = PIECE.GP_NUMERO
        WHERE GL_ARTICLE = @article AND GP_TIERS = @tiers
          AND GP_NATUREPIECEG IN ('FAC', 'CMD')
          AND GL_QTEFACT > 0
        ORDER BY GP_DATECREATION DESC
      `);

    if (venteResult.recordset.length === 0) {
      return res.status(400).json({ message: 'Achat original introuvable pour cet article.' });
    }

    const dateVente = new Date(venteResult.recordset[0].GP_DATECREATION);
    const aujourdHui = new Date();
    const differenceJours = Math.floor((aujourdHui - dateVente) / (1000 * 60 * 60 * 24));

   const retourRefuse = differenceJours >= 30; 
    const statutRetour = retourRefuse ? 'refusé' : 'accepté';

    if (retourRefuse) {
      return res.status(403).json({ message: "Retour refusé : le délai de 30 jours est dépassé." });
    }

    // Début de transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    const pieceId = Math.floor(Math.random() * 1000000000);

    // Insertion dans PIECE
    await new sql.Request(transaction)
      .input('GP_NUMERO', sql.Int, pieceId)
      .input('GP_TIERS', sql.NVarChar(17), utilisateur)
      .input('GP_DATEPIECE', sql.DateTime, new Date())
      .input('GP_SOUCHE', sql.NVarChar(6), 'RT')
      .input('GP_NATUREPIECEG', sql.NVarChar(3), 'FFO')
      .input('GP_MODERETOUR', sql.NVarChar(20), modeRetour)
      .input('GP_STATUTRETOUR', sql.NVarChar(20), statutRetour)
      .query(`
        INSERT INTO PIECE (GP_NUMERO, GP_TIERS, GP_DATEPIECE, GP_SOUCHE, GP_NATUREPIECEG, GP_MODERETOUR, GP_STATUTRETOUR)
        VALUES (@GP_NUMERO, @GP_TIERS, @GP_DATEPIECE, @GP_SOUCHE, @GP_NATUREPIECEG, @GP_MODERETOUR, @GP_STATUTRETOUR)
      `);

    // Insertion ligne
    await new sql.Request(transaction)
      .input('GL_NUMERO', sql.Int, pieceId)
      .input('GL_ARTICLE', sql.NVarChar(50), article.trim())
      .input('GL_QTEFACT', sql.Numeric(19, 4), -Math.abs(quantite))
      .input('GL_DEPOT', sql.NVarChar(6), depot)
      .input('GL_SOUCHE', sql.NVarChar(6), 'RT')
      .input('GL_NATUREPIECEG', sql.NVarChar(3), 'FFO')
      .query(`
        INSERT INTO LIGNE (GL_NUMERO, GL_ARTICLE, GL_QTEFACT, GL_DEPOT, GL_SOUCHE, GL_NATUREPIECEG)
        VALUES (@GL_NUMERO, @GL_ARTICLE, @GL_QTEFACT, @GL_DEPOT, @GL_SOUCHE, @GL_NATUREPIECEG)
      `);

    // Mise à jour du stock
    await new sql.Request(transaction)
      .input('article', sql.NVarChar(50), article.trim())
      .input('depot', sql.NVarChar(6), depot)
      .input('quantite', sql.Numeric(19, 4), Math.abs(quantite))
      .query(`
        UPDATE DISPO
        SET GQ_PHYSIQUE = GQ_PHYSIQUE + @quantite
        WHERE REPLACE(GQ_ARTICLE, ' ', '') = REPLACE(@article, ' ', '')
          AND REPLACE(GQ_DEPOT, ' ', '') = REPLACE(@depot, ' ', '')
      `);

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: '✅ Retour client enregistré avec succès.',
      pieceId
    });

  } catch (err) {
    console.error('❌ Erreur SQL lors du retour :', err);
    res.status(500).json({ error: err.message });
  }
};

  exports.generateReturnReceipt = async (req, res) => {
    const { numeroRetour } = req.params;
    const pool = await poolPromise;
    const generateReturnPDF = require('../invoices/generateReturnPDF');
    const path = require('path');
  
    try {
      const pieceResult = await pool.request()
        .input('numero', sql.Int, parseInt(numeroRetour))
        .query(`
          SELECT * FROM PIECE
          WHERE GP_NUMERO = @numero AND GP_NATUREPIECEG = 'FFO'
        `);
  
      if (pieceResult.recordset.length === 0) {
        return res.status(404).json({ message: "Retour introuvable." });
      }
  
      const retour = pieceResult.recordset[0];
  
      const lignesResult = await pool.request()
        .input('numero', sql.Int, parseInt(numeroRetour))
        .query(`
          SELECT * FROM LIGNE
          WHERE GL_NUMERO = @numero AND GL_NATUREPIECEG = 'FFO'
        `);
  
      const filePath = path.join(__dirname, `../invoices/retour_${numeroRetour}.pdf`);
      generateReturnPDF(retour, lignesResult.recordset, filePath);
  
      setTimeout(() => {
        res.download(filePath, () => {
          fs.unlink(filePath, () => {});
        });
      }, 1000);
  
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  exports.getRetoursByClient = async (req, res) => {
  const { utilisateur } = req.params;
  const pool = await poolPromise;

  try {
    const result = await pool.request()
      .input('utilisateur', sql.NVarChar, utilisateur)
      .query(`
        SELECT GP_NUMERO, GP_DATEPIECE, GP_MODERETOUR, GP_STATUTRETOUR
        FROM PIECE
        WHERE GP_TIERS = @utilisateur AND GP_NATUREPIECEG = 'FFO'
        ORDER BY GP_DATEPIECE DESC
      `);
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getUserRetours = async (req, res) => {
  const { utilisateur } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('utilisateur', sql.NVarChar(17), utilisateur)
      .query(`
        SELECT 
          P.GP_NUMERO AS numeroRetour,
          P.GP_DATEPIECE AS dateRetour,
          P.GP_STATUTRETOUR AS statut,
          P.GP_MODERETOUR AS modeRetour,
          L.GL_ARTICLE AS article,
          L.GL_QTEFACT AS quantite
        FROM PIECE P
        JOIN LIGNE L ON 
          P.GP_NUMERO = L.GL_NUMERO AND 
          P.GP_SOUCHE = L.GL_SOUCHE AND 
          P.GP_NATUREPIECEG = L.GL_NATUREPIECEG
        WHERE 
          P.GP_TIERS = @utilisateur AND 
          P.GP_NATUREPIECEG = 'FFO'
        ORDER BY P.GP_DATEPIECE DESC
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('❌ Erreur lors de la récupération des retours :', err);
    res.status(500).json({ error: err.message });
  }
};

