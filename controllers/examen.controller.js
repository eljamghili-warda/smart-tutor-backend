const pool = require('../config/db');
const emailService = require('../services/email.service');
const path = require('path');
const fs   = require('fs');

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Créer un examen (BROUILLON)
// POST /api/examens
// ══════════════════════════════════════════════════════════════════
const createExamen = async (req, res) => {
  const { salleId, titre, description, notePassage = 70, dureeMinutes = 30, maxTentatives } = req.body;
  try {
    // Vérifier que le tuteur est admin/co-admin de la salle
    const roleRes = await pool.query(
      `SELECT role FROM participations WHERE salle_id=$1 AND utilisateur_id=$2`,
      [salleId, req.user.id]
    );
    if (!roleRes.rows.length || !['ADMIN','CO_ADMIN'].includes(roleRes.rows[0].role))
      return res.status(403).json({ error: 'Vous devez être admin de la salle pour créer un examen.' });

    const { rows } = await pool.query(
      `INSERT INTO examens (salle_id, tuteur_id, titre, description, note_passage, duree_minutes, max_tentatives)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [salleId, req.user.id, titre, description, notePassage, dureeMinutes, maxTentatives || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Ajouter une question
// POST /api/examens/:id/questions
// ══════════════════════════════════════════════════════════════════
const addQuestion = async (req, res) => {
  const { id } = req.params;
  const { texte, type = 'QCM', points = 1, reponses = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Vérifier propriété examen
    const exam = await client.query(`SELECT * FROM examens WHERE id=$1`, [id]);
    if (!exam.rows.length) return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id)
      return res.status(403).json({ error: 'Non autorisé' });
    if (exam.rows[0].statut !== 'BROUILLON')
      return res.status(400).json({ error: 'Impossible de modifier un examen publié.' });

    const ordreRes = await client.query(
      `SELECT COALESCE(MAX(ordre),0)+1 as next FROM questions_examen WHERE examen_id=$1`, [id]
    );
    const ordre = ordreRes.rows[0].next;
    const qRes = await client.query(
      `INSERT INTO questions_examen (examen_id, texte, type, points, ordre)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, texte, type, points, ordre]
    );
    const question = qRes.rows[0];

    // Insérer les réponses
    for (let i = 0; i < reponses.length; i++) {
      const r = reponses[i];
      await client.query(
        `INSERT INTO reponses_question (question_id, texte, est_correcte, ordre) VALUES ($1,$2,$3,$4)`,
        [question.id, r.texte, r.estCorrecte || false, i + 1]
      );
    }
    await client.query('COMMIT');

    // Retourner la question avec ses réponses
    const repRes = await pool.query(`SELECT * FROM reponses_question WHERE question_id=$1 ORDER BY ordre`, [question.id]);
    res.status(201).json({ ...question, reponses: repRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Publier un examen
// PUT /api/examens/:id/publier
// ══════════════════════════════════════════════════════════════════
const publierExamen = async (req, res) => {
  const { id } = req.params;
  try {
    const exam = await pool.query(`SELECT * FROM examens WHERE id=$1`, [id]);
    if (!exam.rows.length) return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (exam.rows[0].statut !== 'BROUILLON') return res.status(400).json({ error: 'Examen déjà publié ou archivé.' });

    const qCount = await pool.query(`SELECT COUNT(*) FROM questions_examen WHERE examen_id=$1`, [id]);
    if (parseInt(qCount.rows[0].count) < 1)
      return res.status(400).json({ error: 'Ajoutez au moins une question avant de publier.' });

    const { rows } = await pool.query(
      `UPDATE examens SET statut='PUBLIE', published_at=NOW() WHERE id=$1 RETURNING *`, [id]
    );

    // Notifier les membres de la salle via socket (géré dans socket/index.js)
    res.json({ message: 'Examen publié !', examen: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// ══════════════════════════════════════════════════════════════════
// Lister les examens d'une salle
// GET /api/examens/salle/:salleId
// ══════════════════════════════════════════════════════════════════
const getExamensSalle = async (req, res) => {
  const { salleId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              u.prenom as tuteur_prenom, u.nom as tuteur_nom,
              (SELECT COUNT(*) FROM questions_examen WHERE examen_id=e.id) as nb_questions,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id AND etudiant_id=$2 AND statut='REUSSI') as deja_reussi,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id AND etudiant_id=$2) as nb_tentatives
       FROM examens e
       JOIN utilisateurs u ON e.tuteur_id = u.id
       WHERE e.salle_id=$1
         AND (e.statut='PUBLIE' OR e.tuteur_id=$2)
       ORDER BY e.created_at DESC`,
      [salleId, req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// ══════════════════════════════════════════════════════════════════
// Détail examen avec questions (mélangées pour étudiant)
// GET /api/examens/:id
// ══════════════════════════════════════════════════════════════════
const getExamen = async (req, res) => {
  const { id } = req.params;
  try {
    const examRes = await pool.query(
      `SELECT e.*, u.prenom as tuteur_prenom, u.nom as tuteur_nom
       FROM examens e JOIN utilisateurs u ON e.tuteur_id=u.id WHERE e.id=$1`, [id]
    );
    if (!examRes.rows.length) return res.status(404).json({ error: 'Examen introuvable' });
    const examen = examRes.rows[0];

    const qRes = await pool.query(
      `SELECT q.*, json_agg(r ORDER BY r.ordre) as reponses
       FROM questions_examen q
       LEFT JOIN reponses_question r ON r.question_id=q.id
       WHERE q.examen_id=$1
       GROUP BY q.id ORDER BY q.ordre`, [id]
    );

    // Pour les étudiants, masquer est_correcte
    const isTuteur = req.user.id === examen.tuteur_id || req.user.role === 'admin';
    const questions = qRes.rows.map(q => ({
      ...q,
      reponses: (q.reponses || []).map(r => ({
        id: r.id, texte: r.texte, ordre: r.ordre,
        ...(isTuteur ? { est_correcte: r.est_correcte } : {})
      }))
    }));

    res.json({ ...examen, questions });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT — Démarrer une tentative
// POST /api/examens/:id/tentatives
// ══════════════════════════════════════════════════════════════════
const demarrerTentative = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const examRes = await client.query(`SELECT * FROM examens WHERE id=$1 AND statut='PUBLIE'`, [id]);
    if (!examRes.rows.length) return res.status(404).json({ error: 'Examen introuvable ou non publié.' });
    const examen = examRes.rows[0];

    // Vérifier si déjà réussi
    const reussiRes = await client.query(
      `SELECT id FROM tentatives_examen WHERE examen_id=$1 AND etudiant_id=$2 AND statut='REUSSI'`, [id, req.user.id]
    );
    if (reussiRes.rows.length) return res.status(400).json({ error: 'Vous avez déjà réussi cet examen.' });

    // Vérifier tentatives max
    if (examen.max_tentatives) {
      const countRes = await client.query(
        `SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=$1 AND etudiant_id=$2`, [id, req.user.id]
      );
      if (parseInt(countRes.rows[0].count) >= examen.max_tentatives)
        return res.status(400).json({ error: `Nombre maximum de tentatives atteint (${examen.max_tentatives}).` });
    }

    // Calculer score_max
    const scoreRes = await client.query(
      `SELECT COALESCE(SUM(points),0) as total FROM questions_examen WHERE examen_id=$1`, [id]
    );
    const scoreMax = parseFloat(scoreRes.rows[0].total);
    const expiresAt = new Date(Date.now() + examen.duree_minutes * 60 * 1000);

    const tentRes = await client.query(
      `INSERT INTO tentatives_examen (examen_id, etudiant_id, score_max, expires_at)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, req.user.id, scoreMax, expiresAt]
    );

    await client.query('COMMIT');
    res.status(201).json({ tentative: tentRes.rows[0], examen, expiresAt });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT — Soumettre les réponses
// PUT /api/tentatives/:tentativeId/soumettre
// ══════════════════════════════════════════════════════════════════
const soumettreReponses = async (req, res) => {
  const { tentativeId } = req.params;
  const { reponses = [] } = req.body; // [{ questionId, reponseId }]
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tentRes = await client.query(
      `SELECT t.*, e.note_passage, e.titre as examen_titre, e.salle_id,
              s.nom as salle_nom, u.prenom as tuteur_prenom, u.nom as tuteur_nom, u.email as tuteur_email
       FROM tentatives_examen t
       JOIN examens e ON t.examen_id=e.id
       JOIN salles s ON e.salle_id=s.id
       JOIN utilisateurs u ON e.tuteur_id=u.id
       WHERE t.id=$1 AND t.etudiant_id=$2`,
      [tentativeId, req.user.id]
    );
    if (!tentRes.rows.length) return res.status(404).json({ error: 'Tentative introuvable.' });
    const tentative = tentRes.rows[0];

    if (tentative.statut !== 'EN_COURS') return res.status(400).json({ error: 'Cette tentative est déjà terminée.' });
    if (new Date() > new Date(tentative.expires_at)) {
      await client.query(`UPDATE tentatives_examen SET statut='ECHOUE', submitted_at=NOW() WHERE id=$1`, [tentativeId]);
      await client.query('COMMIT');
      return res.status(400).json({ error: 'Temps écoulé — tentative expirée.' });
    }

    // Évaluer chaque réponse
    let scoreObtenu = 0;
    for (const rep of reponses) {
      const repCorrecte = await client.query(
        `SELECT est_correcte, q.points FROM reponses_question r
         JOIN questions_examen q ON r.question_id=q.id
         WHERE r.id=$1 AND q.examen_id=$2`,
        [rep.reponseId, tentative.examen_id]
      );
      const correct = repCorrecte.rows.length && repCorrecte.rows[0].est_correcte;
      if (correct) scoreObtenu += parseFloat(repCorrecte.rows[0].points);

      await client.query(
        `INSERT INTO reponses_etudiant (tentative_id, question_id, reponse_id, est_correcte)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [tentativeId, rep.questionId, rep.reponseId, correct]
      );
    }

    const pourcentage = tentative.score_max > 0 ? (scoreObtenu / tentative.score_max) * 100 : 0;
    const reussi = pourcentage >= parseFloat(tentative.note_passage);
    const statut = reussi ? 'REUSSI' : 'ECHOUE';

    await client.query(
      `UPDATE tentatives_examen
       SET statut=$1, score_obtenu=$2, pourcentage=$3, submitted_at=NOW()
       WHERE id=$4`,
      [statut, scoreObtenu, pourcentage, tentativeId]
    );

    let certificat = null;
    if (reussi) {
      // Vérifier qu'un certificat n'existe pas déjà
      const certExist = await client.query(
        `SELECT id FROM certificats WHERE etudiant_id=$1 AND examen_id=$2`, [req.user.id, tentative.examen_id]
      );
      if (!certExist.rows.length) {
        const seqRes = await client.query(`SELECT COUNT(*)+1 as num FROM certificats`);
        const num = String(seqRes.rows[0].num).padStart(5, '0');
        const year = new Date().getFullYear();
        const numeroCert = `CERT-${year}-${num}`;

        const certRes = await client.query(
          `INSERT INTO certificats (etudiant_id, examen_id, tentative_id, numero_certificat, score_obtenu)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.user.id, tentative.examen_id, tentativeId, numeroCert, pourcentage]
        );
        certificat = certRes.rows[0];

        // Email à l'étudiant
        const etudiantRes = await client.query(`SELECT * FROM utilisateurs WHERE id=$1`, [req.user.id]);
        const etudiant = etudiantRes.rows[0];
        emailService.sendCertificatEmail({
          to: etudiant.email,
          nom: `${etudiant.prenom} ${etudiant.nom}`,
          examenTitre: tentative.examen_titre,
          sallenom: tentative.salle_nom,
          numeroCert,
          score: pourcentage.toFixed(1),
          tuteurNom: `${tentative.tuteur_prenom} ${tentative.tuteur_nom}`,
        }).catch(console.error);

        // Email au tuteur
        emailService.sendNotifTuteurCertificat({
          to: tentative.tuteur_email,
          tuteurNom: `${tentative.tuteur_prenom} ${tentative.tuteur_nom}`,
          etudiantNom: `${req.user.prenom || ''} ${req.user.nom || ''}`,
          examenTitre: tentative.examen_titre,
          score: pourcentage.toFixed(1),
          numeroCert,
        }).catch(console.error);
      }
    }

    await client.query('COMMIT');
    res.json({
      statut,
      scoreObtenu,
      scoreMax: tentative.score_max,
      pourcentage: pourcentage.toFixed(1),
      notePassage: tentative.note_passage,
      reussi,
      certificat,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// ══════════════════════════════════════════════════════════════════
// Mes certificats
// GET /api/certificats/mes-certificats
// ══════════════════════════════════════════════════════════════════
const mesCertificats = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, e.titre as examen_titre, s.nom as salle_nom,
              u.prenom as tuteur_prenom, u.nom as tuteur_nom
       FROM certificats c
       JOIN examens e ON c.examen_id=e.id
       JOIN salles s ON e.salle_id=s.id
       JOIN utilisateurs u ON e.tuteur_id=u.id
       WHERE c.etudiant_id=$1 ORDER BY c.date_emission DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// ══════════════════════════════════════════════════════════════════
// Vérification publique d'un certificat
// GET /api/certificats/verifier/:numero
// ══════════════════════════════════════════════════════════════════
const verifierCertificat = async (req, res) => {
  const { numero } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT c.numero_certificat, c.score_obtenu, c.date_emission, c.est_valide,
              u.prenom as etudiant_prenom, u.nom as etudiant_nom,
              e.titre as examen_titre, s.nom as salle_nom,
              tu.prenom as tuteur_prenom, tu.nom as tuteur_nom
       FROM certificats c
       JOIN utilisateurs u  ON c.etudiant_id=u.id
       JOIN examens e        ON c.examen_id=e.id
       JOIN salles s         ON e.salle_id=s.id
       JOIN utilisateurs tu  ON e.tuteur_id=tu.id
       WHERE c.numero_certificat=$1`, [numero]
    );
    if (!rows.length) return res.status(404).json({ valide: false, message: 'Certificat introuvable.' });
    const cert = rows[0];
    res.json({
      valide: cert.est_valide,
      message: cert.est_valide ? 'Certificat valide ✅' : 'Certificat révoqué ❌',
      certificat: {
        numero: cert.numero_certificat,
        etudiant: `${cert.etudiant_prenom} ${cert.etudiant_nom}`,
        examen: cert.examen_titre,
        salle: cert.salle_nom,
        tuteur: `${cert.tuteur_prenom} ${cert.tuteur_nom}`,
        score: `${cert.score_obtenu}%`,
        date: cert.date_emission,
      }
    });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// ══════════════════════════════════════════════════════════════════
// ADMIN — Révoquer un certificat
// PUT /api/admin/certificats/:id/revoquer
// ══════════════════════════════════════════════════════════════════
const revoquerCertificat = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE certificats SET est_valide=false WHERE id=$1 RETURNING *`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Certificat introuvable' });
    res.json({ message: 'Certificat révoqué.', certificat: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

module.exports = {
  createExamen, addQuestion, publierExamen,
  getExamensSalle, getExamen,
  demarrerTentative, soumettreReponses,
  mesCertificats, verifierCertificat, revoquerCertificat,
};