const { pool } = require('../config/db');

// POST /api/evaluations
const createEvaluation = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { tuteurId, seanceId, note, commentaire } = req.body;

    if (note < 1 || note > 5) return res.status(400).json({ error: 'Note entre 1 et 5' });

    // Vérifier que l'étudiant a participé à la séance
    if (seanceId) {
      const seance = await client.query(
        `SELECT s.salle_id FROM seances s WHERE s.id=$1`, [seanceId]
      );
      if (seance.rows.length) {
        const participated = await client.query(
          `SELECT id FROM participations WHERE utilisateur_id=$1 AND salle_id=$2`,
          [req.user.id, seance.rows[0].salle_id]
        );
        if (!participated.rows.length) {
          return res.status(403).json({ error: 'Vous ne faites pas partie de cette séance' });
        }
      }
    }

    // Vérifier doublon
    const existing = await client.query(
      `SELECT id FROM evaluations WHERE etudiant_id=$1 AND tuteur_id=$2 AND seance_id=$3`,
      [req.user.id, tuteurId, seanceId]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Vous avez déjà évalué ce tuteur pour cette séance' });
    }

    const result = await client.query(
      `INSERT INTO evaluations (etudiant_id, tuteur_id, seance_id, note, commentaire)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, tuteurId, seanceId || null, note, commentaire]
    );

    // Recalculer la note moyenne du tuteur
    const moyenneRes = await client.query(
      'SELECT AVG(note)::numeric(4,2) as moyenne FROM evaluations WHERE tuteur_id=$1',
      [tuteurId]
    );
    await client.query(
      'UPDATE tuteurs SET note_moyenne=$1 WHERE utilisateur_id=$2',
      [moyenneRes.rows[0].moyenne, tuteurId]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// GET /api/evaluations/tuteur/:id
const getEvaluationsTuteur = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, u.prenom || ' ' || u.nom as etudiant_nom, s.titre as seance_titre
      FROM evaluations e
      JOIN utilisateurs u ON e.etudiant_id = u.id
      LEFT JOIN seances s ON e.seance_id = s.id
      WHERE e.tuteur_id=$1
      ORDER BY e.date_evaluation DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = { createEvaluation, getEvaluationsTuteur };