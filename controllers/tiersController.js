const express = require("express");
const { getAllTiers, getTiersById } = require("../models/tiersModel");

const router = express.Router();

// Route pour récupérer tous les tiers
router.get("/", async (req, res) => {
  const tiers = await getAllTiers();
  res.json(tiers);
});

// Route pour récupérer un tiers par ID
router.get("/:id", async (req, res) => {
  const tiers = await getTiersById(req.params.id);
  if (tiers) {
    res.json(tiers);
  } else {
    res.status(404).json({ message: "Utilisateur non trouvé" });
  }
});

module.exports = router;
