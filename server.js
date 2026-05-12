require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Protection par mot de passe du dashboard
app.use((req, res, next) => {
  const pwd = process.env.DASHBOARD_PASSWORD || '';
  if (!pwd) return next();

  // Toujours autoriser login, logout et fichiers statiques
  if (req.path === '/login' || req.path === '/logout') return next();
  if (req.path.match(/\.(js|css|png|jpg|ico|svg|woff|woff2)$/)) return next();

  // Vérifier le cookie pour toutes les autres routes (/, /api/*, etc.)
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').find(c => c.trim().startsWith('dash_token='));
  const val = token ? token.trim().split('=').slice(1).join('=').trim() : '';
  if (val === pwd) return next();

  // API sans cookie valide → 401
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non autorisé' });

  return res.redirect('/login');
});

// Page de login
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Défi Enfance — Connexion</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0007;font-family:'Poppins',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{background:#1a0a12;border:1px solid rgba(251,0,137,0.2);border-radius:18px;padding:40px;width:340px;text-align:center}.logo{font-size:1.6rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px}.sub{font-size:.78rem;color:rgba(255,255,255,0.4);margin-bottom:32px}input{width:100%;padding:12px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:.9rem;outline:none;margin-bottom:16px}input:focus{border-color:#fb0089}button{width:100%;padding:13px;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff;border:none;border-radius:10px;font-size:.9rem;font-weight:700;cursor:pointer}.err{color:#ff4d4d;font-size:.8rem;margin-top:12px}</style></head>
  <body><div class="box"><div class="logo">🤝 DÉFI ENFANCE</div><div class="sub">Dashboard — Accès sécurisé</div>
  <form method="POST" action="/login"><input type="password" name="password" placeholder="Mot de passe" autofocus>
  <button type="submit">Se connecter</button></form>
  ${req.query.err ? '<div class="err">Mot de passe incorrect</div>' : ''}</div></body></html>`);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const pwd = process.env.DASHBOARD_PASSWORD || '';
  if (req.body.password === pwd) {
    res.setHeader('Set-Cookie', `dash_token=${pwd}; Path=/; SameSite=Strict`);
    // Page intermédiaire qui sauvegarde dans localStorage puis redirige
    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
    <script>
      try { localStorage.setItem('dash_pwd', ${JSON.stringify(pwd)}); } catch(e) {}
      window.location.href = '/';
    </script>
    </body></html>`);
  }
  res.redirect('/login?err=1');
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'dash_token=; Path=/; Max-Age=0');
  return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
  <script>
    try { localStorage.removeItem('dash_pwd'); } catch(e) {}
    window.location.href = '/login';
  </script>
  </body></html>`);
});

// Route principale — injecte le mot de passe dans le HTML
app.get('/', (req, res) => {
  const pwd = process.env.DASHBOARD_PASSWORD || '';
  if (pwd) {
    const cookie = req.headers.cookie || '';
    const token = cookie.split(';').find(c => c.trim().startsWith('dash_token='));
    const val = token ? token.trim().split('=').slice(1).join('=').trim() : '';
    if (val !== pwd) return res.redirect('/login');
  }
  const fs2 = require('fs');
  const indexPath = path.join(__dirname, 'public', 'index.html');
  let html = fs2.readFileSync(indexPath, 'utf8');
  html = html.replace('</head>', `<script>window.__DASH_PWD__ = ${JSON.stringify(pwd)};</script></head>`);
  res.send(html);
});

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
//  PERSISTANCE DES IDs TRAITÉS
// ══════════════════════════════════════════════════════
const fs   = require('fs');
const PROCESSED_IDS_FILE = '/opt/render/project/src/defi-enfance-processed-ids.json';
const ATTENTE_FILE        = '/opt/render/project/src/defi-enfance-dons-attente.json';

function loadProcessedIds() {
  try {
    if (fs.existsSync(PROCESSED_IDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf8'));
      return new Set(data);
    }
  } catch(e) {
    console.log(`[WARN] Impossible de charger les IDs traités : ${e.message}`);
  }
  return new Set();
}

function saveProcessedIds() {
  try {
    fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify([...state.processedIds]));
  } catch(e) {
    console.log(`[WARN] Impossible de sauvegarder les IDs traités : ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════
