const { sql, poolPromise } = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');



exports.getAllAdmins = async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
        SELECT US_UTILISATEUR, US_EMAIL, US_ABREGE, US_FONCTION, US_SUPERVISEUR
       FROM UTILISAT
     WHERE US_GROUPE = 'ADM'
     OR US_FONCTION LIKE '%admin%'
     OR US_SUPERVISEUR = 'X'
    `);

    const admins = result.recordset.map(admin => ({
      ID_Utilisateur: admin.US_UTILISATEUR ?? '',
      Nom: admin.US_ABREGE ?? '', 
      Email: admin.US_EMAIL ?? '',
      Role: 'admin',
    }));

    res.status(200).json(admins);
  } catch (err) {
    console.error('❌ Erreur récupération admins :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};



exports.getAllClients = async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT T_TIERS, T_LIBELLE, T_PRENOM2, T_EMAIL
      FROM TIERS
      WHERE T_NATUREAUXI = 'CLI'
    `);

    const clients = result.recordset.map(client => ({
      ID_Client: client.T_TIERS ?? '',
      Nom: client.T_LIBELLE ?? '',
      Prenom: client.T_PRENOM2 ?? '',
      Email: client.T_EMAIL ?? '',
      Role: 'client',
    }));

    res.status(200).json(clients);
  } catch (err) {
    console.error('❌ Erreur récupération clients :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};


exports.getAllMagasiniers = async (_req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT 
        C.GCL_COMMERCIAL AS ID_Utilisateur,
        C.GCL_LIBELLE AS Nom,
        U.US_EMAIL AS Email,
        U.US_FONCTION AS Fonction,
        U.US_GROUPE AS Groupe
      FROM COMMERCIAL C
      LEFT JOIN UTILISAT U ON U.US_UTILISATEUR = C.GCL_UTILASSOCIE
      WHERE C.GCL_VENDEUR = 'X'
    `);

    const magasinUsers = result.recordset.map(user => ({
      ID_Utilisateur: user.ID_Utilisateur ?? '',
      Nom: user.Nom ?? '',
      Email: user.Email ?? '',
      Role: 'magasinier',
      Fonction: user.Fonction ?? '',
      Groupe: user.Groupe ?? '',
    }));

    res.status(200).json(magasinUsers);
  } catch (err) {
    console.error('❌ Erreur récupération magasiniers (via COMMERCIAL) :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};


// ➕ Ajouter un utilisateur (admin uniquement)
exports.addClient = async (req, res) => {
  const { nom, prenom, email, motDePasse } = req.body;

  if (!nom || !prenom || !email || !motDePasse) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    const pool = await poolPromise;

    // Vérifier si l'e-mail est déjà utilisé
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`SELECT 1 FROM TIERS WHERE T_EMAIL = @email AND T_NATUREAUXI = 'CLI'`);

    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'Ce client existe déjà.' });
    }

    const codeClient = 'CLI' + Date.now().toString().slice(-6);
    const hashedPassword = crypto.createHash('sha256').update(motDePasse).digest('hex').substring(0, 20);

    await pool.request()
      .input('code', sql.NVarChar, codeClient)
      .input('nom', sql.NVarChar, nom)
      .input('prenom', sql.NVarChar, prenom)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hashedPassword)
      .input('nature', sql.NVarChar, 'CLI')
      .query(`
        INSERT INTO TIERS 
        (T_TIERS, T_LIBELLE, T_PRENOM, T_EMAIL, T_PASSWINTERNET, T_NATUREAUXI)
        VALUES 
        (@code, @nom, @prenom, @email, @password, @nature)
      `);

    res.status(201).json({ message: 'Client ajouté avec succès.' });

  } catch (err) {
    console.error('❌ Erreur ajout client :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};


exports.addAdmin = async (req, res) => {
  const { nom, email, motDePasse } = req.body;

  if (!nom || !email || !motDePasse) {
    return res.status(400).json({ message: 'Nom, email et mot de passe sont requis.' });
  }

  try {
    const pool = await poolPromise;

    // Vérification si l'email existe déjà
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT 1 FROM UTILISAT WHERE US_EMAIL = @email');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'Cet e-mail est déjà utilisé.' });
    }

    const userCode = 'U' + Date.now().toString().slice(-6);
    const hashedPassword = crypto.createHash('sha256').update(motDePasse).digest('hex').substring(0, 20);

    await pool.request()
      .input('util', sql.NVarChar, userCode)
      .input('email', sql.NVarChar, email)
      .input('nom', sql.NVarChar, nom)
      .input('pass', sql.NVarChar, hashedPassword)
      .input('fonction', sql.NVarChar, 'Administrateur')
      .input('groupe', sql.NVarChar, 'ADM')
      .input('superviseur', sql.NChar(1), 'X')
      .query(`
        INSERT INTO UTILISAT 
        (US_UTILISATEUR, US_EMAIL, US_NOM, US_PASSWORD, US_FONCTION, US_GROUPE, US_SUPERVISEUR)
        VALUES 
        (@util, @email, @nom, @pass, @fonction, @groupe, @superviseur)
      `);

    res.status(201).json({ message: 'Administrateur ajouté avec succès.' });

  } catch (err) {
    console.error('❌ Erreur ajout admin :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};

exports.addMagasinier = async (req, res) => {
  const { nom, email, motDePasse } = req.body;

  if (!nom || !email || !motDePasse) {
    return res.status(400).json({ message: 'Nom, email et mot de passe sont requis.' });
  }

  try {
    const pool = await poolPromise;

    // Vérification si email existe déjà
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT 1 FROM UTILISAT WHERE US_EMAIL = @email');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'Cet e-mail est déjà utilisé.' });
    }

    const userCode = 'U' + Date.now().toString().slice(-6);
    const commercialCode = 'VEN' + Date.now().toString().slice(-5);
    const hashedPassword = crypto.createHash('sha256').update(motDePasse).digest('hex').substring(0, 20);

    // Insertion dans UTILISAT
    await pool.request()
      .input('util', sql.NVarChar, userCode)
      .input('email', sql.NVarChar, email)
      .input('nom', sql.NVarChar, nom)
      .input('pass', sql.NVarChar, hashedPassword)
      .input('fonction', sql.NVarChar, 'Magasinier')
      .input('groupe', sql.NVarChar, 'VEN')
      .input('superviseur', sql.NChar(1), '')
      .query(`
        INSERT INTO UTILISAT 
        (US_UTILISATEUR, US_EMAIL, US_NOM, US_PASSWORD, US_FONCTION, US_GROUPE, US_SUPERVISEUR)
        VALUES 
        (@util, @email, @nom, @pass, @fonction, @groupe, @superviseur)
      `);

    // Insertion dans COMMERCIAL (lié via GCL_UTILASSOCIE)
    await pool.request()
      .input('code', sql.NVarChar, commercialCode)
      .input('libelle', sql.NVarChar, nom)
      .input('utilAssocie', sql.NVarChar, userCode)
      .query(`
        INSERT INTO COMMERCIAL 
        (GCL_COMMERCIAL, GCL_LIBELLE, GCL_VENDEUR, GCL_UTILASSOCIE)
        VALUES 
        (@code, @libelle, 'X', @utilAssocie)
      `);

    res.status(201).json({ message: 'Magasinier ajouté avec succès.' });

  } catch (err) {
    console.error('❌ Erreur ajout magasinier :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};



exports.updateMagasinier = async (req, res) => {
  const { id } = req.params; // GCL_COMMERCIAL
  const { nom, email, motDePasse, fonction } = req.body;

  if (!nom && !email && !motDePasse && !fonction) {
    return res.status(400).json({ message: 'Aucune donnée fournie pour la mise à jour.' });
  }

  try {
    const pool = await poolPromise;

    // 🔍 Récupérer le code utilisateur lié
    const commercial = await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`SELECT GCL_UTILASSOCIE FROM COMMERCIAL WHERE GCL_COMMERCIAL = @id`);

    if (commercial.recordset.length === 0) {
      return res.status(404).json({ message: 'Magasinier non trouvé.' });
    }

    const userCode = commercial.recordset[0].GCL_UTILASSOCIE;

    // 🔁 Mise à jour dans COMMERCIAL
    await pool.request()
      .input('id', sql.NVarChar, id)
      .input('nom', sql.NVarChar, nom)
      .query(`UPDATE COMMERCIAL SET GCL_LIBELLE = @nom WHERE GCL_COMMERCIAL = @id`);

    // 🔁 Mise à jour dans UTILISAT
    const updateQuery = `
      UPDATE UTILISAT
      SET
        ${email ? 'US_EMAIL = @email,' : ''}
        ${motDePasse ? 'US_PASSWORD = @pass,' : ''}
        ${fonction ? 'US_FONCTION = @fonction,' : ''}
        US_NOM = @nom
      WHERE US_UTILISATEUR = @util
    `.replace(/,\s*US_NOM/, 'US_NOM') // enlever la virgule si nom est le seul champ

    const request = pool.request()
      .input('util', sql.NVarChar, userCode)
      .input('nom', sql.NVarChar, nom);

    if (email) request.input('email', sql.NVarChar, email);
    if (fonction) request.input('fonction', sql.NVarChar, fonction);
    if (motDePasse) {
      const hashed = crypto.createHash('sha256').update(motDePasse).digest('hex').substring(0, 20);
      request.input('pass', sql.NVarChar, hashed);
    }

    await request.query(updateQuery);

    res.status(200).json({ message: 'Magasinier mis à jour avec succès.' });

  } catch (err) {
    console.error('❌ Erreur updateMagasinier :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};

exports.updateClient = async (req, res) => {
  const { id } = req.params; // T_TIERS
  const { nom, prenom, email, motDePasse } = req.body;

  if (!nom && !prenom && !email && !motDePasse) {
    return res.status(400).json({ message: 'Aucune donnée fournie pour la mise à jour.' });
  }

  try {
    const pool = await poolPromise;

    // Vérifier si le client existe
    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`SELECT 1 FROM TIERS WHERE T_TIERS = @id AND T_NATUREAUXI = 'CLI'`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Client non trouvé.' });
    }

    // Préparer la requête dynamique
    const updateFields = [];
    if (nom) updateFields.push("T_LIBELLE = @nom");
    if (prenom) updateFields.push("T_PRENOM = @prenom");
    if (email) updateFields.push("T_EMAIL = @email");
    if (motDePasse) updateFields.push("T_PASSWINTERNET = @password");

    const updateQuery = `
      UPDATE TIERS
      SET ${updateFields.join(', ')}
      WHERE T_TIERS = @id
    `;

    const request = pool.request().input('id', sql.NVarChar, id);
    if (nom) request.input('nom', sql.NVarChar, nom);
    if (prenom) request.input('prenom', sql.NVarChar, prenom);
    if (email) request.input('email', sql.NVarChar, email);
    if (motDePasse) {
      const hashed = crypto.createHash('sha256').update(motDePasse).digest('hex').substring(0, 20);
      request.input('password', sql.NVarChar, hashed);
    }

    await request.query(updateQuery);

    res.status(200).json({ message: 'Client mis à jour avec succès.' });

  } catch (err) {
    console.error('❌ Erreur updateClient :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};



exports.deleteClient = async (req, res) => {
  const { id } = req.params; // T_TIERS

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`SELECT 1 FROM TIERS WHERE T_TIERS = @id AND T_NATUREAUXI = 'CLI'`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Client non trouvé.' });
    }

    await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`DELETE FROM TIERS WHERE T_TIERS = @id AND T_NATUREAUXI = 'CLI'`);

    res.status(200).json({ message: 'Client supprimé avec succès.' });

  } catch (err) {
    console.error('❌ Erreur deleteClient :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};


exports.updateAdmin = async (req, res) => {
  const { id } = req.params; // US_UTILISATEUR
  const { nom, email, motDePasse } = req.body;

  if (!nom && !email && !motDePasse) {
    return res.status(400).json({ message: 'Aucune donnée fournie pour la mise à jour.' });
  }

  try {
    const pool = await poolPromise;

    // Vérification de l'existence de l'admin
    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`
        SELECT 1 FROM UTILISAT 
        WHERE US_UTILISATEUR = @id 
          AND (US_GROUPE = 'ADM' OR US_SUPERVISEUR = 'X' OR US_FONCTION LIKE '%admin%')
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Administrateur non trouvé.' });
    }

    const fields = [];
    if (nom) fields.push('US_NOM = @nom');
    if (email) fields.push('US_EMAIL = @email');
    if (motDePasse) fields.push('US_PASSWORD = @pass');

    const query = `
      UPDATE UTILISAT
      SET ${fields.join(', ')}
      WHERE US_UTILISATEUR = @id
    `;

    const request = pool.request().input('id', sql.NVarChar, id);
    if (nom) request.input('nom', sql.NVarChar, nom);
    if (email) request.input('email', sql.NVarChar, email);
    if (motDePasse) {
      const hashed = crypto.createHash('sha256').update(motDePasse).digest('hex').substring(0, 20);
      request.input('pass', sql.NVarChar, hashed);
    }

    await request.query(query);

    res.status(200).json({ message: 'Administrateur mis à jour avec succès.' });

  } catch (err) {
    console.error('❌ Erreur updateAdmin :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};



exports.deleteAdmin = async (req, res) => {
  const { id } = req.params; // US_UTILISATEUR

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`
        SELECT 1 FROM UTILISAT 
        WHERE US_UTILISATEUR = @id 
          AND (US_GROUPE = 'ADM' OR US_SUPERVISEUR = 'X' OR US_FONCTION LIKE '%admin%')
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Administrateur non trouvé.' });
    }

    await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`DELETE FROM UTILISAT WHERE US_UTILISATEUR = @id`);

    res.status(200).json({ message: 'Administrateur supprimé avec succès.' });

  } catch (err) {
    console.error('❌ Erreur deleteAdmin :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};



exports.deleteMagasinier = async (req, res) => {
  const { id } = req.params; // GCL_COMMERCIAL

  try {
    const pool = await poolPromise;

    // Vérifier si le commercial existe
    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`SELECT GCL_UTILASSOCIE FROM COMMERCIAL WHERE GCL_COMMERCIAL = @id`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Magasinier non trouvé.' });
    }

    const userCode = result.recordset[0].GCL_UTILASSOCIE;

    // Supprimer d’abord le lien COMMERCIAL
    await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`DELETE FROM COMMERCIAL WHERE GCL_COMMERCIAL = @id`);

    // Ensuite supprimer le compte UTILISAT (optionnel, mais logique ici)
    await pool.request()
      .input('code', sql.NVarChar, userCode)
      .query(`DELETE FROM UTILISAT WHERE US_UTILISATEUR = @code`);

    res.status(200).json({ message: 'Magasinier supprimé avec succès.' });

  } catch (err) {
    console.error('❌ Erreur deleteMagasinier :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};



exports.searchClients = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ message: 'Le paramètre de recherche est requis.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('q', sql.NVarChar, `%${query}%`)
      .query(`
        SELECT T_TIERS, T_LIBELLE, T_PRENOM, T_EMAIL
        FROM TIERS
        WHERE T_NATUREAUXI = 'CLI'
          AND (
            T_TIERS LIKE @q OR
            T_LIBELLE LIKE @q OR
            T_PRENOM LIKE @q OR
            T_EMAIL LIKE @q
          )
      `);

    const clients = result.recordset.map(c => ({
      ID_Client: c.T_TIERS,
      Nom: c.T_LIBELLE,
      Prenom: c.T_PRENOM,
      Email: c.T_EMAIL,
    }));

    res.status(200).json(clients);
  } catch (err) {
    console.error('❌ Erreur recherche client :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};


exports.searchAdmins = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ message: 'Le paramètre de recherche est requis.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('q', sql.NVarChar, `%${query}%`)
      .query(`
        SELECT US_UTILISATEUR, US_NOM, US_EMAIL, US_FONCTION
        FROM UTILISAT
        WHERE (US_GROUPE = 'ADM' OR US_SUPERVISEUR = 'X' OR US_FONCTION LIKE '%admin%')
          AND (
            US_UTILISATEUR LIKE @q OR
            US_NOM LIKE @q OR
            US_EMAIL LIKE @q OR
            US_FONCTION LIKE @q
          )
      `);

    const admins = result.recordset.map(a => ({
      ID_Admin: a.US_UTILISATEUR,
      Nom: a.US_NOM,
      Email: a.US_EMAIL,
      Fonction: a.US_FONCTION,
    }));

    res.status(200).json(admins);
  } catch (err) {
    console.error('❌ Erreur recherche admin :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};


exports.searchMagasiniers = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ message: 'Le paramètre de recherche est requis.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('q', sql.NVarChar, `%${query}%`)
      .query(`
        SELECT 
          C.GCL_COMMERCIAL AS ID_Utilisateur,
          C.GCL_LIBELLE AS Nom,
          U.US_EMAIL AS Email,
          U.US_FONCTION AS Fonction,
          U.US_GROUPE AS Groupe
        FROM COMMERCIAL C
        LEFT JOIN UTILISAT U ON U.US_UTILISATEUR = C.GCL_UTILASSOCIE
        WHERE C.GCL_VENDEUR = 'X'
          AND (
            C.GCL_LIBELLE LIKE @q OR
            C.GCL_COMMERCIAL LIKE @q OR
            U.US_EMAIL LIKE @q OR
            U.US_FONCTION LIKE @q
          )
      `);

    const magasiniers = result.recordset.map(m => ({
      ID_Utilisateur: m.ID_Utilisateur,
      Nom: m.Nom,
      Email: m.Email,
      Fonction: m.Fonction,
      Groupe: m.Groupe,
    }));

    res.status(200).json(magasiniers);
  } catch (err) {
    console.error('❌ Erreur recherche magasinier :', err);
    res.status(500).json({ message: 'Erreur serveur.', error: err.message });
  }
};

