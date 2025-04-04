const Order = require('../models/Order');
const { sql, poolPromise } = require('../db');

exports.getAllOrders = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT TOP 100 * FROM PIECE');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération commandes.', error: err.message });
  }
};

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

exports.createOrder = async (req, res) => {
  const { GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT } = req.body;

  if (!GP_NATUREPIECEG || !GP_SOUCHE || !GP_NUMERO || !GP_INDICEG || !GP_TIERS || !GP_TOTALHT || !GP_TOTALTTC || !GP_DATECREATION || !GP_DEPOT) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    const order = new Order(GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT);
    await order.save();

    res.status(201).json({ message: 'Commande créée avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur création commande.', error: err.message });
  }
};

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
      .input('GP_TOTALHT', sql.Numeric(19,4), GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19,4), GP_TOTALTTC)
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

exports.deleteOrder = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;
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
