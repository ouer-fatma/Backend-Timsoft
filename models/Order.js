//Order.js
// 🆕 getOrderDetails avec LIGNE + ARTICLE + GL_NUMPIECE
exports.getOrderDetails = async (req, res) => {
  const { nature, souche, numero, indice } = req.params;

  try {
    const pool = await poolPromise;

    const pieceResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT * FROM PIECE
        WHERE GP_NATUREPIECEG=@nature AND GP_SOUCHE=@souche AND GP_NUMERO=@numero AND GP_INDICEG=@indice
      `);

    if (pieceResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    const commande = pieceResult.recordset[0];

    const lignesResult = await pool.request()
      .input('nature', sql.NVarChar(3), nature)
      .input('souche', sql.NVarChar(6), souche)
      .input('numero', sql.Int, parseInt(numero))
      .input('indice', sql.NVarChar(3), indice)
      .query(`
        SELECT L.*, A.GA_LIBELLE, A.GA_PVTTC
        FROM LIGNE L
        LEFT JOIN ARTICLE A ON A.GA_ARTICLE = L.GL_ARTICLE
        WHERE L.GL_NATUREPIECEG=@nature AND L.GL_SOUCHE=@souche AND L.GL_NUMERO=@numero AND L.GL_INDICEG=@indice
      `);

    const lignes = lignesResult.recordset.map(l => ({
      ...l,
      GL_TOTALLIGNE: (l.GL_QTEFACT || 0) * (l.GA_PVTTC || 0),
      GL_NUMPIECE: `${nature}/${souche}/${numero}/${indice}`
    }));

    res.status(200).json({ commande, lignes });
  } catch (err) {
    res.status(500).json({ message: 'Erreur lors de la récupération des détails de la commande.', error: err.message });
  }
};
