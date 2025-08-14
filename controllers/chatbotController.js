// controllers/chatbotController.js
const axios = require('axios');

const RAG_API_BASE = process.env.RAG_API_BASE || 'http://127.0.0.1:5001';
const RAG_API_URL = `${RAG_API_BASE.replace(/\/+$/, '')}/match-mot`;

exports.chatbot = async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: "Champ 'message' requis." });
  }

  try {
    const ragResp = await axios.post(
      RAG_API_URL,
      { mot: message.trim() },
      { timeout: 20000 }
    );

    const payload = ragResp.data;

    if (!Array.isArray(payload)) {
      const errorMsg = payload && payload.error ? payload.error : 'Réponse inattendue du RAG API';
      return res.status(502).json({ message: errorMsg, from: 'rag_api' });
    }

    const articles = payload.map((a) => ({
      codeArticle: a.GA_CODEARTICLE,
      libelle: a.GA_LIBELLE,
      prix: a.GA_PVTTC,
      famille: [a.GA_FAMILLENIV1, a.GA_FAMILLENIV2, a.GA_FAMILLENIV3].filter(Boolean),
      image: a.IMAGE || null,
      quantiteTotale: a.QUANTITE_TOTALE ?? 0,
      variantes: Array.isArray(a.variantes)
        ? a.variantes.map((v) => ({
            article: v.GA_ARTICLE,
            taille: v.taille || null,
            couleur: v.couleur || null,
            depot: v.depot || null,
          }))
        : [],
    }));

    return res.status(200).json({
      message: `Résultats pour: "${message}"`,
      total: articles.length,
      articles,
    });
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('❌ Erreur appel rag_api:', status, data || err.message);

    return res.status(500).json({
      message: 'Erreur lors de la recherche.',
      error: data?.error || err.message,
      from: 'rag_api',
    });
  }
};
