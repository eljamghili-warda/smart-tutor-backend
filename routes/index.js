const express = require('express');
const router  = express.Router();
const { authenticate, requireRole, requireActiveTuteur } = require('../middleware/auth');

// ─── Auth ─────────────────────────────────────────────────────────────────────
const authCtrl = require('../controllers/auth.controller');
router.post('/auth/register', authCtrl.register);
router.post('/auth/login',    authCtrl.login);
router.get ('/auth/me',       authenticate, authCtrl.getMe);
router.put ('/auth/profile',  authenticate, authCtrl.updateProfile);

// ─── Salles ───────────────────────────────────────────────────────────────────
const salleCtrl = require('../controllers/salle.controller');
router.get   ('/salles',                  authenticate, salleCtrl.getSalles);
router.get   ('/salles/mes-salles',       authenticate, salleCtrl.getMesSalles);
router.post  ('/salles',                  authenticate, salleCtrl.createSalle);
router.get   ('/salles/:id',              authenticate, salleCtrl.getSalle);
router.post  ('/salles/:id/rejoindre',    authenticate, requireActiveTuteur, salleCtrl.rejoindreSalle);
router.post  ('/salles/:id/demander',     authenticate, salleCtrl.demanderInvitation);
router.delete('/salles/:id/quitter',              authenticate, salleCtrl.quitterSalle);
router.delete('/salles/:id/membres/:membreId',    authenticate, salleCtrl.kickMembre);
router.get   ('/salles/:id/participants', authenticate, salleCtrl.getParticipants);
router.get   ('/salles/:id/messages',     authenticate, salleCtrl.getMessages);
router.get   ('/salles/:id/fichiers',     authenticate, salleCtrl.getFichiers);
router.post  ('/salles/:id/fichiers',     authenticate, salleCtrl.uploadFichier);

// ─── Invitations ──────────────────────────────────────────────────────────────
const invitCtrl = require('../controllers/invitation.controller');
router.get('/invitations',               authenticate, invitCtrl.getMesInvitations);
router.post('/invitations',              authenticate, invitCtrl.sendInvitation);
router.put('/invitations/:id/accepter',  authenticate, invitCtrl.accepterInvitation);
router.put('/invitations/:id/refuser',   authenticate, invitCtrl.refuserInvitation);

// ─── Séances ──────────────────────────────────────────────────────────────────
// ⚠️  ORDRE CRITIQUE : routes statiques AVANT /:id
//     Express lirait "creneaux", "emploi-du-temps", "disponibilites" comme des IDs sinon
const seanceCtrl = require('../controllers/seance.controller');

// Routes statiques
router.get   ('/seances/creneaux',           authenticate, seanceCtrl.getCreneauxDisponibles);
router.get   ('/seances/emploi-du-temps',    authenticate, seanceCtrl.getEmploiDuTemps);
router.get   ('/seances/disponibilites',     authenticate, seanceCtrl.getDisponibilites);
router.post  ('/seances/disponibilites',     authenticate, requireRole('tuteur'), seanceCtrl.setDisponibilite);
router.delete('/seances/disponibilites/:id', authenticate, requireRole('tuteur'), seanceCtrl.deleteDisponibilite);

// Liste + création
router.get ('/seances',      authenticate, seanceCtrl.getSeances);
router.post('/seances',      authenticate, requireRole('tuteur'), seanceCtrl.createSeance);

// Routes avec :id
router.put('/seances/:id/annuler', authenticate, requireRole('tuteur'), seanceCtrl.annulerSeance);

// ─── Tuteurs ──────────────────────────────────────────────────────────────────
const tuteurCtrl = require('../controllers/tuteur.controller');
router.get('/tuteurs',     authenticate, tuteurCtrl.getTuteurs);
router.get('/tuteurs/:id', authenticate, tuteurCtrl.getTuteur);

// ─── Évaluations ──────────────────────────────────────────────────────────────
const evalCtrl = require('../controllers/evaluation.controller');
router.post('/evaluations',            authenticate, requireRole('etudiant'), evalCtrl.createEvaluation);
router.get ('/evaluations/tuteur/:id', authenticate, evalCtrl.getEvaluationsTuteur);

// ─── Tarifs ───────────────────────────────────────────────────────────────────
// ⚠️  "mes-tarifs" AVANT ":tuteurId"
const tarifCtrl = require('../controllers/tarif.controller');
router.get   ('/tarifs/mes-tarifs', authenticate, requireRole('tuteur'), tarifCtrl.getMesTarifs);
router.get   ('/tarifs/:tuteurId',  authenticate, tarifCtrl.getTarifsTuteur);
router.post  ('/tarifs',            authenticate, requireRole('tuteur'), tarifCtrl.upsertTarif);
router.delete('/tarifs/:id',        authenticate, requireRole('tuteur'), tarifCtrl.deleteTarif);

