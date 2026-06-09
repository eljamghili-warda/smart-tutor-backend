// Script de test à lancer depuis le dossier backend :
// node test_email_realisation.js <seance_id>
//
// Il simule exactement ce qui se passe quand une séance devient REALISEE

require('dotenv').config();
const { pool } = require('./config/db');
const emailService = require('./services/email.service');
const { libererFonds } = require('./controllers/paiement.controller');

const seanceId = process.argv[2];
if (!seanceId) {
  console.error('Usage: node test_email_realisation.js <seance_id>');
  process.exit(1);
}

async function main() {
  console.log(`\n🔍 Diagnostic email réalisation pour séance ${seanceId}\n`);

  // 1. Vérifier la séance
  const seanceRes = await pool.query(
    `SELECT s.*, sa.nom as salle_nom
     FROM seances s JOIN salles sa ON s.salle_id = sa.id
     WHERE s.id = $1`, [seanceId]
  );
  if (!seanceRes.rows.length) { console.error('❌ Séance introuvable'); process.exit(1); }
  const seance = seanceRes.rows[0];
  console.log(`✅ Séance: "${seance.titre}" | statut: ${seance.statut} | statut_paiement: ${seance.statut_paiement}`);

  // 2. Vérifier le paiement
  const paiRes = await pool.query(
    `SELECT p.*, ut.email as tuteur_email, up.email as payeur_email
     FROM paiements p
     LEFT JOIN utilisateurs ut ON p.tuteur_id = ut.id
     LEFT JOIN utilisateurs up ON p.payeur_id = up.id
     WHERE p.seance_id = $1`, [seanceId]
  );
  if (!paiRes.rows.length) {
    console.error('❌ Aucun paiement pour cette séance — emails impossibles');
    process.exit(1);
  }
  const pai = paiRes.rows[0];
  console.log(`✅ Paiement: statut=${pai.statut} | tuteur_email=${pai.tuteur_email} | payeur_email=${pai.payeur_email} | gain_tuteur=${pai.gain_tuteur}`);

  // 3. Tester SMTP directement
  console.log(`\n📧 Test envoi email tuteur → ${pai.tuteur_email}`);
  try {
    await emailService.sendVirementTuteur({
      to: pai.tuteur_email,
      nom: 'Test Tuteur',
      seance: { titre: seance.titre, date_debut: seance.date_debut },
      gainTuteur: pai.gain_tuteur,
      reference: pai.reference || 'TEST-REF',
      rib: null,
    });
    console.log(`✅ Email tuteur envoyé avec succès !`);
  } catch (err) {
    console.error(`❌ Erreur email tuteur:`, err.message);
    console.error(`   → Vérifiez SMTP_HOST, SMTP_USER, SMTP_PASS dans .env`);
  }

  console.log(`\n📧 Test envoi email admin → ${pai.payeur_email}`);
  try {
    await emailService.sendSeanceRealiseeAdmin({
      to: pai.payeur_email,
      nom: 'Test Admin',
      seance: { titre: seance.titre, date_debut: seance.date_debut },
      tuteur: { prenom: 'Tuteur', nom: 'Test' },
      montantTotal: pai.montant_total,
      gainTuteur: pai.gain_tuteur,
      commission: pai.commission_plateforme,
      reference: pai.reference || 'TEST-REF',
    });
    console.log(`✅ Email admin envoyé avec succès !`);
  } catch (err) {
    console.error(`❌ Erreur email admin:`, err.message);
  }

  // 4. Test libererFonds complet
  console.log(`\n🔧 Test libererFonds...`);
  // Mettre paiement en état attendu
  await pool.query(
    `UPDATE paiements SET statut='EN_ATTENTE_LIBERATION' WHERE seance_id=$1 AND statut IN ('COMPLETE','EN_ATTENTE_LIBERATION')`,
    [seanceId]
  );
  const result = await libererFonds(seanceId);
  if (result) {
    console.log(`✅ libererFonds OK — gain tuteur: ${result.gain_tuteur} DH`);
  } else {
    console.error(`❌ libererFonds a retourné null`);
  }

  await pool.end();
}

main().catch(err => { console.error('Erreur fatale:', err); process.exit(1); });