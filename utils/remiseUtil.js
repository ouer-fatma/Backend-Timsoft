//remiseUtil.js
function appliquerRemise(prixBase, remise) {
  if (!remise || remise <= 0) return prixBase;
  return +(prixBase * (1 - remise / 100)).toFixed(2);
}

module.exports = { appliquerRemise };