// ─── Paiements ────────────────────────────────────────────────────────────────
// ⚠️  Routes statiques AVANT /:id
const paiementCtrl = require('../controllers/paiement.controller');
router.get ('/paiements/mes-paiements',    authenticate, paiementCtrl.getMesPaiements);
router.get ('/paiements/mes-revenus',      authenticate, requireRole('tuteur'), paiementCtrl.getMesRevenus);
router.get ('/paiements/seance/:seanceId', authenticate, paiementCtrl.getPaiementSeance);
router.post('/paiements',                  authenticate, paiementCtrl.payerSeance);
router.post('/paiements/:id/rembourser',   authenticate, paiementCtrl.rembourserPaiement);

// ─── Admin ────────────────────────────────────────────────────────────────────
// ⚠️  "tuteurs/pending" AVANT "tuteurs/:id"
const adminCtrl = require('../controllers/admin.controller');
router.get   ('/admin/stats',                    authenticate, requireRole('admin'), adminCtrl.getStats);
router.get   ('/admin/utilisateurs',             authenticate, requireRole('admin'), adminCtrl.getUtilisateurs);
router.put   ('/admin/utilisateurs/:id/bloquer', authenticate, requireRole('admin'), adminCtrl.bloquerUtilisateur);
router.delete('/admin/utilisateurs/:id',         authenticate, requireRole('admin'), adminCtrl.supprimerUtilisateur);
router.get   ('/admin/tuteurs/pending',          authenticate, requireRole('admin'), adminCtrl.getTuteursPending);
router.put   ('/admin/tuteurs/:id/valider',      authenticate, requireRole('admin'), adminCtrl.validerTuteur);
router.get   ('/admin/salles',                   authenticate, requireRole('admin'), adminCtrl.getSallesAdmin);
router.put   ('/admin/salles/:id/fermer',        authenticate, requireRole('admin'), adminCtrl.fermerSalle);
router.get   ('/admin/seances',                  authenticate, requireRole('admin'), adminCtrl.getSeancesAdmin);
router.get   ('/admin/examens',                  authenticate, requireRole('admin'), adminCtrl.getExamensAdmin);
router.get   ('/admin/examens/:id/details',      authenticate, requireRole('admin'), adminCtrl.getExamenDetails);
router.get   ('/admin/tuteurs/activite',         authenticate, requireRole('admin'), adminCtrl.getTuteursActivite);
router.get   ('/admin/seances/stats',            authenticate, requireRole('admin'), adminCtrl.getSeancesStats);
router.get   ('/admin/revenus/details',          authenticate, requireRole('admin'), adminCtrl.getRevenusDetails);
router.get   ('/admin/revenus',                  authenticate, requireRole('admin'), paiementCtrl.getAdminRevenus);
router.get   ('/admin/paiements',                authenticate, requireRole('admin'), paiementCtrl.getAllPaiements);

// ─── Examens & Certificats ────────────────────────────────────────────────────
const examenCtrl = require('../controllers/examen.controller');

// Examens — routes statiques AVANT /:id
router.get ('/examens/mes-examens',              authenticate, requireRole('tuteur'), examenCtrl.getMesExamens);
router.get ('/examens/mes-examens-etudiant',     authenticate, requireRole('etudiant'), examenCtrl.getMesExamensEtudiant);
router.get ('/examens/salle/:salleId',           authenticate, examenCtrl.getExamensSalle);
router.post('/examens',                          authenticate, requireRole('tuteur'), examenCtrl.createExamen);

// Examens — routes avec :id
router.get ('/examens/:id',                      authenticate, examenCtrl.getExamen);
router.get ('/examens/:id/stats',                authenticate, examenCtrl.getStatsExamen);
router.get ('/examens/:id/ma-derniere-tentative', authenticate, examenCtrl.getMaDerniereTentative);
router.put ('/examens/:id',                      authenticate, requireRole('tuteur'), examenCtrl.updateExamen);
router.put ('/examens/:id/publier',              authenticate, requireRole('tuteur'), examenCtrl.publierExamen);
router.put ('/examens/:id/archiver',             authenticate, requireRole('tuteur'), examenCtrl.archiverExamen);

// Questions
router.post  ('/examens/:id/questions',                                  authenticate, requireRole('tuteur'), examenCtrl.addQuestion);
router.put   ('/examens/:examId/questions/:questionId',                  authenticate, requireRole('tuteur'), examenCtrl.updateQuestion);
router.delete('/examens/:examId/questions/:questionId',                  authenticate, requireRole('tuteur'), examenCtrl.deleteQuestion);

// Tentatives
router.post('/examens/:id/tentatives',           authenticate, examenCtrl.demarrerTentative);
router.get ('/examens/:id/tentatives',           authenticate, examenCtrl.getTentativesExamen);
router.get ('/examens/:id/mes-tentatives',       authenticate, examenCtrl.getMesTentativesExamen);
router.put ('/tentatives/:tentativeId/soumettre',authenticate, examenCtrl.soumettreReponses);
router.get ('/tentatives/:tentativeId/resultats',authenticate, examenCtrl.getResultatsTentative);

// Certificats
router.get('/certificats/mes-certificats',       authenticate, examenCtrl.mesCertificats);
router.get('/certificats/verifier/:numero',      examenCtrl.verifierCertificat); // public
router.put('/admin/certificats/:id/revoquer',    authenticate, requireRole('admin'), examenCtrl.revoquerCertificat);

module.exports = router;