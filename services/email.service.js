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
const sendConfirmationPaiementAdminSalle = async ({ to, nom, seance, salle, tuteur, paiement, escrow }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">✅</div>
    <div class="title">Paiement confirmé !</div>
    <div class="subtitle">Bonjour ${nom}, votre paiement de ${paiement.montant_total} DH a été enregistré avec succès.</div>

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

    <div class="box" style="background:#eff6ff;border-color:#bfdbfe;margin-top:0">
      <div class="row" style="border:none;flex-direction:column;gap:6px">
        <span style="font-size:13px;font-weight:700;color:#1d4ed8">🔒 Fonds en sécurité (Escrow)</span>
        <span style="font-size:12px;color:#3b82f6">
          Votre paiement est conservé par SmartEdu jusqu'à la réalisation de la séance.<br/>
          Si la séance est annulée par le tuteur, vous serez remboursé à 100%.
        </span>
      </div>
    </div>

    <div class="total">
      <span class="total-label">💰 Montant sécurisé</span>
      <span class="total-value">${paiement.montant_total} DH</span>
    </div>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `✅ Paiement confirmé — ${seance.titre} — ${paiement.montant_total} DH`,
    html,
  });
};

// ── EMAIL 2 : Notification au tuteur ────────────────────────────────────────
const sendNotificationTuteur = async ({ to, nom, seance, salle, payeur, paiement, gainTuteur, escrow }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">📚</div>
    <div class="title">Nouvelle séance confirmée !</div>
    <div class="subtitle">Bonjour ${nom}, votre séance a été réservée et payée par l'admin de salle.</div>

    <div class="box">
      <div class="row"><span class="label">Séance</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Salle</span><span class="value">${salle.nom}</span></div>
      <div class="row"><span class="label">Réservé par</span><span class="value">${payeur.prenom} ${payeur.nom}</span></div>
      <div class="row"><span class="label">Matière</span><span class="value">${seance.matiere || '—'}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${new Date(seance.date_debut).toLocaleString('fr-FR', { dateStyle:'full', timeStyle:'short' })}</span></div>
      <div class="row"><span class="label">Durée</span><span class="value">${seance.duree} minutes</span></div>
      <div class="row"><span class="label">Référence</span><span class="value">${paiement.reference}</span></div>
    </div>

    <div class="box" style="background:#f0fdf4;border-color:#bbf7d0;margin-top:0">
      <div class="row"><span class="label">Montant total</span><span class="value">${paiement.montant_total} DH</span></div>
      <div class="row" style="border:none"><span class="label">Votre rémunération (85%)</span><span class="value" style="color:#16a34a;font-weight:800">${gainTuteur || paiement.gain_tuteur} DH</span></div>
    </div>

    <div class="box" style="background:#eff6ff;border-color:#bfdbfe;margin-top:0">
      <div class="row" style="border:none;flex-direction:column;gap:4px">
        <span style="font-size:12px;font-weight:700;color:#1d4ed8">⏳ Versement après réalisation</span>
        <span style="font-size:12px;color:#3b82f6">
          Votre rémunération de ${gainTuteur || paiement.gain_tuteur} DH sera versée automatiquement
          après la réalisation de la séance.
        </span>
      </div>
    </div>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `📚 Séance confirmée — ${seance.titre}`,
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


// ── EMAIL : Virement au tuteur après réalisation ─────────────────────────────
const sendVirementTuteur = async ({ to, nom, seance, gainTuteur, reference, rib }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">🎉</div>
    <div class="title">Paiement versé !</div>
    <div class="subtitle">Bonjour ${nom}, votre séance a été réalisée avec succès.</div>

    <div class="box">
      <div class="row"><span class="label">Séance réalisée</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${new Date(seance.date_debut).toLocaleString('fr-FR', { dateStyle:'full', timeStyle:'short' })}</span></div>
      <div class="row"><span class="label">Référence</span><span class="value" style="font-family:monospace">${reference}</span></div>
      ${rib ? `<div class="row"><span class="label">RIB crédité</span><span class="value">${rib}</span></div>` : ''}
    </div>

    <div class="total">
      <span class="total-label">💰 Montant versé</span>
      <span class="total-value">${gainTuteur} DH</span>
    </div>

    <p style="font-size:13px;color:#64748b;text-align:center;">
      Votre rémunération a été transférée sur votre compte bancaire.<br/>
      Merci pour votre contribution à SmartEdu !
    </p>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `💰 Paiement versé — ${gainTuteur} DH — ${seance.titre}`,
    html,
  });
};

