function validateRegister(req, res, next) {
    const { nom, email, motDePasse } = req.body;
  
    if (!nom || !email || !motDePasse) {
      return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
    }
  
    // Valider l'email avec une regex simple
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email invalide.' });
    }
  
    // Valider la longueur du mot de passe
    if (motDePasse.length < 6) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }
  
    next(); // Passer au contrôleur si tout est valide
  }
  
  module.exports = validateRegister;