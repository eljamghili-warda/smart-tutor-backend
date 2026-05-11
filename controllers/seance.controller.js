const { pool } = require('../config/db');

// GET /api/seances?salleId=&tuteurId=
const getSeances = async (req, res) => {
  try {
    const { salleId, tuteurId } = req.query;
    let query = `
      SELECT s.*,
        sa.nom as salle_nom,
        u.prenom || ' ' || u.nom as tuteur_nom
      FROM seances s
      JOIN salles sa ON s.salle_id = sa.id
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (salleId) { params.push(salleId); query += ` AND s.salle_id=$${params.length}`; }
    if (tuteurId) { params.push(tuteurId); query += ` AND s.tuteur_id=$${params.length}`; }
    query += ' ORDER BY s.date_debut ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/seances/emploi-du-temps
const getEmploiDuTemps = async (req, res) => {
  try {
    const { debut, fin } = req.query;
    const result = await pool.query(`
      SELECT s.*, sa.nom as salle_nom, u.prenom || ' ' || u.nom as tuteur_nom
      FROM seances s
      JOIN salles sa ON s.salle_id = sa.id
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      WHERE s.salle_id IN (
        SELECT salle_id FROM participations WHERE utilisateur_id=$1
      )
      AND s.statut IN ('PLANIFIEE','EN_COURS','REALISEE','ANNULEE')
      AND ($2::timestamp IS NULL OR s.date_debut >= $2::timestamp)
      AND ($3::timestamp IS NULL OR s.date_debut <= $3::timestamp)
      ORDER BY s.date_debut
    `, [req.user.id, debut || null, fin || null]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/seances — planifier (tuteur CO_ADMIN seulement)
const createSeance = async (req, res) => {
  try {
    const { salleId, titre, description, matiere, dateDebut, duree } = req.body;
    if (!salleId || !titre || !dateDebut || !duree)
      return res.status(400).json({ error: 'Champs obligatoires manquants' });

    // Vérifier que l'utilisateur est tuteur CO_ADMIN dans la salle
    const check = await pool.query(
      `SELECT id FROM participations WHERE utilisateur_id=$1 AND salle_id=$2 AND role='CO_ADMIN'`,
      [req.user.id, salleId]
    );
    if (!check.rows.length)
      return res.status(403).json({ error: 'Seul le tuteur de la salle peut planifier une séance' });

    // Vérifier conflit de planning
    const conflict = await pool.query(`
      SELECT id FROM seances
      WHERE tuteur_id=$1 AND statut IN ('PLANIFIEE','EN_COURS')
        AND $2::timestamp < date_debut + ($3 * interval '1 minute')
        AND $2::timestamp + ($3 * interval '1 minute') > date_debut
    `, [req.user.id, dateDebut, duree]);
    if (conflict.rows.length)
      return res.status(409).json({ error: 'Conflit de planning : vous avez déjà une séance à ce créneau' });

    const result = await pool.query(
      `INSERT INTO seances (salle_id, tuteur_id, titre, description, matiere, date_debut, duree)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [salleId, req.user.id, titre, description, matiere, dateDebut, duree]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// PUT /api/seances/:id/annuler — annulation manuelle par le tuteur
const annulerSeance = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE seances SET statut='ANNULEE'
       WHERE id=$1 AND tuteur_id=$2 AND statut='PLANIFIEE' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Séance introuvable ou non annulable' });
    res.json({ message: 'Séance annulée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/seances/disponibilites
const getDisponibilites = async (req, res) => {
  try {
    const { tuteurId } = req.query;
    const result = await pool.query(
      `SELECT * FROM disponibilites_tuteur WHERE tuteur_id=$1 ORDER BY jour_semaine, heure_debut`,
      [tuteurId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/seances/disponibilites
const setDisponibilite = async (req, res) => {
  try {
    const { jourSemaine, heureDebut, heureFin } = req.body;
    const result = await pool.query(
      `INSERT INTO disponibilites_tuteur (tuteur_id, jour_semaine, heure_debut, heure_fin)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, jourSemaine, heureDebut, heureFin]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ─── CRON : annuler automatiquement les séances expirées sans appel ────────────
//
// Règles :
//   1. PLANIFIEE dont la fin (date_debut + duree) est dépassée ET pas d'appel
//      → ANNULEE  (personne n'a lancé d'appel pendant le créneau)
//
//   2. EN_COURS dont la session_appel liée est terminée (actif=FALSE)
//      et dont la fin est dépassée → REALISEE  (sécurité : normalement
//      géré par call:end, mais au cas où le serveur redémarre)
//
const verifierSeancesExpirees = async () => {
  try {
    // 1. Séances PLANIFIEES sans appel dont la fenêtre est passée → ANNULEE
    const annulees = await pool.query(`
      UPDATE seances
      SET statut = 'ANNULEE'
      WHERE statut = 'PLANIFIEE'
        AND session_appel_id IS NULL
        AND (date_debut + (duree * interval '1 minute')) < NOW()
      RETURNING id, titre, salle_id
    `);
    if (annulees.rows.length > 0) {
      console.log(`🔄 Auto-annulation : ${annulees.rows.length} séance(s) sans appel → ANNULEE`);
    }

    // 2. Séances EN_COURS dont l'appel est terminé ET la fin est dépassée → REALISEE
    const realisees = await pool.query(`
      UPDATE seances s
      SET statut = 'REALISEE'
      FROM sessions_appel sa
      WHERE s.session_appel_id = sa.id
        AND s.statut = 'EN_COURS'
        AND sa.actif = FALSE
        AND (s.date_debut + (s.duree * interval '1 minute')) < NOW()
      RETURNING s.id, s.titre
    `);
    if (realisees.rows.length > 0) {
      console.log(`✅ Auto-réalisation : ${realisees.rows.length} séance(s) → REALISEE`);
    }
  } catch (err) {
    console.error('verifierSeancesExpirees error:', err);
  }
};

module.exports = {
  getSeances,
  getEmploiDuTemps,
  createSeance,
  annulerSeance,
  getDisponibilites,
  setDisponibilite,
  verifierSeancesExpirees,
};