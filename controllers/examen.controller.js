const { pool } = require('../config/db');
const emailService = require('../services/email.service');

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Créer un examen (BROUILLON)
// POST /api/examens
// ══════════════════════════════════════════════════════════════════
const createExamen = async (req, res) => {
  const {
    salleId, titre, description,
    notePassage = 70, dureeMinutes = 30, maxTentatives,
    dateDebut, dateLimite, dateAffichageResultats,
    modeAffichage = 'UNE_PAR_UNE',
    melangerQuestions = true, melangerReponses = true,
  } = req.body;

  if (!titre?.trim()) return res.status(400).json({ error: 'Le titre est obligatoire.' });
  if (!salleId)       return res.status(400).json({ error: 'La salle est obligatoire.' });

  try {
    // Vérifier que le tuteur est admin/co-admin de la salle
    const roleRes = await pool.query(
      `SELECT role FROM participations WHERE salle_id=$1 AND utilisateur_id=$2`,
      [salleId, req.user.id]
    );
    if (!roleRes.rows.length || !['ADMIN','CO_ADMIN'].includes(roleRes.rows[0].role))
      return res.status(403).json({ error: 'Vous devez être admin de la salle pour créer un examen.' });

    const { rows } = await pool.query(
      `INSERT INTO examens
         (salle_id, tuteur_id, titre, description, note_passage, duree_minutes, max_tentatives,
          date_debut, date_limite, date_affichage_resultats, mode_affichage,
          melanger_questions, melanger_reponses)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [salleId, req.user.id, titre.trim(), description,
       notePassage, dureeMinutes, maxTentatives || null,
       dateDebut || null, dateLimite || null, dateAffichageResultats || null,
       modeAffichage, melangerQuestions, melangerReponses]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Modifier un examen (BROUILLON seulement)
// PUT /api/examens/:id
// ══════════════════════════════════════════════════════════════════
const updateExamen = async (req, res) => {
  const { id } = req.params;
  const {
    titre, description, notePassage, dureeMinutes, maxTentatives,
    dateDebut, dateLimite, dateAffichageResultats,
    modeAffichage, melangerQuestions, melangerReponses,
  } = req.body;
  try {
    const exam = await pool.query(`SELECT * FROM examens WHERE id=$1`, [id]);
    if (!exam.rows.length)           return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (exam.rows[0].statut !== 'BROUILLON')
      return res.status(400).json({ error: 'Impossible de modifier un examen publié ou archivé.' });

    const { rows } = await pool.query(
      `UPDATE examens SET
         titre=$1, description=$2, note_passage=$3, duree_minutes=$4, max_tentatives=$5,
         date_debut=$6, date_limite=$7, date_affichage_resultats=$8,
         mode_affichage=$9, melanger_questions=$10, melanger_reponses=$11
       WHERE id=$12 RETURNING *`,
      [titre, description, notePassage, dureeMinutes, maxTentatives || null,
       dateDebut || null, dateLimite || null, dateAffichageResultats || null,
       modeAffichage, melangerQuestions, melangerReponses, id]
    );
    res.json(rows[0]);
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

    const exam = await client.query(`SELECT * FROM examens WHERE id=$1`, [id]);
    if (!exam.rows.length)                    return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (exam.rows[0].statut !== 'BROUILLON')
      return res.status(400).json({ error: 'Impossible de modifier un examen publié.' });

    if (!texte?.trim()) return res.status(400).json({ error: 'Le texte de la question est obligatoire.' });

    // Vérification réponses
    if (type === 'QCM' && reponses.length < 2)
      return res.status(400).json({ error: 'Un QCM doit avoir au moins 2 réponses.' });
    const hasCorrect = reponses.some(r => r.estCorrecte);
    if (!hasCorrect)
      return res.status(400).json({ error: 'Cochez au moins une bonne réponse.' });

    const ordreRes = await client.query(
      `SELECT COALESCE(MAX(ordre),0)+1 as next FROM questions_examen WHERE examen_id=$1`, [id]
    );
    const ordre = ordreRes.rows[0].next;

    const qRes = await client.query(
      `INSERT INTO questions_examen (examen_id, texte, type, points, ordre)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, texte.trim(), type, points, ordre]
    );
    const question = qRes.rows[0];

    for (let i = 0; i < reponses.length; i++) {
      const r = reponses[i];
      await client.query(
        `INSERT INTO reponses_question (question_id, texte, est_correcte, ordre) VALUES ($1,$2,$3,$4)`,
        [question.id, r.texte, r.estCorrecte || false, i + 1]
      );
    }
    await client.query('COMMIT');

    const repRes = await pool.query(
      `SELECT * FROM reponses_question WHERE question_id=$1 ORDER BY ordre`, [question.id]
    );
    res.status(201).json({ ...question, reponses: repRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Modifier une question existante
// PUT /api/examens/:examId/questions/:questionId
// ══════════════════════════════════════════════════════════════════
const updateQuestion = async (req, res) => {
  const { examId, questionId } = req.params;
  const { texte, type, points, reponses = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exam = await client.query(`SELECT * FROM examens WHERE id=$1`, [examId]);
    if (!exam.rows.length)                      return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (exam.rows[0].statut !== 'BROUILLON')
      return res.status(400).json({ error: 'Impossible de modifier un examen publié.' });

    await client.query(
      `UPDATE questions_examen SET texte=$1, type=$2, points=$3 WHERE id=$4 AND examen_id=$5`,
      [texte, type, points, questionId, examId]
    );

    // Remplacer les réponses
    await client.query(`DELETE FROM reponses_question WHERE question_id=$1`, [questionId]);
    for (let i = 0; i < reponses.length; i++) {
      const r = reponses[i];
      await client.query(
        `INSERT INTO reponses_question (question_id, texte, est_correcte, ordre) VALUES ($1,$2,$3,$4)`,
        [questionId, r.texte, r.estCorrecte || false, i + 1]
      );
    }
    await client.query('COMMIT');

    const qRes = await pool.query(`SELECT * FROM questions_examen WHERE id=$1`, [questionId]);
    const repRes = await pool.query(
      `SELECT * FROM reponses_question WHERE question_id=$1 ORDER BY ordre`, [questionId]
    );
    res.json({ ...qRes.rows[0], reponses: repRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Supprimer une question
// DELETE /api/examens/:examId/questions/:questionId
// ══════════════════════════════════════════════════════════════════
const deleteQuestion = async (req, res) => {
  const { examId, questionId } = req.params;
  try {
    const exam = await pool.query(`SELECT * FROM examens WHERE id=$1`, [examId]);
    if (!exam.rows.length)                      return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (exam.rows[0].statut !== 'BROUILLON')
      return res.status(400).json({ error: 'Impossible de modifier un examen publié.' });

    await pool.query(`DELETE FROM questions_examen WHERE id=$1 AND examen_id=$2`, [questionId, examId]);
    res.json({ message: 'Question supprimée.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Publier un examen
// PUT /api/examens/:id/publier
// ══════════════════════════════════════════════════════════════════
const publierExamen = async (req, res) => {
  const { id } = req.params;
  // io est injecté via req.app.get('io') dans server.js
  try {
    const exam = await pool.query(`SELECT * FROM examens WHERE id=$1`, [id]);
    if (!exam.rows.length) return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (exam.rows[0].statut !== 'BROUILLON')
      return res.status(400).json({ error: 'Examen déjà publié ou archivé.' });

    const qCount = await pool.query(
      `SELECT COUNT(*) FROM questions_examen WHERE examen_id=$1`, [id]
    );
    if (parseInt(qCount.rows[0].count) < 1)
      return res.status(400).json({ error: 'Ajoutez au moins une question avant de publier.' });

    const { rows } = await pool.query(
      `UPDATE examens SET statut='PUBLIE', published_at=NOW() WHERE id=$1 RETURNING *`, [id]
    );
    const examen = rows[0];

    // Récupérer infos tuteur pour le message
    const tuteurRes = await pool.query(
      `SELECT prenom, nom FROM utilisateurs WHERE id=$1`, [req.user.id]
    );
    const tuteur = tuteurRes.rows[0];

    // Notification WebSocket → tous les membres de la salle
    const io = req.app.get('io');
    if (io) {
      // Message automatique dans le chat
      const msgRes = await pool.query(
        `INSERT INTO messages (salle_id, expediteur_id, contenu) VALUES ($1,$2,$3) RETURNING id, contenu, horodatage`,
        [examen.salle_id, req.user.id,
         `📘 Nouvel examen publié : "${examen.titre}"\n🕒 Durée : ${examen.duree_minutes} min${examen.date_limite ? `\n📅 Limite : ${new Date(examen.date_limite).toLocaleDateString('fr-FR')}` : ''}\n\nPassez l'examen depuis l'onglet "Examens".`]
      );
      io.to(`salle:${examen.salle_id}`).emit('chat:message', {
        ...msgRes.rows[0],
        expediteur_id: req.user.id,
        expediteur_nom: `${tuteur.prenom} ${tuteur.nom}`,
        system: true,
      });

      // Événement examen:publie
      io.to(`salle:${examen.salle_id}`).emit('examen:publie', { examen });
    }

    res.json({ message: 'Examen publié !', examen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ══════════════════════════════════════════════════════════════════
// TUTEUR — Archiver un examen
// PUT /api/examens/:id/archiver
// ══════════════════════════════════════════════════════════════════
const archiverExamen = async (req, res) => {
  const { id } = req.params;
  try {
    const exam = await pool.query(`SELECT * FROM examens WHERE id=$1`, [id]);
    if (!exam.rows.length)                      return res.status(404).json({ error: 'Examen introuvable' });
    if (exam.rows[0].tuteur_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });

    const { rows } = await pool.query(
      `UPDATE examens SET statut='ARCHIVE' WHERE id=$1 RETURNING *`, [id]
    );
    res.json({ message: 'Examen archivé.', examen: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
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
              (SELECT COUNT(*) FROM questions_examen WHERE examen_id=e.id)::int AS nb_questions,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id AND etudiant_id=$2 AND statut='REUSSI')::int AS deja_reussi,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id AND etudiant_id=$2)::int AS nb_tentatives_faites,
              (SELECT statut FROM tentatives_examen
               WHERE examen_id=e.id AND etudiant_id=$2
               ORDER BY started_at DESC LIMIT 1) AS derniere_tentative_statut
       FROM examens e
       JOIN utilisateurs u ON e.tuteur_id = u.id
       WHERE e.salle_id=$1
         AND (e.statut='PUBLIE' OR e.tuteur_id=$2 OR $3=true)
       ORDER BY e.created_at DESC`,
      [salleId, req.user.id, req.user.role === 'admin']
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ══════════════════════════════════════════════════════════════════
// Lister tous les examens du tuteur connecté (dashboard)
// GET /api/examens/mes-examens
// ══════════════════════════════════════════════════════════════════
const getMesExamens = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              s.nom as salle_nom,
              (SELECT COUNT(*) FROM questions_examen WHERE examen_id=e.id)::int AS nb_questions,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id)::int AS nb_tentatives,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id AND statut='REUSSI')::int AS nb_reussi,
              (SELECT COUNT(*) FROM certificats WHERE examen_id=e.id)::int AS nb_certificats
       FROM examens e
       JOIN salles s ON e.salle_id=s.id
       WHERE e.tuteur_id=$1
       ORDER BY e.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ══════════════════════════════════════════════════════════════════
// Lister tous les examens disponibles pour l'étudiant connecté
// GET /api/examens/mes-examens-etudiant
// ══════════════════════════════════════════════════════════════════
const getMesExamensEtudiant = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              s.nom as salle_nom,
              u.prenom as tuteur_prenom, u.nom as tuteur_nom,
              (SELECT COUNT(*) FROM questions_examen WHERE examen_id=e.id)::int AS nb_questions,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id AND etudiant_id=$1 AND statut='REUSSI')::int AS deja_reussi,
              (SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=e.id AND etudiant_id=$1)::int AS nb_tentatives_faites,
              (SELECT statut FROM tentatives_examen
               WHERE examen_id=e.id AND etudiant_id=$1
               ORDER BY started_at DESC LIMIT 1) AS derniere_tentative_statut,
              (SELECT score_obtenu FROM tentatives_examen
               WHERE examen_id=e.id AND etudiant_id=$1 AND statut='REUSSI'
               LIMIT 1) AS meilleur_score
       FROM examens e
       JOIN salles s ON e.salle_id=s.id
       JOIN utilisateurs u ON e.tuteur_id=u.id
       -- L'étudiant doit être membre de la salle
       JOIN participations p ON p.salle_id=e.salle_id AND p.utilisateur_id=$1
       WHERE e.statut='PUBLIE'
       ORDER BY e.published_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
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

    // Comparaison string/int safe
    const isTuteur = String(req.user.id) === String(examen.tuteur_id) || req.user.role === 'admin';

    // ORDER BY dans un GROUP BY doit utiliser les colonnes du GROUP BY
    // On charge toujours par ordre fixe puis on mélange en JS si besoin
    const qRes = await pool.query(
      `SELECT q.*,
              COALESCE(
                json_agg(
                  json_build_object('id', r.id, 'texte', r.texte, 'ordre', r.ordre, 'est_correcte', r.est_correcte)
                  ORDER BY r.ordre
                ) FILTER (WHERE r.id IS NOT NULL),
                '[]'
              ) as reponses
       FROM questions_examen q
       LEFT JOIN reponses_question r ON r.question_id=q.id
       WHERE q.examen_id=$1
       GROUP BY q.id
       ORDER BY q.ordre`, [id]
    );

    let questions = qRes.rows.map(q => {
      let reponses = Array.isArray(q.reponses) ? q.reponses.filter(r => r && r.id) : [];
      // Mélanger les réponses en JS
      if (!isTuteur && (examen.melanger_reponses !== false)) {
        reponses = [...reponses].sort(() => Math.random() - 0.5);
      }
      return {
        ...q,
        reponses: reponses.map(r => ({
          id: r.id,
          texte: r.texte,
          ordre: r.ordre,
          // Masquer est_correcte pour les étudiants
          ...(isTuteur ? { est_correcte: r.est_correcte } : {}),
        })),
      };
    });

    // Mélanger les questions en JS si nécessaire
    if (!isTuteur && (examen.melanger_questions !== false)) {
      questions = [...questions].sort(() => Math.random() - 0.5);
    }

    console.log(`📝 getExamen #${id} → ${questions.length} questions, user=${req.user.id}, isTuteur=${isTuteur}`);
    res.json({ ...examen, questions });
  } catch (err) {
    console.error('getExamen error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
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

    const examRes = await client.query(
      `SELECT * FROM examens WHERE id=$1 AND statut='PUBLIE'`, [id]
    );
    if (!examRes.rows.length)
      return res.status(404).json({ error: 'Examen introuvable ou non publié.' });
    const examen = examRes.rows[0];

    // Vérifier date_limite
    if (examen.date_limite && new Date() > new Date(examen.date_limite))
      return res.status(400).json({ error: 'La période de passage est terminée.' });

    // Vérifier date_debut
    if (examen.date_debut && new Date() < new Date(examen.date_debut))
      return res.status(400).json({ error: `L'examen n'est pas encore disponible.` });

    // Vérifier si déjà réussi
    const reussiRes = await client.query(
      `SELECT id FROM tentatives_examen WHERE examen_id=$1 AND etudiant_id=$2 AND statut='REUSSI'`,
      [id, req.user.id]
    );
    if (reussiRes.rows.length)
      return res.status(400).json({ error: 'Vous avez déjà réussi cet examen.' });

    // Vérifier tentatives max
    if (examen.max_tentatives) {
      const countRes = await client.query(
        `SELECT COUNT(*) FROM tentatives_examen WHERE examen_id=$1 AND etudiant_id=$2`,
        [id, req.user.id]
      );
      if (parseInt(countRes.rows[0].count) >= examen.max_tentatives)
        return res.status(400).json({
          error: `Nombre maximum de tentatives atteint (${examen.max_tentatives}).`
        });
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
  // Accepter { reponses: [...] } ou directement [...] 
  let reponses = req.body?.reponses ?? req.body ?? [];
  if (!Array.isArray(reponses)) reponses = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tentRes = await client.query(
      `SELECT t.*, e.note_passage, e.titre as examen_titre, e.salle_id,
              s.nom as salle_nom,
              u.prenom as tuteur_prenom, u.nom as tuteur_nom, u.email as tuteur_email,
              NULL::timestamp as date_affichage_resultats
       FROM tentatives_examen t
       JOIN examens e ON t.examen_id=e.id
       JOIN salles s ON e.salle_id=s.id
       JOIN utilisateurs u ON e.tuteur_id=u.id
       WHERE t.id=$1 AND t.etudiant_id=$2`,
      [tentativeId, req.user.id]
    );
    // Récupérer date_affichage_resultats séparément (colonne ajoutée par migration)
    try {
      const darRes = await client.query(
        `SELECT date_affichage_resultats FROM examens WHERE id=$1`,
        [tentRes.rows[0]?.examen_id]
      );
      if (darRes.rows.length && tentRes.rows.length) {
        tentRes.rows[0].date_affichage_resultats = darRes.rows[0].date_affichage_resultats;
      }
    } catch (_) { /* colonne pas encore créée — résultats immédiats */ }
    if (!tentRes.rows.length) return res.status(404).json({ error: 'Tentative introuvable.' });
    const tentative = tentRes.rows[0];

    if (tentative.statut !== 'EN_COURS')
      return res.status(400).json({ error: 'Cette tentative est déjà terminée.' });

    // Expiration
    if (new Date() > new Date(tentative.expires_at)) {
      await client.query(
        `UPDATE tentatives_examen SET statut='ECHOUE', submitted_at=NOW() WHERE id=$1`,
        [tentativeId]
      );
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

      // Vérifier si déjà inséré (évite l'erreur si pas de contrainte UNIQUE)
      const existRes = await client.query(
        `SELECT id FROM reponses_etudiant WHERE tentative_id=$1 AND question_id=$2 LIMIT 1`,
        [tentativeId, rep.questionId]
      );
      if (!existRes.rows.length) {
        await client.query(
          `INSERT INTO reponses_etudiant (tentative_id, question_id, reponse_id, est_correcte)
           VALUES ($1,$2,$3,$4)`,
          [tentativeId, rep.questionId, rep.reponseId, correct]
        );
      }
    }

    const pourcentage = tentative.score_max > 0
      ? (scoreObtenu / tentative.score_max) * 100 : 0;
    const reussi  = pourcentage >= parseFloat(tentative.note_passage);
    const statut  = reussi ? 'REUSSI' : 'ECHOUE';

    await client.query(
      `UPDATE tentatives_examen
       SET statut=$1, score_obtenu=$2, pourcentage=$3, submitted_at=NOW()
       WHERE id=$4`,
      [statut, scoreObtenu, pourcentage, tentativeId]
    );

    // ─── Certificat automatique si réussi ────────────────
    let certificat = null;
    if (reussi) {
      const certExist = await client.query(
        `SELECT id FROM certificats WHERE etudiant_id=$1 AND examen_id=$2`,
        [req.user.id, tentative.examen_id]
      );
      if (!certExist.rows.length) {
        const seqRes = await client.query(`SELECT COUNT(*)+1 as num FROM certificats`);
        const num = String(seqRes.rows[0].num).padStart(5, '0');
        const year = new Date().getFullYear();
        const numeroCert = `CERT-${year}-${num}`;

        // Récupérer infos étudiant + stats salle pour le PDF
        const etudiantRes2 = await client.query(
          `SELECT prenom, nom FROM utilisateurs WHERE id=$1`, [req.user.id]
        );
        const etudiant2 = etudiantRes2.rows[0] || {};

        // Compter séances réalisées et durée totale de la salle
        let nbSeances = 0, dureeTotaleMin = 0, matiere = '';
        try {
          const salleStats = await client.query(
            `SELECT COUNT(*) as nb,
                    COALESCE(SUM(duree_minutes),0) as duree
             FROM seances
             WHERE salle_id=$1 AND statut='REALISEE'`,
            [tentative.salle_id]
          );
          nbSeances = parseInt(salleStats.rows[0]?.nb || 0);
          dureeTotaleMin = parseInt(salleStats.rows[0]?.duree || 0);
          const matiereRes = await client.query(
            `SELECT matiere FROM salles WHERE id=$1`, [tentative.salle_id]
          );
          matiere = matiereRes.rows[0]?.matiere || '';
        } catch (_) {}

        // Générer le PDF
        let urlPdf = null;
        try {
          urlPdf = await genererCertificatPDF({
            numeroCert,
            etudiantPrenom: etudiant2.prenom || '',
            etudiantNom:    etudiant2.nom    || '',
            examenTitre:    tentative.examen_titre,
            salleNom:       tentative.salle_nom,
            matiere,
            tuteurNom:      `${tentative.tuteur_prenom} ${tentative.tuteur_nom}`,
            scoreObtenu:    pourcentage,
            nbSeances,
            dureeTotaleMin,
            dateEmission:   new Date(),
          });
        } catch (pdfErr) {
          console.error('PDF certificat error:', pdfErr.message);
        }

        const certRes = await client.query(
          `INSERT INTO certificats (etudiant_id, examen_id, tentative_id, numero_certificat, score_obtenu, url_pdf)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.user.id, tentative.examen_id, tentativeId, numeroCert, pourcentage, urlPdf]
        );
        certificat = certRes.rows[0];

        // Emails
        const etudiantRes = await client.query(
          `SELECT * FROM utilisateurs WHERE id=$1`, [req.user.id]
        );
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

        emailService.sendNotifTuteurCertificat({
          to: tentative.tuteur_email,
          tuteurNom: `${tentative.tuteur_prenom} ${tentative.tuteur_nom}`,
          etudiantNom: `${etudiant.prenom} ${etudiant.nom}`,
          examenTitre: tentative.examen_titre,
          score: pourcentage.toFixed(1),
          numeroCert,
        }).catch(console.error);

        // Notification WebSocket certificat:emis
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${req.user.id}`).emit('certificat:emis', {
            certificat,
            examenTitre: tentative.examen_titre,
            score: pourcentage.toFixed(1),
          });
        }
      }
    }

    await client.query('COMMIT');

    // Déterminer si les résultats sont affichables maintenant
    const maintenant = new Date();
    const dateAffichage = tentative.date_affichage_resultats
      ? new Date(tentative.date_affichage_resultats) : null;
    const resultatsVisibles = !dateAffichage || maintenant >= dateAffichage;

    res.json({
      statut,
      scoreObtenu,
      scoreMax: tentative.score_max,
      pourcentage: pourcentage.toFixed(1),
      notePassage: tentative.note_passage,
      reussi,
      certificat,
      resultatsVisibles,
      dateAffichageResultats: tentative.date_affichage_resultats,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
};

// ══════════════════════════════════════════════════════════════════
// Résultats détaillés d'une tentative (corrigé)
// GET /api/tentatives/:tentativeId/resultats
// ══════════════════════════════════════════════════════════════════
const getResultatsTentative = async (req, res) => {
  const { tentativeId } = req.params;
  try {
    const tentRes = await pool.query(
      `SELECT t.*, e.titre as examen_titre,
              e.note_passage, e.duree_minutes,
              NULL::timestamp as date_affichage_resultats
       FROM tentatives_examen t
       JOIN examens e ON t.examen_id=e.id
       WHERE t.id=$1 AND t.etudiant_id=$2`,
      [tentativeId, req.user.id]
    );
    // Récupérer date_affichage_resultats séparément (colonne ajoutée par migration)
    if (tentRes.rows.length) {
      try {
        const darRes = await pool.query(
          `SELECT date_affichage_resultats FROM examens WHERE id=$1`,
          [tentRes.rows[0].examen_id]
        );
        if (darRes.rows.length) tentRes.rows[0].date_affichage_resultats = darRes.rows[0].date_affichage_resultats;
      } catch (_) { /* colonne pas encore créée */ }
    }
    if (!tentRes.rows.length)
      return res.status(404).json({ error: 'Tentative introuvable.' });

    const tentative = tentRes.rows[0];

    // Vérifier date affichage résultats
    const dateAffichage = tentative.date_affichage_resultats
      ? new Date(tentative.date_affichage_resultats) : null;
    if (dateAffichage && new Date() < dateAffichage) {
      return res.status(403).json({
        error: 'Résultats pas encore disponibles.',
        dateAffichage: tentative.date_affichage_resultats,
      });
    }

    // Récupérer le corrigé complet
    const questions = await pool.query(
      `SELECT q.id, q.texte, q.type, q.points,
              json_agg(r ORDER BY r.ordre) as toutes_reponses,
              (SELECT re.reponse_id FROM reponses_etudiant re
               WHERE re.tentative_id=$1 AND re.question_id=q.id LIMIT 1) as reponse_choisie,
              (SELECT re.est_correcte FROM reponses_etudiant re
               WHERE re.tentative_id=$1 AND re.question_id=q.id LIMIT 1) as est_correcte
       FROM questions_examen q
       LEFT JOIN reponses_question r ON r.question_id=q.id
       WHERE q.examen_id=$2
       GROUP BY q.id ORDER BY q.ordre`,
      [tentativeId, tentative.examen_id]
    );

    res.json({
      tentative,
      questions: questions.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
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
    if (!rows.length)
      return res.status(404).json({ valide: false, message: 'Certificat introuvable.' });

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
      },
    });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
};

// ══════════════════════════════════════════════════════════════════
// ADMIN — Révoquer un certificat
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


// ══════════════════════════════════════════════════════════════════
// Résultats détaillés d'une tentative
// GET /api/tentatives/:tentativeId/resultats
// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// TUTEUR — Statistiques complètes d'un examen
// GET /api/examens/:id/stats
// ══════════════════════════════════════════════════════════════════
const getStatsExamen = async (req, res) => {
  const { id } = req.params;
  try {
    // Vérifier que c'est bien le tuteur
    const examRes = await pool.query(
      `SELECT e.*, s.nom as salle_nom,
              u.prenom as tuteur_prenom, u.nom as tuteur_nom
       FROM examens e
       JOIN salles s ON e.salle_id=s.id
       JOIN utilisateurs u ON e.tuteur_id=u.id
       WHERE e.id=$1`, [id]
    );
    if (!examRes.rows.length) return res.status(404).json({ error: 'Examen introuvable' });
    const examen = examRes.rows[0];
    if (String(examen.tuteur_id) !== String(req.user.id) && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Non autorisé' });

    // Colonnes optionnelles (migration)
    let dateDebut = null, dateLimite = null, dateAffichage = null, modeAffichage = 'UNE_PAR_UNE';
    try {
      const extraRes = await pool.query(
        `SELECT date_debut, date_limite, date_affichage_resultats, mode_affichage
         FROM examens WHERE id=$1`, [id]
      );
      if (extraRes.rows.length) {
        dateDebut = extraRes.rows[0].date_debut;
        dateLimite = extraRes.rows[0].date_limite;
        dateAffichage = extraRes.rows[0].date_affichage_resultats;
        modeAffichage = extraRes.rows[0].mode_affichage || 'UNE_PAR_UNE';
      }
    } catch (_) {}

    // Questions avec réponses (avec est_correcte pour le tuteur)
    const qRes = await pool.query(
      `SELECT q.*,
              COALESCE(
                json_agg(
                  json_build_object('id', r.id, 'texte', r.texte, 'ordre', r.ordre, 'est_correcte', r.est_correcte)
                  ORDER BY r.ordre
                ) FILTER (WHERE r.id IS NOT NULL),
                '[]'
              ) as reponses
       FROM questions_examen q
       LEFT JOIN reponses_question r ON r.question_id=q.id
       WHERE q.examen_id=$1
       GROUP BY q.id ORDER BY q.ordre`, [id]
    );

    // Tentatives de tous les étudiants
    const tentRes = await pool.query(
      `SELECT t.*,
              u.prenom as etudiant_prenom, u.nom as etudiant_nom, u.email as etudiant_email
       FROM tentatives_examen t
       JOIN utilisateurs u ON t.etudiant_id=u.id
       WHERE t.examen_id=$1
       ORDER BY t.started_at DESC`, [id]
    );

    // Stats globales
    const terminees = tentRes.rows.filter(t => t.statut !== 'EN_COURS');
    const reussies  = tentRes.rows.filter(t => t.statut === 'REUSSI');
    const scores    = terminees.map(t => parseFloat(t.pourcentage)).filter(s => !isNaN(s));
    const moyenneScore = scores.length ? (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1) : null;

    res.json({
      examen: {
        ...examen,
        date_debut: dateDebut,
        date_limite: dateLimite,
        date_affichage_resultats: dateAffichage,
        mode_affichage: modeAffichage,
      },
      questions: qRes.rows,
      tentatives: tentRes.rows,
      stats: {
        total: tentRes.rows.length,
        terminees: terminees.length,
        reussies: reussies.length,
        echecs: terminees.length - reussies.length,
        tauxReussite: terminees.length ? ((reussies.length / terminees.length) * 100).toFixed(0) : null,
        moyenneScore,
      },
    });
  } catch (err) {
    console.error('getStatsExamen error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ══════════════════════════════════════════════════════════════════
// ÉTUDIANT — Dernière tentative d'un examen (pour voir résultats)
// GET /api/examens/:id/ma-derniere-tentative
// ══════════════════════════════════════════════════════════════════
const getMaDerniereTentative = async (req, res) => {
  const { id } = req.params;
  try {
    const tentRes = await pool.query(
      `SELECT t.* FROM tentatives_examen t
       WHERE t.examen_id=$1 AND t.etudiant_id=$2
       ORDER BY t.started_at DESC LIMIT 1`,
      [id, req.user.id]
    );
    if (!tentRes.rows.length)
      return res.status(404).json({ error: 'Aucune tentative trouvée.' });
    res.json({ tentativeId: tentRes.rows[0].id, tentative: tentRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  createExamen, updateExamen,
  addQuestion, updateQuestion, deleteQuestion,
  publierExamen, archiverExamen,
  getExamensSalle, getMesExamens, getMesExamensEtudiant, getExamen,
  demarrerTentative, soumettreReponses, getResultatsTentative,
  getStatsExamen, getMaDerniereTentative,
  mesCertificats, verifierCertificat, revoquerCertificat,
};