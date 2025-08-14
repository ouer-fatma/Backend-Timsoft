// models/promotion.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define("Promotion", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING, allowNull: false },
    libelle: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING }, // e.g. ANN, VIP, etc.
    valeur: { type: DataTypes.DECIMAL(10,2) },
    date_debut: { type: DataTypes.DATE },
    date_fin: { type: DataTypes.DATE },
    conditions: { type: DataTypes.TEXT }, // JSON ou texte libre
    active: { type: DataTypes.BOOLEAN, defaultValue: true }
  });
};
