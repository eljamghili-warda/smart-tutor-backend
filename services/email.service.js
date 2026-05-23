const nodemailer = require('nodemailer');

// Créer le transporteur SMTP
const createTransporter = () => {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Template HTML commun
const wrapTemplate = (contenu) => `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>SmartTutor</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background:#0f0f1a; color:#e2e8f0; }
    .wrapper { max-width:600px; margin:0 auto; padding:32px 16px; }
    .card { background:#1a1a2e; border:1px solid #2d2d4a; border-radius:16px; overflow:hidden; }
    .header { background:linear-gradient(135deg,#7c3aed,#4f46e5); padding:32px; text-align:center; }
    .logo { font-size:36px; margin-bottom:8px; }
    .brand { font-size:24px; font-weight:800; color:#fff; letter-spacing:-0.5px; }
    .tagline { font-size:13px; color:rgba(255,255,255,0.7); margin-top:4px; }
    .body { padding:32px; }
    .title { font-size:20px; font-weight:700; color:#fff; margin-bottom:8px; }
    .subtitle { font-size:14px; color:#94a3b8; margin-bottom:24px; }
    .box { background:#0f0f1a; border:1px solid #2d2d4a; border-radius:12px; padding:20px; margin:20px 0; }
    .row { display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #2d2d4a; }
    .row:last-child { border-bottom:none; }
    .label { font-size:13px; color:#64748b; }
    .value { font-size:13px; font-weight:600; color:#e2e8f0; }
    .total { background:linear-gradient(135deg,rgba(124,58,237,0.15),rgba(79,70,229,0.15)); border:1px solid rgba(124,58,237,0.3); border-radius:12px; padding:16px 20px; margin:20px 0; display:flex; justify-content:space-between; align-items:center; }
    .total-label { font-size:15px; font-weight:700; color:#a78bfa; }
    .total-value { font-size:22px; font-weight:800; color:#7c3aed; }
    .badge { display:inline-block; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700; }
    .badge-success { background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); }
    .badge-warning { background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); }
    .footer { text-align:center; padding:24px 32px; border-top:1px solid #2d2d4a; }
    .footer p { font-size:12px; color:#475569; line-height:1.6; }
    .footer a { color:#7c3aed; text-decoration:none; }
    .icon { font-size:40px; text-align:center; margin-bottom:12px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo">🎓</div>
        <div class="brand">SmartTutor</div>
        <div class="tagline">Plateforme de tutorat collaboratif</div>
      </div>
      <div class="body">${contenu}</div>
      <div class="footer">
        <p>Cet email a été envoyé automatiquement par SmartTutor.<br/>
        Pour toute question, contactez <a href="mailto:${process.env.SMTP_USER}">${process.env.SMTP_USER}</a></p>
      </div>
    </div>
  </div>
</body>
</html>
`;

// ── EMAIL 1 : Confirmation paiement (admin salle) ───────────────────────────
const sendConfirmationPaiementAdminSalle = async ({ to, nom, seance, salle, tuteur, paiement }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">✅</div>
    <div class="title">Paiement confirmé !</div>
    <div class="subtitle">Bonjour ${nom}, votre paiement a été traité avec succès.</div>
    
    <div class="box">
      <div class="row"><span class="label">Séance</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Salle</span><span class="value">${salle.nom}</span></div>
      <div class="row"><span class="label">Tuteur</span><span class="value">${tuteur.prenom} ${tuteur.nom}</span></div>
      <div class="row"><span class="label">Matière</span><span class="value">${seance.matiere || '—'}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${new Date(seance.date_debut).toLocaleString('fr-FR', { dateStyle:'full', timeStyle:'short' })}</span></div>
      <div class="row"><span class="label">Durée</span><span class="value">${seance.duree} minutes</span></div>
      <div class="row"><span class="label">Méthode</span><span class="value">${paiement.methode}</span></div>
      <div class="row"><span class="label">Référence</span><span class="value">${paiement.reference}</span></div>
    </div>

    <div class="total">
      <span class="total-label">💰 Montant payé</span>
      <span class="total-value">${paiement.montant_total} DH</span>
    </div>

    <p style="font-size:13px;color:#64748b;text-align:center;">
      La séance est maintenant <span class="badge badge-success">CONFIRMÉE</span>.<br/>
      Un rappel vous sera envoyé 1 heure avant le début.
    </p>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `✅ Paiement confirmé — ${seance.titre}`,
    html,
  });
};

