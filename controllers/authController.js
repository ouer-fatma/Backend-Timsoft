const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const admin = require('firebase-admin');
const { sql, poolPromise } = require('../db');
const User = require('../models/User');
const serviceAccount = require('../firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Enregistrement utilisateur
const registerUser = async (req, res) => {
  const { nom, prenom, email, motDePasse, role, etablissement } = req.body;

  if (!nom || !prenom || !email || !motDePasse || !role) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    const config = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      port: parseInt(process.env.DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    };
    await sql.connect(config);

    const request = new sql.Request();
    request.input('Email', sql.VarChar, email);
    const existing = await request.query('SELECT 1 FROM Utilisateur WHERE Email = @Email');
    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'Cet e-mail est déjà utilisé.' });
    }

    // Générer CodeTiers
    const codeRes = await new sql.Request().query(`
      SELECT TOP 1 T_TIERS FROM TIERS 
      WHERE T_TIERS LIKE 'TR%' 
      ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
    `);
    let newCodeTiers = 'TR001';
    if (codeRes.recordset.length > 0) {
      const lastCode = codeRes.recordset[0].T_TIERS;
      const next = parseInt(lastCode.slice(2)) + 1;
      newCodeTiers = 'TR' + next.toString().padStart(3, '0');
    }

    await new sql.Request()
      .input('T_TIERS', sql.VarChar, newCodeTiers)
      .query('INSERT INTO TIERS (T_TIERS) VALUES (@T_TIERS)');

    let codeCommercial = null;

    if (role === 'personnel_magasin') {
      // Créer un commercial pour le magasinier
      codeCommercial = 'MAG' + Math.floor(1000 + Math.random() * 9000);
      await new sql.Request()
        .input('typeCommercial', sql.NVarChar, 'VEN')
        .input('codeCommercial', sql.NVarChar, codeCommercial)
        .input('etablissement', sql.Int, etablissement)
        .input('libelle', sql.NVarChar, `${nom} ${prenom}`)
        .input('prenom', sql.NVarChar, prenom)
        .input('surname', sql.NVarChar, nom)
        .query(`
          INSERT INTO Commercial (GCL_TYPECOMMERCIAL, GCL_COMMERCIAL, GCL_ETABLISSEMENT, GCL_LIBELLE, GCL_PRENOM, GCL_SURNOM)
          VALUES (@typeCommercial, @codeCommercial, @etablissement, @libelle, @prenom, @surname)
        `);
    }

    await new sql.Request()
      .input('Nom', sql.NVarChar, nom)
      .input('Prenom', sql.NVarChar, prenom)
      .input('Email', sql.NVarChar, email)
      .input('MotDePasse', sql.NVarChar, hashedPassword)
      .input('Role', sql.NVarChar, role)
      .input('CodeTiers', sql.NVarChar, newCodeTiers)
      .input('CodeCommercial', sql.NVarChar, codeCommercial)
      .query(`
        INSERT INTO Utilisateur (Nom, Prenom, Email, MotDePasse, Role, CodeTiers, CodeCommercial)
        VALUES (@Nom, @Prenom, @Email, @MotDePasse, @Role, @CodeTiers, @CodeCommercial)
      `);

    // Créer un panier vide
    const resultNumero = await new sql.Request().query(`
      SELECT MAX(CAST(GP_NUMERO AS INT)) + 1 AS newNumero 
      FROM PIECE WHERE ISNUMERIC(GP_NUMERO) = 1
    `);
    const newNumero = resultNumero.recordset[0].newNumero || 1;

    await new sql.Request()
      .input('nature', sql.NVarChar, 'PAN')
      .input('souche', sql.NVarChar, 'PAN001')
      .input('numero', sql.Int, newNumero)
      .input('indice', sql.Int, 0)
      .input('tiers', sql.NVarChar, newCodeTiers)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
        VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
      `);

    res.status(201).json({ message: 'Utilisateur inscrit avec succès.' });

  } catch (err) {
    console.error('Erreur d’inscription :', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    sql.close();
  }
};

// Créer un compte pour un commercial existant
const creerCompteCommercial = async (req, res) => {
  const { email, motDePasse, etablissement } = req.body;

  if (!email || !motDePasse || !etablissement) {
    return res.status(400).json({ message: 'Champs manquants.' });
  }

  try {
    const pool = await poolPromise;

    // 🔍 Trouver un commercial disponible
    const result = await pool.request()
      .input('Etab', sql.Int, etablissement)
      .query(`
        SELECT TOP 1 GCL_COMMERCIAL, GCL_PRENOM, GCL_SURNOM
        FROM Commercial
        WHERE GCL_ETABLISSEMENT = @Etab
          AND GCL_COMMERCIAL NOT IN (
            SELECT CodeCommercial FROM Utilisateur WHERE CodeCommercial IS NOT NULL
          )
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucun commercial disponible pour ce dépôt.' });
    }

    const commercial = result.recordset[0];
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    await pool.request()
      .input('Nom', sql.NVarChar, commercial.GCL_SURNOM)
      .input('Prenom', sql.NVarChar, commercial.GCL_PRENOM)
      .input('Email', sql.NVarChar, email)
      .input('MotDePasse', sql.NVarChar, hashedPassword)
      .input('Role', sql.NVarChar, 'personnel_magasin')
      .input('CodeCommercial', sql.NVarChar, commercial.GCL_COMMERCIAL)
      .query(`
        INSERT INTO Utilisateur (Nom, Prenom, Email, MotDePasse, Role, CodeCommercial)
        VALUES (@Nom, @Prenom, @Email, @MotDePasse, @Role, @CodeCommercial)
      `);

    res.status(201).json({ message: 'Magasinier créé avec succès.' });

  } catch (err) {
    console.error('Erreur création magasinier :', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const getDepotsDisponibles = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DISTINCT GCL_ETABLISSEMENT
      FROM Commercial
      ORDER BY GCL_ETABLISSEMENT
    `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('Erreur récupération dépôts :', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};
const getBLPourMagasinier = async (req, res) => {
  const { codeCommercial } = req.user;
  if (!codeCommercial) {
    return res.status(403).json({ message: 'CodeCommercial manquant.' });
  }

  try {
    const pool = await poolPromise;

    const etabRes = await pool.request()
      .input('CodeCommercial', sql.VarChar, codeCommercial)
      .query(`
        SELECT GCL_ETABLISSEMENT 
        FROM Commercial 
        WHERE GCL_COMMERCIAL = @CodeCommercial
      `);

    if (etabRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Commercial introuvable.' });
    }

    const etablissement = etabRes.recordset[0].GCL_ETABLISSEMENT;

    const blRes = await pool.request()
      .input('Etablissement', sql.Int, etablissement)
      .query(`
        SELECT 
          P.GP_NUMERO,
          P.GP_DATEPIECE,
          P.GP_TIERS,
          P.GP_DEPOT,
          P.GP_STATUTPIECE AS GP_STATUTPIECE -- 🔥 Ajout essentiel
        FROM PIECE P
        WHERE P.GP_NATUREPIECEG = 'BL'
          AND P.GP_DEPOT = @Etablissement
        ORDER BY P.GP_DATEPIECE DESC
      `);

    res.status(200).json(blRes.recordset);

  } catch (err) {
    console.error("Erreur récupération BL:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
};



// Connexion
const loginUser = async (req, res) => {
  const { email, motDePasse } = req.body;

  try {
    await sql.connect({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      port: parseInt(process.env.DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    });

    const request = new sql.Request();
    request.input('Email', sql.VarChar, email);
    const result = await request.query('SELECT * FROM Utilisateur WHERE Email = @Email');

    const utilisateur = result.recordset[0];
    if (!utilisateur) return res.status(404).json({ message: 'Utilisateur non trouvé.' });

    const isMatch = await bcrypt.compare(motDePasse, utilisateur.MotDePasse);
    if (!isMatch) return res.status(401).json({ message: 'Mot de passe incorrect.' });

    const token = jwt.sign({
      id: utilisateur.ID_Utilisateur,
      nom: utilisateur.Nom,
      email: utilisateur.Email,
      role: utilisateur.Role,
      codeTiers: utilisateur.CodeTiers,
   // <-- ou le vrai nom du champ "dépôt" dans ta table
 
      codeCommercial: utilisateur.CodeCommercial

    }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ message: 'Connexion réussie !', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    sql.close();
  }
};

// Connexion avec Google
const googleSignIn = async (req, res) => {
  const token = req.body.token;
  const username = req.body.username;

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const email = decodedToken.email;
    const nom = username || decodedToken.name || email.split('@')[0];
    const prenom = '';

    await sql.connect({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      port: parseInt(process.env.DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    });

    const request = new sql.Request();
    request.input('Email', sql.NVarChar, email);
    const result = await request.query('SELECT * FROM Utilisateur WHERE Email = @Email');

    let utilisateur = result.recordset[0];

    if (!utilisateur) {
      const codeRes = await new sql.Request().query(`
        SELECT TOP 1 T_TIERS FROM TIERS 
        WHERE T_TIERS LIKE 'TR%' 
        ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
      `);
      let newCodeTiers = 'TR001';
      if (codeRes.recordset.length > 0) {
        const lastCode = codeRes.recordset[0].T_TIERS;
        const next = parseInt(lastCode.slice(2)) + 1;
        newCodeTiers = 'TR' + next.toString().padStart(3, '0');
      }

      await new sql.Request()
        .input('T_TIERS', sql.NVarChar, newCodeTiers)
        .query('INSERT INTO TIERS (T_TIERS) VALUES (@T_TIERS)');

      const hashedPassword = bcrypt.hashSync('0000', 10);
      await new sql.Request()
        .input('Nom', sql.NVarChar, nom)
        .input('Prenom', sql.NVarChar, prenom)
        .input('Email', sql.NVarChar, email)
        .input('MotDePasse', sql.NVarChar, hashedPassword)
        .input('Role', sql.NVarChar, 'client')
        .input('CodeTiers', sql.NVarChar, newCodeTiers)
        .query(`
          INSERT INTO Utilisateur (Nom, Prenom, Email, MotDePasse, Role, CodeTiers)
          VALUES (@Nom, @Prenom, @Email, @MotDePasse, @Role, @CodeTiers)
        `);

      utilisateur = { Nom: nom, Email: email, Role: 'client', CodeTiers: newCodeTiers };
    }

    const jwtToken = jwt.sign({
      id: utilisateur.ID_Utilisateur,
      email: utilisateur.Email,
      nom: utilisateur.Nom,
      role: utilisateur.Role,
      codeTiers: utilisateur.CodeTiers,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({
      message: 'Connexion Google réussie !',
      token: jwtToken,
      user: utilisateur
    });

  } catch (err) {
    console.error('Erreur Google Sign-In :', err);
    res.status(401).json({ message: 'Échec Google Sign-In', error: err.message });
  } finally {
    sql.close();
  }
};

// Contrôleurs de rôle
const adminDashboard = (req, res) => res.json({ message: 'Bienvenue, Admin !' });
const magasinDashboard = (req, res) => res.json({ message: 'Bienvenue, Personnel du Magasin !' });
const clientDashboard = (req, res) => res.json({ message: 'Bienvenue, Client !' });

module.exports = {
  registerUser,
  creerCompteCommercial,
  getDepotsDisponibles,
  getBLPourMagasinier,
  loginUser,
  googleSignIn,
  adminDashboard,
  magasinDashboard,
  clientDashboard
};
