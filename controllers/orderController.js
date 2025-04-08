const Order = require('../models/Order');
const { sql, poolPromise } = require('../db');

// Récupérer toutes les commandes
exports.getAllOrders = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT TOP 100 * FROM PIECE');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commandes.', error: err.message });
  }
};

// Récupérer une commande par son identifiant composite
exports.getOrderById = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GP_SOUCHE', sql.NVarChar(6), souche)
      .input('GP_NUMERO', sql.Int, parseInt(numero))
      .input('GP_INDICEG', sql.NVarChar(3), indice)
      .query('SELECT * FROM PIECE WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commande.', error: err.message });
  }
};

// Obtenir les détails d'une commande avec lignes + article
exports.getOrderDetails = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;

    const pieceResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice
      `);

    if (pieceResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    const commande = pieceResult.recordset[0];

    const lignesResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT L.*, A.GA_LIBELLE, A.GA_PVTTC
        FROM LIGNE L
        LEFT JOIN ARTICLE A ON A.GA_CODEARTICLE = L.GL_ARTICLE
        WHERE L.GL_NATUREPIECEG=@nature AND L.GL_SOUCHE=@souche AND L.GL_NUMERO=@numero AND L.GL_INDICEG=@indice
      `);

    const lignes = lignesResult.recordset.map(l => ({
      ...l,
      GL_TOTALLIGNE: (l.GL_QTEFACT || 0) * (l.GA_PVTTC || 0),
      GL_NUMPIECE: `${nature}/${souche}/${numero}/${indice}`
    }));

    res.status(200).json({ commande, lignes });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la récupération des détails de la commande.', error: err.message });
  }
};

// Créer une commande + lignes de commande
exports.createOrder = async (req, res) => {
  const {
    GP_NATUREPIECEG,
    GP_SOUCHE,
    GP_NUMERO,
    GP_INDICEG,
    GP_TIERS,
    GP_TOTALHT,
    GP_TOTALTTC,
    GP_DATECREATION,
    GP_DEPOT,
    lignes = []
  } = req.body;

  if (!GP_NATUREPIECEG || !GP_SOUCHE || !GP_NUMERO || !GP_INDICEG || !GP_TIERS || !GP_TOTALHT || !GP_TOTALTTC || !GP_DATECREATION || !GP_DEPOT) {
    return res.status(400).json({ message: 'Tous les champs de la commande sont obligatoires.' });
  }

  if (!Array.isArray(lignes)) {
    return res.status(400).json({ message: 'Lignes de commande invalides.' });
  }

  try {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    const request = new sql.Request(transaction);

    await request
      .input('GP_NATUREPIECEG', sql.NVarChar(3), GP_NATUREPIECEG)
      .input('GP_SOUCHE', sql.NVarChar(6), GP_SOUCHE)
      .input('GP_NUMERO', sql.Int, GP_NUMERO)
      .input('GP_INDICEG', sql.Int, GP_INDICEG)
      .input('GP_TIERS', sql.NVarChar(17), GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19, 4), GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19, 4), GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), GP_DEPOT)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT)
        VALUES (@GP_NATUREPIECEG, @GP_SOUCHE, @GP_NUMERO, @GP_INDICEG, @GP_TIERS, @GP_TOTALHT, @GP_TOTALTTC, @GP_DATECREATION, @GP_DEPOT)
      `);

      for (let i = 0; i < lignes.length; i++) {
        const { GL_CODEARTICLE, GL_QTEFACT } = lignes[i];
        if (!GL_CODEARTICLE || !GL_QTEFACT) continue;
      
        const ligneRequest = new sql.Request(transaction); // 🔄 nouvelle requête à chaque fois
      
        await ligneRequest
          .input('GL_NATUREPIECEG', sql.NVarChar(3), GP_NATUREPIECEG)
          .input('GL_SOUCHE', sql.NVarChar(6), GP_SOUCHE)
          .input('GL_NUMERO', sql.Int, GP_NUMERO)
          .input('GL_INDICEG', sql.Int, GP_INDICEG)
          .input('GL_CODEARTICLE', sql.NVarChar(18), GL_CODEARTICLE)
          .input('GL_QTEFACT', sql.Numeric(19, 4), GL_QTEFACT)
          .query(`
            INSERT INTO LIGNE (GL_NATUREPIECEG, GL_SOUCHE, GL_NUMERO, GL_INDICEG, GL_CODEARTICLE, GL_QTEFACT)
            VALUES (@GL_NATUREPIECEG, @GL_SOUCHE, @GL_NUMERO, @GL_INDICEG, @GL_CODEARTICLE, @GL_QTEFACT)
          `);
      }
      
      

    await transaction.commit();
    res.status(201).json({ message: 'Commande + lignes créées avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la création de la commande.', error: err.message });
  }
};

// Modifier une commande
exports.updateOrder = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;
  const { GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GP_SOUCHE', sql.NVarChar(6), souche)
      .input('GP_NUMERO', sql.Int, parseInt(numero))
      .input('GP_INDICEG', sql.NVarChar(3), indice)
      .input('GP_TIERS', sql.NVarChar(17), GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19, 4), GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19, 4), GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), GP_DEPOT)
      .query(`
        UPDATE PIECE SET GP_TIERS=@GP_TIERS, GP_TOTALHT=@GP_TOTALHT, GP_TOTALTTC=@GP_TOTALTTC,
        GP_DATECREATION=@GP_DATECREATION, GP_DEPOT=@GP_DEPOT
        WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json({ message: 'Commande mise à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur mise à jour commande.', error: err.message });
  }
};

// Supprimer une commande
exports.deleteOrder = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;

    await pool.request()
      .input('GL_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GL_SOUCHE', sql.NVarChar(6), souche)
      .input('GL_NUMERO', sql.Int, parseInt(numero))
      .input('GL_INDICEG', sql.NVarChar(3), indice)
      .query('DELETE FROM LIGNE WHERE GL_NATUREPIECEG=@GL_NATUREPIECEG AND GL_SOUCHE=@GL_SOUCHE AND GL_NUMERO=@GL_NUMERO AND GL_INDICEG=@GL_INDICEG');

    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), nature)
      .input('GP_SOUCHE', sql.NVarChar(6), souche)
      .input('GP_NUMERO', sql.Int, parseInt(numero))
      .input('GP_INDICEG', sql.NVarChar(3), indice)
      .query('DELETE FROM PIECE WHERE GP_NATUREPIECEG=@GP_NATUREPIECEG AND GP_SOUCHE=@GP_SOUCHE AND GP_NUMERO=@GP_NUMERO AND GP_INDICEG=@GP_INDICEG');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json({ message: 'Commande supprimée avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur suppression commande.', error: err.message });
  }
};