// ── EMAIL 2 : Notification au tuteur ────────────────────────────────────────
const sendNotificationTuteur = async ({ to, nom, seance, salle, payeur, paiement }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">💸</div>
    <div class="title">Séance confirmée et payée !</div>
    <div class="subtitle">Bonjour ${nom}, une de vos séances vient d'être payée.</div>

    <div class="box">
      <div class="row"><span class="label">Séance</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Salle</span><span class="value">${salle.nom}</span></div>
      <div class="row"><span class="label">Payé par</span><span class="value">${payeur.prenom} ${payeur.nom}</span></div>
      <div class="row"><span class="label">Matière</span><span class="value">${seance.matiere || '—'}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${new Date(seance.date_debut).toLocaleString('fr-FR', { dateStyle:'full', timeStyle:'short' })}</span></div>
      <div class="row"><span class="label">Durée</span><span class="value">${seance.duree} minutes</span></div>
    </div>

    <div class="total">
      <span class="total-label">🎉 Votre gain</span>
      <span class="total-value">${paiement.gain_tuteur} DH</span>
    </div>

    <p style="font-size:12px;color:#64748b;text-align:center;">
      Commission plateforme : ${paiement.commission_plateforme} DH (15%)<br/>
      Montant total réglé : ${paiement.montant_total} DH
    </p>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `💰 Séance payée — ${seance.titre}`,
    html,
  });
};

// ── EMAIL 3 : Confirmation remboursement ─────────────────────────────────────
const sendConfirmationRemboursement = async ({ to, nom, seance, paiement }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">↩️</div>
    <div class="title">Remboursement effectué</div>
    <div class="subtitle">Bonjour ${nom}, votre remboursement a été traité.</div>

    <div class="box">
      <div class="row"><span class="label">Séance annulée</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Date d'annulation</span><span class="value">${new Date().toLocaleString('fr-FR')}</span></div>
      <div class="row"><span class="label">Référence paiement</span><span class="value">${paiement.reference}</span></div>
    </div>

    <div class="total">
      <span class="total-label">💳 Montant remboursé</span>
      <span class="total-value">${paiement.montant_total} DH</span>
    </div>

    <p style="font-size:13px;color:#64748b;text-align:center;">
      Le remboursement sera crédité sur votre compte d'ici 3-5 jours ouvrables.
    </p>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `↩️ Remboursement — ${seance.titre}`,
    html,
  });
};

// ── EMAIL 4 (bis) : Notification admin plateforme — paiement reçu ────────────
const sendNotificationAdminPlateforme = async ({ to, seance, salle, tuteur, payeur, paiement }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">🛡️</div>
    <div class="title">Nouveau paiement reçu</div>
    <div class="subtitle">Un paiement vient d'être effectué sur la plateforme SmartTutor.</div>

    <div class="box">
      <div class="row"><span class="label">Référence</span><span class="value" style="font-family:monospace">${paiement.reference}</span></div>
      <div class="row"><span class="label">Séance</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Salle</span><span class="value">${salle.nom}</span></div>
      <div class="row"><span class="label">Tuteur</span><span class="value">${tuteur.prenom} ${tuteur.nom} &lt;${tuteur.email}&gt;</span></div>
      <div class="row"><span class="label">Payeur</span><span class="value">${payeur.prenom} ${payeur.nom} &lt;${payeur.email}&gt;</span></div>
      <div class="row"><span class="label">Méthode</span><span class="value">${paiement.methode}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${new Date(paiement.date_paiement).toLocaleString('fr-FR')}</span></div>
    </div>

    <div class="box" style="margin-top:0">
      <div class="row"><span class="label">Montant total</span><span class="value">${paiement.montant_total} DH</span></div>
      <div class="row"><span class="label">Gain tuteur (85%)</span><span class="value">${paiement.gain_tuteur} DH</span></div>
      <div class="row" style="border-bottom:none"><span class="label">Commission plateforme (15%)</span><span class="value" style="color:#7c3aed;font-weight:800">${paiement.commission_plateforme} DH</span></div>
    </div>

    <div class="total">
      <span class="total-label">💰 Commission encaissée</span>
      <span class="total-value">${paiement.commission_plateforme} DH</span>
    </div>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `🛡️ Paiement reçu — ${paiement.reference} — ${paiement.montant_total} DH`,
    html,
  });
};

