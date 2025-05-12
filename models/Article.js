const { poolPromise, sql } = require('../db');

class Article {
  constructor(GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE, GA_PVHT, GA_PVTTC, GA_TENUESTOCK) {
    this.GA_CODEARTICLE = GA_CODEARTICLE;
    this.GA_CODEBARRE = GA_CODEBARRE;
    this.GA_LIBELLE = GA_LIBELLE;
    this.GA_PVHT = GA_PVHT;
    this.GA_PVTTC = GA_PVTTC;
    this.GA_TENUESTOCK = GA_TENUESTOCK;
  }

  async save() {
    try {
      const pool = await poolPromise;
      await pool.request()
        .input('GA_CODEARTICLE', sql.NVarChar, this.GA_CODEARTICLE)
        .input('GA_CODEBARRE', sql.NVarChar, this.GA_CODEBARRE)
        .input('GA_LIBELLE', sql.NVarChar, this.GA_LIBELLE)
        .input('GA_PVHT', sql.Numeric(19, 4), this.GA_PVHT)
        .input('GA_PVTTC', sql.Numeric(19, 4), this.GA_PVTTC)
        .input('GA_TENUESTOCK', sql.NVarChar, this.GA_TENUESTOCK)
        .query(`
          INSERT INTO ARTICLE (
            GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE,
            GA_PVHT, GA_PVTTC, GA_TENUESTOCK, GA_DATECREATION
          )
          VALUES (
            @GA_CODEARTICLE, @GA_CODEBARRE, @GA_LIBELLE,
            @GA_PVHT, @GA_PVTTC, @GA_TENUESTOCK, GETDATE()
          )
        `);
    } catch (err) {
      throw new Error('Erreur lors de la création de l’article : ' + err.message);
    }
  }
}

module.exports = Article;