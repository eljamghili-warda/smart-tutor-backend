const { pool } = require('../config/db');

// GET /api/salles
// Retourne : toutes les salles PUBLIQUES + toutes les salles PRIVÉES (visibles à tous)
// L'étudiant peut voir les salles privées mais doit faire une demande pour les rejoindre
const getSalles = async (req, res) => {
  try {
    const { search, matiere } = req.query;

    let query = `
      SELECT 
        s.*,
        u.prenom || ' ' || u.nom AS createur_nom,
        (SELECT COUNT(*) FROM participations WHERE salle_id = s.id) AS nb_participants,
        (SELECT p.role FROM participations p WHERE p.salle_id = s.id AND p.utilisateur_id = $1) AS mon_role,
        CASE WHEN EXISTS (
          SELECT 1 FROM participations WHERE salle_id = s.id AND utilisateur_id = $1
        ) THEN true ELSE false END AS est_membre
      FROM salles s
      LEFT JOIN utilisateurs u ON s.createur_id = u.id
      WHERE s.statut != 'FERMEE'
    `;

    const params = [req.user.id];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (s.nom ILIKE $${params.length} OR s.description ILIKE $${params.length} OR s.matiere ILIKE $${params.length})`;
    }
    if (matiere) {
      params.push(matiere);
      query += ` AND s.matiere = $${params.length}`;
    }

    query += ' ORDER BY s.date_creation DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('getSalles error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/salles/mes-salles
const getMesSalles = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, p.role AS mon_role,
        u.prenom || ' ' || u.nom AS createur_nom,
        (SELECT COUNT(*) FROM participations WHERE salle_id = s.id) AS nb_participants
      FROM salles s
      JOIN participations p ON s.id = p.salle_id
      LEFT JOIN utilisateurs u ON s.createur_id = u.id
      WHERE p.utilisateur_id = $1 AND s.statut != 'FERMEE'
      ORDER BY p.date_join DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('getMesSalles error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/salles/:id
const getSalle = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT s.*,
        u.prenom || ' ' || u.nom AS createur_nom,
        (SELECT COUNT(*) FROM participations WHERE salle_id = s.id) AS nb_participants,
        (SELECT p.role FROM participations p WHERE p.salle_id = s.id AND p.utilisateur_id = $2) AS mon_role
      FROM salles s
      LEFT JOIN utilisateurs u ON s.createur_id = u.id
      WHERE s.id = $1
    `, [id, req.user.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Salle introuvable' });

    const salle = result.rows[0];

    const participants = await pool.query(`
      SELECT u.id, u.prenom, u.nom, u.photo_profil,
             u.role AS role_plateforme,
             p.role AS role_salle,
             p.date_join,
             t.specialites, t.note_moyenne
      FROM participations p
      JOIN utilisateurs u ON p.utilisateur_id = u.id
      LEFT JOIN tuteurs t ON u.id = t.utilisateur_id
      WHERE p.salle_id = $1
      ORDER BY
        CASE p.role WHEN 'ADMIN' THEN 1 WHEN 'CO_ADMIN' THEN 2 ELSE 3 END,
        u.prenom
    `, [id]);

    salle.participants = participants.rows;
    res.json(salle);
  } catch (err) {
    console.error('getSalle error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/salles
const createSalle = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { nom, description, type, capaciteMax, matiere } = req.body;
    if (!nom || !type) return res.status(400).json({ error: 'Nom et type requis' });

    const salleRes = await client.query(
      `INSERT INTO salles (nom, description, type, capacite_max, matiere, createur_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nom, description, type, capaciteMax || 50, matiere, req.user.id]
    );
    const salle = salleRes.rows[0];

    // Le créateur devient ADMIN de la salle
    await client.query(
      `INSERT INTO participations (utilisateur_id, salle_id, role) VALUES ($1,$2,'ADMIN')`,
      [req.user.id, salle.id]
    );

    // Créer le tableau blanc
    await client.query(
      `INSERT INTO tableaux_blancs (salle_id) VALUES ($1)`,
      [salle.id]
    );

    await client.query('COMMIT');
    res.status(201).json(salle);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createSalle error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// POST /api/salles/:id/rejoindre — salle PUBLIQUE uniquement
const rejoindreSalle = async (req, res) => {
  try {
    const { id } = req.params;
    const salle = await pool.query('SELECT * FROM salles WHERE id=$1', [id]);
    if (!salle.rows.length) return res.status(404).json({ error: 'Salle introuvable' });
    if (salle.rows[0].statut === 'FERMEE') return res.status(400).json({ error: 'Salle fermée' });

    // Vérifier si déjà membre
    const deja = await pool.query(
      'SELECT id FROM participations WHERE utilisateur_id=$1 AND salle_id=$2',
      [req.user.id, id]
    );
    if (deja.rows.length) return res.status(409).json({ error: 'Déjà membre de cette salle' });

    // Salle privée => refuser le rejoindre direct (utiliser invitation)
    if (salle.rows[0].type === 'PRIVEE' && req.user.role !== 'admin') {
      // Vérifier si une invitation acceptée existe (dans les 2 sens)
      // Cas 1: admin a invité l'étudiant (destinataire=étudiant)
      // Cas 2: étudiant a demandé et admin a accepté (expediteur=étudiant, type=VERS_ETUDIANT)
      const invite = await pool.query(
        `SELECT id FROM invitations 
         WHERE salle_id=$1 AND statut='ACCEPTEE'
         AND (
           (destinataire_id=$2)
           OR (expediteur_id=$2 AND type_invitation='VERS_ETUDIANT')
         )`,
        [id, req.user.id]
      );
      if (!invite.rows.length) {
        return res.status(403).json({ error: 'Cette salle est privée. Votre demande n pas encore été acceptée.' });
      }
    }

    // Tuteur => doit avoir une invitation acceptée VERS_TUTEUR
    if (req.user.role === 'tuteur') {
      const invite = await pool.query(
        `SELECT id FROM invitations 
         WHERE salle_id=$1 AND destinataire_id=$2 AND statut='ACCEPTEE' AND type_invitation='VERS_TUTEUR'`,
        [id, req.user.id]
      );
      if (!invite.rows.length) {
        return res.status(403).json({ error: 'Vous devez être invité par l\'admin pour rejoindre en tant que tuteur.' });
      }
      await pool.query(
        `INSERT INTO participations (utilisateur_id, salle_id, role) VALUES ($1,$2,'CO_ADMIN')`,
        [req.user.id, id]
      );
      await pool.query(
        `UPDATE salles SET statut='ACTIVE_AVEC_TUTEUR' WHERE id=$1`, [id]
      );
    } else {
      // Étudiant rejoint une salle publique
      await pool.query(
        `INSERT INTO participations (utilisateur_id, salle_id, role) VALUES ($1,$2,'MEMBRE')`,
        [req.user.id, id]
      );
    }

    res.json({ message: 'Salle rejointe avec succès' });
  } catch (err) {
    console.error('rejoindreSalle error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/salles/:id/demander-invitation
const demanderInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    const salle = await pool.query('SELECT * FROM salles WHERE id=$1', [id]);
    if (!salle.rows.length) return res.status(404).json({ error: 'Salle introuvable' });
    // Salle publique ou privée : l'étudiant envoie une demande à l'admin
    // (pour les salles publiques, on ne rejoint plus directement, on demande aussi)

    // Vérifier si déjà membre
    const deja = await pool.query(
      'SELECT id FROM participations WHERE utilisateur_id=$1 AND salle_id=$2',
      [req.user.id, id]
    );
    if (deja.rows.length) return res.status(409).json({ error: 'Vous êtes déjà membre.' });

    // Vérifier si une demande existe déjà
    const existing = await pool.query(
      `SELECT id FROM invitations WHERE salle_id=$1 AND destinataire_id=$2 AND statut='EN_ATTENTE'`,
      [id, req.user.id]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Demande déjà envoyée, en attente de l\'admin.' });
    }

    // Créer une invitation de type VERS_ETUDIANT (l'étudiant demande à l'admin)
    // L'expediteur est l'étudiant, le destinataire est l'admin de la salle
    const adminSalle = await pool.query(
      `SELECT utilisateur_id FROM participations WHERE salle_id=$1 AND role='ADMIN'`,
      [id]
    );
    if (!adminSalle.rows.length) return res.status(404).json({ error: 'Admin de la salle introuvable' });

    // ── Type d'invitation selon le rôle du demandeur ──────────────────────
    // Tuteur qui demande → VERS_TUTEUR → il deviendra CO_ADMIN si accepté
    // Étudiant qui demande → VERS_ETUDIANT → il deviendra MEMBRE si accepté
    const typeInvitation = req.user.role === 'tuteur' ? 'VERS_TUTEUR' : 'VERS_ETUDIANT';

    await pool.query(
      `INSERT INTO invitations (salle_id, expediteur_id, destinataire_id, type_invitation)
       VALUES ($1,$2,$3,$4)`,
      [id, req.user.id, adminSalle.rows[0].utilisateur_id, typeInvitation]
    );

    res.json({ message: 'Demande d\'invitation envoyée à l\'admin de la salle.' });
  } catch (err) {
    console.error('demanderInvitation error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// DELETE /api/salles/:id/quitter
const quitterSalle = async (req, res) => {
  try {
    const { id } = req.params;
    const participation = await pool.query(
      'SELECT role FROM participations WHERE utilisateur_id=$1 AND salle_id=$2',
      [req.user.id, id]
    );
    if (!participation.rows.length) return res.status(404).json({ error: 'Non membre de cette salle' });

    // Admin exit → supprime définitivement la salle et toutes ses données
    if (participation.rows[0].role === 'ADMIN') {
      await pool.query('DELETE FROM messages        WHERE salle_id=$1', [id]);
      await pool.query('DELETE FROM invitations     WHERE salle_id=$1', [id]);
      await pool.query('DELETE FROM seances         WHERE salle_id=$1', [id]);
      await pool.query('DELETE FROM fichiers_partages WHERE salle_id=$1', [id]);
      await pool.query('DELETE FROM tableaux_blancs WHERE salle_id=$1', [id]);
      await pool.query('DELETE FROM participations  WHERE salle_id=$1', [id]);
      await pool.query('DELETE FROM salles          WHERE id=$1',       [id]);
      return res.json({ message: 'Salle supprimée définitivement', salleSuprimee: true });
    }

    // Tuteur exit → salle perd son tuteur
    if (req.user.role === 'tuteur') {
      await pool.query("UPDATE salles SET statut='ACTIVE_SANS_TUTEUR' WHERE id=$1", [id]);
    }

    await pool.query(
      'DELETE FROM participations WHERE utilisateur_id=$1 AND salle_id=$2',
      [req.user.id, id]
    );

    // Si plus personne → fermer
    const count = await pool.query('SELECT COUNT(*) FROM participations WHERE salle_id=$1', [id]);
    if (parseInt(count.rows[0].count) === 0) {
      await pool.query("UPDATE salles SET statut='FERMEE' WHERE id=$1", [id]);
    }

    res.json({ message: 'Vous avez quitté la salle' });
  } catch (err) {
    console.error('quitterSalle error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/salles/:id/participants
const getParticipants = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.prenom, u.nom, u.photo_profil,
             u.role AS role_plateforme,
             p.role AS role_salle,
             p.date_join,
             t.specialites, t.note_moyenne
      FROM participations p
      JOIN utilisateurs u ON p.utilisateur_id = u.id
      LEFT JOIN tuteurs t ON u.id = t.utilisateur_id
      WHERE p.salle_id = $1
      ORDER BY
        CASE p.role WHEN 'ADMIN' THEN 1 WHEN 'CO_ADMIN' THEN 2 ELSE 3 END,
        u.prenom
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/salles/:id/messages
const getMessages = async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await pool.query(`
      SELECT m.*, u.prenom || ' ' || u.nom AS expediteur_nom, u.photo_profil
      FROM messages m
      JOIN utilisateurs u ON m.expediteur_id = u.id
      WHERE m.salle_id = $1
      ORDER BY m.horodatage ASC
      LIMIT $2 OFFSET $3
    `, [req.params.id, limit, offset]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/salles/:id/fichiers
const getFichiers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, u.prenom || ' ' || u.nom AS uploader_nom
      FROM fichiers_partages f
      JOIN utilisateurs u ON f.uploader_id = u.id
      WHERE f.salle_id = $1
      ORDER BY f.date_upload DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/salles/:id/fichiers
const uploadFichier = async (req, res) => {
  try {
    if (!req.files || !req.files.fichier) {
      return res.status(400).json({ error: 'Fichier requis' });
    }
    const file = req.files.fichier;
    const uploadPath = `./uploads/${Date.now()}_${file.name}`;
    await file.mv(uploadPath);

    const result = await pool.query(
      `INSERT INTO fichiers_partages (salle_id, uploader_id, nom_fichier, url_telechargement, taille, type_mime)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, req.user.id, file.name, uploadPath, file.size, file.mimetype]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('uploadFichier error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// DELETE /api/salles/:id/membres/:membreId  — Admin expulse un membre
const kickMembre = async (req, res) => {
  try {
    const { id, membreId } = req.params;

    // Vérifier que le demandeur est ADMIN de la salle
    const admin = await pool.query(
      'SELECT role FROM participations WHERE utilisateur_id=$1 AND salle_id=$2',
      [req.user.id, id]
    );
    if (!admin.rows.length || admin.rows[0].role !== 'ADMIN') {
      return res.status(403).json({ error: 'Seul l\'admin peut expulser un membre' });
    }

    // Impossible de s'expulser soi-même
    if (String(membreId) === String(req.user.id)) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous expulser vous-même' });
    }

    // Vérifier que le membre est bien dans la salle
    const membre = await pool.query(
      'SELECT p.role, u.prenom, u.nom FROM participations p JOIN utilisateurs u ON p.utilisateur_id=u.id WHERE p.utilisateur_id=$1 AND p.salle_id=$2',
      [membreId, id]
    );
    if (!membre.rows.length) {
      return res.status(404).json({ error: 'Membre introuvable dans cette salle' });
    }

    const { role, prenom, nom } = membre.rows[0];

    // Si c'est le tuteur (CO_ADMIN), remettre la salle en ACTIVE_SANS_TUTEUR
    if (role === 'CO_ADMIN') {
      await pool.query("UPDATE salles SET statut='ACTIVE_SANS_TUTEUR' WHERE id=$1", [id]);
    }

    await pool.query(
      'DELETE FROM participations WHERE utilisateur_id=$1 AND salle_id=$2',
      [membreId, id]
    );

    res.json({ message: `${prenom} ${nom} a été expulsé(e) de la salle`, membreId: parseInt(membreId) });
  } catch (err) {
    console.error('kickMembre error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  getSalles, getMesSalles, getSalle, createSalle,
  rejoindreSalle, demanderInvitation, quitterSalle,
  kickMembre,
  getParticipants, getMessages, getFichiers, uploadFichier
};