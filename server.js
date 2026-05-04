require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════
const CONFIG = {
  ohmeClientName:   process.env.OHME_CLIENT_NAME   || '',
  ohmeClientSecret: process.env.OHME_CLIENT_SECRET || '',
  ohmeBase:         (process.env.OHME_BASE_URL     || '').replace(/\/$/, ''),
  brevoKey:         process.env.BREVO_API_KEY      || '',
  senderEmail:      process.env.SENDER_EMAIL       || 'contact@defienfance.fr',
  senderName:       process.env.SENDER_NAME        || 'Défi Enfance',
  pollInterval:     parseInt(process.env.POLL_INTERVAL_MS || '600000'),
  dashPassword:     process.env.DASHBOARD_PASSWORD || '',
};

// ══════════════════════════════════════════════════════
//  ÉTAT SERVEUR
// ══════════════════════════════════════════════════════
const state = {
  isRunning:    false,
  processedIds: new Set(),
  stats:        { sent: 0, dons: 0, bill: 0, errors: 0 },
  logs:         [],          // 100 dernières entrées
  events:       [],          // 20 derniers événements
  lastPoll:     null,
  nextPoll:     null,
  pollTimer:    null,
};

function addLog(msg, type = 'info') {
  const entry = { ts: new Date().toISOString(), msg, type };
  state.logs.unshift(entry);
  if (state.logs.length > 100) state.logs.pop();
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

function addEvent(icon, title, sub, type) {
  state.events.unshift({ icon, title, sub, type, ts: new Date().toISOString() });
  if (state.events.length > 20) state.events.pop();
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL
// ══════════════════════════════════════════════════════
function tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur, association }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#f5f0f3;font-family:'Poppins',Arial,sans-serif;color:#1a0a12}
    .outer{max-width:600px;margin:0 auto;padding:24px 12px}
    .header{background:linear-gradient(135deg,#fb0089 0%,#ef6135 100%);border-radius:18px 18px 0 0;padding:36px 40px 32px;text-align:center;position:relative;overflow:hidden}
    .header::before{content:'';position:absolute;top:-40px;right:-40px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,0.08)}
    .header-icon{font-size:48px;margin-bottom:14px;position:relative;z-index:1}
    .header h1{font-family:'Antonio',Arial,sans-serif;font-size:2rem;color:#fff;letter-spacing:.03em;position:relative;z-index:1;line-height:1.1}
    .header p{color:rgba(255,255,255,0.85);font-size:.85rem;margin-top:8px;position:relative;z-index:1}
    .body{background:#fff;padding:36px 40px;border-left:1px solid #f0e8ed;border-right:1px solid #f0e8ed}
    .greeting{font-size:1.05rem;font-weight:600;margin-bottom:16px}
    .intro{font-size:.9rem;color:#3d1830;line-height:1.65;margin-bottom:24px}
    .don-box{background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:22px 26px;text-align:center;margin-bottom:28px}
    .don-amount{font-family:'Antonio',Arial,sans-serif;font-size:3rem;color:#fb0089;line-height:1}
    .don-label{font-size:.78rem;color:#ef6135;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}
    .donateur-card{background:#fdf8fb;border:1px solid #f5dced;border-radius:12px;padding:18px 22px;margin-bottom:28px}
    .donateur-card h3{font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
    .row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f5dced;font-size:.85rem;color:#3d1830}
    .row:last-child{border-bottom:none}
    .row .ic{font-size:1.1rem;width:24px;text-align:center;flex-shrink:0}
    .cta-text{font-size:.88rem;color:#3d1830;line-height:1.6;background:#fff8ef;border-left:4px solid #ff8533;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:28px}
    .footer{background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:0 0 18px 18px;padding:24px 40px;text-align:center}
    .footer-logo{font-family:'Antonio',Arial,sans-serif;font-size:1.2rem;color:#fb0089;letter-spacing:.05em;margin-bottom:6px}
    .footer-sub{font-size:.72rem;color:rgba(255,255,255,0.45);line-height:1.5}
    .divider{height:1px;background:linear-gradient(90deg,transparent,#fb0089,transparent);margin:20px 0;opacity:.3}
  </style></head><body>
  <div class="outer">
    <div class="header">
      <div class="header-icon">❤️</div>
      <h1>Nouveau don<br>pour toi !</h1>
      <p>Défi Enfance — Générateur de victoires pour l'enfance</p>
    </div>
    <div class="body">
      <div class="greeting">Bonjour ${coureurPrenom} 👋</div>
      <div class="intro">Nous sommes heureux de t'annoncer qu'un nouveau don vient d'être enregistré sur <strong>ta page de collecte Défi Enfance</strong> !</div>
      <div class="don-box">
        <div class="don-amount">${montant} €</div>
        <div class="don-label">Don reçu de ${donateur}</div>
      </div>
      <div class="donateur-card">
        <h3>📋 Coordonnées du donateur</h3>
        <div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div>
        <div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#fb0089">${email_donateur}</a></div></div>
      </div>
      <div class="cta-text">💌 <strong>N'hésite pas à remercier ${donateur} personnellement</strong> — un message sincère fait toujours une grande différence et renforce l'élan de générosité autour de ta collecte !</div>
      <div class="divider"></div>
      <div style="font-size:.78rem;color:#888;text-align:center">Association soutenue par ta collecte : <strong>${association}</strong><br>Email envoyé automatiquement dans les 10 minutes suivant le don.</div>
    </div>
    <div class="footer">
      <div class="footer-logo">DÉFI ENFANCE</div>
      <div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div>
    </div>
  </div></body></html>`;
}

function tplDonEquipe({ chefPrenom, nomEquipe, donateur, montant, email_donateur }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#f5f0f3;font-family:'Poppins',Arial,sans-serif;color:#1a0a12}
    .outer{max-width:600px;margin:0 auto;padding:24px 12px}
    .header{background:linear-gradient(135deg,#ef6135 0%,#ff8533 100%);border-radius:18px 18px 0 0;padding:36px 40px 32px;text-align:center;position:relative;overflow:hidden}
    .header::before{content:'';position:absolute;top:-40px;right:-40px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,0.08)}
    .header-icon{font-size:48px;margin-bottom:14px;position:relative;z-index:1}
    .header h1{font-family:'Antonio',Arial,sans-serif;font-size:2rem;color:#fff;letter-spacing:.03em;position:relative;z-index:1;line-height:1.1}
    .header p{color:rgba(255,255,255,0.85);font-size:.85rem;margin-top:8px;position:relative;z-index:1}
    .body{background:#fff;padding:36px 40px;border-left:1px solid #f0e8ed;border-right:1px solid #f0e8ed}
    .greeting{font-size:1.05rem;font-weight:600;margin-bottom:16px}
    .intro{font-size:.9rem;color:#3d1830;line-height:1.65;margin-bottom:24px}
    .equipe-badge{display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff;border-radius:99px;padding:6px 18px;font-size:.82rem;font-weight:700;letter-spacing:.05em;margin-bottom:20px}
    .don-box{background:linear-gradient(135deg,#fff5ef,#fff8ef);border:2px solid #ef6135;border-radius:14px;padding:22px 26px;text-align:center;margin-bottom:28px}
    .don-amount{font-family:'Antonio',Arial,sans-serif;font-size:3rem;color:#ef6135;line-height:1}
    .don-label{font-size:.78rem;color:#ff8533;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}
    .donateur-card{background:#fdfaf8;border:1px solid #f5e5d5;border-radius:12px;padding:18px 22px;margin-bottom:28px}
    .donateur-card h3{font-size:.75rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
    .row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f5e5d5;font-size:.85rem;color:#3d1830}
    .row:last-child{border-bottom:none}
    .row .ic{font-size:1.1rem;width:24px;text-align:center;flex-shrink:0}
    .cta-text{font-size:.88rem;color:#3d1830;line-height:1.6;background:#fff8ef;border-left:4px solid #ef6135;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:28px}
    .footer{background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:0 0 18px 18px;padding:24px 40px;text-align:center}
    .footer-logo{font-family:'Antonio',Arial,sans-serif;font-size:1.2rem;color:#ff8533;letter-spacing:.05em;margin-bottom:6px}
    .footer-sub{font-size:.72rem;color:rgba(255,255,255,0.45);line-height:1.5}
    .divider{height:1px;background:linear-gradient(90deg,transparent,#ef6135,transparent);margin:20px 0;opacity:.3}
  </style></head><body>
  <div class="outer">
    <div class="header">
      <div class="header-icon">🏆</div>
      <h1>Nouveau don<br>pour votre équipe !</h1>
      <p>Défi Enfance — Générateur de victoires pour l'enfance</p>
    </div>
    <div class="body">
      <div class="greeting">Bonjour ${chefPrenom} 👋</div>
      <div style="margin-bottom:16px"><span class="equipe-badge">🏃 Équipe ${nomEquipe}</span></div>
      <div class="intro">Excellente nouvelle ! Un nouveau don vient d'être enregistré pour soutenir <strong>votre équipe au Défi Enfance</strong>.</div>
      <div class="don-box">
        <div class="don-amount">${montant} €</div>
        <div class="don-label">Don reçu de ${donateur}</div>
      </div>
      <div class="donateur-card">
        <h3>📋 Coordonnées du donateur</h3>
        <div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div>
        <div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#ef6135">${email_donateur}</a></div></div>
      </div>
      <div class="cta-text">💌 En tant que référent de l'équipe, <strong>n'hésitez pas à remercier ${donateur} au nom de toute l'équipe</strong> — et à partager la bonne nouvelle avec vos coéquipiers pour booster la motivation !</div>
      <div class="divider"></div>
      <div style="font-size:.78rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant le don.</div>
    </div>
    <div class="footer">
      <div class="footer-logo">DÉFI ENFANCE</div>
      <div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div>
    </div>
  </div></body></html>`;
}

function tplInscriptionAsso({ nomAsso, coureur, email_coureur, ville }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#f5f0f3;font-family:'Poppins',Arial,sans-serif;color:#1a0a12}
    .outer{max-width:600px;margin:0 auto;padding:24px 12px}
    .header{background:linear-gradient(135deg,#fb0089 0%,#ff8533 100%);border-radius:18px 18px 0 0;padding:36px 40px 32px;text-align:center;position:relative;overflow:hidden}
    .header::before{content:'';position:absolute;top:-40px;right:-40px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,0.08)}
    .header-icon{font-size:48px;margin-bottom:14px;position:relative;z-index:1}
    .header h1{font-family:'Antonio',Arial,sans-serif;font-size:2rem;color:#fff;letter-spacing:.03em;position:relative;z-index:1;line-height:1.1}
    .header p{color:rgba(255,255,255,0.85);font-size:.85rem;margin-top:8px;position:relative;z-index:1}
    .body{background:#fff;padding:36px 40px;border-left:1px solid #f0e8ed;border-right:1px solid #f0e8ed}
    .greeting{font-size:1.05rem;font-weight:600;margin-bottom:16px}
    .intro{font-size:.9rem;color:#3d1830;line-height:1.65;margin-bottom:24px}
    .runner-box{background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:22px 26px;text-align:center;margin-bottom:28px}
    .runner-name{font-family:'Antonio',Arial,sans-serif;font-size:1.8rem;color:#fb0089;line-height:1}
    .runner-label{font-size:.78rem;color:#ef6135;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-top:6px}
    .runner-card{background:#fdf8fb;border:1px solid #f5dced;border-radius:12px;padding:18px 22px;margin-bottom:28px}
    .runner-card h3{font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
    .row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f5dced;font-size:.85rem;color:#3d1830}
    .row:last-child{border-bottom:none}
    .row .ic{font-size:1.1rem;width:24px;text-align:center;flex-shrink:0}
    .cta-text{font-size:.88rem;color:#3d1830;line-height:1.6;background:#fff0f8;border-left:4px solid #fb0089;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:28px}
    .insight-box{background:#f5f0f3;border-radius:12px;padding:16px 20px;margin-bottom:24px;font-size:.82rem;color:#3d1830;line-height:1.6}
    .footer{background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:0 0 18px 18px;padding:24px 40px;text-align:center}
    .footer-logo{font-family:'Antonio',Arial,sans-serif;font-size:1.2rem;color:#fb0089;letter-spacing:.05em;margin-bottom:6px}
    .footer-sub{font-size:.72rem;color:rgba(255,255,255,0.45);line-height:1.5}
    .divider{height:1px;background:linear-gradient(90deg,transparent,#fb0089,transparent);margin:20px 0;opacity:.3}
  </style></head><body>
  <div class="outer">
    <div class="header">
      <div class="header-icon">🏃</div>
      <h1>Nouveau coureur<br>pour votre cause !</h1>
      <p>Défi Enfance — Générateur de victoires pour l'enfance</p>
    </div>
    <div class="body">
      <div class="greeting">Bonjour,</div>
      <div class="intro">Bonne nouvelle ! Un coureur vient de <strong>choisir votre association</strong> pour courir à ses côtés lors du <strong>Défi Enfance${ville ? ' de ' + ville : ''}</strong>.</div>
      <div class="runner-box">
        <div class="runner-name">${coureur}</div>
        <div class="runner-label">Nouveau coureur inscrit !</div>
      </div>
      <div class="runner-card">
        <h3>📋 Coordonnées du coureur</h3>
        <div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${coureur}</div></div>
        <div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_coureur}" style="color:#fb0089">${email_coureur}</a></div></div>
      </div>
      <div class="cta-text">💌 <strong>Prenez contact avec ${coureur}</strong> pour le remercier de son choix et l'accueillir chaleureusement — un message personnalisé peut vraiment faire la différence !</div>
      <div class="insight-box">💡 <strong>Conseil Défi Enfance :</strong> Présentez vos actions et vos bénéficiaires. Plus le coureur est engagé, plus sa collecte sera importante !</div>
      <div class="divider"></div>
      <div style="font-size:.78rem;color:#888;text-align:center">Association bénéficiaire : <strong>${nomAsso}</strong><br>Email envoyé automatiquement dans les 10 minutes suivant l'inscription.</div>
    </div>
    <div class="footer">
      <div class="footer-logo">DÉFI ENFANCE</div>
      <div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div>
    </div>
  </div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  OHME — FETCH PAIEMENTS
// ══════════════════════════════════════════════════════
async function fetchOhmePayments() {
  if (!CONFIG.ohmeClientName || !CONFIG.ohmeClientSecret || !CONFIG.ohmeBase) {
    addLog('Clé API Ohme (client-name ou client-secret) ou URL manquante', 'warn');
    return [];
  }
  try {
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?limit=200`, {
      headers: {
        'Accept':        'application/json',
        'client-name':   CONFIG.ohmeClientName,
        'client-secret': CONFIG.ohmeClientSecret,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    const json = await res.json();
    return json.data || [];
  } catch (e) {
    addLog(`Erreur Ohme : ${e.message}`, 'error');
    state.stats.errors++;
    return [];
  }
}

// ══════════════════════════════════════════════════════
//  BREVO — ENVOI EMAIL
// ══════════════════════════════════════════════════════
async function sendBrevo(to, subject, html) {
  if (!CONFIG.brevoKey) { addLog('Clé Brevo manquante', 'warn'); return false; }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept':       'application/json',
        'api-key':      CONFIG.brevoKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender:      { name: CONFIG.senderName, email: CONFIG.senderEmail },
        to:          [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addLog(`Brevo erreur ${res.status} : ${err.message || ''}`, 'error');
      state.stats.errors++;
      return false;
    }
    return true;
  } catch (e) {
    addLog(`Brevo exception : ${e.message}`, 'error');
    state.stats.errors++;
    return false;
  }
}

// ══════════════════════════════════════════════════════
//  TRAITEMENT DES PAIEMENTS
// ══════════════════════════════════════════════════════
async function processPayments(payments) {
  let newCount = 0;

  for (const p of payments) {
    if (state.processedIds.has(p.id)) continue;

    // Champ exact Ohme : nom_de_levent — filtre sur ENFANCE (sans accent, insensible à la casse)
    const eventName = (p.nom_de_levent || p.event_name || '').toUpperCase();
    if (!eventName.includes('ENFANCE')) {
      state.processedIds.add(p.id);
      continue;
    }

    // Type de paiement Ohme : payment_type_id ou type
    const type = (p.payment_type || p.type || '').toLowerCase();

    // ── CAS 1 : DON ──────────────────────────────────────
    if (type === 'don') {
      state.stats.dons++;
      newCount++;
      const donateur = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const montant  = p.amount || '?';
      const emailDon = p.email || '';

      // Champ Ohme : coureur_parraine → c'est un contact Ohme (même orthographe)
      const coureurParraine = (p.coureur_parraine || '').trim();
      // Champ Ohme : equipe_parraine → c'est une structure Ohme (même orthographe)
      const equipeParraine  = (p.equipe_parraine  || '').trim();

      if (coureurParraine) {
        // Chercher le contact dans Ohme pour récupérer son email
        const contact = await fetchOhmeContactByName(coureurParraine);
        const emailCoureur = contact ? (contact.email || '') : '';
        const coureurPrenom = coureurParraine.split(' ')[0];
        const assoSoutenue  = p.asso_soutenue || '';

        if (emailCoureur) {
          const html = tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur: emailDon, association: assoSoutenue });
          const ok = await sendBrevo(emailCoureur, '❤️ Nouveau don pour ton Défi Enfance !', html);
          if (ok) {
            state.stats.sent++;
            addLog(`✅ Don ${montant}€ de ${donateur} → ${coureurParraine}`, 'ok');
            addEvent('❤️', `Don de ${montant} €`, `${donateur} → ${coureurParraine}`, 'don');
          }
        } else {
          addLog(`⚠️ Don → coureur "${coureurParraine}" introuvable dans Ohme`, 'warn');
        }

      } else if (equipeParraine) {
        // Chercher la structure dans Ohme pour récupérer email_referent_defi_enfance et nom_du_referent
        const structure = await fetchOhmeStructureByName(equipeParraine);
        const chefEmail  = structure ? (structure.email_referent_defi_enfance || '') : '';
        const chefNom    = structure ? (structure.nom_du_referent_defi_enfance || '') : '';
        const chefPrenom = chefNom.split(' ')[0] || 'Bonjour';

        if (chefEmail) {
          const html = tplDonEquipe({ chefPrenom, nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon });
          const ok = await sendBrevo(chefEmail, '❤️ Nouveau don pour votre équipe au Défi Enfance !', html);
          if (ok) {
            state.stats.sent++;
            addLog(`✅ Don ${montant}€ de ${donateur} → équipe ${equipeParraine}`, 'ok');
            addEvent('🏆', `Don de ${montant} € pour équipe`, `${donateur} → ${equipeParraine}`, 'don');
          }
        } else {
          addLog(`⚠️ Don → équipe "${equipeParraine}" — email référent introuvable`, 'warn');
        }

      } else {
        addLog(`⚠️ Don ${montant}€ de ${donateur} — aucun coureur ni équipe parrainé(e) renseigné(e)`, 'warn');
      }
    }

    // ── CAS 2 : BILLETTERIE ───────────────────────────────
    else if (type === 'billetterie') {
      state.stats.bill++;
      newCount++;
      const coureur      = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const emailCoureur = p.email || '';
      // Champ Ohme : asso_soutenue → nom de la structure (même orthographe)
      const nomAsso      = (p.asso_soutenue || '').trim();
      const ville        = (p.nom_de_levent || '').replace(/DÉFI\s*ENFANCE?\s*/gi, '').replace(/\d{4}/g, '').trim();

      if (nomAsso) {
        // Chercher la structure dans Ohme pour récupérer l'email du référent
        const structure = await fetchOhmeStructureByName(nomAsso);
        const emailAsso = structure ? (structure.email_referent_defi_enfance || '') : '';

        if (emailAsso) {
          const html = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailCoureur, ville });
          const ok = await sendBrevo(emailAsso, '🏃 Nouveau coureur pour votre cause — Défi Enfance !', html);
          if (ok) {
            state.stats.sent++;
            addLog(`✅ Inscription ${coureur} → asso ${nomAsso}`, 'ok');
            addEvent('🏃', `Inscription de ${coureur}`, `Association : ${nomAsso}`, 'bill');
          }
        } else {
          addLog(`⚠️ Inscription ${coureur} — email référent asso "${nomAsso}" introuvable`, 'warn');
        }
      } else {
        addLog(`⚠️ Inscription ${coureur} — champ asso_soutenue vide`, 'warn');
      }
    }

    state.processedIds.add(p.id);
  }

  if (newCount === 0) addLog('Aucun nouveau paiement à traiter', 'info');
}

// ── Chercher un contact Ohme par nom (pour récupérer l'email du coureur parrainé)
async function fetchOhmeContactByName(name) {
  try {
    const res = await fetch(
      `${CONFIG.ohmeBase}/api/v1/contacts?search=${encodeURIComponent(name)}&limit=1`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const items = json.data || [];
    return items.length > 0 ? items[0] : null;
  } catch { return null; }
}

// ── Chercher une structure Ohme par nom (pour récupérer l'email référent)
async function fetchOhmeStructureByName(name) {
  try {
    const res = await fetch(
      `${CONFIG.ohmeBase}/api/v1/structures?search=${encodeURIComponent(name)}&limit=1`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const items = json.data || [];
    return items.length > 0 ? items[0] : null;
  } catch { return null; }
}

// ══════════════════════════════════════════════════════
//  RATTRAPAGE HISTORIQUE
// ══════════════════════════════════════════════════════

// Dates plancher pour le rattrapage
const RATTRAPAGE_DATE_DONS  = new Date('2025-05-01T00:00:00.000Z');
const RATTRAPAGE_DATE_BILL  = new Date('2025-04-01T00:00:00.000Z');

// État du rattrapage (un seul à la fois)
const rattrapage = {
  running:   false,
  total:     0,
  done:      0,
  skipped:   0,
  sent:      0,
  errors:    0,
  log:       [],   // 200 dernières lignes
  startedAt: null,
  finishedAt:null,
};

function rattrapageLog(msg, type = 'info') {
  const entry = { ts: new Date().toISOString(), msg, type };
  rattrapage.log.unshift(entry);
  if (rattrapage.log.length > 200) rattrapage.log.pop();
  addLog(`[RATTRAPAGE] ${msg}`, type);
}

async function fetchAllOhmePayments() {
  if (!CONFIG.ohmeClientName || !CONFIG.ohmeClientSecret || !CONFIG.ohmeBase) return [];
  let all = [];
  let cursor = null;
  const limit = 500;
  while (true) {
    try {
      const url = cursor
        ? `${CONFIG.ohmeBase}/api/v1/payments?limit=${limit}&cursor=${cursor}`
        : `${CONFIG.ohmeBase}/api/v1/payments?limit=${limit}`;
      const res = await fetch(url, {
        headers: {
          'Accept':        'application/json',
          'client-name':   CONFIG.ohmeClientName,
          'client-secret': CONFIG.ohmeClientSecret,
        }
      });
      if (!res.ok) { rattrapageLog(`Erreur HTTP ${res.status}`, 'error'); break; }
      const json = await res.json();
      const items = json.data || [];
      all = all.concat(items);
      rattrapageLog(`📦 ${all.length} paiements récupérés…`, 'info');
      if (items.length < limit) break;
      cursor = items[items.length - 1].id;
    } catch (e) {
      rattrapageLog(`Exception fetch : ${e.message}`, 'error');
      break;
    }
  }
  return all;
}

function shouldSkipBilletterie(p) {
  // Règle métier : si Asso soutenue == Équipe → ignorer
  // Les champs Ohme s'appellent "Équipe" et "Asso soutenue"
  // En snake_case API : equipe / asso_soutenue (à ajuster si besoin après test)
  const equipe      = (p['equipe']       || p['Équipe']       || p['equipe_name']  || '').trim().toLowerCase();
  const assoSoutenu = (p['asso_soutenue']|| p['Asso soutenue']|| p['asso_soutenue_name'] || '').trim().toLowerCase();
  if (!equipe || !assoSoutenu) return false; // champs absents → on ne saute pas
  return equipe === assoSoutenu;
}

async function lancerRattrapage() {
  if (rattrapage.running) return { error: 'Rattrapage déjà en cours' };

  rattrapage.running    = true;
  rattrapage.total      = 0;
  rattrapage.done       = 0;
  rattrapage.skipped    = 0;
  rattrapage.sent       = 0;
  rattrapage.errors     = 0;
  rattrapage.log        = [];
  rattrapage.startedAt  = new Date().toISOString();
  rattrapage.finishedAt = null;

  // Lancer en arrière-plan
  (async () => {
    try {
      rattrapageLog('Récupération de tous les paiements Ohme…', 'info');
      const all = await fetchAllOhmePayments();
      rattrapageLog(`${all.length} paiement(s) total récupéré(s) dans Ohme`, 'info');

      // Filtrer sur DÉFI + dates plancher
      const eligibles = all.filter(p => {
        const eventName = (p.nom_de_levent || p.event_name || '').toUpperCase();
        if (!eventName.includes('ENFANCE')) return false;
        const type = (p.payment_type || p.type || '').toLowerCase();
        const date = new Date(p.date || p.created_at || 0);
        if (type === 'don'         && date < RATTRAPAGE_DATE_DONS) return false;
        if (type === 'billetterie' && date < RATTRAPAGE_DATE_BILL) return false;
        return type === 'don' || type === 'billetterie';
      });

      rattrapage.total = eligibles.length;
      rattrapageLog(`${eligibles.length} paiement(s) éligible(s) au rattrapage`, 'info');

      for (const p of eligibles) {
        rattrapage.done++;
        const type = (p.payment_type || p.type || '').toLowerCase();
        const date = new Date(p.date || p.created_at || 0).toLocaleDateString('fr-FR');

        // ── DON ──
        if (type === 'don') {
          const donateur        = `${p.first_name || ''} ${p.last_name || ''}`.trim();
          const montant         = p.amount || '?';
          const emailDon        = p.email || '';
          const coureurParraine = (p.coureur_parraine || '').trim();
          const equipeParraine  = (p.equipe_parraine  || '').trim();

          if (coureurParraine) {
            const contact = await fetchOhmeContactByName(coureurParraine);
            const emailCoureur = contact ? (contact.email || '') : '';
            if (emailCoureur) {
              const html = tplDonCoureur({ coureurPrenom: coureurParraine.split(' ')[0], donateur, montant, email_donateur: emailDon, association: p.asso_soutenue || '' });
              const ok = await sendBrevo(emailCoureur, '❤️ Nouveau don pour ton Défi Enfance !', html);
              if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Don ${montant}€ de ${donateur} → ${coureurParraine}`, 'ok'); }
              else { rattrapage.errors++; }
            } else { rattrapage.skipped++; rattrapageLog(`⚠️ [${date}] Coureur "${coureurParraine}" introuvable`, 'warn'); }

          } else if (equipeParraine) {
            const structure = await fetchOhmeStructureByName(equipeParraine);
            const chefEmail = structure ? (structure.email_referent_defi_enfance || '') : '';
            const chefNom   = structure ? (structure.nom_du_referent_defi_enfance || '') : '';
            if (chefEmail) {
              const html = tplDonEquipe({ chefPrenom: chefNom.split(' ')[0] || 'Bonjour', nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon });
              const ok = await sendBrevo(chefEmail, '❤️ Nouveau don pour votre équipe au Défi Enfance !', html);
              if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Don ${montant}€ de ${donateur} → équipe ${equipeParraine}`, 'ok'); }
              else { rattrapage.errors++; }
            } else { rattrapage.skipped++; rattrapageLog(`⚠️ [${date}] Équipe "${equipeParraine}" — référent introuvable`, 'warn'); }

          } else {
            rattrapage.skipped++;
            rattrapageLog(`⚠️ [${date}] Don ${montant}€ de ${donateur} — aucun coureur ni équipe parrainé(e)`, 'warn');
          }
        }

        // ── BILLETTERIE ──
        else if (type === 'billetterie') {
          if (shouldSkipBilletterie(p)) {
            rattrapage.skipped++;
            const coureur = `${p.first_name || ''} ${p.last_name || ''}`.trim();
            rattrapageLog(`⏭️ [${date}] Inscription ${coureur} — même asso que l'équipe, ignoré`, 'info');
          } else {
            const coureur      = `${p.first_name || ''} ${p.last_name || ''}`.trim();
            const emailCoureur = p.email || '';
            const nomAsso      = (p.asso_soutenue || '').trim();
            const ville        = (p.nom_de_levent || '').replace(/DÉFI\s*ENFANCE?\s*/gi, '').replace(/\d{4}/g, '').trim();

            if (nomAsso) {
              const structure = await fetchOhmeStructureByName(nomAsso);
              const emailAsso = structure ? (structure.email_referent_defi_enfance || '') : '';
              if (emailAsso) {
                const html = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailCoureur, ville });
                const ok = await sendBrevo(emailAsso, '🏃 Nouveau coureur pour votre cause — Défi Enfance !', html);
                if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Inscription ${coureur} → asso ${nomAsso}`, 'ok'); }
                else { rattrapage.errors++; }
              } else { rattrapage.skipped++; rattrapageLog(`⚠️ [${date}] Asso "${nomAsso}" — email référent introuvable`, 'warn'); }
            } else { rattrapage.skipped++; rattrapageLog(`⚠️ [${date}] Inscription — asso_soutenue vide`, 'warn'); }
          }
        }

        // Pause de 2 secondes entre chaque email pour ne pas saturer Brevo
        await new Promise(r => setTimeout(r, 2000));
      }

      rattrapageLog(`🎉 Rattrapage terminé — ${rattrapage.sent} email(s) envoyé(s), ${rattrapage.skipped} ignoré(s), ${rattrapage.errors} erreur(s)`, 'ok');
    } catch (e) {
      rattrapageLog(`Exception générale : ${e.message}`, 'error');
    } finally {
      rattrapage.running    = false;
      rattrapage.finishedAt = new Date().toISOString();
    }
  })();

  return { started: true };
}

// ══════════════════════════════════════════════════════
//  POLLING
// ══════════════════════════════════════════════════════
async function poll() {
  state.lastPoll = new Date().toISOString();
  state.nextPoll = new Date(Date.now() + CONFIG.pollInterval).toISOString();
  addLog(`🔄 Interrogation Ohme…`, 'info');

  const payments = await fetchOhmePayments();
  addLog(`📦 ${payments.length} paiement(s) récupéré(s)`, 'info');
  await processPayments(payments);
}

function startPolling() {
  if (state.isRunning) return;
  state.isRunning = true;
  addLog('▶ Surveillance démarrée', 'ok');
  poll();
  state.pollTimer = setInterval(poll, CONFIG.pollInterval);
}

// Démarrage automatique au lancement du serveur
startPolling();

// ══════════════════════════════════════════════════════
//  API REST — tableau de bord
// ══════════════════════════════════════════════════════
app.get('/api/status', (req, res) => {
  res.json({
    isRunning:    state.isRunning,
    stats:        state.stats,
    lastPoll:     state.lastPoll,
    nextPoll:     state.nextPoll,
    pollInterval: CONFIG.pollInterval,
    processedCount: state.processedIds.size,
  });
});

app.get('/api/logs', (req, res) => {
  res.json(state.logs.slice(0, 50));
});

app.get('/api/events', (req, res) => {
  res.json(state.events);
});

// Envoi de test
app.post('/api/test-email', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Email requis' });
  const html = tplDonCoureur({
    coureurPrenom: 'Test', donateur: 'Jean-Claude Martin',
    montant: '20', email_donateur: 'jc.martin@test.fr',
    association: 'Les Enfants du Soleil',
  });
  const ok = await sendBrevo(to, '🧪 Test — Défi Enfance Notifications', html);
  res.json({ success: ok });
});

// Poll manuel depuis le dashboard
app.post('/api/poll-now', async (req, res) => {
  await poll();
  res.json({ success: true, stats: state.stats });
});

// ── RATTRAPAGE ──────────────────────────────────────
app.post('/api/rattrapage/start', async (req, res) => {
  const result = await lancerRattrapage();
  res.json(result);
});

app.get('/api/rattrapage/status', (req, res) => {
  res.json({
    running:    rattrapage.running,
    total:      rattrapage.total,
    done:       rattrapage.done,
    skipped:    rattrapage.skipped,
    sent:       rattrapage.sent,
    errors:     rattrapage.errors,
    startedAt:  rattrapage.startedAt,
    finishedAt: rattrapage.finishedAt,
    log:        rattrapage.log.slice(0, 100),
  });
});

// ══════════════════════════════════════════════════════
//  KEEP-ALIVE (évite le sleep sur Render plan gratuit)
// ══════════════════════════════════════════════════════
const APP_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(async () => {
  try {
    await fetch(`${APP_URL}/api/status`);
  } catch (_) {}
}, 14 * 60 * 1000); // toutes les 14 min

// ══════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ Serveur Défi Enfance démarré sur le port ${PORT}`);
  console.log(`   Polling Ohme toutes les ${CONFIG.pollInterval / 60000} minutes`);
  console.log(`   Ohme : ${CONFIG.ohmeBase || '⚠️ URL manquante'}`);
  console.log(`   Ohme client-name : ${CONFIG.ohmeClientName ? '✅ présent' : '⚠️ manquant'}`);
  console.log(`   Brevo : ${CONFIG.brevoKey ? '✅ clé présente' : '⚠️ clé manquante'}`);
});