// ── EMAIL : Admin salle — séance réalisée ────────────────────────────────────
const sendSeanceRealiseeAdmin = async ({ to, nom, seance, tuteur, montantTotal, gainTuteur, commission, reference }) => {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">✅</div>
    <div class="title">Séance réalisée avec succès</div>
    <div class="subtitle">Bonjour ${nom}, la séance s'est déroulée et le paiement a été libéré.</div>

    <div class="box">
      <div class="row"><span class="label">Séance</span><span class="value">${seance.titre}</span></div>
      <div class="row"><span class="label">Tuteur</span><span class="value">${tuteur.prenom} ${tuteur.nom}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${new Date(seance.date_debut).toLocaleString('fr-FR', { dateStyle:'full', timeStyle:'short' })}</span></div>
      <div class="row"><span class="label">Référence</span><span class="value" style="font-family:monospace">${reference}</span></div>
    </div>

    <div class="box" style="margin-top:0">
      <div class="row"><span class="label">Montant total payé</span><span class="value">${montantTotal} DH</span></div>
      <div class="row"><span class="label">Versé au tuteur (85%)</span><span class="value">${gainTuteur} DH</span></div>
      <div class="row" style="border:none"><span class="label">Commission SmartEdu (15%)</span><span class="value" style="color:#7c3aed;font-weight:800">${commission} DH</span></div>
    </div>

    <p style="font-size:13px;color:#64748b;text-align:center;">
      La séance est maintenant clôturée. Merci d'utiliser SmartEdu !
    </p>
  `);

  await transporter.sendMail({
    from: `"SmartTutor" <${process.env.SMTP_USER}>`,
    to,
    subject: `✅ Séance réalisée — paiement libéré — ${seance.titre}`,
    html,
  });
};

module.exports = {
  sendConfirmationPaiementAdminSalle,
  sendNotificationTuteur,
  sendConfirmationRemboursement,
  sendAnnulationTuteur,
  sendNotificationAdminPlateforme,
  sendVirementTuteur,
  sendSeanceRealiseeAdmin,
  sendCertificatEmail,
  sendNotifTuteurCertificat,
};

// ── EMAIL 5 : Certificat à l'étudiant (PDF en pièce jointe directe) ──
async function sendCertificatEmail({ to, nom, examenTitre, sallenom, numeroCert, score, tuteurNom, pdfPath }) {
  const transporter = createTransporter();
  const verifyUrl   = `${process.env.APP_URL || 'http://localhost:5173'}/certificats/verifier/${numeroCert}`;

  const html = wrapTemplate(`
    <div class="icon">🏆</div>
    <div class="title">Félicitations ${nom} !</div>
    <div class="subtitle">Vous avez réussi l'examen et obtenu votre certificat SmartEdu.</div>

    <div class="box">
      <div class="row"><span class="label">Examen</span><span class="value">${examenTitre}</span></div>
      <div class="row"><span class="label">Salle</span><span class="value">${sallenom || '—'}</span></div>
      <div class="row"><span class="label">Tuteur</span><span class="value">${tuteurNom || '—'}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${new Date().toLocaleDateString('fr-FR')}</span></div>
    </div>

    <div class="total">
      <span class="total-label">🎓 Numéro de certificat</span>
      <span class="total-value" style="font-size:14px;font-family:monospace">${numeroCert}</span>
    </div>

    <!-- Note pièce jointe PDF -->
    <div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:12px;padding:14px 18px;margin:20px 0;text-align:center">
      <p style="margin:0;font-size:13px;color:#1D4ED8;font-weight:700">
        📎 Votre certificat PDF est joint à cet email
      </p>
      <p style="margin:6px 0 0;font-size:12px;color:#3B82F6">
        Ouvrez la pièce jointe pour télécharger et partager votre certificat.
      </p>
    </div>

    <p style="font-size:12px;color:#64748b;text-align:center">
      Score obtenu : <strong>${score}%</strong><br/>
      Vous pouvez vérifier l'authenticité de votre certificat sur notre site.
    </p>
  `);

  // Pièce jointe PDF directe
  const attachments = [];
  if (pdfPath && fs.existsSync(pdfPath)) {
    attachments.push({
      filename: `Certificat-SmartEdu-${numeroCert}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf',
    });
  }

  await transporter.sendMail({
    from: `"SmartEdu" <${process.env.SMTP_USER}>`,
    to,
    subject: `🏆 Certificat SmartEdu — ${examenTitre}`,
    html,
    attachments,
  });
}

// ── EMAIL 6 : Notification tuteur — certificat émis ──────────────────────────
async function sendNotifTuteurCertificat({ to, tuteurNom, etudiantNom, examenTitre, score, numeroCert }) {
  const transporter = createTransporter();
  const html = wrapTemplate(`
    <div class="icon">📋</div>
    <div class="title">Nouveau certificat émis</div>
    <div class="subtitle">Un de vos étudiants a validé votre examen avec succès.</div>
    <div class="box">
      <div class="row"><span class="label">Étudiant</span><span class="value">${etudiantNom}</span></div>
      <div class="row"><span class="label">Examen</span><span class="value">${examenTitre}</span></div>
      <div class="row" style="border-bottom:none">
        <span class="label">Score obtenu</span>
        <span class="value" style="color:#7c3aed;font-weight:800">${score}%</span>
      </div>
    </div>
    <div class="total">
      <span class="total-label">Numéro certificat</span>
      <span class="total-value" style="font-family:monospace">${numeroCert}</span>
    </div>
  `);
  await transporter.sendMail({
    from: `"SmartEdu" <${process.env.SMTP_USER}>`,
    to,
    subject: `📋 Certificat émis — ${etudiantNom} — ${examenTitre}`,
    html,
  });
}