const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ─── RECHERCHE DU LOGO (priorité haute) ─────────────────────────────
const LOGO_PATHS = [
  path.join(__dirname, '..', 'assets', 'logo.png'),
  path.join(__dirname, '..', 'uploads', 'logo.png'),
  path.join(__dirname, '..', '..', 'SmartTutorFrontend', 'public', 'logo.png'),
  path.join(__dirname, '..', '..', 'frontend', 'public', 'logo.png'),
  path.join(__dirname, '..', '..', 'client', 'public', 'logo.png'),
];
const LOGO_PATH = LOGO_PATHS.find(p => fs.existsSync(p)) || null;

// ─── PALETTE PROFESSIONNELLE ÉLÉGANTE (Bleu + Marron/Doré) ──────────
const C = {
  // Fond du certificat - beige/ivoire chaleureux
  pageBg:    '#F5F0E6',      // Ivoire élégant (type parchemin)
  cardBg:    '#FFFFFF',      // Blanc pur pour contraste
  
  // Bleus professionnels (comme les grandes plateformes éducatives)
  blueDeep:  '#1A3A5C',      // Bleu profond - titres principaux
  blueSky:   '#4A90E2',      // Bleu ciel - accents modernes
  blueDark:  '#0F2A3B',      // Bleu nuit - textes importants
  blueLight: '#D6E6F5',      // Bleu très clair - fonds subtils
  blueMid:   '#2C5F8A',      // Bleu moyen - éléments secondaires
  
  // Doré / Or (prestige et valeur)
  gold:      '#C5A059',      // Doré principal
  goldLight: '#E8D5A3',      // Doré clair
  goldDark:  '#8B6914',      // Doré foncé / marron doré
  goldShine: '#F0E0B0',      // Doré très clair (effet brillant)
  
  // Marron (chaleur et authenticité)
  brown:     '#8B6914',      // Marron doré
  brownLight:'#A0894A',      // Marron clair
  brownDark: '#5C4033',      // Marron foncé
  
  // Neutres
  dark:      '#0F2A3B',      // Bleu nuit pour textes
  gray:      '#6B7B8D',      // Gris bleuté subtil
  grayLight: '#B0C4DE',      // Gris bleu clair
  white:     '#FFFFFF',
};

