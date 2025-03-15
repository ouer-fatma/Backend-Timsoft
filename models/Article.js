const sql = require('mssql');

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
      await sql.query`
        INSERT INTO ARTICLE (GA_CODEARTICLE, GA_CODEBARRE, GA_LIBELLE, GA_PVHT, GA_PVTTC, GA_TENUESTOCK)
        VALUES (${this.GA_CODEARTICLE}, ${this.GA_CODEBARRE}, ${this.GA_LIBELLE}, ${this.GA_PVHT}, ${this.GA_PVTTC}, ${this.GA_TENUESTOCK})
      `;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = Article;
