const { poolPromise } = require('../db');

exports.getAll = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT * FROM TYPEREMISE");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la récupération des promotions', error: err });
  }
};

exports.create = async (req, res) => {
  const { GTR_TYPEREMISE, GTR_LIBELLE, GTR_ABREGE, GTR_IMPRIMABLE } = req.body;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('GTR_TYPEREMISE', GTR_TYPEREMISE)
      .input('GTR_LIBELLE', GTR_LIBELLE)
      .input('GTR_ABREGE', GTR_ABREGE)
      .input('GTR_IMPRIMABLE', GTR_IMPRIMABLE)
      .query(`
        INSERT INTO TYPEREMISE (GTR_TYPEREMISE, GTR_LIBELLE, GTR_ABREGE, GTR_IMPRIMABLE)
        VALUES (@GTR_TYPEREMISE, @GTR_LIBELLE, @GTR_ABREGE, @GTR_IMPRIMABLE)
      `);
    res.status(201).json({ message: 'Promotion créée avec succès' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la création', error: err });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { GTR_LIBELLE, GTR_ABREGE, GTR_IMPRIMABLE } = req.body;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('id', id)
      .input('GTR_LIBELLE', GTR_LIBELLE)
      .input('GTR_ABREGE', GTR_ABREGE)
      .input('GTR_IMPRIMABLE', GTR_IMPRIMABLE)
      .query(`
        UPDATE TYPEREMISE
        SET GTR_LIBELLE = @GTR_LIBELLE,
            GTR_ABREGE = @GTR_ABREGE,
            GTR_IMPRIMABLE = @GTR_IMPRIMABLE
        WHERE GTR_TYPEREMISE = @id
      `);
    res.json({ message: 'Promotion mise à jour' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la mise à jour', error: err });
  }
};

exports.remove = async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('id', id)
      .query("DELETE FROM TYPEREMISE WHERE GTR_TYPEREMISE = @id");
    res.json({ message: 'Promotion supprimée' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la suppression', error: err });
  }
};