// ─── FONCTIONS UTILITAIRES ─────────────────────────────────────────
function formatDate(date) {
  const d = new Date(date);
  const day = d.getDate();
  const sfx = (day >= 11 && day <= 13) ? 'th' : ({1:'st',2:'nd',3:'rd'}[day % 10] || 'th');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${day}${sfx} of ${months[d.getMonth()]}, ${d.getFullYear()}`;
}

// ─── DESSINER UN CADRE DÉCORATIF ÉLÉGANT ────────────────────────────
function drawElegantBorder(doc, W, H) {
  const margin = 28;
  const innerMargin = 35;
  
  // Bordure extérieure (dorée)
  doc.rect(margin, margin, W - margin * 2, H - margin * 2)
     .lineWidth(2.5)
     .strokeColor(C.gold)
     .stroke();
  
  // Bordure intérieure (dorée clair + double trait)
  doc.rect(innerMargin, innerMargin, W - innerMargin * 2, H - innerMargin * 2)
     .lineWidth(1)
     .strokeColor(C.goldLight)
     .stroke();
  
  // Décoration d'angle - coins arrondis dorés (effet premium)
  const cornerSize = 42;
  const cornerGap = 32;
  
  // Coin haut-gauche
  doc.save();
  doc.lineWidth(2.5).strokeColor(C.gold);
  for (let i = 0; i < 3; i++) {
    const offset = cornerGap + (i * 12);
    const size = cornerSize - (i * 8);
    doc.moveTo(margin + offset, margin + 8)
       .lineTo(margin + offset + size, margin + 8)
       .lineTo(margin + offset, margin + 8 + size)
       .stroke();
  }
  
  // Coin haut-droit
  for (let i = 0; i < 3; i++) {
    const offset = cornerGap + (i * 12);
    const size = cornerSize - (i * 8);
    doc.moveTo(W - margin - offset, margin + 8)
       .lineTo(W - margin - offset - size, margin + 8)
       .lineTo(W - margin - offset, margin + 8 + size)
       .stroke();
  }
  
  // Coin bas-gauche
  for (let i = 0; i < 3; i++) {
    const offset = cornerGap + (i * 12);
    const size = cornerSize - (i * 8);
    doc.moveTo(margin + offset, H - margin - 8)
       .lineTo(margin + offset + size, H - margin - 8)
       .lineTo(margin + offset, H - margin - 8 - size)
       .stroke();
  }
  
  // Coin bas-droit
  for (let i = 0; i < 3; i++) {
    const offset = cornerGap + (i * 12);
    const size = cornerSize - (i * 8);
    doc.moveTo(W - margin - offset, H - margin - 8)
       .lineTo(W - margin - offset - size, H - margin - 8)
       .lineTo(W - margin - offset, H - margin - 8 - size)
       .stroke();
  }
  doc.restore();
}

// ─── DESSINER UNE MÉDAILLE/HONNEUR ─────────────────────────────────
function drawHonorMedal(doc, cx, cy) {
  const radius = 65;
  
  // Rayons dorés autour de la médaille (effet soleil)
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const x1 = cx + (radius + 5) * Math.cos(angle);
    const y1 = cy + (radius + 5) * Math.sin(angle);
    const x2 = cx + (radius + 15) * Math.cos(angle);
    const y2 = cy + (radius + 15) * Math.sin(angle);
    doc.moveTo(x1, y1).lineTo(x2, y2)
       .lineWidth(1.2).strokeColor(i % 3 === 0 ? C.gold : C.goldLight).stroke();
  }
  
  // Anneaux concentriques
  doc.circle(cx, cy, radius + 3).lineWidth(2.5).strokeColor(C.gold).stroke();
  doc.circle(cx, cy, radius).lineWidth(1.5).strokeColor(C.goldDark).stroke();
  doc.circle(cx, cy, radius - 3).lineWidth(1).strokeColor(C.goldLight).stroke();
  
  // Fond de la médaille blanc
  doc.circle(cx, cy, radius - 5).fill(C.white);

  // Logo SmartEdu clippé dans le cercle central
  if (LOGO_PATH) {
    try {
      const logoSize = radius * 2;
      doc.save();
      doc.circle(cx, cy, radius).clip();
      doc.image(LOGO_PATH, cx - logoSize / 2, cy - logoSize / 2, {
        width: logoSize, height: logoSize, fit: [logoSize, logoSize],
      });
      doc.restore();
    } catch (_) {
      doc.fontSize(28).fillColor(C.gold).text('\u2605', cx - 14, cy - 14, { width: 28, align: 'center' });
    }
  } else {
    doc.fontSize(28).fillColor(C.gold).text('\u2605', cx - 14, cy - 14, { width: 28, align: 'center' });
  }
  
  // Ruban bleu SmartEdu
  doc.save();
  doc.moveTo(cx - 15, cy + radius - 8)
     .lineTo(cx - 22, cy + radius + 35)
     .lineTo(cx - 5, cy + radius + 28)
     .closePath().fill(C.blueDeep);
  doc.moveTo(cx + 15, cy + radius - 8)
     .lineTo(cx + 22, cy + radius + 35)
     .lineTo(cx + 5, cy + radius + 28)
     .closePath().fill(C.blueMid);
  doc.restore();
}

// ─── GÉNÉRATION PRINCIPALE DU CERTIFICAT ───────────────────────────
async function genererCertificatPDF(opts) {
  const {
    certId, numeroCert,
    etudiantPrenom = '', etudiantNom = '',
    examenTitre = '',
    salleNom = '', matiere = '',
    tuteurNom = '',
    scoreObtenu = 0,
    dateEmission = new Date(),
  } = opts;

  const dir = path.join(__dirname, '..', 'uploads', 'certificats');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${numeroCert}.pdf`;
  const filepath = path.join(dir, filename);
  const urlPath = `/uploads/certificats/${filename}`;

  const nomComplet = `${etudiantPrenom} ${etudiantNom}`.trim();
  const dateDisplay = formatDate(dateEmission);
  const scoreDisplay = parseFloat(scoreObtenu).toFixed(1);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const W = doc.page.width;   // 841.89
    const H = doc.page.height;  // 595.28
    const CX = W / 2;

    // ─────────────────────────────────────────────────────────────
    // 1. FOND IVOIRE ÉLÉGANT
    // ─────────────────────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(C.pageBg);

    // ─────────────────────────────────────────────────────────────
    // 2. MOTIF DE FOND SUBTIL (lignes fines très claires)
    // ─────────────────────────────────────────────────────────────
    for (let i = 0; i < 30; i++) {
      const y = 40 + i * 35;
      doc.moveTo(20, y).lineTo(W - 20, y)
         .lineWidth(0.2).strokeColor(C.goldLight).opacity(0.3).stroke();
    }
    doc.opacity(1);

    // ─────────────────────────────────────────────────────────────
    // 3. CADRES ÉLÉGANTS
    // ─────────────────────────────────────────────────────────────
    drawElegantBorder(doc, W, H);

    // ─────────────────────────────────────────────────────────────
    // 4. LOGO - GRAND ET CLAIR (position centrale en haut)
    // ─────────────────────────────────────────────────────────────
    const logoSize = 90;
    const logoX = CX - logoSize / 2;
    const logoY = 42;

    if (LOGO_PATH) {
      try {
        doc.image(LOGO_PATH, logoX, logoY, { width: logoSize, height: logoSize });
      } catch (err) {
        console.warn('Logo non trouvé, utilisation du texte SmartEdu');
        doc.fontSize(28).fillColor(C.blueDeep).text('SmartEdu', CX - 70, logoY + 25, {
          width: 140, align: 'center', font: 'Helvetica-Bold',
        });
      }
    } else {
      doc.fontSize(28).fillColor(C.blueDeep).text('SmartEdu', CX - 70, logoY + 25, {
        width: 140, align: 'center', font: 'Helvetica-Bold',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. TITRE "CERTIFICATE OF COMPLETION" AVEC ENCADREMENT
    // ─────────────────────────────────────────────────────────────
    const titleY = logoY + logoSize + 15;

    // Bandeau bleu sous le logo
    doc.rect(60, titleY - 8, W - 120, 58).fill(C.blueDeep);
    
    doc.font('Helvetica-Bold').fontSize(26)
       .fillColor(C.white)
       .text('CERTIFICATE', 0, titleY, {
         width: W, align: 'center', characterSpacing: 4,
       });
    doc.fontSize(18).fillColor(C.goldLight)
       .text('OF COMPLETION', 0, titleY + 32, {
         width: W, align: 'center', characterSpacing: 3,
       });

    // ─────────────────────────────────────────────────────────────
    // 6. LIGNE DORÉE SOUS LE TITRE
    // ─────────────────────────────────────────────────────────────
    const lineY = titleY + 58;
    doc.moveTo(CX - 180, lineY).lineTo(CX - 30, lineY)
       .lineWidth(1.5).strokeColor(C.gold).stroke();
    doc.moveTo(CX - 30, lineY).lineTo(CX + 30, lineY)
       .lineWidth(3).strokeColor(C.gold).stroke();
    doc.moveTo(CX + 30, lineY).lineTo(CX + 180, lineY)
       .lineWidth(1.5).strokeColor(C.gold).stroke();

    // ─────────────────────────────────────────────────────────────
    // 7. "THIS IS TO CERTIFY THAT"
    // ─────────────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(10)
       .fillColor(C.gray)
       .text('THIS IS TO CERTIFY THAT', 0, lineY + 20, {
         width: W, align: 'center', characterSpacing: 2,
       });

    // ─────────────────────────────────────────────────────────────
    // 8. NOM ÉTUDIANT (grand, élégant, signature)
    // ─────────────────────────────────────────────────────────────
    const nameY = lineY + 45;
    doc.font('Times-BoldItalic').fontSize(42)
       .fillColor(C.blueDark)
       .text(nomComplet, 0, nameY, {
         width: W, align: 'center',
       });

    // Ligne sous le nom
    doc.moveTo(CX - 200, nameY + 52).lineTo(CX + 200, nameY + 52)
       .lineWidth(0.8).strokeColor(C.gold).stroke();

    // ─────────────────────────────────────────────────────────────
    // 9. DESCRIPTION DE L'EXAMEN
    // ─────────────────────────────────────────────────────────────
    const bodyY = nameY + 68;
    
    doc.font('Times-Italic').fontSize(12)
       .fillColor(C.brownLight)
       .text('has successfully completed the SmartEdu certified program', 0, bodyY, {
         width: W, align: 'center',
       });
    
    // Titre de l'examen en bleu
    doc.font('Helvetica-Bold').fontSize(13)
       .fillColor(C.blueMid)
       .text(examenTitre, 0, bodyY + 22, {
         width: W, align: 'center',
       });
    
    if (matiere) {
      doc.font('Times-Italic').fontSize(11)
         .fillColor(C.gray)
         .text(`${matiere} • ${salleNom || ''}`, 0, bodyY + 44, {
           width: W, align: 'center',
         });
    }

    // Date — déplacée sous la médaille

    // ─────────────────────────────────────────────────────────────
    // 10. MÉDAILLE D'HONNEUR + SCORE
    // ─────────────────────────────────────────────────────────────
    const medalY = bodyY + 110;
    drawHonorMedal(doc, CX, medalY);
    
    // Score affiché sous la médaille
    doc.font('Helvetica-Bold').fontSize(11)
       .fillColor(C.goldDark)
       .text(`${scoreDisplay}%`, CX - 25, medalY + 70, {
         width: 50, align: 'center',
       });
    doc.font('Helvetica').fontSize(8).fillColor(C.gray)
       .text('SCORE', CX - 20, medalY + 82, {
         width: 40, align: 'center',
       });

    // Date — bien visible sous le badge, en dehors du cercle
    doc.font('Helvetica-Bold').fontSize(10)
       .fillColor(C.blueDeep)
       .text(dateDisplay, CX - 100, medalY + 100, {
         width: 200, align: 'center',
       });

    // ─────────────────────────────────────────────────────────────
    // 11. SIGNATURES (style officiel)
    // ─────────────────────────────────────────────────────────────
    const signY = H - 75;
    
    // Ligne séparatrice
    doc.moveTo(80, signY - 12).lineTo(W - 80, signY - 12)
       .lineWidth(0.5).strokeColor(C.goldLight).stroke();

    // Signature Tuteur (gauche)
    doc.font('Helvetica').fontSize(8).fillColor(C.gray)
       .text('CERTIFIED INSTRUCTOR', CX - 220, signY, { width: 180, align: 'center' });
    doc.font('Times-BoldItalic').fontSize(12).fillColor(C.blueDark)
       .text(tuteurNom, CX - 220, signY + 14, { width: 180, align: 'center' });
    doc.moveTo(CX - 300, signY + 28).lineTo(CX - 140, signY + 28)
       .lineWidth(0.6).strokeColor(C.grayLight).stroke();

    // Signature Direction (droite)
    doc.font('Helvetica').fontSize(8).fillColor(C.gray)
       .text('DIRECTOR OF ACADEMY', CX + 40, signY, { width: 180, align: 'center' });
    doc.font('Times-BoldItalic').fontSize(12).fillColor(C.blueDark)
       .text('Dr. Ahmed El Fassi', CX + 40, signY + 14, { width: 180, align: 'center' });
    doc.moveTo(CX - 40, signY + 28).lineTo(CX + 120, signY + 28)
       .lineWidth(0.6).strokeColor(C.grayLight).stroke();

    // ─────────────────────────────────────────────────────────────
    // 12. SCEAU / QR CODE SIMULÉ (élégance)
    // ─────────────────────────────────────────────────────────────
    doc.circle(W - 65, H - 50, 15).lineWidth(1).strokeColor(C.gold).stroke();
    doc.fontSize(10).fillColor(C.gold).text('✓', W - 70, H - 55);

    // ─────────────────────────────────────────────────────────────
    // 13. RÉFÉRENCE EN BAS
    // ─────────────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(7).fillColor(C.grayLight)
       .text(
         `Certificate ID: ${numeroCert} • SmartEdu Academic Platform • smartedu.ma`,
         0, H - 25, { width: W, align: 'center' }
       );

    doc.end();

    stream.on('finish', () => resolve(urlPath));
    stream.on('error', reject);
  });
}

function getCertificatFilePath(numeroCert) {
  return path.join(__dirname, '..', 'uploads', 'certificats', `${numeroCert}.pdf`);
}

module.exports = { genererCertificatPDF, getCertificatFilePath };