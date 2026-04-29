const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireActiveTuteur } = require('../middleware/auth');

// Auth
const authCtrl = require('../controllers/auth.controller');
router.post('/auth/register', authCtrl.register);
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', authenticate, authCtrl.getMe);
router.put('/auth/profile', authenticate, authCtrl.updateProfile);

// Salles
const salleCtrl = require('../controllers/salle.controller');
router.get('/salles', authenticate, salleCtrl.getSalles);
router.get('/salles/mes-salles', authenticate, salleCtrl.getMesSalles);
router.post('/salles', authenticate, requireRole('etudiant', 'admin'), salleCtrl.createSalle);
router.get('/salles/:id', authenticate, salleCtrl.getSalle);
router.post('/salles/:id/rejoindre', authenticate, requireActiveTuteur, salleCtrl.rejoindreSalle);
router.delete('/salles/:id/quitter', authenticate, salleCtrl.quitterSalle);
router.get('/salles/:id/participants', authenticate, salleCtrl.getParticipants);
router.get('/salles/:id/messages', authenticate, salleCtrl.getMessages);
router.get('/salles/:id/fichiers', authenticate, salleCtrl.getFichiers);
router.post('/salles/:id/fichiers', authenticate, salleCtrl.uploadFichier);

// Invitations
const invitCtrl = require('../controllers/invitation.controller');
router.get('/invitations', authenticate, invitCtrl.getMesInvitations);
router.post('/invitations', authenticate, invitCtrl.sendInvitation);
router.put('/invitations/:id/accepter', authenticate, invitCtrl.accepterInvitation);
router.put('/invitations/:id/refuser', authenticate, invitCtrl.refuserInvitation);

// Séances
const seanceCtrl = require('../controllers/seance.controller');
router.get('/seances', authenticate, seanceCtrl.getSeances);
router.get('/seances/emploi-du-temps', authenticate, seanceCtrl.getEmploiDuTemps);
router.post('/seances', authenticate, requireRole('tuteur'), seanceCtrl.createSeance);
router.post('/seances/:id/lancer', authenticate, requireRole('tuteur'), seanceCtrl.lancerSeance);
router.post('/seances/:id/terminer', authenticate, requireRole('tuteur'), seanceCtrl.terminerSeance);
router.put('/seances/:id/annuler', authenticate, requireRole('tuteur'), seanceCtrl.annulerSeance);
router.get('/seances/disponibilites', authenticate, seanceCtrl.getDisponibilites);
router.post('/seances/disponibilites', authenticate, requireRole('tuteur'), seanceCtrl.setDisponibilite);

// Tuteurs
const tuteurCtrl = require('../controllers/tuteur.controller');
router.get('/tuteurs', authenticate, tuteurCtrl.getTuteurs);
router.get('/tuteurs/:id', authenticate, tuteurCtrl.getTuteur);

// Evaluations
const evalCtrl = require('../controllers/evaluation.controller');
router.post('/evaluations', authenticate, requireRole('etudiant'), evalCtrl.createEvaluation);
router.get('/evaluations/tuteur/:id', authenticate, evalCtrl.getEvaluationsTuteur);

// Admin
const adminCtrl = require('../controllers/admin.controller');
router.get('/admin/stats', authenticate, requireRole('admin'), adminCtrl.getStats);
router.get('/admin/utilisateurs', authenticate, requireRole('admin'), adminCtrl.getUtilisateurs);
router.put('/admin/utilisateurs/:id/bloquer', authenticate, requireRole('admin'), adminCtrl.bloquerUtilisateur);
router.delete('/admin/utilisateurs/:id', authenticate, requireRole('admin'), adminCtrl.supprimerUtilisateur);
router.get('/admin/tuteurs/pending', authenticate, requireRole('admin'), adminCtrl.getTuteursPending);
router.put('/admin/tuteurs/:id/valider', authenticate, requireRole('admin'), adminCtrl.validerTuteur);
router.get('/admin/salles', authenticate, requireRole('admin'), adminCtrl.getSallesAdmin);
router.put('/admin/salles/:id/fermer', authenticate, requireRole('admin'), adminCtrl.fermerSalle);
router.get('/admin/seances', authenticate, requireRole('admin'), adminCtrl.getSeancesAdmin);

module.exports = router;