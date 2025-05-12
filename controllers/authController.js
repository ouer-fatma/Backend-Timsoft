const bcrypt = require('bcrypt');
const sql = require('mssql');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Contrôleur pour l'inscription
const registerUser = async (req, res) => {
  const { nom, email, motDePasse, role } = req.body;

  // Vérification des champs requis
  if (!nom || !email || !motDePasse || !role) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    // Hash du mot de passe
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(motDePasse, salt);

    // Connexion à la base de données
    const { DB_USER, DB_PASSWORD, DB_SERVER, DB_DATABASE, DB_PORT } = process.env;
    const config = {
      user: DB_USER,
      password: DB_PASSWORD,
      server: DB_SERVER,
      database: DB_DATABASE,
      port: parseInt(DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    };

    await sql.connect(config);

    // Étape 1 : Générer automatiquement un CodeTiers unique (ex: TR001)
    const requestGetCode = new sql.Request();
    const resultLastCode = await requestGetCode.query(`
      SELECT TOP 1 T_TIERS 
      FROM TIERS 
      WHERE T_TIERS LIKE 'TR%' 
      ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
    `);

    let newCodeTiers = 'TR001'; // valeur par défaut
    if (resultLastCode.recordset.length > 0) {
      const lastCode = resultLastCode.recordset[0].T_TIERS;
      const numericPart = parseInt(lastCode.slice(2)) + 1;
      newCodeTiers = 'TR' + numericPart.toString().padStart(3, '0');
    }

    // Étape 2 : Créer un enregistrement dans la table TIERS avec le nouveau CodeTiers
    const requestInsertTiers = new sql.Request();
    requestInsertTiers.input('T_TIERS', sql.VarChar, newCodeTiers);
    await requestInsertTiers.query(`
      INSERT INTO TIERS (T_TIERS) VALUES (@T_TIERS)
    `);

    // Étape 3 : Insérer l’utilisateur dans la table Utilisateur
    const requestUser = new sql.Request();
    requestUser.input('Nom', sql.VarChar, nom);
    requestUser.input('Email', sql.VarChar, email);
    requestUser.input('MotDePasse', sql.VarChar, hashedPassword);
    requestUser.input('Role', sql.VarChar, role);
    requestUser.input('CodeTiers', sql.VarChar, newCodeTiers);

    await requestUser.query(`
      INSERT INTO Utilisateur (Nom, Email, MotDePasse, Role, CodeTiers)
      VALUES (@Nom, @Email, @MotDePasse, @Role, @CodeTiers)
    `);

    res.status(201).json({ message: 'Utilisateur enregistré avec succès !' });

  } catch (err) {
    console.error('Erreur lors de l\'inscription :', err);
    res.status(500).json({ message: 'Erreur lors de l\'inscription.' });
  } finally {
    await sql.close();
  }
};

// Contrôleur pour la connexion
const loginUser = async (req, res) => {
  const { email, motDePasse } = req.body;

  if (!email || !motDePasse) {
    return res.status(400).json({ message: 'Email et mot de passe sont obligatoires.' });
  }

  try {
    const { DB_USER, DB_PASSWORD, DB_SERVER, DB_DATABASE, DB_PORT } = process.env;
    const config = {
      user: DB_USER,
      password: DB_PASSWORD,
      server: DB_SERVER,
      database: DB_DATABASE,
      port: parseInt(DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    };

    await sql.connect(config);
    const request = new sql.Request();
    request.input('Email', sql.VarChar, email);
    
    const result = await request.query('SELECT * FROM Utilisateur WHERE Email = @Email');
    const utilisateur = result.recordset[0];

    if (!utilisateur) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const passwordMatch = await bcrypt.compare(motDePasse, utilisateur.MotDePasse);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    const token = jwt.sign(
      { id: utilisateur.ID_Utilisateur, email: utilisateur.Email, role: utilisateur.Role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log("Email reçu:", email);
    console.log("Utilisateur trouvé:", utilisateur);
    console.log("Mot de passe correct:", passwordMatch);

    res.status(200).json({ message: 'Connexion réussie !', token });

  } catch (err) {
    console.error('Erreur lors de la connexion :', err);
    res.status(500).json({ message: 'Erreur lors de la connexion.' });
  } finally {
    await sql.close();
  }
};

// Contrôleurs pour les routes protégées
const adminDashboard = (req, res) => res.json({ message: 'Bienvenue, Admin !' });
const magasinDashboard = (req, res) => res.json({ message: 'Bienvenue, Personnel du Magasin !' });
const clientDashboard = (req, res) => res.json({ message: 'Bienvenue, Client !' });

module.exports = {
  registerUser,
  loginUser,
  adminDashboard,
  magasinDashboard,
  clientDashboard
};
