const sql = require("mssql");

// Fonction pour récupérer tous les utilisateurs (tiers)
async function getAllTiers() {
  try {
    const pool = await sql.connect();
    const result = await pool.request().query("SELECT * FROM dbo.TIERS");
    return result.recordset;
  } catch (err) {
    console.error("Erreur lors de la récupération des utilisateurs :", err);
    return [];
  }
}

// Fonction pour récupérer un utilisateur par ID
async function getTiersById(id) {
  try {
    const pool = await sql.connect();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT * FROM dbo.TIERS WHERE id = @id");
    return result.recordset[0] || null;
  } catch (err) {
    console.error("Erreur lors de la récupération de l'utilisateur :", err);
    return null;
  }
}

module.exports = { getAllTiers, getTiersById };