//  ÉTAT SERVEUR
// ══════════════════════════════════════════════════════
const state = {
  isRunning:      false,
  processedIds:   loadProcessedIds(),
  donsEnAttente:  loadDonsEnAttente(),
  stats:          { sent: 0, dons: 0, bill: 0, errors: 0 },
  logs:           [],
  events:         [],
  lastPoll:       null,
  nextPoll:       null,
  pollTimer:      null,
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
//  FILE D'ATTENTE — DONS NON FLÉCHÉS
// ══════════════════════════════════════════════════════
function loadDonsEnAttente() {
  try {
    if (fs.existsSync(ATTENTE_FILE)) return JSON.parse(fs.readFileSync(ATTENTE_FILE, 'utf8'));
  } catch(e) {}
  return [];
}

function saveDonsEnAttente() {
  try { fs.writeFileSync(ATTENTE_FILE, JSON.stringify(state.donsEnAttente)); } catch(e) {}
}

function addDonEnAttente(don) {
  // Éviter les doublons
  if (state.donsEnAttente.find(d => d.paiementId === don.paiementId)) return;
  state.donsEnAttente.push({ ...don, addedAt: new Date().toISOString() });
  saveDonsEnAttente();
  addLog(`⏸️ Don en attente ajouté : ${don.donateur} — ${don.montant}€`, 'warn');
}

// ══════════════════════════════════════════════════════
//  EMAIL MERCI DONATEUR (envoi immédiat)
// ══════════════════════════════════════════════════════
async function sendMerciDonateur({ email, prenom, montant, donateur, coureurPrenom, coureurNom, association, nomEquipe }) {
  if (!email) return;
  let html, subject;
  if (coureurPrenom) {
    // Don fléché vers un coureur
    subject = `❤️ Merci pour votre don à ${coureurPrenom} !`;
    html = tplMerciDonateur({ prenomDonateur: prenom, montant, donateur, coureurPrenom, coureurNom: coureurNom || '', association: association || '' });
  } else if (nomEquipe) {
    // Don fléché vers une équipe
    subject = `❤️ Merci pour votre don à ${nomEquipe} !`;
    html = tplMerciDonateurEquipe({ prenomDonateur: prenom, montant, donateur, nomEquipe });
  } else {
    // Don global non fléché
    subject = '❤️ Merci pour votre don !';
    html = tplMerciDonateurGlobal({ prenomDonateur: prenom, montant, donateur });
  }
  const ok = await sendBrevo(email, subject, html);
  if (ok) {
    state.stats.sent++;
    addLog(`✅ Email merci envoyé à ${prenom} (${email})`, 'ok');
    addEvent('🙏', `Merci envoyé`, donateur, 'don');
  }
}

// ══════════════════════════════════════════════════════
//  CONSTANTES TEMPLATES
// ══════════════════════════════════════════════════════
const LOGO_URL     = 'https://defi-enfance-notifications.onrender.com/logo-defi-enfance.png';
const URL_COUREURS = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_event=all';
const URL_EQUIPES  = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=all';
const URL_DON      = 'https://defienfance.fr/faire-un-don/';
const URL_LINKEDIN = 'https://www.linkedin.com/company/d%C3%A9fi-enfance/';
const URL_FACEBOOK = 'https://www.facebook.com/people/D%C3%A9fi-Enfance/61586953989862/';
const URL_INSTAGRAM= 'https://www.instagram.com/defienfance';

const CSS_COMMUN = `
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#f5f0f3;font-family:'Poppins',Arial,sans-serif;color:#1a0a12}
    .outer{max-width:600px;margin:0 auto;padding:24px 12px}
    .logo-header{background:linear-gradient(135deg,#fb0089 0%,#ef6135 100%);border-radius:18px 18px 0 0;padding:18px 40px;text-align:center}
    .logo-header .logo-text{font-family:'Antonio',Arial,sans-serif;font-size:1.6rem;color:#fff;letter-spacing:.08em;text-transform:uppercase}
    .logo-header .logo-sub{font-size:.72rem;color:rgba(255,255,255,0.8);letter-spacing:.06em;margin-top:2px}
    .header{background:linear-gradient(135deg,#fb0089 0%,#ef6135 100%);padding:28px 40px 24px;text-align:center}
    .header.orange{background:linear-gradient(135deg,#ef6135 0%,#ff8533 100%)}
    .header.mixed{background:linear-gradient(135deg,#fb0089 0%,#ff8533 100%)}
    .header h1{font-family:'Antonio',Arial,sans-serif;font-size:1.8rem;color:#fff;letter-spacing:.03em;line-height:1.1}
    .header p{color:rgba(255,255,255,0.85);font-size:.82rem;margin-top:6px}
    .body{background:#fff;padding:32px 40px;border-left:1px solid #f0e8ed;border-right:1px solid #f0e8ed}
    .greeting{font-size:1.05rem;font-weight:600;margin-bottom:14px}
    .intro{font-size:.88rem;color:#3d1830;line-height:1.65;margin-bottom:22px}
    .don-box{background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:20px 26px;text-align:center;margin-bottom:24px}
    .don-box.orange{border-color:#ef6135;background:linear-gradient(135deg,#fff5ef,#fff8ef)}
    .don-amount{font-family:'Antonio',Arial,sans-serif;font-size:2.8rem;color:#fb0089;line-height:1}
    .don-amount.orange{color:#ef6135}
    .don-label{font-size:.76rem;color:#ef6135;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}
    .card{background:#fdf8fb;border:1px solid #f5dced;border-radius:12px;padding:16px 20px;margin-bottom:22px}
    .card.orange{background:#fdfaf8;border-color:#f5e5d5}
    .card h3{font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
    .card h3.orange{color:#ef6135}
    .row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
    .row.orange{border-bottom-color:#f5e5d5}
    .row:last-child{border-bottom:none}
    .row .ic{font-size:1rem;width:22px;text-align:center;flex-shrink:0}
    .cta-box{background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:20px 24px;text-align:center;margin-bottom:24px}
    .cta-box.orange{border-color:#ef6135;background:linear-gradient(135deg,#fff5ef,#fff8ef)}
    .cta-box p{font-size:.88rem;color:#3d1830;font-style:italic;margin-bottom:14px;line-height:1.5}
    .cta-btn{display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:12px 28px;border-radius:99px;font-weight:700;font-size:.85rem}
    .cta-btn.orange{background:linear-gradient(135deg,#ef6135,#ff8533)}
    .note{font-size:.86rem;color:#3d1830;line-height:1.6;background:#fff8ef;border-left:4px solid #ff8533;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:22px}
    .note.magenta{border-left-color:#fb0089;background:#fff0f8}
    .badge{display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff;border-radius:99px;padding:5px 16px;font-size:.8rem;font-weight:700;margin-bottom:18px}
    .divider{height:1px;background:linear-gradient(90deg,transparent,#fb0089,transparent);margin:18px 0;opacity:.3}
    .temoignage{background:#fdf8fb;border-left:4px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:14px;font-size:.84rem;color:#3d1830;line-height:1.6;font-style:italic}
    .social-bar{display:flex;justify-content:center;gap:16px;margin:16px 0;flex-wrap:wrap}
    .social-btn{display:inline-block;padding:8px 18px;border-radius:99px;font-size:.75rem;font-weight:700;text-decoration:none;color:#fff}
    .social-btn.li{background:#0077b5}
    .social-btn.fb{background:#1877f2}
    .social-btn.ig{background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)}
    .footer{background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:0 0 18px 18px;padding:22px 40px;text-align:center}
    .footer img{height:36px;width:auto;margin-bottom:8px;opacity:.85}
    .footer-sub{font-size:.7rem;color:rgba(255,255,255,0.45);line-height:1.5}
    .impact-stat{display:inline-block;text-align:center;margin:0 14px}
    .impact-stat .num{font-family:'Antonio',Arial,sans-serif;font-size:1.8rem;color:#fb0089;display:block}
    .impact-stat .lbl{font-size:.72rem;color:#3d1830;display:block}
`;

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL
// ══════════════════════════════════════════════════════
function tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur, association }) {
  const assoLine = association ? `<br>Association soutenue par ta collecte : <strong>${association}</strong>` : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Nouveau don pour toi !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${coureurPrenom} 👋</div><div class="intro">Nous sommes heureux de t'annoncer qu'un nouveau don vient d'être enregistré sur <strong>ta page de collecte Défi Enfance</strong> !</div><div class="don-box"><div class="don-amount">${montant} €</div><div class="don-label">Don reçu de ${donateur}</div></div><div class="card"><h3>📋 Coordonnées du donateur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#fb0089">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>N'hésite pas à remercier ${donateur} personnellement</strong> — un message sincère fait toujours une grande différence !</div><div class="cta-box"><p>✨ <strong>Et si tu faisais grimper ta collecte pour l'enfance encore plus haut ?</strong><br>Partage ta page et invite tes proches à te soutenir !</p><a href="${URL_COUREURS}" class="cta-btn">🏃 Voir ma page de collecte</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant le don.${assoLine}</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplDonEquipe({ chefPrenom, nomEquipe, donateur, montant, email_donateur }) {
  const isDE = nomEquipe === 'Défi Enfance';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header orange"><h1>${isDE ? '❤️ Don non fléché reçu !' : '🏆 Nouveau don pour votre équipe !'}</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${chefPrenom} 👋</div>${!isDE ? `<div style="margin-bottom:16px"><span class="badge">🏃 Équipe ${nomEquipe}</span></div>` : ''}<div class="intro">${isDE ? `Un don de <strong>${montant} €</strong> vient d'être reçu sans être fléché vers un coureur ou une équipe.` : `Excellente nouvelle ! Un nouveau don vient d'être enregistré pour soutenir <strong>votre équipe au Défi Enfance</strong>.`}</div><div class="don-box orange"><div class="don-amount orange">${montant} €</div><div class="don-label">Don reçu de ${donateur}</div></div><div class="card orange"><h3 class="orange">📋 Coordonnées du donateur</h3><div class="row orange"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row orange"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#ef6135">${email_donateur}</a></div></div></div><div class="note">${isDE ? `💌 N'hésitez pas à <strong>contacter ${donateur}</strong> pour le remercier et lui proposer de flécher son don !` : `💌 En tant que référent, <strong>n'hésitez pas à remercier ${donateur} au nom de toute l'équipe</strong> !`}</div>${!isDE ? `<div class="cta-box orange"><p>✨ <strong>Et si vous faisiez grimper votre collecte pour l'enfance encore plus haut ?</strong></p><a href="${URL_EQUIPES}" class="cta-btn orange">🏆 Voir la page de notre équipe</a></div>` : `<div class="cta-box orange"><p>✨ Invitez ${donateur} à flécher son prochain don vers un coureur ou une équipe !</p><a href="${URL_DON}" class="cta-btn orange">❤️ Page de don Défi Enfance</a></div>`}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant le don.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplInscriptionAsso({ nomAsso, coureur, email_coureur, ville, prenomReferent }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🏃 Nouveau coureur pour votre cause !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomReferent ? prenomReferent : ''} 👋</div><div class="intro">Bonne nouvelle ! Un coureur vient de <strong>choisir votre association ${nomAsso}</strong> pour courir lors du <strong>Défi Enfance${ville ? ' de ' + ville : ''}</strong>.</div><div class="don-box"><div class="don-amount" style="font-size:1.8rem">${coureur}</div><div class="don-label">Nouveau coureur inscrit !</div></div><div class="card"><h3>📋 Coordonnées du coureur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${coureur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_coureur}" style="color:#fb0089">${email_coureur}</a></div></div></div><div class="note magenta">💌 <strong>Prenez contact avec ${coureur}</strong> pour le remercier de son choix et l'accueillir chaleureusement !</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">💡 <strong>Conseil :</strong> Présentez vos actions et vos bénéficiaires. Plus le coureur est engagé, plus sa collecte sera importante !</div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Association bénéficiaire : <strong>${nomAsso}</strong><br>Email envoyé automatiquement dans les 10 minutes suivant l'inscription.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplInscriptionCoureur({ prenom, nomComplet }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">🚀 Vous pouvez désormais aider l'Association que vous avez choisie en invitant vos réseaux pro et perso à faire un don !</div><div class="cta-box"><p>Partagez le lien de don à vos contacts — en choisissant votre nom dans le formulaire, ils soutiennent votre collecte pour votre Association et le Plaidoyer du Défi Enfance.</p><a href="${URL_DON}" class="cta-btn">❤️ Page de don Défi Enfance</a></div><div class="note magenta">💡 Leur don est éligible à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur leur IR ou 60% sur leur IS s'ils donnent au nom de leur société.</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">📊 Suivez vos dons sur votre page enregistrée au <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">classement général des donateurs</a> (coureurs et équipes) du <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">Défi Enfance</a>.</div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Ensemble, on va soulever les énergies pour l'enfance.<br>Merci pour votre engagement !</div><div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplInscriptionSupporter({ prenom }) {
  const URL_ASSOS = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=associations&de_event=all';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">🚀 En tant que supporter, vous avez un rôle privilégié pour soutenir les coureurs engagés pour le Défi Enfance ! Dès maintenant, faites des dons et faites faire des dons pour les Associations choisies par les coureurs.</div><div class="card"><h3>💪 Comment agir dès maintenant ?</h3><div class="row"><span class="ic">🏃</span><div>Découvrez <a href="${URL_ASSOS}" style="color:#fb0089;font-weight:600">la liste des associations ici</a></div></div><div class="row"><span class="ic">❤️</span><div>Parrainez un coureur ou une équipe par un don</div></div><div class="row"><span class="ic">📢</span><div>Partagez la <a href="${URL_DON}" style="color:#fb0089;font-weight:600">page Faire un don</a></div></div></div><div class="note magenta">💡 Les dons soutiennent à <strong>50% les Associations</strong> parrainées par les coureurs et à <strong>50% le Plaidoyer du Défi Enfance</strong>. Tous les dons sont éligibles à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur leur IR ou 60% sur leur IS s'ils donnent au nom de leur société.</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">💬 Laissez un mot d'encouragement au coureur ou à l'équipe soutenue sur le formulaire de dons.<br><br>📊 Suivez ensuite l'évolution des dons sur le <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">classement général des donateurs</a> (coureurs et équipes) du <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">Défi Enfance</a>.</div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Ensemble, nous allons soulever les énergies pour l'enfance.<br>Merci du fond du cœur pour votre engagement !</div><div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ── Template merci donateur → coureur
function tplMerciDonateur({ prenomDonateur, montant, donateur, coureurPrenom, coureurNom, association }) {
  const URL_ASSOS = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=associations&de_event=all';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Merci pour votre don<br>à ${coureurPrenom} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> pour <strong>${coureurPrenom} ${coureurNom}</strong> fait une vraie différence ! En soutenant ${coureurPrenom}, vous contribuez directement à la collecte de l'<strong>Association ${association}</strong> (50% du montant de votre don) et au Plaidoyer du Défi Enfance (50% du montant de votre don).</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="margin-bottom:12px;font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em">L'impact de votre don</div><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div><div style="font-size:.9rem;font-weight:600;color:#1a0a12;margin-bottom:14px">Ces enfants ont besoin de vous :</div><div class="temoignage"><strong>"Ce sont les enfants de tout le monde. Ce sont les enfants de chacun."</strong><br><br>Jérôme Aucordier accompagne des enfants au quotidien dans un lieu de vie qui place chaque enfant au cœur de ses propres décisions. Pour lui, ces enfants ne sont pas des cas à gérer — ce sont un capital pour notre société.</div><div class="temoignage"><strong>"Défi Enfance, c'est un moyen que les jeunes soient entendus."</strong><br><br>Anne Loriot, éducatrice spécialisée en foyer, accueille des jeunes jour et nuit. Un jour, une jeune lui a dit : <em>"Est-ce que tu vas rester ?"</em> — une phrase qui dit tout. Ces enfants ne demandent pas grand-chose. Juste de la stabilité. Juste quelqu'un qui ne part pas.</div><div style="font-size:.86rem;color:#3d1830;line-height:1.7;background:#fff0f8;border-radius:12px;padding:18px 20px;margin-bottom:24px">Chaque enfant a le droit à son enfance. Nous avons comme belle mission de société de proposer à chacun, quelles que soient ses difficultés, de recevoir un accueil aimant, familial et sécurisant.<br><br><strong>Nous croyons que les enfants sont le plus grand capital de notre société.</strong></div><div style="text-align:center;margin-bottom:20px"><div style="font-size:.82rem;font-weight:600;color:#3d1830;margin-bottom:12px">Découvrez leurs témoignages :</div><div class="social-bar"><a href="${URL_LINKEDIN}" class="social-btn li">LinkedIn</a><a href="${URL_FACEBOOK}" class="social-btn fb">Facebook</a><a href="${URL_INSTAGRAM}" class="social-btn ig">Instagram</a></div></div><div class="cta-box"><p>✨ <strong>Envie d'aller encore plus loin ?</strong><br>Partagez le Défi Enfance autour de vous !</p><a href="${URL_DON}" class="cta-btn">❤️ Faire un don</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Cet email vous a été envoyé en remerciement de votre don de ${montant} €.<br>contact@defienfance.fr — defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ── Template merci donateur → équipe
function tplMerciDonateurEquipe({ prenomDonateur, montant, donateur, nomEquipe }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header orange"><h1>❤️ Merci pour votre don<br>à ${nomEquipe} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> pour l'équipe <strong>${nomEquipe}</strong> fait une vraie différence ! En soutenant cette équipe, vous contribuez à leur collecte et au Plaidoyer du Défi Enfance.</div><div style="text-align:center;background:linear-gradient(135deg,#fff5ef,#fff8ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="margin-bottom:12px;font-size:.78rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.08em">L'impact de votre don</div><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#ef6135">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#ef6135">+40</span><span class="lbl">associations soutenues</span></div></div></div><div style="font-size:.9rem;font-weight:600;color:#1a0a12;margin-bottom:14px">Ces enfants ont besoin de vous :</div><div class="temoignage"><strong>"Ce sont les enfants de tout le monde. Ce sont les enfants de chacun."</strong><br><br>Jérôme Aucordier accompagne des enfants au quotidien dans un lieu de vie qui place chaque enfant au cœur de ses propres décisions. Pour lui, ces enfants ne sont pas des cas à gérer — ce sont un capital pour notre société.</div><div class="temoignage"><strong>"Défi Enfance, c'est un moyen que les jeunes soient entendus."</strong><br><br>Anne Loriot, éducatrice spécialisée en foyer, accueille des jeunes jour et nuit. Un jour, une jeune lui a dit : <em>"Est-ce que tu vas rester ?"</em> — une phrase qui dit tout. Ces enfants ne demandent pas grand-chose. Juste de la stabilité. Juste quelqu'un qui ne part pas.</div><div style="font-size:.86rem;color:#3d1830;line-height:1.7;background:#fff0f8;border-radius:12px;padding:18px 20px;margin-bottom:24px">Chaque enfant a le droit à son enfance. Nous avons comme belle mission de société de proposer à chacun, quelles que soient ses difficultés, de recevoir un accueil aimant, familial et sécurisant.<br><br><strong>Nous croyons que les enfants sont le plus grand capital de notre société.</strong></div><div style="text-align:center;margin-bottom:20px"><div style="font-size:.82rem;font-weight:600;color:#3d1830;margin-bottom:12px">Découvrez leurs témoignages :</div><div class="social-bar"><a href="${URL_LINKEDIN}" class="social-btn li">LinkedIn</a><a href="${URL_FACEBOOK}" class="social-btn fb">Facebook</a><a href="${URL_INSTAGRAM}" class="social-btn ig">Instagram</a></div></div><div class="cta-box orange"><p>✨ <strong>Envie d'aller encore plus loin ?</strong><br>Partagez le Défi Enfance autour de vous !</p><a href="${URL_DON}" class="cta-btn orange">❤️ Faire un don</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Cet email vous a été envoyé en remerciement de votre don de ${montant} €.<br>contact@defienfance.fr — defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ── Template merci donateur → don global non fléché
function tplMerciDonateurGlobal({ prenomDonateur, montant, donateur }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>❤️ Merci pour<br>votre don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> au Défi Enfance fait une vraie différence dans la vie de milliers d'enfants. Merci du fond du cœur !</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="margin-bottom:12px;font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em">L'impact de votre don</div><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div><div style="font-size:.9rem;font-weight:600;color:#1a0a12;margin-bottom:14px">Ces enfants ont besoin de vous :</div><div class="temoignage"><strong>"Ce sont les enfants de tout le monde. Ce sont les enfants de chacun."</strong><br><br>Jérôme Aucordier accompagne des enfants au quotidien dans un lieu de vie qui place chaque enfant au cœur de ses propres décisions. Pour lui, ces enfants ne sont pas des cas à gérer — ce sont un capital pour notre société.</div><div class="temoignage"><strong>"Défi Enfance, c'est un moyen que les jeunes soient entendus."</strong><br><br>Anne Loriot, éducatrice spécialisée en foyer, accueille des jeunes jour et nuit. Un jour, une jeune lui a dit : <em>"Est-ce que tu vas rester ?"</em> — une phrase qui dit tout. Ces enfants ne demandent pas grand-chose. Juste de la stabilité. Juste quelqu'un qui ne part pas.</div><div style="font-size:.86rem;color:#3d1830;line-height:1.7;background:#fff0f8;border-radius:12px;padding:18px 20px;margin-bottom:24px">Chaque enfant a le droit à son enfance. Nous avons comme belle mission de société de proposer à chacun, quelles que soient ses difficultés, de recevoir un accueil aimant, familial et sécurisant.<br><br><strong>Nous croyons que les enfants sont le plus grand capital de notre société.</strong></div><div style="text-align:center;margin-bottom:20px"><div style="font-size:.82rem;font-weight:600;color:#3d1830;margin-bottom:12px">Découvrez leurs témoignages :</div><div class="social-bar"><a href="${URL_LINKEDIN}" class="social-btn li">LinkedIn</a><a href="${URL_FACEBOOK}" class="social-btn fb">Facebook</a><a href="${URL_INSTAGRAM}" class="social-btn ig">Instagram</a></div></div><div class="cta-box"><p>✨ <strong>Envie d'aller encore plus loin ?</strong><br>Partagez le Défi Enfance autour de vous !</p><a href="${URL_DON}" class="cta-btn">❤️ Faire un don</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Cet email vous a été envoyé en remerciement de votre don de ${montant} €.<br>contact@defienfance.fr — defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}
async function fetchOhmePayments() {
  if (!CONFIG.ohmeClientName || !CONFIG.ohmeClientSecret || !CONFIG.ohmeBase) {
    addLog('Clé API Ohme (client-name ou client-secret) ou URL manquante', 'warn');
    return [];
  }
  try {
    // Récupérer tous les paiements depuis le 1er avril 2026
    const url = `${CONFIG.ohmeBase}/api/v1/payments?limit=500&since_date=2026-03-01`;

    const res = await fetch(url, {
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

// Version du serveur — incrémenter à chaque mise à jour de server.js
const SERVER_VERSION = '55';
const VERSION_FILE   = '/opt/render/project/src/defi-enfance-version.txt';

function getLastVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) return fs.readFileSync(VERSION_FILE, 'utf8').trim();
  } catch(e) {}
  return null;
}

function saveCurrentVersion() {
  try { fs.writeFileSync(VERSION_FILE, SERVER_VERSION); } catch(e) {}
}

// Premier poll après redémarrage = mode validation manuelle
// UNIQUEMENT si la version du server.js a changé
const lastVersion = getLastVersion();
let premierPoll = lastVersion !== SERVER_VERSION;

if (premierPoll) {
  console.log(`🆕 Nouvelle version détectée (${lastVersion || 'aucune'} → ${SERVER_VERSION}) — mode validation manuelle activé`);
  saveCurrentVersion();
} else {
  console.log(`✅ Même version (${SERVER_VERSION}) — mode automatique direct`);
}

async function processPayments(payments, ignoreDate = false) {
  let newCount = 0;

  for (const p of payments) {
    if (state.processedIds.has(String(p.id))) continue;

    // Seuls les paiements Défi Enfance ont nom_de_levent renseigné
    const eventName = (
      p.nom_de_levent ||
      (p.custom_fields && p.custom_fields.nom_de_levent) ||
      ''
    ).trim();
    if (!eventName) {
      state.processedIds.add(String(p.id));
      continue;
    }

    // ── MODE PREMIER POLL : mise en attente pour validation manuelle ──
    if (premierPoll && !ignoreDate) {
      // Récupérer les infos du donateur/coureur pour afficher dans le dashboard
      const contactDon = await fetchOhmeContactById(p.contact_id);
      const prenom = contactDon ? (contactDon.firstname || contactDon.first_name || '') : '';
      const nom    = contactDon ? (contactDon.lastname  || contactDon.last_name  || '') : '';
      const donateur = `${prenom} ${nom}`.trim() || 'Inconnu';
      const emailDon = contactDon ? (contactDon.email || '') : '';
      const typeId   = p.payment_type_id;
      const typeLabel = typeId === 1 ? 'Don' : typeId === 3 ? 'Inscription' : 'Autre';
      const montant  = p.amount || '?';
      const date     = p.date || new Date().toISOString();

      addDonEnAttente({
        paiementId: String(p.id),
        donateur,
        emailDon,
        montant,
        date,
        eventName,
        typeLabel,
        modeValidation: true,
      });
      // Marquer comme traité immédiatement pour éviter retraitement au poll suivant
      state.processedIds.add(String(p.id));
      addLog(`⏸️ [Démarrage] ${typeLabel} ${montant}€ de ${donateur} — en attente de validation`, 'warn');
      newCount++;
      continue;
    }

    // Types de paiement Ohme : 1 = Don, 3 = Billetterie (IDs numériques)
    const typeId = p.payment_type_id;
    const isDon        = typeId === 1;
    const isBilletterie = typeId === 3;

    // ── CAS 1 : DON ──────────────────────────────────────
    if (isDon) {
      state.stats.dons++;
      newCount++;

      // Récupérer les infos du donateur (particulier ou structure)
      const infos    = await fetchInfosDonateur(p);
      const donateur = infos.donateur;
      const emailDon = infos.emailDon;
      const prenomMerci = infos.prenomMerci;
      const montant  = p.amount || '?';

      // Champs personnalisés Ohme
      const cf = p.custom_fields || p;
      const coureurParraine = (cf.coureur_parraine || '').trim();
      const equipeParraine  = (cf.equipe_parraine  || '').trim();

      if (coureurParraine) {
        // Chercher le contact dans Ohme pour récupérer son email
        const contact = await fetchOhmeContactByName(coureurParraine);
        const emailCoureur = contact ? (contact.email || '') : '';
        const coureurPrenom = coureurParraine.split(' ')[0];
        const assoSoutenue = (cf.asso_soutenue || p.asso_soutenue || '').trim();

        if (emailCoureur) {
          const html = tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur: emailDon, association: assoSoutenue });
          const ok = await sendBrevo(emailCoureur, `❤️ [live] ${prenomMerci || donateur.split(' ')[0]} a fait un don pour vous !`, html);
          if (ok) {
            state.stats.sent++;
            addLog(`✅ Don ${montant}€ de ${donateur} → ${coureurParraine}`, 'ok');
            addEvent('❤️', `Don de ${montant} €`, `${donateur} → ${coureurParraine}`, 'don');
            sendMerciDonateur({ email: emailDon, prenom: prenomMerci || donateur.split(' ')[0], montant, donateur, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: assoSoutenue });
          }

          const equipe = await fetchEquipeCoureur(contact ? contact.id : null);
          if (equipe) {
            const structure  = await fetchOhmeStructureByName(equipe);
            const chefEmail  = structure ? (structure.email_referent_defi_enfance || '') : '';
            const chefPrenom = structure ? (structure.prenom_du_referent_defi_enfance || 'Bonjour') : 'Bonjour';
            if (chefEmail) {
              const htmlEquipe = tplDonEquipe({ chefPrenom, nomEquipe: equipe, donateur, montant, email_donateur: emailDon });
              const okEquipe = await sendBrevo(chefEmail, `❤️ [live] ${prenomMerci || donateur.split(' ')[0]} a fait un don pour votre équipe !`, htmlEquipe);
              if (okEquipe) {
                state.stats.sent++;
                addLog(`✅ Don ${montant}€ → chef équipe ${equipe} (${chefPrenom}) notifié`, 'ok');
                addEvent('🏆', `Don équipe ${montant} €`, `${donateur} → équipe ${equipe}`, 'don');
              }
            } else {
              addLog(`⚠️ Équipe "${equipe}" du coureur — email référent introuvable`, 'warn');
            }
          }
        } else {
          addLog(`⚠️ Don → coureur "${coureurParraine}" introuvable dans Ohme`, 'warn');
        }

      } else if (equipeParraine) {
        const structure  = await fetchOhmeStructureByName(equipeParraine);
        const chefEmail  = structure ? (structure.email_referent_defi_enfance   || '') : '';
        const chefPrenom = structure ? (structure.prenom_du_referent_defi_enfance || structure.nom_du_referent_defi_enfance?.split(' ')[0] || 'Bonjour') : 'Bonjour';

        if (chefEmail) {
          const html = tplDonEquipe({ chefPrenom, nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon });
          const ok = await sendBrevo(chefEmail, `❤️ [live] ${prenomMerci || donateur.split(' ')[0]} a fait un don pour votre équipe !`, html);
          if (ok) {
            state.stats.sent++;
            addLog(`✅ Don ${montant}€ de ${donateur} → équipe ${equipeParraine} (${chefPrenom})`, 'ok');
            addEvent('🏆', `Don de ${montant} € pour équipe`, `${donateur} → ${equipeParraine}`, 'don');
            sendMerciDonateur({ email: emailDon, prenom: prenomMerci || donateur.split(' ')[0], montant, donateur, nomEquipe: equipeParraine });
          }
        } else {
          addLog(`⚠️ Don → équipe "${equipeParraine}" — email référent introuvable`, 'warn');
        }

      } else {
        // Don non fléché → mise en ATTENTE (pas d'email automatique)
        addLog(`⏸️ Don ${montant}€ de ${donateur} — non fléché, mis en attente de validation`, 'warn');
        addDonEnAttente({
          paiementId: p.id,
          donateur,
          emailDon,
          montant,
          date: p.date || new Date().toISOString(),
          eventName,
        });
        addEvent('⏸️', `Don en attente ${montant} €`, `${donateur} — à valider`, 'don');
      }
    }

    // ── CAS 2 : BILLETTERIE ───────────────────────────────
    else if (isBilletterie) {
      state.stats.bill++;
      newCount++;

      // Récupérer les infos du coureur via contact_id
      const contactCoureur = await fetchOhmeContactById(p.contact_id);
      const prenomC      = contactCoureur ? (contactCoureur.firstname || contactCoureur.first_name || '') : '';
      const nomC         = contactCoureur ? (contactCoureur.lastname  || contactCoureur.last_name  || '') : '';
      const coureur      = `${prenomC} ${nomC}`.trim() || 'Coureur';
      const emailCoureur = contactCoureur ? (contactCoureur.email || '') : '';
      const cf           = p.custom_fields || p;
      const nomAsso      = (cf.asso_soutenue || '').trim();
      const ville        = eventName.replace(/défi\s*enfance?\s*/gi, '').replace(/\d{4}/g, '').trim();

      const isSupporter = eventName.toUpperCase().includes('#SUPPORTERS');

      // Règle : si équipe ET asso soutenue sont tous les deux vides → pas d'email
      const cfC = p.custom_fields || p;
      const equipeC = (cfC.equipe || '').trim();
      if (!equipeC && !nomAsso) {
        addLog(`⏭️ Billet ${coureur} — équipe et asso vides → pas d'email`, 'info');
        state.processedIds.add(String(p.id));
        continue;
      }

      if (isSupporter) {
        // ── SUPPORTER → email de bienvenue au supporter
        if (emailCoureur) {
          const html = tplInscriptionSupporter({ prenom: prenomC || coureur });
          const ok = await sendBrevo(emailCoureur, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, html);
          if (ok) {
            state.stats.sent++;
            addLog(`✅ Email bienvenue supporter → ${coureur} (${emailCoureur})`, 'ok');
            addEvent('🚀', `Bienvenue supporter`, coureur, 'bill');
          }
        } else {
          addLog(`⚠️ Supporter ${coureur} — email introuvable`, 'warn');
        }

      } else {
        // ── COUREUR → email de bienvenue au coureur + email à l'association
        if (emailCoureur) {
          const html = tplInscriptionCoureur({ prenom: prenomC || coureur, nomComplet: coureur });
          const ok = await sendBrevo(emailCoureur, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, html);
          if (ok) {
            state.stats.sent++;
            addLog(`✅ Email bienvenue coureur → ${coureur} (${emailCoureur})`, 'ok');
            addEvent('🚀', `Bienvenue coureur`, coureur, 'bill');
          }
        } else {
          addLog(`⚠️ Coureur ${coureur} — email introuvable`, 'warn');
        }

        // Email à l'association soutenue
        // Règle : ne pas envoyer si asso = équipe du coureur
        if (nomAsso && nomAsso.toLowerCase() === equipeC.toLowerCase()) {
          addLog(`⏭️ Inscription ${coureur} — asso "${nomAsso}" = équipe → email asso ignoré`, 'info');
        } else if (nomAsso) {
          const structure      = await fetchOhmeStructureByName(nomAsso);
          const emailAsso      = structure ? (structure.email_referent_defi_enfance     || '') : '';
          const prenomReferent = structure ? (structure.prenom_du_referent_defi_enfance || '') : '';

          if (emailAsso) {
            const html = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailCoureur, ville, prenomReferent });
            const ok = await sendBrevo(emailAsso, `🏃 [live] ${prenomC || coureur} court pour vous !`, html);
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
    }

    state.processedIds.add(String(p.id));
  }

  // Sauvegarder les IDs traités sur disque après chaque poll
  saveProcessedIds();

  if (newCount === 0) addLog('Aucun nouveau paiement à traiter', 'info');
}

// ── Récupérer les infos du donateur (particulier ou structure)
async function fetchInfosDonateur(p) {
  const contact = await fetchOhmeContactById(p.contact_id);
  const prenomContact = contact ? (contact.firstname || contact.first_name || '') : '';
  const nomContact    = contact ? (contact.lastname  || contact.last_name  || '') : '';
  const emailContact  = contact ? (contact.email || '') : '';

  // Si don d'une structure → récupérer les infos du référent via structure_ohme_ids
  if (p.donator_nature === 'organization' && contact) {
    const structureOhmeIds = contact.structure_ohme_ids || [];
    const structureOhmeId  = structureOhmeIds.length > 0 ? structureOhmeIds[0] : null;

    if (structureOhmeId) {
      try {
        // Étape 1 : trouver la structure par ohme_id
        await sleep(OHME_DELAY_MS);
        const r = await fetch(
          `${CONFIG.ohmeBase}/api/v1/structures?ohme_id=${structureOhmeId}&limit=1`,
          { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
        );
        if (r.ok) {
          const json = await r.json();
          const items = json.data || [];
          if (items.length > 0) {
            const sItem = items[0];
            // Étape 2 : récupérer la fiche individuelle pour les champs personnalisés
            await sleep(OHME_DELAY_MS);
            const r2 = await fetch(
              `${CONFIG.ohmeBase}/api/v1/structures/${sItem.id}`,
              { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
            );
            if (r2.ok) {
              const json2 = await r2.json();
              const s  = json2.data || json2;
              const cf = s.custom_fields || s;
              const emailRef     = cf.email_referent_defi_enfance     || s.email_referent_defi_enfance     || emailContact;
              const prenomRef    = cf.prenom_du_referent_defi_enfance || s.prenom_du_referent_defi_enfance || prenomContact;
              const nomStructure = s.name || sItem.name || `${prenomContact} ${nomContact}`.trim();
              addLog(`🏢 Don structure : ${nomStructure} — référent: ${prenomRef} (${emailRef})`, 'info');
              return {
                donateur:     nomStructure,
                emailDon:     emailRef,
                prenomMerci:  prenomRef,
                isStructure:  true,
                nomStructure,
              };
            }
          }
        }
      } catch(e) {
        addLog(`⚠️ Impossible de récupérer la structure du donateur : ${e.message}`, 'warn');
      }
    }
  }

  // Particulier → infos classiques
  return {
    donateur:    `${prenomContact} ${nomContact}`.trim() || 'Donateur anonyme',
    emailDon:    emailContact,
    prenomMerci: prenomContact,
    isStructure: false,
    nomStructure: null,
  };
}
async function fetchOhmeContactById(contactId) {
  if (!contactId) return null;
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(
      `${CONFIG.ohmeBase}/api/v1/contacts/${contactId}`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (!res.ok) {
      addLog(`⚠️ Contact ID ${contactId} erreur ${res.status}`, 'warn');
      return null;
    }
    const json = await res.json();
    return json.data || json;
  } catch(e) {
    addLog(`⚠️ Exception fetchContactById ${contactId} : ${e.message}`, 'warn');
    return null;
  }
}

// ── Chercher un contact Ohme par nom (pour récupérer l'email du coureur parrainé)
async function fetchOhmeContactByName(name) {
  try {
    await sleep(OHME_DELAY_MS);
    const parts     = name.trim().split(' ');
    const firstname = parts[0] || '';
    const lastname  = parts.slice(1).join(' ') || '';

    const params = new URLSearchParams({ limit: '5' });
    if (firstname) params.set('firstname', firstname);
    if (lastname)  params.set('lastname',  lastname);

    const res = await fetch(
      `${CONFIG.ohmeBase}/api/v1/contacts?${params.toString()}`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (!res.ok) {
      addLog(`⚠️ Contacts API erreur ${res.status} pour "${name}"`, 'warn');
      return null;
    }
    const json = await res.json();
    const items = json.data || [];

    if (items.length === 0) {
      addLog(`⚠️ Contact "${name}" introuvable dans Ohme`, 'warn');
      return null;
    }

    // Trouver le contact dont le nom complet correspond exactement
    const contact = items.find(c => {
      const fullName = `${c.firstname || c.first_name || ''} ${c.lastname || c.last_name || ''}`.trim().toLowerCase();
      return fullName === name.toLowerCase();
    }) || items[0];

    const email = contact.email || '';
    addLog(`🔍 Contact "${contact.firstname || contact.first_name} ${contact.lastname || contact.last_name}" trouvé — email: "${email || 'VIDE'}"`, 'info');
    return { ...contact, email };
  } catch(e) {
    addLog(`⚠️ Exception fetchContact "${name}" : ${e.message}`, 'warn');
    return null;
  }
}

// Délai pour éviter le rate limiting Ohme (429)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OHME_DELAY_MS = 800; // 800ms entre chaque appel API Ohme

// ── Récupérer l'équipe d'un coureur depuis son inscription billetterie
async function fetchEquipeCoureur(contactId) {
  if (!contactId) return null;
  try {
    await sleep(OHME_DELAY_MS);
    // Chercher le paiement de billetterie (type 3) de ce contact
    const res = await fetch(
      `${CONFIG.ohmeBase}/api/v1/payments?contact_id=${contactId}&payment_type_id=3&limit=10`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const items = json.data || [];
    // Chercher un paiement Défi Enfance avec une équipe renseignée
    for (const p of items) {
      const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').toUpperCase();
      if (!eventName.includes('ENFANCE')) continue;
      const cf = p.custom_fields || p;
      const equipe = (cf.equipe || '').trim();
      if (equipe) {
        addLog(`🔍 Équipe du coureur trouvée : ${equipe}`, 'info');
        return equipe;
      }
    }
    return null;
  } catch(e) {
    addLog(`⚠️ Exception fetchEquipeCoureur : ${e.message}`, 'warn');
    return null;
  }
}

// ── Chercher une structure Ohme par nom (pour récupérer l'email référent)
async function fetchOhmeStructureByName(name) {
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(
      `${CONFIG.ohmeBase}/api/v1/structures?name=${encodeURIComponent(name)}&limit=5`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (!res.ok) {
      addLog(`⚠️ Structures API erreur ${res.status} pour "${name}"`, 'warn');
      return null;
    }
    const json = await res.json();
    const items = json.data || [];

    if (items.length === 0) {
      addLog(`⚠️ Structure "${name}" introuvable dans Ohme`, 'warn');
      return null;
    }

    // Trouver la correspondance exacte ou prendre la première
    const structure = items.find(s => (s.name || '').toLowerCase() === name.toLowerCase()) || items[0];

    // Étape 2 : récupérer la structure individuelle pour avoir les champs personnalisés
    await sleep(OHME_DELAY_MS);
    const res2 = await fetch(
      `${CONFIG.ohmeBase}/api/v1/structures/${structure.id}`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (!res2.ok) {
      addLog(`⚠️ Erreur récupération structure individuelle id=${structure.id}`, 'warn');
      return structure; // on retourne quand même ce qu'on a
    }
    const detail = await res2.json();
    const s = detail.data || detail;
    const cf = s.custom_fields || s;

    const result = {
      ...s,
      email_referent_defi_enfance:     cf.email_referent_defi_enfance     || s.email_referent_defi_enfance     || '',
      prenom_du_referent_defi_enfance: cf.prenom_du_referent_defi_enfance  || s.prenom_du_referent_defi_enfance || '',
      nom_du_referent_defi_enfance:    cf.nom_du_referent_defi_enfance     || s.nom_du_referent_defi_enfance    || '',
    };

    addLog(`🔍 Structure "${s.name}" — email référent: "${result.email_referent_defi_enfance || 'VIDE'}"`, 'info');
    return result;

  } catch(e) {
    addLog(`⚠️ Exception fetchStructure "${name}" : ${e.message}`, 'warn');
    return null;
  }
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
        const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').trim();
        if (!eventName) return false;
        const typeId = p.payment_type_id;
        const date   = new Date(p.date || p.created_at || 0);
        if (typeId === 1 && date < RATTRAPAGE_DATE_DONS)  return false;
        if (typeId === 3 && date < RATTRAPAGE_DATE_BILL)  return false;
        return typeId === 1 || typeId === 3;
      });

      rattrapage.total = eligibles.length;
      rattrapageLog(`${eligibles.length} paiement(s) éligible(s) au rattrapage`, 'info');

      for (const p of eligibles) {
        rattrapage.done++;
        const typeId = p.payment_type_id;
        const date   = new Date(p.date || p.created_at || 0).toLocaleDateString('fr-FR');
        const cf     = p.custom_fields || p;

        // ── DON ──
        if (typeId === 1) {
          // Récupérer les infos du donateur via contact_id
          const contactDon  = await fetchOhmeContactById(p.contact_id);
          const prenomDon   = contactDon ? (contactDon.firstname || contactDon.first_name || '') : '';
          const nomDon      = contactDon ? (contactDon.lastname  || contactDon.last_name  || '') : '';
          const donateur    = `${prenomDon} ${nomDon}`.trim() || 'Donateur anonyme';
          const emailDon    = contactDon ? (contactDon.email || '') : '';
          const montant     = p.amount || '?';
          const coureurParraine = (cf.coureur_parraine || '').trim();
          const equipeParraine  = (cf.equipe_parraine  || '').trim();

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
            const structure  = await fetchOhmeStructureByName(equipeParraine);
            const chefEmail  = structure ? (structure.email_referent_defi_enfance    || '') : '';
            const chefPrenom = structure ? (structure.prenom_du_referent_defi_enfance || structure.nom_du_referent_defi_enfance?.split(' ')[0] || 'Bonjour') : 'Bonjour';
            if (chefEmail) {
              const html = tplDonEquipe({ chefPrenom, nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon });
              const ok = await sendBrevo(chefEmail, '❤️ Nouveau don pour votre équipe au Défi Enfance !', html);
              if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Don ${montant}€ de ${donateur} → équipe ${equipeParraine} (${chefPrenom})`, 'ok'); }
              else { rattrapage.errors++; }
            } else { rattrapage.skipped++; rattrapageLog(`⚠️ [${date}] Équipe "${equipeParraine}" — référent introuvable`, 'warn'); }

          } else {
            // Don non fléché → notifier la structure "Défi Enfance"
            const structure  = await fetchOhmeStructureByName('Défi Enfance');
            const chefEmail  = structure ? (structure.email_referent_defi_enfance    || '') : '';
            const chefPrenom = structure ? (structure.prenom_du_referent_defi_enfance || structure.nom_du_referent_defi_enfance?.split(' ')[0] || 'Bonjour') : 'Bonjour';
            if (chefEmail) {
              const html = tplDonEquipe({ chefPrenom, nomEquipe: 'Défi Enfance', donateur, montant, email_donateur: emailDon });
              const ok = await sendBrevo(chefEmail, '❤️ Nouveau don non fléché pour le Défi Enfance !', html);
              if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Don non fléché ${montant}€ de ${donateur} → Défi Enfance`, 'ok'); }
              else { rattrapage.errors++; }
            } else { rattrapage.skipped++; rattrapageLog(`⚠️ [${date}] Don non fléché — structure "Défi Enfance" introuvable`, 'warn'); }
          }
        }

        // ── BILLETTERIE ──
        else if (typeId === 3) {
          // Récupérer les infos du coureur via contact_id
          const contactC    = await fetchOhmeContactById(p.contact_id);
          const prenomC     = contactC ? (contactC.firstname || contactC.first_name || '') : '';
          const nomC        = contactC ? (contactC.lastname  || contactC.last_name  || '') : '';
          const coureur     = `${prenomC} ${nomC}`.trim() || 'Coureur';
          const emailCoureur= contactC ? (contactC.email || '') : '';

          if (shouldSkipBilletterie(p)) {
            rattrapage.skipped++;
            rattrapageLog(`⏭️ [${date}] Inscription ${coureur} — même asso que l'équipe, ignoré`, 'info');
          } else {
            const nomAsso  = (cf.asso_soutenue || '').trim();
            const eventNom = (cf.nom_de_levent || p.nom_de_levent || '');
            const ville    = eventNom.replace(/défi\s*enfance?\s*/gi, '').replace(/\d{4}/g, '').trim();

            if (nomAsso) {
              const structure      = await fetchOhmeStructureByName(nomAsso);
              const emailAsso      = structure ? (structure.email_referent_defi_enfance     || '') : '';
              const prenomReferent = structure ? (structure.prenom_du_referent_defi_enfance || '') : '';
              if (emailAsso) {
                const html = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailCoureur, ville, prenomReferent });
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

// Version sans filtre date plancher pour les envois forcés
async function processPaymentsForced(payments) {
  await processPayments(payments, true);
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

  if (premierPoll) {
    addLog('⚠️ Premier poll après redémarrage — paiements récents mis en attente de validation', 'warn');
  }

  await processPayments(payments);

  // Désactiver le mode premier poll après le premier cycle
  if (premierPoll) {
    premierPoll = false;
    saveProcessedIds(); // ← sauvegarder immédiatement tous les IDs mis en attente
    addLog('✅ Mode validation manuelle terminé — surveillance automatique active', 'ok');
  }
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
  const { to, template } = req.body;
  if (!to) return res.status(400).json({ error: 'Email requis' });

  const donnees = {
    don_coureur: {
      subject: '🧪 Test — ❤️ Nouveau don pour ton Défi Enfance !',
      html: tplDonCoureur({ coureurPrenom: 'Pierre', donateur: 'Jean-Claude Martin', montant: '20', email_donateur: 'jc.martin@test.fr', association: 'Les Enfants du Soleil' })
    },
    don_equipe: {
      subject: '🧪 Test — 🏆 Nouveau don pour votre équipe !',
      html: tplDonEquipe({ chefPrenom: 'Sophie', nomEquipe: 'Les Gazelles Solidaires', donateur: 'Marie Dupont', montant: '50', email_donateur: 'marie.dupont@test.fr' })
    },
    don_nonfleche: {
      subject: '🧪 Test — ❤️ Don non fléché reçu !',
      html: tplDonEquipe({ chefPrenom: 'Responsable', nomEquipe: 'Défi Enfance', donateur: 'Thomas Bernard', montant: '30', email_donateur: 't.bernard@test.fr' })
    },
    inscription_asso: {
      subject: '🧪 Test — 🏃 Nouveau coureur pour votre cause !',
      html: tplInscriptionAsso({ nomAsso: 'Espoir Enfants', coureur: 'Lucas Moreau', email_coureur: 'l.moreau@test.fr', ville: 'Angers', prenomReferent: 'Sophie' })
    },
    inscription_coureur: {
      subject: '🧪 Test — 🚀 Bienvenue coureur Défi Enfance !',
      html: tplInscriptionCoureur({ prenom: 'Lucas', nomComplet: 'Lucas Moreau' })
    },
    inscription_supporter: {
      subject: '🧪 Test — 🚀 Bienvenue supporter Défi Enfance !',
      html: tplInscriptionSupporter({ prenom: 'Marie' })
    },
    merci_donateur: {
      subject: '🧪 Test — ❤️ Merci pour votre don à Pierre !',
      html: tplMerciDonateur({ prenomDonateur: 'Jean-Claude', montant: '20', donateur: 'Jean-Claude Martin', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil' })
    },
    merci_donateur_equipe: {
      subject: '🧪 Test — ❤️ Merci pour votre don à Les Gazelles !',
      html: tplMerciDonateurEquipe({ prenomDonateur: 'Jean-Claude', montant: '50', donateur: 'Jean-Claude Martin', nomEquipe: 'Les Gazelles Solidaires' })
    },
    merci_donateur_global: {
      subject: '🧪 Test — ❤️ Merci pour votre don !',
      html: tplMerciDonateurGlobal({ prenomDonateur: 'Jean-Claude', montant: '30', donateur: 'Jean-Claude Martin' })
    },
  };

  const tpl = donnees[template] || donnees['don_coureur'];
  const ok = await sendBrevo(to, tpl.subject, tpl.html);
  res.json({ success: ok });
});

// Forcer l'envoi pour un paiement spécifique par son ID Ohme ou external_id (GiveWP)
app.post('/api/forcer-paiement', async (req, res) => {
  const { paiementId } = req.body;
  if (!paiementId) return res.status(400).json({ error: 'ID paiement requis' });

  addLog(`🔧 Envoi forcé pour paiement : ${paiementId}`, 'info');

  try {
    let p = null;

    // Détecter si c'est un external_id (GiveWP-xxxxx) ou un ID Ohme numérique
    const isExternalId = isNaN(paiementId.replace(/[^0-9]/g, '')) || paiementId.includes('-') || paiementId.includes('GiveWP');

    if (isExternalId) {
      // Chercher par external_id dans Ohme
      await sleep(OHME_DELAY_MS);
      const r = await fetch(
        `${CONFIG.ohmeBase}/api/v1/payments?external_id=${encodeURIComponent(paiementId)}&limit=5`,
        { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
      );
      if (!r.ok) return res.json({ success: false, error: `Erreur API Ohme HTTP ${r.status}` });
      const json = await r.json();
      const items = json.data || [];
      if (items.length === 0) return res.json({ success: false, error: `Paiement "${paiementId}" introuvable dans Ohme` });
      p = items[0];
    } else {
      // Chercher par ID Ohme direct
      await sleep(OHME_DELAY_MS);
      const r = await fetch(
        `${CONFIG.ohmeBase}/api/v1/payments/${paiementId}`,
        { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
      );
      if (!r.ok) return res.json({ success: false, error: `Paiement ${paiementId} introuvable (HTTP ${r.status})` });
      const json = await r.json();
      p = json.data || json;
    }

    if (!p) return res.json({ success: false, error: 'Paiement introuvable' });

    addLog(`🔧 Paiement trouvé : ID ${p.id} — external_id: ${p.external_id || 'N/A'}`, 'info');

    // Retirer l'ID sous toutes ses formes pour forcer le retraitement
    state.processedIds.delete(String(p.id));
    state.processedIds.delete(Number(p.id));
    state.processedIds.delete(p.id);

    addLog(`🔧 ID ${p.id} retiré des traités — lancement du traitement forcé…`, 'info');
    await processPaymentsForced([p]);
    saveProcessedIds();

    res.json({ success: true, message: `Paiement ${p.external_id || p.id} traité avec succès` });
  } catch(e) {
    addLog(`❌ Erreur forcer-paiement : ${e.message}`, 'error');
    res.json({ success: false, error: e.message });
  }
});

app.get('/', (req, res) => {
  const pwd = process.env.DASHBOARD_PASSWORD || '';
  if (pwd) {
    const cookie = req.headers.cookie || '';
    const token = cookie.split(';').find(c => c.trim().startsWith('dash_token='));
    const val = token ? token.trim().split('=').slice(1).join('=').trim() : '';
    if (val !== pwd) return res.redirect('/login');
  }
  // Lire index.html et injecter le mot de passe comme variable globale
  const fs2 = require('fs');
  const indexPath = path.join(__dirname, 'public', 'index.html');
  let html = fs2.readFileSync(indexPath, 'utf8');
  html = html.replace('</head>', `<script>window.__DASH_PWD__ = ${JSON.stringify(pwd)};</script></head>`);
  res.send(html);
});
app.post('/api/poll-now', async (req, res) => {
  await poll();
  res.json({ success: true, stats: state.stats });
});

// ── DONS EN ATTENTE ──────────────────────────────────
// Lister les dons en attente
app.get('/api/dons-attente', (req, res) => {
  res.json(state.donsEnAttente);
});

// Valider un don en attente — relit le paiement dans Ohme et envoie le bon email
app.post('/api/dons-attente/:paiementId/valider', async (req, res) => {
  const { paiementId } = req.params;

  const don = state.donsEnAttente.find(d => String(d.paiementId) === String(paiementId));
  if (!don) {
    addLog(`⚠️ Don introuvable : ${paiementId} — liste: ${state.donsEnAttente.map(d=>d.paiementId).join(', ')}`, 'warn');
    return res.status(404).json({ error: `Don introuvable (ID: ${paiementId})` });
  }

  // Relire le paiement dans Ohme pour avoir les données à jour
  let paiement = null;
  try {
    await sleep(OHME_DELAY_MS);
    const res2 = await fetch(
      `${CONFIG.ohmeBase}/api/v1/payments/${paiementId}`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (res2.ok) {
      const json = await res2.json();
      paiement = json.data || json;
    }
  } catch(e) {
    addLog(`⚠️ Impossible de relire le paiement ${paiementId} : ${e.message}`, 'warn');
  }

  if (!paiement) return res.json({ success: false, error: 'Impossible de relire le paiement dans Ohme' });

  const cf              = paiement.custom_fields || paiement;
  const typeId          = paiement.payment_type_id;
  const coureurParraine = (cf.coureur_parraine || '').trim();
  const equipeParraine  = (cf.equipe_parraine  || '').trim();
  const { donateur, emailDon, montant } = don;
  let ok = false;

  // ── CAS BILLETTERIE (inscription coureur) → notifier l'association ──
  if (typeId === 3) {
    const nomAsso = (cf.asso_soutenue || '').trim();
    const eventNom = (cf.nom_de_levent || paiement.nom_de_levent || '');
    const ville = eventNom.replace(/défi\s*enfance?\s*/gi, '').replace(/\d{4}/g, '').trim();

    // Récupérer les infos du coureur
    const contactCoureur = await fetchOhmeContactById(paiement.contact_id);
    const prenomC  = contactCoureur ? (contactCoureur.firstname || contactCoureur.first_name || '') : '';
    const nomC     = contactCoureur ? (contactCoureur.lastname  || contactCoureur.last_name  || '') : '';
    const coureur  = `${prenomC} ${nomC}`.trim() || donateur;
    const emailCoureur = contactCoureur ? (contactCoureur.email || '') : '';

    if (nomAsso) {
      const structure      = await fetchOhmeStructureByName(nomAsso);
      const emailAsso      = structure ? (structure.email_referent_defi_enfance     || '') : '';
      const prenomReferent = structure ? (structure.prenom_du_referent_defi_enfance || '') : '';
      if (emailAsso) {
        const html = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailCoureur, ville, prenomReferent });
        ok = await sendBrevo(emailAsso, '🏃 Nouveau coureur pour votre cause — Défi Enfance !', html);
        if (ok) {
          state.stats.sent++;
          addLog(`✅ Inscription validée → asso ${nomAsso} (${coureur})`, 'ok');
          addEvent('🏃', `Inscription validée`, `${coureur} → ${nomAsso}`, 'bill');
        }
      } else {
        return res.json({ success: false, error: `Association "${nomAsso}" — email référent introuvable` });
      }
    } else {
      return res.json({ success: false, error: 'Champ asso_soutenue vide dans Ohme' });
    }

  // ── CAS DON → coureur ou équipe ──
  } else if (coureurParraine) {
    // Fléché vers un coureur
    const contact      = await fetchOhmeContactByName(coureurParraine);
    const emailCoureur = contact ? (contact.email || '') : '';
    const coureurPrenom = coureurParraine.split(' ')[0];
    const assoSoutenue  = (cf.asso_soutenue || '').trim();
    if (emailCoureur) {
      // 1. Email au coureur
      const html = tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur: emailDon, association: assoSoutenue });
      ok = await sendBrevo(emailCoureur, '❤️ Nouveau don pour ton Défi Enfance !', html);
      if (ok) {
        state.stats.sent++;
        addLog(`✅ Don validé → coureur ${coureurParraine} (${montant}€)`, 'ok');
        addEvent('❤️', `Don validé ${montant}€`, `${donateur} → ${coureurParraine}`, 'don');
        // 2. Email merci J+1 au donateur
        sendMerciDonateur({ email: emailDon, prenom: donateur.split(' ')[0], montant, donateur });
      }
      // 3. Email au chef d'équipe si le coureur appartient à une équipe
      const equipe = await fetchEquipeCoureur(contact ? contact.id : null);
      if (equipe) {
        const structure  = await fetchOhmeStructureByName(equipe);
        const chefEmail  = structure ? (structure.email_referent_defi_enfance || '') : '';
        const chefPrenom = structure ? (structure.prenom_du_referent_defi_enfance || 'Bonjour') : 'Bonjour';
        if (chefEmail) {
          const htmlEquipe = tplDonEquipe({ chefPrenom, nomEquipe: equipe, donateur, montant, email_donateur: emailDon });
          const okEquipe = await sendBrevo(chefEmail, '❤️ Nouveau don pour votre équipe au Défi Enfance !', htmlEquipe);
          if (okEquipe) {
            state.stats.sent++;
            addLog(`✅ Don validé → chef équipe ${equipe} notifié`, 'ok');
          }
        }
      }
    } else {
      return res.json({ success: false, error: `Coureur "${coureurParraine}" introuvable dans Ohme — vérifiez l'orthographe` });
    }

  } else if (equipeParraine) {
    // Fléché vers une équipe
    const structure  = await fetchOhmeStructureByName(equipeParraine);
    const chefEmail  = structure ? (structure.email_referent_defi_enfance || '') : '';
    const chefPrenom = structure ? (structure.prenom_du_referent_defi_enfance || 'Bonjour') : 'Bonjour';
    if (chefEmail) {
      const html = tplDonEquipe({ chefPrenom, nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon });
      ok = await sendBrevo(chefEmail, '❤️ Nouveau don pour votre équipe au Défi Enfance !', html);
      if (ok) {
        state.stats.sent++;
        // Email merci J+1 au donateur
        sendMerciDonateur({ email: emailDon, prenom: donateur.split(' ')[0], montant, donateur });
        addLog(`✅ Don validé → équipe ${equipeParraine} (${montant}€)`, 'ok');
        addEvent('🏆', `Don validé ${montant}€`, `${donateur} → ${equipeParraine}`, 'don');
      }
    } else {
      return res.json({ success: false, error: `Équipe "${equipeParraine}" — référent introuvable dans Ohme` });
    }

  } else {
    // Toujours non fléché → envoyer à Défi Enfance
    const structure  = await fetchOhmeStructureByName('Défi Enfance');
    const chefEmail  = structure ? (structure.email_referent_defi_enfance || '') : '';
    const chefPrenom = structure ? (structure.prenom_du_referent_defi_enfance || 'Bonjour') : 'Bonjour';
    if (chefEmail) {
      const html = tplDonEquipe({ chefPrenom, nomEquipe: 'Défi Enfance', donateur, montant, email_donateur: emailDon });
      ok = await sendBrevo(chefEmail, '❤️ Nouveau don non fléché pour le Défi Enfance !', html);
      if (ok) {
        state.stats.sent++;
        sendMerciDonateur({ email: emailDon, prenom: donateur.split(' ')[0], montant, donateur });
        addLog(`✅ Don non fléché confirmé → Défi Enfance (${montant}€)`, 'ok');
        addEvent('❤️', `Don non fléché ${montant}€`, donateur, 'don');
      }
    } else {
      return res.json({ success: false, error: 'Structure "Défi Enfance" introuvable dans Ohme' });
    }
  }

  if (ok) {
    state.donsEnAttente = state.donsEnAttente.filter(d => String(d.paiementId) !== String(paiementId));
    saveDonsEnAttente();
  }

  res.json({ success: ok });
});

// Ignorer TOUS les dons en attente
app.post('/api/dons-attente/ignorer-tous', (req, res) => {
  const count = state.donsEnAttente.length;
  // Marquer tous comme traités
  state.donsEnAttente.forEach(d => state.processedIds.add(String(d.paiementId)));
  state.donsEnAttente = [];
  saveDonsEnAttente();
  saveProcessedIds();
  addLog(`🗑️ ${count} don(s) en attente ignorés en masse`, 'info');
  res.json({ success: true, count });
});

// Ignorer un don en attente
app.post('/api/dons-attente/:paiementId/ignorer', (req, res) => {
  const { paiementId } = req.params;
  state.donsEnAttente = state.donsEnAttente.filter(d => String(d.paiementId) !== String(paiementId));
  saveDonsEnAttente();
  addLog(`🗑️ Don en attente ignoré : ${paiementId}`, 'info');
  res.json({ success: true });
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
  console.log(`   IDs déjà traités chargés : ${state.processedIds.size}`);
});
