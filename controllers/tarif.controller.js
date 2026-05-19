const { pool } = require('../config/db');

// GET /api/tarifs/:tuteurId — tarifs publics d'un tuteur
const getTarifsTuteur = async (req, res) => {
  try {
    const { tuteurId } = req.params;
    const result = await pool.query(
      `SELECT * FROM tuteur_tarifs WHERE tuteur_id = $1 ORDER BY matiere`,
      [tuteurId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/tarifs/mes-tarifs — mes tarifs (tuteur connecté)
const getMesTarifs = async (req, res) => {
  try {
    if (req.user.role !== 'tuteur') {
      return res.status(403).json({ error: 'Réservé aux tuteurs' });
    }
    const result = await pool.query(
      `SELECT * FROM tuteur_tarifs WHERE tuteur_id = $1 ORDER BY matiere`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/tarifs — créer ou mettre à jour un tarif
const upsertTarif = async (req, res) => {
  try {
    if (req.user.role !== 'tuteur') {
      return res.status(403).json({ error: 'Réservé aux tuteurs' });
    }
    const { matiere, tarifHeure } = req.body;
    if (!matiere || !tarifHeure) {
      return res.status(400).json({ error: 'matiere et tarifHeure sont requis' });
    }
    if (tarifHeure <= 0 || tarifHeure > 10000) {
      return res.status(400).json({ error: 'Tarif invalide (0–10000 DH)' });
    }

    const result = await pool.query(
      `INSERT INTO tuteur_tarifs (tuteur_id, matiere, tarif_heure)
       VALUES ($1, $2, $3)
       ON CONFLICT (tuteur_id, matiere)
       DO UPDATE SET tarif_heure = EXCLUDED.tarif_heure
       RETURNING *`,
      [req.user.id, matiere.trim(), tarifHeure]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// DELETE /api/tarifs/:id — supprimer un tarif
const deleteTarif = async (req, res) => {
  try {
    if (req.user.role !== 'tuteur') {
      return res.status(403).json({ error: 'Réservé aux tuteurs' });
    }
    const result = await pool.query(
      `DELETE FROM tuteur_tarifs WHERE id = $1 AND tuteur_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Tarif introuvable' });
    }
    res.json({ message: 'Tarif supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = { getTarifsTuteur, getMesTarifs, upsertTarif, deleteTarif };