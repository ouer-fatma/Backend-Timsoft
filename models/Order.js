const { sql, poolPromise } = require('../db');

class Order {
  constructor(GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT) {
    this.GP_TIERS = GP_TIERS;
    this.GP_TOTALHT = GP_TOTALHT;
    this.GP_TOTALTTC = GP_TOTALTTC;
    this.GP_DATECREATION = GP_DATECREATION;
    this.GP_DEPOT = GP_DEPOT;
  }

  async save() {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_TIERS', sql.NVarChar(17), this.GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19,4), this.GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19,4), this.GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, this.GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), this.GP_DEPOT)
      .query(`
        INSERT INTO PIECE (GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT)
        VALUES (@GP_TIERS, @GP_TOTALHT, @GP_TOTALTTC, @GP_DATECREATION, @GP_DEPOT)
      `);

    return result.rowsAffected;
  }
}

module.exports = Order;
