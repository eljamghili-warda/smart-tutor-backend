const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

// Chercher le logo dans plusieurs emplacements possibles
const LOGO_PATHS = [
  path.join(__dirname, '..', 'assets', 'logo.png'),           // backend/assets/logo.png
  path.join(__dirname, '..', 'uploads', 'logo.png'),           // backend/uploads/logo.png
  path.join(__dirname, '..', '..', 'SmartTutorFrontend', 'public', 'logo.png'), // ../frontend/public/logo.png
  path.join(__dirname, '..', '..', 'frontend', 'public', 'logo.png'),
  path.join(__dirname, '..', '..', 'client', 'public', 'logo.png'),
];
const LOGO_PATH = LOGO_PATHS.find(p => fs.existsSync(p)) || null;

/**
 * Génère un certificat PDF style Udemy/Google
 */
async function genererCertificatPDF(opts) {
  const {
    numeroCert,
    etudiantPrenom = '', etudiantNom = '',
    examenTitre   = '',
    salleNom      = '', matiere = '',
    tuteurNom     = '',
    scoreObtenu   = 0,
    nbSeances     = 0,
    dureeTotaleMin = 0,
    dateEmission  = new Date(),
  } = opts;

  const dir = path.join(__dirname, '..', 'uploads', 'certificats');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${numeroCert}.pdf`;
  const filepath = path.join(dir, filename);
  const urlPath  = `/uploads/certificats/${filename}`;

  // Formatages
  const nomComplet = `${etudiantPrenom} ${etudiantNom}`.trim();
  const scoreStr   = parseFloat(scoreObtenu).toFixed(1) + '%';
  const dateStr    = new Date(dateEmission).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const heures    = Math.floor(dureeTotaleMin / 60);
  const mins      = dureeTotaleMin % 60;
  const dureeStr  = heures > 0
    ? `${heures} heure${heures > 1 ? 's' : ''}${mins > 0 ? ` ${mins} min` : ''}`
    : dureeTotaleMin > 0 ? `${dureeTotaleMin} minutes` : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const W = doc.page.width;   // 841.89
    const H = doc.page.height;  // 595.28

    // ══════════════════════════════════════════════
    // FOND BLANC pur
    // ══════════════════════════════════════════════
    doc.rect(0, 0, W, H).fill('#FFFFFF');

    // ══════════════════════════════════════════════
    // BANDE BLEUE gauche (signature Udemy/Google)
    // ══════════════════════════════════════════════
    doc.rect(0, 0, 8, H).fill('#1565C0');

    // ══════════════════════════════════════════════
    // BANDE CYAN en bas
    // ══════════════════════════════════════════════
    doc.rect(0, H - 6, W, 6).fill('#00ACC1');

    // Ligne fine déco sous la bande bleue gauche
    doc.rect(8, 0, 2, H).fill('#E3F2FD');

    // ══════════════════════════════════════════════
    // HEADER : LOGO + Nom plateforme
    // ══════════════════════════════════════════════
    const padL = 40;
    const logoY = 28;

    if (LOGO_PATH) {
      try {
        doc.image(LOGO_PATH, padL, logoY, { height: 52, fit: [52, 52] });
      } catch (_) {}
    }

    // "SmartEdu"
    doc.font('Helvetica-Bold').fontSize(22)
       .fillColor('#1565C0')
       .text('SmartEdu', padL + 60, logoY + 8);

    // "Apprendre Ensemble"
    doc.font('Helvetica').fontSize(10)
       .fillColor('#00ACC1')
       .text('Apprendre Ensemble', padL + 60, logoY + 34);

    // Ligne séparatrice header
    doc.moveTo(padL, logoY + 58)
       .lineTo(W - padL, logoY + 58)
       .lineWidth(0.8).strokeColor('#E0E0E0').stroke();

    // ══════════════════════════════════════════════
    // TITRE "CERTIFICAT DE RÉUSSITE"
    // ══════════════════════════════════════════════
    doc.font('Helvetica').fontSize(11)
       .fillColor('#757575')
       .text('CERTIFICAT DE RÉUSSITE', padL, 108, { characterSpacing: 3 });

    // ══════════════════════════════════════════════
    // "Ce certificat est décerné à"
    // ══════════════════════════════════════════════
    doc.font('Helvetica').fontSize(13)
       .fillColor('#424242')
       .text('Ce certificat est décerné à', padL, 138);

    // ══════════════════════════════════════════════
    // NOM ÉTUDIANT — très grand, signature du certificat
    // ══════════════════════════════════════════════
    doc.font('Helvetica-Bold').fontSize(42)
       .fillColor('#0D47A1')
       .text(nomComplet, padL, 160, { lineBreak: false });

    // Ligne de signature sous le nom (style manuscrit)
    const nameWidth = Math.min(doc.widthOfString(nomComplet, { fontSize: 42 }), W - padL*2 - 50);
    const nameLineY = 215;
    doc.moveTo(padL, nameLineY)
       .lineTo(padL + nameWidth + 10, nameLineY)
       .lineWidth(1.5).strokeColor('#1565C0').stroke();

    // ══════════════════════════════════════════════
    // "pour avoir complété avec succès"
    // ══════════════════════════════════════════════
    doc.font('Helvetica').fontSize(13)
       .fillColor('#424242')
       .text('pour avoir complété avec succès', padL, 228);

    // ══════════════════════════════════════════════
    // NOM DU COURS — bien mis en valeur
    // ══════════════════════════════════════════════
    const coursY = 252;
    doc.font('Helvetica-Bold').fontSize(18)
       .fillColor('#212121')
       .text(examenTitre, padL, coursY, { width: W - padL*2 - 50 });

    // Sous-titre matière/formation
    const sousTitre = [matiere, salleNom].filter(Boolean).join(' · ');
    if (sousTitre) {
      doc.font('Helvetica').fontSize(11)
         .fillColor('#00838F')
         .text(sousTitre, padL, coursY + 28);
    }

    // ══════════════════════════════════════════════
    // INFOS EN BAS À GAUCHE : durée + séances
    // ══════════════════════════════════════════════
    const infoY = 315;

    if (dureeStr) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#212121')
         .text(dureeStr, padL, infoY);
      doc.font('Helvetica').fontSize(9).fillColor('#9E9E9E')
         .text('Durée totale du cours', padL, infoY + 16);
    }

    if (nbSeances > 0) {
      const col2 = padL + 130;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#212121')
         .text(`${nbSeances} séance${nbSeances > 1 ? 's' : ''}`, col2, infoY);
      doc.font('Helvetica').fontSize(9).fillColor('#9E9E9E')
         .text('Séances réalisées', col2, infoY + 16);
    }

    // Score
    const col3 = padL + (nbSeances > 0 ? 280 : 130);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1565C0')
       .text(scoreStr, col3, infoY);
    doc.font('Helvetica').fontSize(9).fillColor('#9E9E9E')
       .text('Score obtenu', col3, infoY + 16);

    // ══════════════════════════════════════════════
    // LIGNE SÉPARATRICE FOOTER
    // ══════════════════════════════════════════════
    const footerY = H - 95;
    doc.moveTo(padL, footerY)
       .lineTo(W - padL, footerY)
       .lineWidth(0.5).strokeColor('#E0E0E0').stroke();

    // ══════════════════════════════════════════════
    // FOOTER : DATE | TUTEUR | N° CERTIFICAT
    // ══════════════════════════════════════════════
    const fY = footerY + 14;
    const colDate   = padL;
    const colTuteur = W / 2 - 80;
    const colNum    = W - padL - 180;

    // Date
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#212121')
       .text(dateStr, colDate, fY);
    doc.font('Helvetica').fontSize(8).fillColor('#9E9E9E')
       .text("Date d'obtention", colDate, fY + 17);
    doc.moveTo(colDate, fY + 10)
       .lineTo(colDate + 110, fY + 10)
       .lineWidth(0.5).strokeColor('#BDBDBD').stroke();

    // Signature tuteur
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#212121')
       .text(tuteurNom, colTuteur, fY, { width: 200 });
    doc.font('Helvetica').fontSize(8).fillColor('#9E9E9E')
       .text('Instructeur certifié', colTuteur, fY + 17);
    doc.moveTo(colTuteur, fY + 10)
       .lineTo(colTuteur + 160, fY + 10)
       .lineWidth(0.5).strokeColor('#BDBDBD').stroke();

    // Numéro certificat
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#757575')
       .text(numeroCert, colNum, fY);
    doc.font('Helvetica').fontSize(7.5).fillColor('#BDBDBD')
       .text('Numéro de certificat', colNum, fY + 17);

    // ══════════════════════════════════════════════
    // MÉDAILLE / BADGE en haut à droite
    // ══════════════════════════════════════════════
    const badgeX = W - 105;
    const badgeY = 40;
    const R = 38;

    // Cercle extérieur doré
    doc.circle(badgeX, badgeY + R, R + 6)
       .lineWidth(3).strokeColor('#FFC107').stroke();
    // Cercle intérieur bleu
    doc.circle(badgeX, badgeY + R, R)
       .fill('#1565C0');
    // Étoile / check blanc
    doc.font('Helvetica-Bold').fontSize(28)
       .fillColor('#FFFFFF')
       .text('✓', badgeX - 13, badgeY + R - 17);
    // "RÉUSSI" sous le badge
    doc.font('Helvetica-Bold').fontSize(8)
       .fillColor('#1565C0')
       .text('RÉUSSI', badgeX - 16, badgeY + R * 2 + 10, { characterSpacing: 1 });

    doc.end();
    stream.on('finish', () => resolve(urlPath));
    stream.on('error', reject);
  });
}

module.exports = { genererCertificatPDF };