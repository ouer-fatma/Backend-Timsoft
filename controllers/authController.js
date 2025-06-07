//authController
const bcrypt = require('bcrypt');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { sql, poolPromise } = require('../db');
const admin = require('firebase-admin');
const serviceAccount = require('../firebase-service-account.json'); // mets le bon chemin

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}


// Contrôleur pour l'inscription
const registerUser = async (req, res) => {
  const { nom, prenom, email, motDePasse, role } = req.body;

  if (!nom || !prenom || !email || !motDePasse || !role) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  if (role !== 'client') {
    return res.status(403).json({ message: 'Seuls les clients peuvent s’inscrire via cette route.' });
  }

  try {
    const motDePasseString = String(motDePasse).trim();
    const pool = await poolPromise;

    // Vérifie si email existe déjà
    const check = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT 1 FROM TIERS WHERE T_EMAIL = @email');

    if (check.recordset.length > 0) {
      return res.status(409).json({ message: 'Cet e-mail est déjà utilisé.' });
    }

    // Générer T_TIERS
    const tiersResult = await pool.request().query(`
      SELECT TOP 1 T_TIERS FROM TIERS 
      WHERE T_TIERS LIKE 'TR%' 
      ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
    `);

    let newCode = 'TR001';
    if (tiersResult.recordset.length > 0) {
      const lastCode = tiersResult.recordset[0].T_TIERS;
      const numeric = parseInt(lastCode.slice(2)) + 1;
      newCode = 'TR' + numeric.toString().padStart(3, '0');
    }

    const hashedPassword = motDePasseString; // Pas besoin de hash vu ta limite 20 char

    // 🛠️ Assigner T_AUXILIAIRE avec le même code que T_TIERS
    await pool.request()
      .input('T_TIERS', sql.NVarChar, newCode)
      .input('T_AUXILIAIRE', sql.NVarChar, newCode)
      .input('T_LIBELLE', sql.NVarChar, `${nom} ${prenom}`)
      .input('T_EMAIL', sql.NVarChar, email)
      .input('T_PASSWINTERNET', sql.NVarChar, hashedPassword)
      .query(`
        INSERT INTO TIERS (T_TIERS, T_AUXILIAIRE, T_LIBELLE, T_EMAIL, T_PASSWINTERNET)
        VALUES (@T_TIERS, @T_AUXILIAIRE, @T_LIBELLE, @T_EMAIL, @T_PASSWINTERNET)
      `);

    // 🛒 Créer un panier
    const resultNumero = await pool.request().query(`
      SELECT MAX(CAST(GP_NUMERO AS INT)) + 1 AS newNumero 
      FROM PIECE WHERE ISNUMERIC(GP_NUMERO) = 1
    `);

    const newNumero = resultNumero.recordset[0].newNumero || 1;

    await pool.request()
      .input('nature', sql.NVarChar, 'PAN')
      .input('souche', sql.NVarChar, 'PAN001')
      .input('numero', sql.Int, newNumero)
      .input('indice', sql.Int, 0)
      .input('tiers', sql.NVarChar, newCode)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
        VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
      `);

    return res.status(201).json({ message: 'Client enregistré avec succès !' });

  } catch (err) {
    console.error('❌ Erreur registerUser:', err);
    return res.status(500).json({ message: 'Erreur serveur lors de l\'inscription.' });
  }
};



// Contrôleur pour la connexion
const loginUser = async (req, res) => {
  const { email, motDePasse } = req.body;

  if (!email || !motDePasse) {
    return res.status(400).json({ message: 'Email et mot de passe sont obligatoires.' });
  }

  try {
    const pool = await poolPromise;
    let utilisateur = null;
    let role = null;
    let codeTiers = null;
    let nom = null; // ✅ à ajouter dans le token pour les clients
    let prenom = null;

    // 🔍 Vérifie si c’est un utilisateur interne (admin / magasinier)
    const userResult = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`
        SELECT US_UTILISATEUR, US_EMAIL, US_PASSWORD, US_FONCTION, US_SUPERVISEUR, US_GROUPE
        FROM UTILISAT
        WHERE US_EMAIL = @email
      `);

    if (userResult.recordset.length > 0) {
      const user = userResult.recordset[0];

      if (motDePasse.trim() !== user.US_PASSWORD?.trim()) {
        return res.status(401).json({ message: 'Mot de passe incorrect.' });
      }

      utilisateur = user;
      codeTiers = user.US_UTILISATEUR?.trim();

      role = (user.US_GROUPE === 'ADM' ||
              (user.US_SUPERVISEUR === 'X' && user.US_GROUPE === 'ADM') ||
              (user.US_FONCTION && user.US_FONCTION.toLowerCase().includes('admin')))
              ? 'admin'
              : 'personnel_magasin';
    }

    // 🔍 Sinon, vérifier si c’est un client dans TIERS
    if (!utilisateur) {
      const clientResult = await pool.request()
        .input('email', sql.NVarChar, email)
        .query(`
          SELECT T_TIERS, T_EMAIL, T_PASSWINTERNET, T_LIBELLE, T_PRENOM 
          FROM TIERS 
          WHERE T_EMAIL = @email
        `);

      if (clientResult.recordset.length > 0) {
        const client = clientResult.recordset[0];

        if (motDePasse !== client.T_PASSWINTERNET?.trim()) {
          return res.status(401).json({ message: 'Mot de passe incorrect.' });
        }

        utilisateur = client;
        codeTiers = client.T_TIERS;
        nom = client.T_LIBELLE;
        prenom = client.T_PRENOM;
        role = 'client';
      }
    }

    if (!utilisateur) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const tokenPayload = {
      email,
      role,
      codeTiers,
    };

    // ✅ Ajouter nom/prenom au token pour les clients
    if (role === 'client') {
      tokenPayload.nom = nom;
      tokenPayload.prenom = prenom;
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = {
      message: 'Connexion réussie !',
      token,
      role,
      codeTiers,
      email,
    };

    // ✅ Ajout des données COMMERCIAL pour les magasinier
    if (role === 'personnel_magasin') {
      const commercialRes = await pool.request()
        .input('code', sql.NVarChar, codeTiers)
        .query(`SELECT * FROM COMMERCIAL WHERE GCL_COMMERCIAL = @code`);

      response.commercial = commercialRes.recordset[0] || null;
    }

    res.status(200).json(response);

  } catch (err) {
    console.error('❌ Erreur de connexion :', err);
    res.status(500).json({ message: 'Erreur serveur pendant la connexion.' });
  }
};



const googleSignIn = async (req, res) => {
  const { token, username } = req.body;

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const email = decodedToken.email;
    const nom = username || decodedToken.name || email.split('@')[0];
    const prenom = ''; // Pas fourni par Google

    const pool = await poolPromise;

    // Vérifie si le client existe déjà
    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`SELECT * FROM TIERS WHERE T_EMAIL = @email`);

    let user = result.recordset[0];

    // S'il n'existe pas, on le crée
    if (!user) {
      const tiersCodeResult = await pool.request().query(`
        SELECT TOP 1 T_TIERS FROM TIERS 
        WHERE T_TIERS LIKE 'TR%' 
        ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
      `);

      let newCode = 'TR001';
      if (tiersCodeResult.recordset.length > 0) {
        const lastCode = tiersCodeResult.recordset[0].T_TIERS;
        const numeric = parseInt(lastCode.slice(2)) + 1;
        newCode = 'TR' + numeric.toString().padStart(3, '0');
      }

      const hashedPassword = '0000'; // Plain fallback (pas de hash)

      await pool.request()
        .input('T_TIERS', sql.NVarChar, newCode)
        .input('T_AUXILIAIRE', sql.NVarChar, newCode) // ✅ requis pour éviter l’erreur d’unicité
        .input('T_LIBELLE', sql.NVarChar, nom)
        .input('T_EMAIL', sql.NVarChar, email)
        .input('T_PASSWINTERNET', sql.NVarChar, hashedPassword)
        .query(`
          INSERT INTO TIERS (T_TIERS, T_AUXILIAIRE, T_LIBELLE, T_EMAIL, T_PASSWINTERNET)
          VALUES (@T_TIERS, @T_AUXILIAIRE, @T_LIBELLE, @T_EMAIL, @T_PASSWINTERNET)
        `);

      // Créer un panier
      const panierResult = await pool.request().query(`
        SELECT MAX(CAST(GP_NUMERO AS INT)) + 1 AS newNumero 
        FROM PIECE WHERE ISNUMERIC(GP_NUMERO) = 1
      `);

      const newNumero = panierResult.recordset[0].newNumero || 1;

      await pool.request()
        .input('nature', sql.NVarChar, 'PAN')
        .input('souche', sql.NVarChar, 'PAN001')
        .input('numero', sql.Int, newNumero)
        .input('indice', sql.Int, 0)
        .input('tiers', sql.NVarChar, newCode)
        .query(`
          INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
          VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
        `);

      user = {
        T_TIERS: newCode,
        T_LIBELLE: nom,
        T_EMAIL: email
      };
    }

    // Créer le token JWT
    const jwtToken = jwt.sign(
      {
        codeTiers: user.T_TIERS,
        nom: user.T_LIBELLE,
        email: user.T_EMAIL,
        role: 'client'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({
      message: 'Connexion Google réussie !',
      token: jwtToken,
      user: {
        codeTiers: user.T_TIERS,
        nom: user.T_LIBELLE,
        email: user.T_EMAIL,
        role: 'client'
      }
    });

  } catch (err) {
    console.error('❌ Erreur Google Sign-In:', err.message);
    res.status(401).json({ message: 'Erreur d\'authentification Google.', error: err.message });
  }
};




// Contrôleurs pour les routes protégées
const adminDashboard = (req, res) => res.json({ message: 'Bienvenue, Admin !' });
const magasinDashboard = (req, res) => res.json({ message: 'Bienvenue, Personnel du Magasin !' });
const clientDashboard = (req, res) => res.json({ message: 'Bienvenue, Client !' });

module.exports = {
  registerUser,
  loginUser,
  googleSignIn,
  adminDashboard,
  magasinDashboard,
  clientDashboard
};

