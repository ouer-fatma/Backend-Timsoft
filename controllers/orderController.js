const { sql, poolPromise } = require('../db');
const Order = require('../models/Order');

// Récupérer toutes les commandes (limité à 100 commandes)
exports.getAllOrders = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT TOP 100 * FROM PIECE');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commandes.', error: err.message });
  }
};

// Récupérer une commande par GP_NUMERO
exports.getOrderById = async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM PIECE WHERE GP_NUMERO=@id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commande.', error: err.message });
  }
};

// Ajouter une nouvelle commande
exports.createOrder = async (req, res) => {
  const { GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT } = req.body;

  if (!GP_TIERS || !GP_TOTALHT || !GP_TOTALTTC || !GP_DATECREATION || !GP_DEPOT) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    const order = new Order(GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT);
    await order.save();

    res.status(201).json({ message: 'Commande créée avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur création commande.', error: err.message });
  }
};

// Modifier une commande existante
exports.updateOrder = async (req, res) => {
  const { id } = req.params;
  const { GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('GP_TIERS', sql.NVarChar(17), GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19,4), GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19,4), GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), GP_DEPOT)
      .query(`
        UPDATE PIECE 
        SET GP_TIERS=@GP_TIERS, GP_TOTALHT=@GP_TOTALHT, GP_TOTALTTC=@GP_TOTALTTC,
            GP_DATECREATION=@GP_DATECREATION, GP_DEPOT=@GP_DEPOT
        WHERE GP_NUMERO=@id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json({ message: 'Commande mise à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur mise à jour commande.', error: err.message });
  }
};
// Route pour récupérer la dernière commande ajoutée
/* exports.getLatestOrder = async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .query('SELECT TOP 1 * FROM PIECE ORDER BY GP_NUMERO DESC'); // Récupère la dernière commande
  
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: 'Aucune commande trouvée.' });
      }
      
      res.status(200).json(result.recordset[0]);
    } catch (err) {
      res.status(500).json({ message: 'Erreur récupération commande.', error: err.message });
    }
  };*/
  
// Supprimer une commande
exports.deleteOrder = async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM PIECE WHERE GP_NUMERO=@id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.status(200).json({ message: 'Commande supprimée avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur suppression commande.', error: err.message });
  }
};
