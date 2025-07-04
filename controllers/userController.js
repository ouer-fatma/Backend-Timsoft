//userController
const { sql, poolPromise } = require('../db');
const bcrypt = require('bcrypt');

// Admin-only: Add new user
exports.addUser = async (req, res) => {
  const { nom, prenom, email, motDePasse, role } = req.body;

  if (!nom || !prenom || !email || !motDePasse || !role) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(motDePasse, 10);
    const pool = await poolPromise;
    await pool.request()
      .input('Nom', sql.NVarChar(50), nom)
      .input('Prenom', sql.NVarChar(50), prenom)
      .input('Email', sql.NVarChar(150), email)
      .input('MotDePasse', sql.NVarChar(255), hashedPassword)
      .input('Role', sql.NVarChar(20), role)
      .query(`
        INSERT INTO Utilisateur (Nom, Prenom, Email, MotDePasse, Role)
        VALUES (@Nom, @Prenom, @Email, @MotDePasse, @Role)
      `);

    res.status(201).json({ message: 'Utilisateur ajouté avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de l\'ajout de l\'utilisateur.', error: err.message });
  }
};

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT ID_Utilisateur, Nom, Prenom, Email, Role FROM Utilisateur');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de récupération des utilisateurs.', error: err.message });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT ID_Utilisateur, Nom, Prenom, Email, Role FROM Utilisateur WHERE ID_Utilisateur=@id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }
    res.status(200).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de récupération.', error: err.message });
  }
};


exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { nom, prenom, email, role, motDePasse } = req.body;

  try {
    const pool = await poolPromise;
    const request = pool.request()
      .input('id', sql.Int, id)
      .input('nom', sql.NVarChar(50), nom)
      .input('prenom', sql.NVarChar(50), prenom)
      .input('email', sql.NVarChar(150), email)
      .input('role', sql.NVarChar(20), role);

    // If password is provided, hash and include it
    let updateQuery = `
      UPDATE Utilisateur
      SET Nom=@nom,
          Prenom=@prenom,
          Email=@email,
          Role=@role
    `;

    if (motDePasse && motDePasse.trim() !== '') {
      const hashedPassword = await bcrypt.hash(motDePasse, 10);
      request.input('motDePasse', sql.NVarChar(255), hashedPassword);
      updateQuery += `, MotDePasse=@motDePasse`;
    }

    updateQuery += ` WHERE ID_Utilisateur=@id`;

    const result = await request.query(updateQuery);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    res.status(200).json({ message: 'Utilisateur mis à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la mise à jour.', error: err.message });
  }
};



// Delete user by admin
exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM Utilisateur WHERE ID_Utilisateur=@id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    res.status(200).json({ message: 'Utilisateur supprimé avec succès.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de suppression.', error: err.message });
  }
};