// ── EMAIL 4 : Notification annulation au tuteur ──────────────────────────────
const sendAnnulationTuteur = async ({ to, nom, seance, motif }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">❌</div>
    <div class="title">Séance annulée</div>
    <div class="subtitle">Bonjour ${nom}, une séance que vous animiez a été annulée.</div>

    <div class="box">
      <div class="row"><span class="label">Séance</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Date prévue</span><span class="value">${new Date(seance.date_debut).toLocaleString('fr-FR', { dateStyle:'full', timeStyle:'short' })}</span></div>
      ${motif ? `<div class="row"><span class="label">Motif</span><span class="value">${motif}</span></div>` : ''}
    </div>

    <p style="font-size:13px;color:#64748b;text-align:center;">
      Le remboursement a été initié automatiquement pour l'admin de la salle.
    </p>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `❌ Séance annulée — ${seance.titre}`,
    html,
  });
};

module.exports = {
  sendConfirmationPaiementAdminSalle,
  sendNotificationTuteur,
  sendConfirmationRemboursement,
  sendAnnulationTuteur,
  sendNotificationAdminPlateforme,
  sendCertificatEmail,
  sendNotifTuteurCertificat,
};

// ── EMAIL 5 : Certificat à l'étudiant ─────────────────────────────────────────
async function sendCertificatEmail({ to, nom, examenTitre, sallenom, numeroCert, score, tuteurNom }) {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">🏆</div>
    <div class="title">Félicitations, ${nom} !</div>
    <div class="subtitle">Vous avez réussi l'examen et obtenu votre certificat SmartTutor.</div>
    <div class="box">
      <div class="row"><span class="label">Examen</span><span class="value">${examenTitre}</span></div>
      <div class="row"><span class="label">Salle</span><span class="value">${sallenom}</span></div>
      <div class="row"><span class="label">Tuteur</span><span class="value">${tuteurNom}</span></div>
      <div class="row" style="border-bottom:none"><span class="label">Score</span><span class="value" style="color:#7c3aed;font-weight:800">${score}%</span></div>
    </div>
    <div class="total">
      <span class="total-label">🎓 Numéro de certificat</span>
      <span class="total-value" style="font-family:monospace;font-size:18px">${numeroCert}</span>
    </div>
    <p style="text-align:center;color:#64748b;font-size:13px;margin-top:16px">
      Vérifiez votre certificat en ligne : <strong>/api/certificats/verifier/${numeroCert}</strong>
    </p>
  `);
  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `🏆 Certificat obtenu — ${examenTitre}`,
    html,
  });
}

// ── EMAIL 6 : Notification tuteur — certificat émis ──────────────────────────
async function sendNotifTuteurCertificat({ to, tuteurNom, etudiantNom, examenTitre, score, numeroCert }) {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">📋</div>
    <div class="title">Nouveau certificat émis</div>
    <div class="subtitle">Un de vos étudiants a validé votre examen.</div>
    <div class="box">
      <div class="row"><span class="label">Étudiant</span><span class="value">${etudiantNom}</span></div>
      <div class="row"><span class="label">Examen</span><span class="value">${examenTitre}</span></div>
      <div class="row" style="border-bottom:none"><span class="label">Score</span><span class="value" style="color:#7c3aed;font-weight:800">${score}%</span></div>
    </div>
    <div class="total">
      <span class="total-label">Numéro certificat</span>
      <span class="total-value" style="font-family:monospace">${numeroCert}</span>
    </div>
  `);
  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `📋 Certificat émis — ${etudiantNom} — ${examenTitre}`,
    html,
  });
}