const { sql, poolPromise } = require('../db');

class Order {
  constructor(GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT) {
    this.GP_NATUREPIECEG = GP_NATUREPIECEG;
    this.GP_SOUCHE = GP_SOUCHE;
    this.GP_NUMERO = GP_NUMERO;
    this.GP_INDICEG = GP_INDICEG;
    this.GP_TIERS = GP_TIERS;
    this.GP_TOTALHT = GP_TOTALHT;
    this.GP_TOTALTTC = GP_TOTALTTC;
    this.GP_DATECREATION = GP_DATECREATION;
    this.GP_DEPOT = GP_DEPOT;
  }

  async save() {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('GP_NATUREPIECEG', sql.NVarChar(3), this.GP_NATUREPIECEG)
      .input('GP_SOUCHE', sql.NVarChar(6), this.GP_SOUCHE)
      .input('GP_NUMERO', sql.Int, this.GP_NUMERO)
      .input('GP_INDICEG', sql.Int, this.GP_INDICEG)
      .input('GP_TIERS', sql.NVarChar(17), this.GP_TIERS)
      .input('GP_TOTALHT', sql.Numeric(19,4), this.GP_TOTALHT)
      .input('GP_TOTALTTC', sql.Numeric(19,4), this.GP_TOTALTTC)
      .input('GP_DATECREATION', sql.DateTime, this.GP_DATECREATION)
      .input('GP_DEPOT', sql.NVarChar(6), this.GP_DEPOT)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_TOTALHT, GP_TOTALTTC, GP_DATECREATION, GP_DEPOT)
        VALUES (@GP_NATUREPIECEG, @GP_SOUCHE, @GP_NUMERO, @GP_INDICEG, @GP_TIERS, @GP_TOTALHT, @GP_TOTALTTC, @GP_DATECREATION, @GP_DEPOT)
      `);

    return result.rowsAffected;
  }
}

module.exports = Order;

  