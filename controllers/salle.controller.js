const { pool } = require('../config/db');

// POST /api/salles - Créer une salle
const creerSalle = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { nom, description, type, capaciteMax, matiere } = req.body;
    if (!nom || !type) return res.status(400).json({ error: 'Nom et type requis' });

    const salleRes = await client.query(
      `INSERT INTO salles (nom, description, type, capacite_max, matiere, createur_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nom, description||null, type, capaciteMax||50, matiere||null, req.user.id]
    );
    const salle = salleRes.rows[0];

    await client.query(
      `INSERT INTO participations (utilisateur_id, salle_id, role) VALUES ($1,$2,'ADMIN')`,
      [req.user.id, salle.id]
    );
    await client.query(`INSERT INTO tableaux_blancs (salle_id) VALUES ($1)`, [salle.id]);

    await client.query('COMMIT');
    res.status(201).json({ message: 'Salle créée', ...salle });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// GET /api/salles
const listerSalles = async (req, res) => {
  try {
    const { search, type, matiere } = req.query;
    let query = `
      SELECT s.*, u.prenom || ' ' || u.nom as createur_nom,
             COUNT(DISTINCT p.id) as nb_participants
      FROM salles s
      LEFT JOIN utilisateurs u ON s.createur_id = u.id
      LEFT JOIN participations p ON s.id = p.salle_id
      WHERE s.statut != 'FERMEE'`;
    const params = [];
    let idx = 1;

    if (req.user.role !== 'admin') {
      query += ` AND (s.type = 'PUBLIQUE' OR EXISTS(SELECT 1 FROM participations WHERE salle_id=s.id AND utilisateur_id=$${idx}))`;
      params.push(req.user.id); idx++;
    }
    if (search) { query += ` AND s.nom ILIKE $${idx}`; params.push(`%${search}%`); idx++; }
    if (type) { query += ` AND s.type = $${idx}`; params.push(type); idx++; }
    if (matiere) { query += ` AND s.matiere ILIKE $${idx}`; params.push(`%${matiere}%`); idx++; }

    query += ' GROUP BY s.id, u.prenom, u.nom ORDER BY s.date_creation DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/salles/mes-salles
const mesSalles = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, p.role as mon_role, p.date_join, COUNT(p2.id) as nb_participants
       FROM salles s
       JOIN participations p ON s.id = p.salle_id AND p.utilisateur_id = $1
       LEFT JOIN participations p2 ON s.id = p2.salle_id
       WHERE s.statut != 'FERMEE'
       GROUP BY s.id, p.role, p.date_join ORDER BY p.date_join DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// GET /api/salles/:id
const getSalle = async (req, res) => {
  try {
    const { id } = req.params;
    const salleRes = await pool.query(
      `SELECT s.*, u.prenom || ' ' || u.nom as createur_nom
       FROM salles s LEFT JOIN utilisateurs u ON s.createur_id = u.id
       WHERE s.id = $1`, [id]
    );
    if (!salleRes.rows.length) return res.status(404).json({ error: 'Salle non trouvée' });
    const salle = salleRes.rows[0];

    if (salle.type === 'PRIVEE' && req.user.role !== 'admin') {
      const membre = await pool.query(
        'SELECT id FROM participations WHERE salle_id=$1 AND utilisateur_id=$2', [id, req.user.id]
      );
      if (!membre.rows.length) return res.status(403).json({ error: 'Accès refusé à cette salle privée' });
    }

    const participants = await pool.query(
      `SELECT u.id, u.prenom, u.nom, u.photo_profil, u.role, p.role as role_salle, p.date_join
       FROM participations p JOIN utilisateurs u ON p.utilisateur_id = u.id
       WHERE p.salle_id = $1`, [id]
    );
    const monRole = participants.rows.find(p => p.id == req.user.id);
    res.json({ ...salle, participants: participants.rows, mon_role: monRole?.role_salle || null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
};

// POST /api/salles/:id/rejoindre
const rejoindreSalle = async (req, res) => {
  try {
    const { id } = req.params;
    const salleRes = await pool.query('SELECT * FROM salles WHERE id=$1', [id]);
    if (!salleRes.rows.length) return res.status(404).json({ error: 'Salle non trouvée' });
    const salle = salleRes.rows[0];

    const existingMembre = await pool.query(
      'SELECT id FROM participations WHERE salle_id=$1 AND utilisateur_id=$2', [id, req.user.id]
    );
    if (existingMembre.rows.length) return res.status(409).json({ error: 'Déjà membre' });

    if (salle.type === 'PRIVEE' || req.user.role === 'tuteur') {
      return res.status(403).json({ error: 'Accès par invitation uniquement', needsInvitation: true });
    }

    await pool.query(
      `INSERT INTO participations (utilisateur_id, salle_id, role) VALUES ($1,$2,'MEMBRE')`,
      [req.user.id, id]
    );
    res.json({ message: 'Vous avez rejoint la salle' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
};

// DELETE /api/salles/:id/quitter
const quitterSalle = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { definitif } = req.query;

    const participRes = await client.query(
      'SELECT * FROM participations WHERE salle_id=$1 AND utilisateur_id=$2', [id, req.user.id]
    );
    if (!participRes.rows.length) return res.status(404).json({ error: "Vous n'êtes pas membre" });
    const participation = participRes.rows[0];

    if (definitif === 'true') {
      await client.query('DELETE FROM participations WHERE salle_id=$1 AND utilisateur_id=$2', [id, req.user.id]);

      if (participation.role === 'ADMIN') {
        await client.query("UPDATE salles SET statut='FERMEE' WHERE id=$1", [id]);
      } else if (participation.role === 'CO_ADMIN') {
        const autreCoAdmin = await client.query(
          "SELECT id FROM participations WHERE salle_id=$1 AND role='CO_ADMIN'", [id]
        );
        if (!autreCoAdmin.rows.length) {
          await client.query("UPDATE salles SET statut='ACTIVE_SANS_TUTEUR' WHERE id=$1", [id]);
        }
      }

      const restants = await client.query('SELECT COUNT(*) FROM participations WHERE salle_id=$1', [id]);
      if (parseInt(restants.rows[0].count) === 0) {
        await client.query("UPDATE salles SET statut='FERMEE' WHERE id=$1", [id]);
      }
    }

    await client.query('COMMIT');
    res.json({ message: definitif === 'true' ? 'Quitté définitivement' : 'Déconnecté temporairement' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// PUT /api/salles/:id
const modifierSalle = async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, description, capaciteMax, matiere } = req.body;
    const roleRes = await pool.query(
      'SELECT role FROM participations WHERE salle_id=$1 AND utilisateur_id=$2', [id, req.user.id]
    );
    if (!roleRes.rows.length || roleRes.rows[0].role !== 'ADMIN') {
      return res.status(403).json({ error: "Seul l'admin peut modifier la salle" });
    }
    await pool.query(
      'UPDATE salles SET nom=$1, description=$2, capacite_max=$3, matiere=$4 WHERE id=$5',
      [nom, description, capaciteMax, matiere, id]
    );
    res.json({ message: 'Salle mise à jour' });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// GET /api/salles/:id/messages
const getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit=50, offset=0 } = req.query;
    const result = await pool.query(
      `SELECT m.*, u.prenom || ' ' || u.nom as expediteur_nom, u.photo_profil
       FROM messages m JOIN utilisateurs u ON m.expediteur_id = u.id
       WHERE m.salle_id = $1 ORDER BY m.horodatage DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );
    res.json(result.rows.reverse());
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// GET /api/salles/:id/fichiers
const getFichiers = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT f.*, u.prenom || ' ' || u.nom as uploader_nom
       FROM fichiers_partages f JOIN utilisateurs u ON f.uploader_id = u.id
       WHERE f.salle_id = $1 ORDER BY f.date_upload DESC`, [id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// POST /api/salles/:id/fichiers
const uploadFichier = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.files?.fichier) return res.status(400).json({ error: 'Aucun fichier' });
    const fichier = req.files.fichier;
    const nomFichier = `${Date.now()}_${fichier.name}`;
    const uploadPath = `${process.env.UPLOAD_PATH || './uploads'}/${nomFichier}`;
    await fichier.mv(uploadPath);
    const result = await pool.query(
      `INSERT INTO fichiers_partages (salle_id, uploader_id, nom_fichier, url_telechargement, taille, type_mime)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, req.user.id, fichier.name, `/uploads/${nomFichier}`, fichier.size, fichier.mimetype]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
};
const getParticipants = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.prenom, u.nom, u.role, p.role as role_salle
       FROM participations p
       JOIN utilisateurs u ON p.utilisateur_id = u.id
       WHERE p.salle_id = $1`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  createSalle: creerSalle,
  getSalles: listerSalles,
  getMesSalles: mesSalles,
  getSalle,
  rejoindreSalle,
  quitterSalle,
  modifierSalle,
  getMessages,
  getFichiers,
  uploadFichier,
  getParticipants
};