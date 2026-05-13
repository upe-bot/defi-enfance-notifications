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
  if (req.path === '/login' || req.path === '/logout') return next();
  if (req.path.match(/\.(js|css|png|jpg|ico|svg|woff|woff2)$/)) return next();
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').find(c => c.trim().startsWith('dash_token='));
  const val = token ? token.trim().split('=').slice(1).join('=').trim() : '';
  if (val === pwd) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non autorisé' });
  return res.redirect('/login');
});

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
    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
    <script>try{localStorage.setItem('dash_pwd',${JSON.stringify(pwd)});}catch(e){}window.location.href='/';</script></body></html>`);
  }
  res.redirect('/login?err=1');
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'dash_token=; Path=/; Max-Age=0');
  return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
  <script>try{localStorage.removeItem('dash_pwd');}catch(e){}window.location.href='/login';</script></body></html>`);
});

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
  upstashUrl:       (process.env.UPSTASH_REDIS_REST_URL  || '').replace(/\/$/, ''),
  upstashToken:     process.env.UPSTASH_REDIS_REST_TOKEN || '',
};

// ══════════════════════════════════════════════════════
//  UPSTASH REDIS
// ══════════════════════════════════════════════════════
const REDIS_KEY_IDS     = 'defi_enfance_processed_ids';
const REDIS_KEY_VERSION = 'defi_enfance_version';
const REDIS_KEY_ATTENTE = 'defi_enfance_dons_attente';

async function redisGet(key) {
  if (!CONFIG.upstashUrl || !CONFIG.upstashToken) return null;
  try {
    const res = await fetch(`${CONFIG.upstashUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${CONFIG.upstashToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result ?? null;
  } catch (e) { console.log(`[REDIS] GET ${key} erreur : ${e.message}`); return null; }
}

async function redisSet(key, value) {
  if (!CONFIG.upstashUrl || !CONFIG.upstashToken) return false;
  try {
    const res = await fetch(`${CONFIG.upstashUrl}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONFIG.upstashToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return res.ok;
  } catch (e) { console.log(`[REDIS] SET ${key} erreur : ${e.message}`); return false; }
}

async function loadProcessedIds() {
  try {
    const raw = await redisGet(REDIS_KEY_IDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [];
      console.log(`[REDIS] ${arr.length} IDs chargés`);
      return new Set(arr);
    }
  } catch (e) { console.log(`[REDIS] Erreur chargement IDs : ${e.message}`); }
  return new Set();
}

async function saveProcessedIds() {
  try { await redisSet(REDIS_KEY_IDS, JSON.stringify([...state.processedIds])); } catch (e) {}
}

async function loadDonsEnAttente() {
  try {
    const raw = await redisGet(REDIS_KEY_ATTENTE);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Garantir que c'est toujours un tableau
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) { console.log(`[REDIS] Erreur loadDonsEnAttente : ${e.message}`); }
  return [];
}

async function saveDonsEnAttente() {
  try { await redisSet(REDIS_KEY_ATTENTE, JSON.stringify(state.donsEnAttente)); } catch (e) {}
}

async function getLastVersion() {
  try { return await redisGet(REDIS_KEY_VERSION); } catch (e) { return null; }
}

async function saveCurrentVersion() {
  try { await redisSet(REDIS_KEY_VERSION, SERVER_VERSION); } catch (e) {}
}

// ══════════════════════════════════════════════════════
//  VERSION
// ══════════════════════════════════════════════════════
const SERVER_VERSION = '73';

// ══════════════════════════════════════════════════════
//  ÉTAT SERVEUR
// ══════════════════════════════════════════════════════
const state = {
  isRunning:      false,
  processedIds:   new Set(),
  donsEnAttente:  [],
  donsParContact: {},
  stats:          { sent: 0, dons: 0, bill: 0, promesses: 0, errors: 0 },
  logs:           [],
  events:         [],
  lastPoll:       null,
  nextPoll:       null,
  pollTimer:      null,
  ready:          false,
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

function addDonEnAttente(don) {
  if (state.donsEnAttente.find(d => d.paiementId === don.paiementId)) return;
  state.donsEnAttente.push({ ...don, addedAt: new Date().toISOString() });
  saveDonsEnAttente();
  addLog(`⏸️ En attente : ${don.donateur} — ${don.montant}€`, 'warn');
}

// ══════════════════════════════════════════════════════
//  INIT REDIS
// ══════════════════════════════════════════════════════
let premierPoll = false;

async function initFromRedis() {
  console.log('[INIT] Chargement depuis Redis…');
  state.processedIds  = await loadProcessedIds();
  state.donsEnAttente = await loadDonsEnAttente();
  console.log(`[INIT] ${state.donsEnAttente.length} don(s) en attente chargés`);
  const lastVersion = await getLastVersion();
  premierPoll = lastVersion !== SERVER_VERSION;
  if (premierPoll) {
    console.log(`[INIT] 🆕 Nouvelle version (${lastVersion || 'aucune'} → ${SERVER_VERSION}) — mode validation manuelle`);
    await saveCurrentVersion();
  } else {
    console.log(`[INIT] ✅ Même version (${SERVER_VERSION}) — mode automatique`);
  }
  state.ready = true;
  startPolling();
}

// ══════════════════════════════════════════════════════
//  CONSTANTES & CSS
// ══════════════════════════════════════════════════════
const URL_RECUS    = 'https://crm.ohme.fr/donateurs/1125899987000006/recus-fiscaux';
const URL_EQUIPES  = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=all';
const URL_DON      = 'https://defienfance.fr/faire-un-don/';
const URL_COUREURS = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_event=all';
const URL_LINKEDIN = 'https://www.linkedin.com/company/d%C3%A9fi-enfance/';
const URL_FACEBOOK = 'https://www.facebook.com/people/D%C3%A9fi-Enfance/61586953989862/';
const URL_INSTAGRAM= 'https://www.instagram.com/defienfance';

const BLOC_RECUS_FISCAUX = `<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:18px 24px;text-align:center;margin-bottom:24px"><div style="font-size:.82rem;font-weight:600;color:#3d1830;margin-bottom:10px">🧾 Vos reçus fiscaux</div><div style="font-size:.8rem;color:#3d1830;margin-bottom:12px">Retrouvez ici tous vos reçus fiscaux du Défi Enfance en entrant votre e-mail</div><a href="${URL_RECUS}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:10px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🧾 Accéder à mes reçus fiscaux</a></div>`;

const BLOC_TEMOIGNAGES = `<div style="font-size:.9rem;font-weight:600;color:#1a0a12;margin-bottom:14px">Ces enfants ont besoin de vous :</div><div class="temoignage"><strong>"Ce sont les enfants de tout le monde. Ce sont les enfants de chacun."</strong><br><br>Jérôme Aucordier accompagne des enfants au quotidien dans un lieu de vie qui place chaque enfant au cœur de ses propres décisions. Pour lui, ces enfants ne sont pas des cas à gérer — ce sont un capital pour notre société.</div><div class="temoignage"><strong>"Défi Enfance, c'est un moyen que les jeunes soient entendus."</strong><br><br>Anne Loriot, éducatrice spécialisée en foyer, accueille des jeunes jour et nuit. Un jour, une jeune lui a dit : <em>"Est-ce que tu vas rester ?"</em> — une phrase qui dit tout. Ces enfants ne demandent pas grand-chose. Juste de la stabilité. Juste quelqu'un qui ne part pas.</div>`;

const BLOC_SOCIAUX = `<div style="text-align:center;margin-bottom:20px"><div style="font-size:.82rem;font-weight:600;color:#3d1830;margin-bottom:12px">Découvrez leurs témoignages :</div><div class="social-bar"><a href="${URL_LINKEDIN}" class="social-btn li">LinkedIn</a><a href="${URL_FACEBOOK}" class="social-btn fb">Facebook</a><a href="${URL_INSTAGRAM}" class="social-btn ig">Instagram</a></div></div>`;

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
    .header.violet{background:linear-gradient(135deg,#7c3aed 0%,#fb0089 100%)}
    .header h1{font-family:'Antonio',Arial,sans-serif;font-size:1.8rem;color:#fff;letter-spacing:.03em;line-height:1.1}
    .header p{color:rgba(255,255,255,0.85);font-size:.82rem;margin-top:6px}
    .body{background:#fff;padding:32px 40px;border-left:1px solid #f0e8ed;border-right:1px solid #f0e8ed}
    .greeting{font-size:1.05rem;font-weight:600;margin-bottom:14px}
    .intro{font-size:.88rem;color:#3d1830;line-height:1.65;margin-bottom:22px}
    .don-box{background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:20px 26px;text-align:center;margin-bottom:24px}
    .don-box.orange{border-color:#ef6135;background:linear-gradient(135deg,#fff5ef,#fff8ef)}
    .don-box.violet{border-color:#7c3aed;background:linear-gradient(135deg,#f5f0ff,#fdf0f8)}
    .don-amount{font-family:'Antonio',Arial,sans-serif;font-size:2.8rem;color:#fb0089;line-height:1}
    .don-amount.orange{color:#ef6135}
    .don-amount.violet{color:#7c3aed}
    .don-label{font-size:.76rem;color:#ef6135;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}
    .don-label.violet{color:#7c3aed}
    .card{background:#fdf8fb;border:1px solid #f5dced;border-radius:12px;padding:16px 20px;margin-bottom:22px}
    .card.orange{background:#fdfaf8;border-color:#f5e5d5}
    .card.violet{background:#f8f5ff;border-color:#e5d5f5}
    .card h3{font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
    .card h3.orange{color:#ef6135}
    .card h3.violet{color:#7c3aed}
    .row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
    .row:last-child{border-bottom:none}
    .row .ic{font-size:1rem;width:22px;text-align:center;flex-shrink:0}
    .promesse-box{background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:20px 26px;text-align:center;margin-bottom:24px}
    .promesse-km{font-family:'Antonio',Arial,sans-serif;font-size:2.4rem;color:#7c3aed;line-height:1}
    .promesse-label{font-size:.76rem;color:#7c3aed;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}
    .promesse-scenario{background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:1px solid #e5d5f5;border-radius:12px;padding:14px 18px;margin-bottom:14px;font-size:.84rem;color:#3d1830}
    .promesse-scenario .sc-line{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e5d5f5;font-size:.82rem}
    .promesse-scenario .sc-line:last-child{border-bottom:none;font-weight:700;color:#7c3aed}
    .recap-box{background:linear-gradient(135deg,#fff8ef,#fff0f8);border:2px solid rgba(251,0,137,0.25);border-radius:14px;padding:16px 20px;margin-bottom:22px}
    .recap-title{font-size:.75rem;font-weight:700;color:#3d1830;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
    .recap-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px dashed rgba(251,0,137,0.15);font-size:.82rem;color:#3d1830}
    .recap-row:last-child{border-bottom:none;font-weight:700;padding-top:8px;font-size:.88rem}
    .recap-num{font-family:'Antonio',Arial,sans-serif;font-size:1.1rem;color:#fb0089}
    .recap-num.violet{color:#7c3aed}
    .cta-box{background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:20px 24px;text-align:center;margin-bottom:24px}
    .cta-box.orange{border-color:#ef6135;background:linear-gradient(135deg,#fff5ef,#fff8ef)}
    .cta-box.violet{border-color:#7c3aed;background:linear-gradient(135deg,#f5f0ff,#fdf0f8)}
    .cta-box p{font-size:.88rem;color:#3d1830;font-style:italic;margin-bottom:14px;line-height:1.5}
    .cta-btn{display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:12px 28px;border-radius:99px;font-weight:700;font-size:.85rem}
    .cta-btn.orange{background:linear-gradient(135deg,#ef6135,#ff8533)}
    .cta-btn.violet{background:linear-gradient(135deg,#7c3aed,#fb0089)}
    .note{font-size:.86rem;color:#3d1830;line-height:1.6;background:#fff8ef;border-left:4px solid #ff8533;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:22px}
    .note.magenta{border-left-color:#fb0089;background:#fff0f8}
    .note.violet{border-left-color:#7c3aed;background:#f5f0ff}
    .badge{display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff;border-radius:99px;padding:5px 16px;font-size:.8rem;font-weight:700;margin-bottom:18px}
    .badge.violet{background:linear-gradient(135deg,#7c3aed,#fb0089)}
    .divider{height:1px;background:linear-gradient(90deg,transparent,#fb0089,transparent);margin:18px 0;opacity:.3}
    .temoignage{background:#fdf8fb;border-left:4px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:14px;font-size:.84rem;color:#3d1830;line-height:1.6;font-style:italic}
    .social-bar{display:flex;justify-content:center;gap:16px;margin:16px 0;flex-wrap:wrap}
    .social-btn{display:inline-block;padding:8px 18px;border-radius:99px;font-size:.75rem;font-weight:700;text-decoration:none;color:#fff}
    .social-btn.li{background:#0077b5}
    .social-btn.fb{background:#1877f2}
    .social-btn.ig{background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)}
    .footer{background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:0 0 18px 18px;padding:22px 40px;text-align:center}
    .footer-sub{font-size:.7rem;color:rgba(255,255,255,0.45);line-height:1.5}
    .impact-stat{display:inline-block;text-align:center;margin:0 14px}
    .impact-stat .num{font-family:'Antonio',Arial,sans-serif;font-size:1.8rem;color:#fb0089;display:block}
    .impact-stat .lbl{font-size:.72rem;color:#3d1830;display:block}
`;

// ══════════════════════════════════════════════════════
//  HELPER — bloc récapitulatif promesses
// ══════════════════════════════════════════════════════
function blocRecapPromesses({ nbPromessesCoureur, totalKmParCoureur, nbPromessesEquipe, totalKmParEquipe, isCoureur }) {
  const lignesCoureur = nbPromessesCoureur > 0 ? `
    <div class="recap-row"><span>🏃 Promesses sur ce coureur</span><span class="recap-num violet">${nbPromessesCoureur} promesse${nbPromessesCoureur > 1 ? 's' : ''}</span></div>
    <div class="recap-row"><span>💰 Total engagé / km (coureur)</span><span class="recap-num violet">${totalKmParCoureur} € / km</span></div>` : '';
  const lignesEquipe = nbPromessesEquipe > 0 ? `
    <div class="recap-row"><span>🏆 Promesses sur l'équipe</span><span class="recap-num">${nbPromessesEquipe} promesse${nbPromessesEquipe > 1 ? 's' : ''}</span></div>
    <div class="recap-row"><span>💰 Total engagé / km (équipe)</span><span class="recap-num">${totalKmParEquipe} € / km</span></div>` : '';
  if (!lignesCoureur && !lignesEquipe) return '';
  return `<div class="recap-box">
    <div class="recap-title">📊 Récapitulatif des promesses de dons</div>
    ${lignesCoureur}${lignesEquipe}
    <div class="recap-row"><span>⚡ Plus vous courez de km, plus les dons seront élevés !</span></div>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  HELPER — bloc scénarios km pour promesses
// ══════════════════════════════════════════════════════
function blocScenariosKm(montantParKm) {
  const m = parseFloat(montantParKm) || 0;
  if (!m) return '';
  return `<div class="promesse-scenario">
    <div style="font-size:.78rem;font-weight:700;color:#7c3aed;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">💡 Projection selon vos km courus</div>
    <div class="sc-line"><span>10 km courus</span><span><strong>${(m * 10).toFixed(0)} €</strong> générés</span></div>
    <div class="sc-line"><span>15 km courus</span><span><strong>${(m * 15).toFixed(0)} €</strong> générés</span></div>
    <div class="sc-line"><span>20 km courus</span><span><strong>${(m * 20).toFixed(0)} €</strong> générés</span></div>
    <div class="sc-line"><span>2h de course (max)</span><span><strong>? €</strong> selon votre rythme !</span></div>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — DONS (inchangés v67)
// ══════════════════════════════════════════════════════
function tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur, association, motEncouragement }) {
  const assoLine = association ? `<br>Association soutenue : <strong>${association}</strong>` : '';
  const motLine  = motEncouragement ? `<div class="note magenta" style="margin-top:16px">💬 <strong>Mot d'encouragement :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Nouveau don pour toi !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${coureurPrenom} 👋</div><div class="intro">Bonne nouvelle ! Un nouveau don vient d'être enregistré sur <strong>ta page de collecte Défi Enfance</strong>.</div><div class="don-box"><div class="don-amount">${montant} €</div><div class="don-label">Don reçu de ${donateur}</div></div><div class="card"><h3>📋 Coordonnées du donateur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#fb0089">${email_donateur}</a></div></div></div>${motLine}<div class="note magenta">💌 <strong>N'hésite pas à remercier ${donateur} personnellement</strong> — un message sincère fait toujours une grande différence !</div><div class="cta-box"><p>✨ <strong>Et si tu faisais grimper ta collecte encore plus haut ?</strong><br>Partage ta page et invite tes proches à te soutenir !</p><a href="${URL_COUREURS}" class="cta-btn">🏃 Voir ma page de collecte</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant le don.${assoLine}</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplDonEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montant, email_donateur, motEncouragement }) {
  const isDE   = nomEquipe === 'Défi Enfance';
  const motLine = motEncouragement ? `<div class="note" style="margin-top:16px;border-left-color:#fb0089;background:#fff0f8">💬 <strong>Mot d'encouragement :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const referentLine = isDE && chefNom ? `<div class="row"><span class="ic">👤</span><div><strong>Référent :</strong> ${chefPrenom} ${chefNom}</div></div>` : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header orange"><h1>${isDE ? '❤️ Don non fléché reçu !' : '🏆 Nouveau don pour votre équipe !'}</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${chefPrenom} 👋</div>${!isDE ? `<div style="margin-bottom:16px"><span class="badge">🏃 Équipe ${nomEquipe}</span></div>` : ''}<div class="intro">${isDE ? `Un don de <strong>${montant} €</strong> vient d'être reçu sans être fléché vers un coureur ou une équipe.` : `Un nouveau don vient d'être enregistré pour soutenir <strong>votre équipe au Défi Enfance</strong> !`}</div><div class="don-box orange"><div class="don-amount orange">${montant} €</div><div class="don-label">Don reçu de ${donateur}</div></div><div class="card orange"><h3 class="orange">📋 Coordonnées du donateur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#ef6135">${email_donateur}</a></div></div>${referentLine}</div>${motLine}<div class="note">${isDE ? `💌 N'hésitez pas à <strong>contacter ${donateur}</strong> pour le remercier !` : `💌 En tant que référent, <strong>remerciez ${donateur} au nom de toute l'équipe</strong> !`}</div>${!isDE ? `<div class="cta-box orange"><p>✨ <strong>Faites grimper la collecte de votre équipe !</strong></p><a href="${URL_EQUIPES}" class="cta-btn orange">🏆 Voir la page de notre équipe</a></div>` : `<div class="cta-box orange"><p>✨ Invitez ${donateur} à flécher son prochain don !</p><a href="${URL_DON}" class="cta-btn orange">❤️ Page de don Défi Enfance</a></div>`}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant le don.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — PROMESSES DE DON
// ══════════════════════════════════════════════════════

/**
 * Promesse de don → coureur parrainé
 * Envoie au coureur : quelqu'un s'engage à donner X€/km le soir de la course
 */
function tplPromesseCoureur({ coureurPrenom, donateur, montantParKm, email_donateur, association, motEncouragement, nbPromessesCoureur, totalKmParCoureur, nbPromessesEquipe, totalKmParEquipe }) {
  const assoLine = association ? `<br>Association soutenue : <strong>${association}</strong>` : '';
  const motLine  = motEncouragement ? `<div class="note violet" style="margin-top:16px">💬 <strong>Message de ${donateur} :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const recap    = blocRecapPromesses({ nbPromessesCoureur, totalKmParCoureur, nbPromessesEquipe, totalKmParEquipe, isCoureur: true });
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour toi !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${coureurPrenom} 👋</div><div class="intro"><strong>${donateur}</strong> croit en toi et s'engage à faire un don sur ta page de collecte — <strong>le soir même de ta course</strong> — en fonction des kilomètres que tu auras courus !</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru par ${donateur}</div></div>${scenarios}${motLine}<div class="note violet">🚀 <strong>Plus tu courras de kilomètres, plus ${donateur} donnera pour l'enfance !</strong><br>Ce soutien est une vraie carotte : chaque foulée supplémentaire compte directement pour les enfants.</div>${recap}<div class="card violet"><h3 class="violet">📋 Coordonnées de votre supporter</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>Remercie ${donateur} dès maintenant</strong> — et donne-lui rendez-vous pour voir ton résultat le soir de la course !</div><div class="cta-box violet"><p>✨ <strong>Partage ta page de collecte</strong> pour multiplier les promesses de dons !<br>Chaque km que tu cours peut rapporter encore plus à l'enfance.</p><a href="${URL_COUREURS}" class="cta-btn violet">🏃 Voir ma page de collecte</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse enregistrée automatiquement. Le don sera effectif après la course.${assoLine}</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

/**
 * Promesse de don → chef d'équipe
 * Envoie au référent d'équipe : quelqu'un promet X€/km pour toute l'équipe
 */
function tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montantParKm, email_donateur, motEncouragement, nbPromessesEquipe, totalKmParEquipe }) {
  const motLine  = motEncouragement ? `<div class="note violet" style="margin-top:16px">💬 <strong>Message de ${donateur} :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const recap    = blocRecapPromesses({ nbPromessesCoureur: 0, totalKmParCoureur: 0, nbPromessesEquipe, totalKmParEquipe, isCoureur: false });
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour votre équipe !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${chefPrenom} 👋</div><div style="margin-bottom:16px"><span class="badge violet">🏃 Équipe ${nomEquipe}</span></div><div class="intro">Excellente nouvelle ! <strong>${donateur}</strong> s'engage à faire un don pour votre équipe — <strong>le soir même de la course</strong> — proportionnellement aux kilomètres cumulés par vos coureurs !</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru — pour l'équipe ${nomEquipe}</div></div>${scenarios}${motLine}<div class="note violet">🚀 <strong>Chaque km couru par chacun de vos coureurs compte !</strong><br>Plus votre équipe performe collectivement, plus ${donateur} donnera pour l'enfance le soir même.</div>${recap}<div class="card violet"><h3 class="violet">📋 Coordonnées du supporter</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>Transmettez cette promesse à vos coureurs</strong> pour les motiver encore davantage — chaque foulée supplémentaire a un prix pour l'enfance !</div><div class="cta-box violet"><p>✨ <strong>Mobilisez l'équipe !</strong><br>Partagez cette promesse de don avec tous vos coureurs pour décupler leur motivation le jour J.</p><a href="${URL_EQUIPES}" class="cta-btn violet">🏆 Voir la page de notre équipe</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse enregistrée automatiquement. Le don sera effectif après la course.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → coureur
 */
function tplMerciPrometteurCoureur({ prenomDonateur, montantParKm, coureurPrenom, coureurNom, association }) {
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🙏 Merci pour votre<br>promesse de don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre promesse de <strong>${montantParKm} € par km</strong> pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''} est enregistrée. Elle sera transformée en don réel — <strong>le soir même de la course</strong> — selon les kilomètres courus.</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km couru par ${coureurPrenom}</div></div>${scenarios}<div class="note violet">💡 <strong>Comment ça fonctionne ?</strong><br>Le soir de la course, vous recevrez un email récapitulatif avec le résultat de ${coureurPrenom}. Il vous suffira alors de cliquer sur le lien de don et de saisir le montant correspondant aux km courus.</div><div style="text-align:center;background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border-radius:14px;padding:22px;margin-bottom:24px"><div style="margin-bottom:12px;font-size:.78rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em">L'impact de votre engagement</div><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#7c3aed">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#7c3aed">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="cta-box violet"><p>✨ <strong>Envie d'aller encore plus loin ?</strong><br>Partagez cette initiative autour de vous — vos proches peuvent aussi promettre un don par km !</p><a href="${URL_DON}" class="cta-btn violet">❤️ Page de don Défi Enfance</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse de don enregistrée — le don sera réalisé après la course.<br>contact@defienfance.fr — defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → équipe
 */
function tplMerciPrometteurEquipe({ prenomDonateur, montantParKm, nomEquipe }) {
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🙏 Merci pour votre<br>promesse de don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre promesse de <strong>${montantParKm} € par km</strong> pour l'équipe <strong>${nomEquipe}</strong> est enregistrée. Elle sera transformée en don réel — <strong>le soir même de la course</strong> — selon les kilomètres cumulés par les coureurs de l'équipe.</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km couru — équipe ${nomEquipe}</div></div>${scenarios}<div class="note violet">💡 <strong>Comment ça fonctionne ?</strong><br>Le soir de la course, vous recevrez un email récapitulatif avec le résultat de l'équipe ${nomEquipe}. Il vous suffira alors de cliquer sur le lien de don et de saisir le montant correspondant.</div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="cta-box violet"><p>✨ <strong>Mobilisez votre entourage !</strong><br>Plus il y a de promesses sur cette équipe, plus leur motivation le jour J est décuplée !</p><a href="${URL_DON}" class="cta-btn violet">❤️ Page de don Défi Enfance</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse de don enregistrée — le don sera réalisé après la course.<br>contact@defienfance.fr — defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — MERCI DONATEUR (inchangés)
// ══════════════════════════════════════════════════════
function tplMerciDonateurFidele({ prenomDonateur, montant }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🏅 Super Badge Donateur<br>du Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Vous avez de nouveau soutenu le Défi Enfance avec un don de <strong>${montant} €</strong>. Merci !</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="font-size:3rem;margin-bottom:8px">🏅</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089;font-weight:700">Vous êtes officiellement<br>Super Donateur du Défi Enfance !</div></div>${BLOC_RECUS_FISCAUX}${BLOC_SOCIAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr — defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateurStructure({ prenomDonateur, montant, nomStructure, coureurPrenom, coureurNom, association, nomEquipe }) {
  const cible = coureurPrenom ? `pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''}` : nomEquipe ? `pour l'équipe <strong>${nomEquipe}</strong>` : 'au Défi Enfance';
  const salutation = prenomDonateur ? `Bonjour ${prenomDonateur} 👋` : `Bonjour 👋`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Merci pour le don de<br>${nomStructure} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">${salutation}</div><div class="intro">Merci pour le don de <strong>${montant} €</strong> de <strong>${nomStructure}</strong> ${cible}.</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour le don de ${montant} € de ${nomStructure}.<br>contact@defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateur({ prenomDonateur, montant, donateur, coureurPrenom, coureurNom, association }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Merci pour votre don<br>à ${coureurPrenom} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> pour <strong>${coureurPrenom} ${coureurNom}</strong> fait une vraie différence. 50% va à l'<strong>Association ${association}</strong>, 50% au Plaidoyer du Défi Enfance.</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateurEquipe({ prenomDonateur, montant, donateur, nomEquipe }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header orange"><h1>❤️ Merci pour votre don<br>à ${nomEquipe} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> pour l'équipe <strong>${nomEquipe}</strong> fait une vraie différence !</div><div style="text-align:center;background:linear-gradient(135deg,#fff5ef,#fff8ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#ef6135">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#ef6135">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateurGlobal({ prenomDonateur, montant }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>❤️ Merci pour<br>votre don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> au Défi Enfance fait une vraie différence dans la vie de milliers d'enfants. Merci du fond du cœur !</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — BILLETTERIE (inchangés)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  TEMPLATES — ENVOIS GROUPÉS
// ══════════════════════════════════════════════════════

const URL_DEJEUNER_ANGERS = 'https://luma.com/defi-dejeuner-angers2026';

function tplGroupeJ10Angers({ prenom }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .programme-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
    .programme-item:last-child{border-bottom:none}
    .programme-ic{font-size:1.1rem;flex-shrink:0;width:24px;text-align:center}
    .programme-time{font-weight:700;color:#fb0089;min-width:48px;flex-shrink:0}
    .liste-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f5e5d5;font-size:.84rem;color:#3d1830}
    .liste-item:last-child{border-bottom:none}
  </style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🎽 Dans 9 jours,<br>on court pour l'enfance !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div><div class="body">
<div class="greeting">Bonjour ${prenom} 👋</div>
<div class="intro">Dans 10 jours, c'est le grand jour ! 🎉 Nous sommes vraiment impatients de vous retrouver au <strong>Parc Saint-Serge</strong> pour cette deuxième édition du Défi Enfance à Angers. Vous faites partie d'une belle aventure — voici tout ce qu'il faut savoir pour arriver prêt(e) et serein(e) ! 💪</div>

<div class="card" style="margin-bottom:22px"><h3>🤲 Pourquoi est-ce qu'on court ?</h3>
<div style="font-size:.86rem;color:#3d1830;line-height:1.7">Le Défi Enfance, c'est bien plus qu'une course — c'est un élan collectif pour soutenir tout le secteur de l'aide à l'enfance. Chaque kilomètre parcouru, chaque don collecté va compter.<br><br>Dès maintenant, faites décoller votre collecte ! <strong>50% des dons</strong> vont directement aux associations choisies, <strong>50%</strong> soutiennent le plaidoyer pour les enfants en France. 🙏<br><br><strong>Nouveauté exclusive :</strong> faites et faites faire des <strong>promesses de dons au km</strong> — une manière percutante de challenger vos proches pour la cause de l'enfance !</div>
<div style="text-align:center;margin-top:16px"><a href="${URL_DON}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:12px 28px;border-radius:99px;font-weight:700;font-size:.85rem">❤️ Faire un don / Promesse de don</a></div>
</div>

<div class="card" style="margin-bottom:22px"><h3>📅 Programme du 22 mai</h3>
<div class="programme-item"><span class="programme-ic">🕣</span><span class="programme-time">8h30</span><div>Ouverture du village &amp; récupération des dossards</div></div>
<div class="programme-item"><span class="programme-ic">🎤</span><span class="programme-time">9h15</span><div>Discours officiels</div></div>
<div class="programme-item"><span class="programme-ic">🏃</span><span class="programme-time">10h00</span><div><strong>Départ de la course</strong> — 2h de dépassement de soi !</div></div>
<div class="programme-item"><span class="programme-ic">🏆</span><span class="programme-time">12h00</span><div>Remise des prix</div></div>
<div class="programme-item"><span class="programme-ic">🍱</span><span class="programme-time">12h30</span><div>Déjeuner avec les paniers gourmands Agapè</div></div>
<div style="margin-top:12px;font-size:.82rem;color:#3d1830">📍 <strong>Parc Saint-Serge</strong>, derrière l'Ice Park — Angers</div>
</div>

<div class="card orange" style="margin-bottom:22px"><h3 class="orange">🍱 Le déjeuner — Panier repas Agapè à 12 €</h3>
<div style="font-size:.86rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Terminez cette belle matinée en beauté avec un panier repas gourmand préparé par <strong>Agapè Anjou</strong>, une école de production angevine qui forme des jeunes de 15 à 25 ans aux métiers de la restauration. Commander son repas, c'est aussi soutenir leur parcours ! 😍</div>
<div class="liste-item"><span>🥙</span><div>Bagel poulet, mozzarella, pesto &amp; tomates confites</div></div>
<div class="liste-item"><span>🧁</span><div>Muffin maison aux fruits rouges</div></div>
<div class="liste-item"><span>🍎</span><div>Une pomme</div></div>
<div class="liste-item"><span>💧</span><div>Une eau</div></div>
<div class="note" style="margin-top:16px;margin-bottom:16px">⏰ <strong>Inscrivez-vous avant le vendredi 15 mai à 12h</strong> — ne passez pas à côté !</div>
<div style="text-align:center"><a href="${URL_DEJEUNER_ANGERS}" style="display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff!important;text-decoration:none;padding:12px 28px;border-radius:99px;font-weight:700;font-size:.85rem">🍱 Je réserve mon panier repas à 12 €</a></div>
</div>

<div class="card" style="margin-bottom:22px"><h3>🏘️ Le village de course</h3>
<div style="font-size:.86rem;color:#3d1830;line-height:1.7">Entre l'arrivée et la remise des prix, le village sera animé et plein de vie ! Venez à la rencontre des associations qui œuvrent chaque jour pour l'enfance, profitez des animations et partagez ce moment avec vos coéquipiers. C'est l'occasion de voir concrètement l'impact de votre engagement. 💚</div>
</div>

<div class="card" style="margin-bottom:22px"><h3>👟 Ce qu'il faut apporter</h3>
<div class="liste-item"><span>👕</span><div>Tenue de sport adaptée</div></div>
<div class="liste-item"><span>👟</span><div>Chaussures de running</div></div>
<div class="liste-item"><span>💧</span><div>Bouteille d'eau (de l'eau sera disponible sur le site)</div></div>
<div class="liste-item"><span>⚡</span><div>Votre énergie et votre bonne humeur !</div></div>
</div>

<div class="note magenta">🎽 <strong>Votre dossard</strong><br>Vous recevrez un email le <strong>jeudi 21 mai</strong> avec votre numéro de dossard. Il ne vous restera plus qu'à le récupérer sur place dès 8h30 et à enfiler vos baskets ! 👟</div>

<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;line-height:1.8">Pour toute question : <a href="mailto:contact@defienfance.fr" style="color:#fb0089;font-weight:600">contact@defienfance.fr</a> 📩<br><br><strong>On vous attend avec impatience — allez, plus que 9 jours ! 🏁</strong></div>
<div style="margin-top:16px;font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— L'équipe du Défi Enfance 🤲</div>

</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr — defienfance.fr</div></div></div></body></html>`;
}

// Placeholder pour les futurs templates — à compléter au fur et à mesure
function tplGroupePlaceholder({ prenom, nomTemplate }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🔧 Template à venir</h1><p>${nomTemplate}</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">Ce template (${nomTemplate}) est en cours de création. Il sera disponible prochainement.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">contact@defienfance.fr</div></div></div></body></html>`;
}

function tplInscriptionAsso({ nomAsso, coureur, email_coureur, ville, prenomReferent }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🏃 Nouveau coureur<br>pour votre cause !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomReferent || ''} 👋</div><div class="intro">Un coureur vient de <strong>choisir votre association ${nomAsso}</strong> pour courir lors du <strong>Défi Enfance${ville ? ' de ' + ville : ''}</strong> !</div><div class="don-box"><div class="don-amount" style="font-size:1.8rem">${coureur}</div><div class="don-label">Nouveau coureur inscrit</div></div><div class="card"><h3>📋 Coordonnées du coureur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${coureur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_coureur}" style="color:#fb0089">${email_coureur}</a></div></div></div><div class="note magenta">💌 <strong>Prenez contact avec ${coureur}</strong> pour le remercier et l'accueillir chaleureusement !</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">💡 Présentez vos actions. Plus le coureur est engagé, plus sa collecte sera importante !</div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Association : <strong>${nomAsso}</strong><br>Email envoyé automatiquement dans les 10 minutes suivant l'inscription.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}


function tplDejeuner({ prenom }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🥗 Votre panier repas<br>est confirmé !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">Votre commande de repas est <strong>validée</strong> pour le Défi Enfance d'Angers — 22 mai 2026 !</div><div class="don-box" style="text-align:left;padding:20px 26px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;text-align:center">🧺 Votre panier gourmand</div><div class="row"><span class="ic">🥙</span><div>Bagel poulet, mozzarella, pesto &amp; tomates confites</div></div><div class="row"><span class="ic">🧁</span><div>Muffin maison aux fruits rouges</div></div><div class="row"><span class="ic">🍎</span><div>Une pomme</div></div><div class="row"><span class="ic">💧</span><div>Une eau</div></div></div><div class="note magenta" style="margin-bottom:22px">🎓 <strong>Panier préparé par Agapè Anjou</strong>, une école de production angevine qui forme des jeunes de 15 à 25 ans aux métiers de la restauration.<br><br>Merci — votre commande est <strong>solidaire</strong> : les 12 € versés viennent soutenir leur parcours.</div><div class="cta-box" style="text-align:left"><p style="text-align:center">📍 <strong>Récupération de votre panier</strong></p><div style="font-size:.86rem;color:#3d1830;line-height:1.8;margin-top:8px"><div>🕛 <strong>Dès 12h</strong> — après la course</div><div>📌 <strong>Stand Agapè Anjou</strong> sur le village de la course</div><div>👤 Dites simplement <strong>votre nom</strong> à l'accueil</div></div></div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">À tout à l'heure sur le Défi Enfance !<br><strong style="color:#fb0089">— Team Défi Enfance</strong></div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}
function tplInscriptionCoureur({ prenom, nomComplet }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">🚀 Vous pouvez désormais aider l'Association que vous avez choisie en invitant vos réseaux pro et perso à faire un don !</div><div class="cta-box"><p>Partagez le lien de don à vos contacts — en choisissant votre nom dans le formulaire, ils soutiennent votre collecte pour votre Association et le Plaidoyer du Défi Enfance.</p><a href="${URL_DON}" class="cta-btn">❤️ Page de don Défi Enfance</a></div><div class="note magenta">💡 Leur don est éligible à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur l'IR ou 60% sur l'IS.</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">📊 Suivez vos dons sur le <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">classement général</a> du Défi Enfance.</div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Ensemble, on va soulever les énergies pour l'enfance !<br>Merci pour votre engagement.</div><div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplInscriptionSupporter({ prenom }) {
  const URL_ASSOS = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=associations&de_event=all';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">En tant que supporter, vous avez un rôle privilégié pour soutenir les coureurs engagés pour le Défi Enfance !</div><div class="card"><h3>💪 Comment agir dès maintenant ?</h3><div class="row"><span class="ic">🏃</span><div>Découvrez <a href="${URL_ASSOS}" style="color:#fb0089;font-weight:600">la liste des associations</a></div></div><div class="row"><span class="ic">❤️</span><div>Parrainez un coureur ou une équipe par un don</div></div><div class="row"><span class="ic">📢</span><div>Partagez la <a href="${URL_DON}" style="color:#fb0089;font-weight:600">page Faire un don</a></div></div></div><div class="note magenta">💡 Dons éligibles à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur l'IR ou 60% sur l'IS.</div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic">Ensemble, nous allons soulever les énergies pour l'enfance !<br><strong style="color:#fb0089">— Team Défi Enfance</strong></div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplBilletsEnGros({ prenomRef, nomStructure, nomEquipe, montant, date }) {
  const equipeLabel = nomEquipe || nomStructure;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🎉 Merci pour votre<br>règlement groupé !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomRef || ''} 👋</div><div style="margin-bottom:16px;text-align:center"><span class="badge">🏃 Équipe ${equipeLabel}</span></div><div class="intro">La Team Défi Enfance est <strong>fière</strong> de savoir l'équipe <strong>${equipeLabel}</strong> embarquée dans l'aventure !</div><div class="don-box"><div class="don-amount" style="font-size:2.2rem">${montant} €</div><div class="don-label">Règlement groupé reçu — 📅 ${date}</div></div><div class="note magenta">🙏 Ce règlement représente bien plus qu'un paiement — c'est le signal de départ d'une belle aventure collective !</div><div class="cta-box"><p>🚀 <strong>Faites décoller la collecte de votre équipe !</strong></p><a href="${URL_EQUIPES}" class="cta-btn">🏆 Voir la page de notre équipe</a></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email suite au règlement groupé.<br>contact@defienfance.fr</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  MERCI DONATEUR (don classique)
// ══════════════════════════════════════════════════════
async function sendMerciDonateur({ email, prenom, montant, donateur, coureurPrenom, coureurNom, association, nomEquipe, contactId, isStructure, nomStructure }) {
  if (!email) return;
  let nbDons = 0;
  if (contactId) { nbDons = state.donsParContact[contactId] || 0; state.donsParContact[contactId] = nbDons + 1; }
  let html, subject;
  if (isStructure && nomStructure) {
    subject = `❤️ Merci pour le don de ${nomStructure} !`;
    html = tplMerciDonateurStructure({ prenomDonateur: prenom, montant, nomStructure, coureurPrenom, coureurNom, association, nomEquipe });
  } else if (nbDons >= 1) {
    subject = '🏅 Super Badge Donateur du Défi Enfance !';
    html = tplMerciDonateurFidele({ prenomDonateur: prenom, montant });
  } else if (coureurPrenom) {
    subject = `❤️ Merci pour votre don à ${coureurPrenom} !`;
    html = tplMerciDonateur({ prenomDonateur: prenom, montant, donateur, coureurPrenom, coureurNom: coureurNom || '', association: association || '' });
  } else if (nomEquipe) {
    subject = `❤️ Merci pour votre don à ${nomEquipe} !`;
    html = tplMerciDonateurEquipe({ prenomDonateur: prenom, montant, donateur, nomEquipe });
  } else {
    subject = '❤️ Merci pour votre don !';
    html = tplMerciDonateurGlobal({ prenomDonateur: prenom, montant });
  }
  const ok = await sendBrevo(email, subject, html);
  if (ok) { state.stats.sent++; addLog(`✅ Email merci envoyé à ${prenom} (${email})`, 'ok'); }
}

// ══════════════════════════════════════════════════════
//  OHME API
// ══════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OHME_DELAY_MS = 800;

async function fetchOhmePayments() {
  if (!CONFIG.ohmeClientName || !CONFIG.ohmeClientSecret || !CONFIG.ohmeBase) {
    addLog('Clé API Ohme manquante', 'warn'); return [];
  }
  try {
    const url = `${CONFIG.ohmeBase}/api/v1/payments?limit=500&since_date=2026-03-01`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data || [];
  } catch (e) { addLog(`Erreur Ohme : ${e.message}`, 'error'); state.stats.errors++; return []; }
}

async function fetchOhmeContactById(contactId) {
  if (!contactId) return null;
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/contacts/${contactId}`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || json;
  } catch(e) { return null; }
}

async function fetchOhmeContactByName(name) {
  try {
    await sleep(OHME_DELAY_MS);
    const parts = name.trim().split(' ');
    const params = new URLSearchParams({ limit: '5' });
    if (parts[0]) params.set('firstname', parts[0]);
    if (parts.slice(1).join(' ')) params.set('lastname', parts.slice(1).join(' '));
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/contacts?${params}`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res.ok) return null;
    const json = await res.json();
    const items = json.data || [];
    if (!items.length) return null;
    const contact = items.find(c => `${c.firstname||c.first_name||''} ${c.lastname||c.last_name||''}`.trim().toLowerCase() === name.toLowerCase()) || items[0];
    return { ...contact, email: contact.email || '' };
  } catch(e) { return null; }
}

async function fetchEquipeCoureur(contactId) {
  if (!contactId) return null;
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?contact_id=${contactId}&payment_type_id=3&limit=10`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res.ok) return null;
    const json = await res.json();
    for (const p of (json.data || [])) {
      const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').toUpperCase();
      if (!eventName.includes('ENFANCE')) continue;
      const equipe = ((p.custom_fields || p).equipe || '').trim();
      if (equipe) return equipe;
    }
    return null;
  } catch(e) { return null; }
}

async function fetchOhmeStructureByName(name) {
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/structures?name=${encodeURIComponent(name)}&limit=5`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res.ok) return null;
    const json = await res.json();
    const items = json.data || [];
    if (!items.length) return null;
    const structure = items.find(s => (s.name||'').toLowerCase() === name.toLowerCase()) || items[0];
    await sleep(OHME_DELAY_MS);
    const res2 = await fetch(`${CONFIG.ohmeBase}/api/v1/structures/${structure.id}`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res2.ok) return structure;
    const detail = await res2.json();
    const s = detail.data || detail;
    const cf = s.custom_fields || s;
    return { ...s, email_referent_defi_enfance: cf.email_referent_defi_enfance || s.email_referent_defi_enfance || '', prenom_du_referent_defi_enfance: cf.prenom_du_referent_defi_enfance || s.prenom_du_referent_defi_enfance || '', nom_du_referent_defi_enfance: cf.nom_du_referent_defi_enfance || s.nom_du_referent_defi_enfance || '' };
  } catch(e) { return null; }
}

async function fetchInfosDonateur(p) {
  const contact = await fetchOhmeContactById(p.contact_id);
  const prenomContact = contact ? (contact.firstname || contact.first_name || '') : '';
  const nomContact    = contact ? (contact.lastname  || contact.last_name  || '') : '';
  const emailContact  = contact ? (contact.email || '') : '';
  const isCompany = p.donator_nature === 'company' || p.donator_nature === 'organization';
  if (isCompany) {
    if (contact && (contact.structure || (contact.structures && contact.structures[0]))) {
      const nomStructure = contact.structure || contact.structures[0];
      try {
        const structure = await fetchOhmeStructureByName(nomStructure);
        if (structure) {
          const cf = structure.custom_fields || structure;
          return { donateur: structure.name || nomStructure, emailDon: cf.email_referent_defi_enfance || emailContact, prenomMerci: cf.prenom_du_referent_defi_enfance || prenomContact, isStructure: true, nomStructure: structure.name || nomStructure };
        }
      } catch(e) {}
    }
    if (p.structure_name) {
      const structure = await fetchOhmeStructureByName(p.structure_name).catch(() => null);
      if (structure) { const cf = structure.custom_fields || structure; return { donateur: structure.name || p.structure_name, emailDon: cf.email_referent_defi_enfance || emailContact, prenomMerci: cf.prenom_du_referent_defi_enfance || '', isStructure: true, nomStructure: structure.name || p.structure_name }; }
      return { donateur: p.structure_name, emailDon: emailContact, prenomMerci: '', isStructure: true, nomStructure: p.structure_name };
    }
    const nom = `${prenomContact} ${nomContact}`.trim() || 'Entreprise';
    return { donateur: nom, emailDon: emailContact, prenomMerci: prenomContact, isStructure: true, nomStructure: nom };
  }
  return { donateur: `${prenomContact} ${nomContact}`.trim() || 'Donateur anonyme', emailDon: emailContact, prenomMerci: prenomContact, isStructure: false, nomStructure: null };
}

// ── Récupérer le total des promesses de dons pour un coureur (contact_id)
async function fetchTotalPromessesCoureur(contactId) {
  if (!contactId) return { nb: 0, total: 0 };
  try {
    await sleep(OHME_DELAY_MS);
    // On cherche tous les paiements de type promesse liés à ce coureur
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?limit=100&since_date=2026-01-01`, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (!res.ok) return { nb: 0, total: 0 };
    const json = await res.json();
    const all = json.data || [];
    let nb = 0, total = 0;
    for (const p of all) {
      const cf = p.custom_fields || p;
      const montantPromesse = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (!montantPromesse) continue;
      // Cherche les promesses fléchées vers ce coureur
      const contact = await fetchOhmeContactById(p.contact_id);
      const coureurParraine = (cf.coureur_parraine || '').trim();
      if (!coureurParraine) continue;
      const contactCoureur = await fetchOhmeContactByName(coureurParraine);
      if (contactCoureur && String(contactCoureur.id) === String(contactId)) {
        nb++;
        total += montantPromesse;
      }
    }
    return { nb, total };
  } catch(e) { return { nb: 0, total: 0 }; }
}

// ── Récupérer le total des promesses de dons pour une équipe (nom)
async function fetchTotalPromessesEquipe(nomEquipe) {
  if (!nomEquipe) return { nb: 0, total: 0 };
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?limit=100&since_date=2026-01-01`, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (!res.ok) return { nb: 0, total: 0 };
    const json = await res.json();
    const all = json.data || [];
    let nb = 0, total = 0;
    for (const p of all) {
      const cf = p.custom_fields || p;
      const montantPromesse = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (!montantPromesse) continue;
      const equipeParraine = (cf.equipe_parraine || '').trim();
      if (equipeParraine.toLowerCase() === nomEquipe.toLowerCase()) { nb++; total += montantPromesse; }
    }
    return { nb, total };
  } catch(e) { return { nb: 0, total: 0 }; }
}

// ══════════════════════════════════════════════════════
//  BREVO
// ══════════════════════════════════════════════════════
async function sendBrevo(to, subject, html) {
  if (!CONFIG.brevoKey) { addLog('Clé Brevo manquante', 'warn'); return false; }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': CONFIG.brevoKey, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: { name: CONFIG.senderName, email: CONFIG.senderEmail }, to: [{ email: to }], subject, htmlContent: html }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); addLog(`Brevo erreur ${res.status} : ${err.message || ''}`, 'error'); state.stats.errors++; return false; }
    return true;
  } catch (e) { addLog(`Brevo exception : ${e.message}`, 'error'); state.stats.errors++; return false; }
}

// ══════════════════════════════════════════════════════
//  TRAITEMENT DES PAIEMENTS
// ══════════════════════════════════════════════════════
async function processPayments(payments, ignoreDate = false) {
  let newCount = 0;

  for (const p of payments) {
    if (state.processedIds.has(String(p.id))) continue;

    const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').trim();
    if (!eventName) { state.processedIds.add(String(p.id)); continue; }

    // ── MODE PREMIER POLL
    if (premierPoll && !ignoreDate) {
      const typeId    = p.payment_type_id;
      const cf        = p.custom_fields || p;
      const isPromesse = !!(parseFloat(cf.montant_promesse_don_par_km || 0));
      const typeLabel = typeId === 1 ? (isPromesse ? 'Promesse de don' : 'Don') : typeId === 3 ? 'Inscription' : 'Autre';
      const montant   = isPromesse ? `${cf.montant_promesse_don_par_km}€/km` : (p.amount || '?');
      const date      = p.date || new Date().toISOString();
      let donateur = 'Inconnu', emailDon = '';
      if (typeId === 1) { const infos = await fetchInfosDonateur(p); donateur = infos.donateur; emailDon = infos.emailDon; }
      else {
        const contact = await fetchOhmeContactById(p.contact_id);
        const prenomC = contact?.firstname || contact?.first_name || '';
        const nomC    = contact?.lastname  || contact?.last_name  || '';
        donateur = `${prenomC} ${nomC}`.trim() || `Participant (ID ${p.contact_id || '?'})`;
        emailDon = contact?.email || '';
      }
      addDonEnAttente({ paiementId: String(p.id), donateur, emailDon, montant, date, eventName, typeLabel, modeValidation: true });
      state.processedIds.add(String(p.id));
      addLog(`⏸️ [Démarrage] ${typeLabel} ${montant} de ${donateur} — en attente`, 'warn');
      newCount++;
      continue;
    }

    const typeId        = p.payment_type_id;
    const cf            = p.custom_fields || p;
    const montantPromesse = parseFloat(cf.montant_promesse_don_par_km || 0);
    const isPromesse    = montantPromesse > 0;
    const isDon         = typeId === 1;
    const isBilletterie = typeId === 3;

    // ══════════════════════════════════════════════════
    //  CAS DON CLASSIQUE
    // ══════════════════════════════════════════════════
    if (isDon && !isPromesse) {
      state.stats.dons++;
      newCount++;
      const infos    = await fetchInfosDonateur(p);
      const { donateur, emailDon, prenomMerci, isStructure, nomStructure } = infos;
      const montant  = p.amount || '?';
      const coureurParraine  = (cf.coureur_parraine  || '').trim();
      const equipeParraine   = (cf.equipe_parraine   || '').trim();
      const motEncouragement = (cf.mot_encouragement_sur_mur || '').trim();

      if (coureurParraine) {
        const contact      = await fetchOhmeContactByName(coureurParraine);
        const emailCoureur = contact?.email || '';
        const coureurPrenom = coureurParraine.split(' ')[0];
        const assoSoutenue  = (cf.asso_soutenue || '').trim();
        if (emailCoureur) {
          const html = tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur: emailDon, association: assoSoutenue, motEncouragement });
          const ok = await sendBrevo(emailCoureur, `❤️ [live] ${prenomMerci || donateur.split(' ')[0]} a fait un don pour vous !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Don ${montant}€ → ${coureurParraine}`, 'ok'); addEvent('❤️', `Don de ${montant} €`, `${donateur} → ${coureurParraine}`, 'don'); sendMerciDonateur({ email: emailDon, prenom: prenomMerci || donateur.split(' ')[0], montant, donateur, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: assoSoutenue, contactId: p.contact_id, isStructure, nomStructure }); }
          const equipe = await fetchEquipeCoureur(contact?.id);
          if (equipe) {
            const structure = await fetchOhmeStructureByName(equipe);
            const chefEmail = structure?.email_referent_defi_enfance || '';
            const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
            const chefNom   = structure?.nom_du_referent_defi_enfance || '';
            if (chefEmail) { const htmlE = tplDonEquipe({ chefPrenom, chefNom, nomEquipe: equipe, donateur, montant, email_donateur: emailDon, motEncouragement }); const okE = await sendBrevo(chefEmail, `❤️ [live] Don pour votre équipe !`, htmlE); if (okE) { state.stats.sent++; addLog(`✅ Don → chef équipe ${equipe}`, 'ok'); } }
          }
        } else { addLog(`⚠️ Coureur "${coureurParraine}" introuvable`, 'warn'); }
      } else if (equipeParraine) {
        const structure = await fetchOhmeStructureByName(equipeParraine);
        const chefEmail = structure?.email_referent_defi_enfance || '';
        const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
        const chefNom   = structure?.nom_du_referent_defi_enfance || '';
        if (chefEmail) {
          const html = tplDonEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon, motEncouragement });
          const ok = await sendBrevo(chefEmail, `❤️ [live] Don pour votre équipe !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Don ${montant}€ → équipe ${equipeParraine}`, 'ok'); addEvent('🏆', `Don ${montant}€ équipe`, `${donateur} → ${equipeParraine}`, 'don'); sendMerciDonateur({ email: emailDon, prenom: prenomMerci || donateur.split(' ')[0], montant, donateur, nomEquipe: equipeParraine, contactId: p.contact_id, isStructure, nomStructure }); }
        } else { addLog(`⚠️ Équipe "${equipeParraine}" — référent introuvable`, 'warn'); }
      } else {
        addLog(`⏸️ Don ${montant}€ de ${donateur} — non fléché, mis en attente`, 'warn');
        addDonEnAttente({ paiementId: p.id, donateur, emailDon, montant, date: p.date || new Date().toISOString(), eventName });
        addEvent('⏸️', `Don en attente ${montant}€`, `${donateur}`, 'don');
      }
    }

    // ══════════════════════════════════════════════════
    //  CAS PROMESSE DE DON
    // ══════════════════════════════════════════════════
    else if (isDon && isPromesse) {
      state.stats.promesses++;
      newCount++;
      const infos    = await fetchInfosDonateur(p);
      const { donateur, emailDon, prenomMerci } = infos;
      const montantKm = montantPromesse.toString();
      const coureurParraine  = (cf.coureur_parraine  || '').trim();
      const equipeParraine   = (cf.equipe_parraine   || '').trim();
      const motEncouragement = (cf.mot_encouragement_sur_mur || '').trim();

      addLog(`🏅 Promesse de don détectée : ${montantKm}€/km de ${donateur}`, 'info');

      if (coureurParraine) {
        const contact      = await fetchOhmeContactByName(coureurParraine);
        const emailCoureur = contact?.email || '';
        const coureurPrenom = coureurParraine.split(' ')[0];
        const assoSoutenue  = (cf.asso_soutenue || '').trim();

        // Récupérer les totaux de promesses pour le coureur et son équipe
        const promCoureur = await fetchTotalPromessesCoureur(contact?.id);
        const equipe      = await fetchEquipeCoureur(contact?.id);
        const promEquipe  = equipe ? await fetchTotalPromessesEquipe(equipe) : { nb: 0, total: 0 };

        if (emailCoureur) {
          // 1. Email au coureur
          const html = tplPromesseCoureur({ coureurPrenom, donateur, montantParKm: montantKm, email_donateur: emailDon, association: assoSoutenue, motEncouragement, nbPromessesCoureur: promCoureur.nb, totalKmParCoureur: promCoureur.total, nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total });
          const ok = await sendBrevo(emailCoureur, `🏅 ${prenomMerci || donateur.split(' ')[0]} promet ${montantKm}€/km pour toi !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Promesse ${montantKm}€/km → coureur ${coureurParraine}`, 'ok'); addEvent('🏅', `Promesse ${montantKm}€/km`, `${donateur} → ${coureurParraine}`, 'don'); }

          // 2. Email merci au prometteur
          const htmlMerci = tplMerciPrometteurCoureur({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantParKm: montantKm, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: assoSoutenue });
          const okMerci = await sendBrevo(emailDon, `🙏 Merci pour votre promesse de don à ${coureurPrenom} !`, htmlMerci);
          if (okMerci) { state.stats.sent++; addLog(`✅ Merci promesse envoyé à ${donateur}`, 'ok'); }

          // 3. Email au chef d'équipe si le coureur est dans une équipe
          if (equipe) {
            const structure = await fetchOhmeStructureByName(equipe);
            const chefEmail  = structure?.email_referent_defi_enfance || '';
            const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
            const chefNom    = structure?.nom_du_referent_defi_enfance || '';
            if (chefEmail) {
              const htmlEquipe = tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe: equipe, donateur, montantParKm: montantKm, email_donateur: emailDon, motEncouragement, nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total });
              const okE = await sendBrevo(chefEmail, `🏅 Promesse de don pour votre équipe — ${montantKm}€/km !`, htmlEquipe);
              if (okE) { state.stats.sent++; addLog(`✅ Promesse ${montantKm}€/km → chef équipe ${equipe}`, 'ok'); }
            }
          }
        } else { addLog(`⚠️ Promesse → coureur "${coureurParraine}" introuvable`, 'warn'); }

      } else if (equipeParraine) {
        const structure = await fetchOhmeStructureByName(equipeParraine);
        const chefEmail  = structure?.email_referent_defi_enfance || '';
        const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
        const chefNom    = structure?.nom_du_referent_defi_enfance || '';
        const promEquipe = await fetchTotalPromessesEquipe(equipeParraine);

        if (chefEmail) {
          // 1. Email au chef d'équipe
          const html = tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montantParKm: montantKm, email_donateur: emailDon, motEncouragement, nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total });
          const ok = await sendBrevo(chefEmail, `🏅 Promesse de don pour votre équipe — ${montantKm}€/km !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Promesse ${montantKm}€/km → équipe ${equipeParraine}`, 'ok'); addEvent('🏅', `Promesse ${montantKm}€/km équipe`, `${donateur} → ${equipeParraine}`, 'don'); }

          // 2. Email merci au prometteur
          const htmlMerci = tplMerciPrometteurEquipe({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantParKm: montantKm, nomEquipe: equipeParraine });
          const okMerci = await sendBrevo(emailDon, `🙏 Merci pour votre promesse de don à l'équipe ${equipeParraine} !`, htmlMerci);
          if (okMerci) { state.stats.sent++; addLog(`✅ Merci promesse envoyé à ${donateur}`, 'ok'); }
        } else { addLog(`⚠️ Promesse → équipe "${equipeParraine}" — référent introuvable`, 'warn'); }

      } else {
        addLog(`⏸️ Promesse ${montantKm}€/km de ${donateur} — non fléchée, mise en attente`, 'warn');
        addDonEnAttente({ paiementId: p.id, donateur, emailDon, montant: `${montantKm}€/km`, date: p.date || new Date().toISOString(), eventName, typeLabel: 'Promesse de don' });
        addEvent('⏸️', `Promesse ${montantKm}€/km en attente`, donateur, 'don');
      }
    }

    // ══════════════════════════════════════════════════
    //  CAS BILLETTERIE (inchangé)
    // ══════════════════════════════════════════════════
    else if (isBilletterie) {
      state.stats.bill++;
      newCount++;
      const contactCoureur = await fetchOhmeContactById(p.contact_id);
      const prenomC  = contactCoureur?.firstname || contactCoureur?.first_name || '';
      const nomC     = contactCoureur?.lastname  || contactCoureur?.last_name  || '';
      const coureur  = `${prenomC} ${nomC}`.trim() || 'Coureur';
      const emailCoureur = contactCoureur?.email || '';
      const nomAsso  = (cf.asso_soutenue || '').trim();
      const ville    = eventName.replace(/défi\s*enfance?\s*/gi, '').replace(/\d{4}/g, '').trim();
      const achatEnGros = (cf.achat_billets_en_gros || '').toLowerCase() === 'oui';

      if (achatEnGros) {
        const infosOrg = await fetchInfosDonateur(p);
        const equipeOrg = (cf.equipe || '').trim();
        const montantOrg = p.amount || '?';
        const dateOrg = p.date ? new Date(p.date).toLocaleDateString('fr-FR') : '';
        if (infosOrg.emailDon) {
          const html = tplBilletsEnGros({ prenomRef: infosOrg.prenomMerci, nomStructure: infosOrg.nomStructure || infosOrg.donateur, nomEquipe: equipeOrg, montant: montantOrg, date: dateOrg });
          const ok = await sendBrevo(infosOrg.emailDon, `🎉 Merci pour votre règlement groupé — Équipe ${equipeOrg || infosOrg.donateur} !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Billets en gros → ${infosOrg.donateur}`, 'ok'); }
        }
        state.processedIds.add(String(p.id)); continue;
      }

      const isSupporter = eventName.toUpperCase().includes('#SUPPORTERS');
      const isDejeuner = eventName.toUpperCase().includes('#DEJEUNER') || eventName.toUpperCase().includes('#DÉJEUNER');
      const equipeC = (cf.equipe || '').trim();

      // Billet déjeuner — traitement prioritaire avant le filtre équipe/asso vides
      if (isDejeuner) {
        if (emailCoureur) {
          const html = tplDejeuner({ prenom: prenomC || coureur });
          const ok = await sendBrevo(emailCoureur, `🥗 Votre panier repas Défi Enfance est confirmé !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Email déjeuner → ${coureur}`, 'ok'); addEvent('🥗', `Déjeuner confirmé`, coureur, 'bill'); }
        } else { addLog(`⚠️ Déjeuner ${coureur} — email introuvable`, 'warn'); }
        state.processedIds.add(String(p.id)); continue;
      }

      if (!equipeC && !nomAsso) { addLog(`⏭️ Billet ${coureur} — équipe et asso vides`, 'info'); state.processedIds.add(String(p.id)); continue; }

      if (isSupporter) {
        if (emailCoureur) { const html = tplInscriptionSupporter({ prenom: prenomC || coureur }); const ok = await sendBrevo(emailCoureur, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, html); if (ok) { state.stats.sent++; addLog(`✅ Bienvenue supporter → ${coureur}`, 'ok'); addEvent('🚀', `Bienvenue supporter`, coureur, 'bill'); } }
      } else {
        if (emailCoureur) { const html = tplInscriptionCoureur({ prenom: prenomC || coureur, nomComplet: coureur }); const ok = await sendBrevo(emailCoureur, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, html); if (ok) { state.stats.sent++; addLog(`✅ Bienvenue coureur → ${coureur}`, 'ok'); addEvent('🚀', `Bienvenue coureur`, coureur, 'bill'); } }
        if (nomAsso && nomAsso.toLowerCase() === equipeC.toLowerCase()) { addLog(`⏭️ Inscription ${coureur} — asso = équipe, ignoré`, 'info'); }
        else if (nomAsso) {
          const structure = await fetchOhmeStructureByName(nomAsso);
          const emailAsso = structure?.email_referent_defi_enfance || '';
          const prenomRef = structure?.prenom_du_referent_defi_enfance || '';
          if (emailAsso) { const html = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailCoureur, ville, prenomReferent: prenomRef }); const ok = await sendBrevo(emailAsso, `🏃 [live] ${prenomC || coureur} court pour vous !`, html); if (ok) { state.stats.sent++; addLog(`✅ Inscription ${coureur} → asso ${nomAsso}`, 'ok'); addEvent('🏃', `Inscription de ${coureur}`, `Asso : ${nomAsso}`, 'bill'); } }
          else { addLog(`⚠️ Inscription ${coureur} — email asso "${nomAsso}" introuvable`, 'warn'); }
        }
      }
    }

    state.processedIds.add(String(p.id));
  }

  await saveProcessedIds();
  if (newCount === 0) addLog('Aucun nouveau paiement à traiter', 'info');
}

async function processPaymentsForced(payments) { await processPayments(payments, true); }

// ══════════════════════════════════════════════════════
//  RATTRAPAGE HISTORIQUE
// ══════════════════════════════════════════════════════
const RATTRAPAGE_DATE_DONS = new Date('2025-05-01T00:00:00.000Z');
const RATTRAPAGE_DATE_BILL = new Date('2025-04-01T00:00:00.000Z');
const rattrapage = { running: false, total: 0, done: 0, skipped: 0, sent: 0, errors: 0, log: [], startedAt: null, finishedAt: null };

function rattrapageLog(msg, type = 'info') {
  const entry = { ts: new Date().toISOString(), msg, type };
  rattrapage.log.unshift(entry);
  if (rattrapage.log.length > 200) rattrapage.log.pop();
  addLog(`[RATTRAPAGE] ${msg}`, type);
}

async function fetchAllOhmePayments() {
  let all = [], cursor = null;
  while (true) {
    try {
      const url = cursor ? `${CONFIG.ohmeBase}/api/v1/payments?limit=500&cursor=${cursor}` : `${CONFIG.ohmeBase}/api/v1/payments?limit=500`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
      if (!res.ok) { rattrapageLog(`Erreur HTTP ${res.status}`, 'error'); break; }
      const json = await res.json();
      const items = json.data || [];
      all = all.concat(items);
      rattrapageLog(`📦 ${all.length} paiements…`, 'info');
      if (items.length < 500) break;
      cursor = items[items.length - 1].id;
    } catch (e) { rattrapageLog(`Exception : ${e.message}`, 'error'); break; }
  }
  return all;
}

async function lancerRattrapage() {
  if (rattrapage.running) return { error: 'Rattrapage déjà en cours' };
  Object.assign(rattrapage, { running: true, total: 0, done: 0, skipped: 0, sent: 0, errors: 0, log: [], startedAt: new Date().toISOString(), finishedAt: null });
  (async () => {
    try {
      rattrapageLog('Récupération de tous les paiements…', 'info');
      const all = await fetchAllOhmePayments();
      const eligibles = all.filter(p => {
        const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').trim();
        if (!eventName) return false;
        const typeId = p.payment_type_id;
        const date = new Date(p.date || p.created_at || 0);
        if (typeId === 1 && date < RATTRAPAGE_DATE_DONS) return false;
        if (typeId === 3 && date < RATTRAPAGE_DATE_BILL) return false;
        return typeId === 1 || typeId === 3;
      });
      rattrapage.total = eligibles.length;
      rattrapageLog(`${eligibles.length} paiement(s) éligible(s)`, 'info');
      for (const p of eligibles) {
        rattrapage.done++;
        const cf = p.custom_fields || p;
        const typeId = p.payment_type_id;
        const date = new Date(p.date || 0).toLocaleDateString('fr-FR');
        const montantPromesse = parseFloat(cf.montant_promesse_don_par_km || 0);
        const isPromesse = montantPromesse > 0;

        if (typeId === 1) {
          const contactDon = await fetchOhmeContactById(p.contact_id);
          const prenomD = contactDon?.firstname || contactDon?.first_name || '';
          const nomD    = contactDon?.lastname  || contactDon?.last_name  || '';
          const donateur = `${prenomD} ${nomD}`.trim() || 'Donateur';
          const emailDon = contactDon?.email || '';
          const montant  = p.amount || '?';
          const coureurParraine = (cf.coureur_parraine || '').trim();
          const equipeParraine  = (cf.equipe_parraine  || '').trim();

          if (isPromesse) {
            const montantKm = montantPromesse.toString();
            if (coureurParraine) {
              const contact = await fetchOhmeContactByName(coureurParraine);
              const emailC = contact?.email || '';
              if (emailC) {
                const html = tplPromesseCoureur({ coureurPrenom: coureurParraine.split(' ')[0], donateur, montantParKm: montantKm, email_donateur: emailDon, association: cf.asso_soutenue || '', nbPromessesCoureur: 0, totalKmParCoureur: 0, nbPromessesEquipe: 0, totalKmParEquipe: 0 });
                const ok = await sendBrevo(emailC, `🏅 Promesse de don pour ton Défi Enfance !`, html);
                if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Promesse ${montantKm}€/km → ${coureurParraine}`, 'ok'); }
                else { rattrapage.errors++; }
              } else { rattrapage.skipped++; }
            } else if (equipeParraine) {
              const structure = await fetchOhmeStructureByName(equipeParraine);
              const chefEmail = structure?.email_referent_defi_enfance || '';
              const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
              const chefNom   = structure?.nom_du_referent_defi_enfance || '';
              if (chefEmail) {
                const html = tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montantParKm: montantKm, email_donateur: emailDon, nbPromessesEquipe: 0, totalKmParEquipe: 0 });
                const ok = await sendBrevo(chefEmail, `🏅 Promesse de don pour votre équipe !`, html);
                if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Promesse ${montantKm}€/km → équipe ${equipeParraine}`, 'ok'); }
                else { rattrapage.errors++; }
              } else { rattrapage.skipped++; }
            } else { rattrapage.skipped++; }
          } else {
            if (coureurParraine) {
              const contact = await fetchOhmeContactByName(coureurParraine);
              const emailC = contact?.email || '';
              if (emailC) { const html = tplDonCoureur({ coureurPrenom: coureurParraine.split(' ')[0], donateur, montant, email_donateur: emailDon, association: cf.asso_soutenue || '' }); const ok = await sendBrevo(emailC, '❤️ Nouveau don pour ton Défi Enfance !', html); if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Don ${montant}€ → ${coureurParraine}`, 'ok'); } else { rattrapage.errors++; } }
              else { rattrapage.skipped++; }
            } else if (equipeParraine) {
              const structure = await fetchOhmeStructureByName(equipeParraine);
              const chefEmail = structure?.email_referent_defi_enfance || '';
              const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
              const chefNom   = structure?.nom_du_referent_defi_enfance || '';
              if (chefEmail) { const html = tplDonEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon }); const ok = await sendBrevo(chefEmail, '❤️ Nouveau don pour votre équipe !', html); if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Don ${montant}€ → équipe ${equipeParraine}`, 'ok'); } else { rattrapage.errors++; } }
              else { rattrapage.skipped++; }
            } else {
              const structure = await fetchOhmeStructureByName('Défi Enfance');
              const chefEmail = structure?.email_referent_defi_enfance || '';
              const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
              const chefNom   = structure?.nom_du_referent_defi_enfance || '';
              if (chefEmail) { const html = tplDonEquipe({ chefPrenom, chefNom, nomEquipe: 'Défi Enfance', donateur, montant, email_donateur: emailDon }); const ok = await sendBrevo(chefEmail, '❤️ Don non fléché — Défi Enfance !', html); if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Don non fléché ${montant}€`, 'ok'); } else { rattrapage.errors++; } }
              else { rattrapage.skipped++; }
            }
          }
        } else if (typeId === 3) {
          const contactC = await fetchOhmeContactById(p.contact_id);
          const prenomC = contactC?.firstname || contactC?.first_name || '';
          const nomC   = contactC?.lastname  || contactC?.last_name  || '';
          const coureur = `${prenomC} ${nomC}`.trim() || 'Coureur';
          const emailC  = contactC?.email || '';
          const nomAsso = (cf.asso_soutenue || '').trim();
          const equipeC = (cf.equipe || '').trim();
          if (nomAsso && nomAsso.toLowerCase() === equipeC.toLowerCase()) { rattrapage.skipped++; continue; }
          if (nomAsso) {
            const structure = await fetchOhmeStructureByName(nomAsso);
            const emailAsso = structure?.email_referent_defi_enfance || '';
            const prenomRef = structure?.prenom_du_referent_defi_enfance || '';
            const eventNom = (cf.nom_de_levent || p.nom_de_levent || '');
            const ville = eventNom.replace(/défi\s*enfance?\s*/gi, '').replace(/\d{4}/g, '').trim();
            if (emailAsso) { const html = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailC, ville, prenomReferent: prenomRef }); const ok = await sendBrevo(emailAsso, '🏃 Nouveau coureur — Défi Enfance !', html); if (ok) { rattrapage.sent++; state.stats.sent++; rattrapageLog(`✅ [${date}] Inscription ${coureur} → ${nomAsso}`, 'ok'); } else { rattrapage.errors++; } }
            else { rattrapage.skipped++; }
          } else { rattrapage.skipped++; }
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      rattrapageLog(`🎉 Terminé — ${rattrapage.sent} envoyé(s), ${rattrapage.skipped} ignoré(s), ${rattrapage.errors} erreur(s)`, 'ok');
    } catch (e) { rattrapageLog(`Exception : ${e.message}`, 'error'); }
    finally { rattrapage.running = false; rattrapage.finishedAt = new Date().toISOString(); }
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
  if (premierPoll) addLog('⚠️ Premier poll — paiements mis en attente de validation', 'warn');
  await processPayments(payments);
  if (premierPoll) { premierPoll = false; await saveProcessedIds(); addLog('✅ Mode validation manuelle terminé — surveillance automatique active', 'ok'); }
}

function startPolling() {
  if (state.isRunning) return;
  state.isRunning = true;
  addLog('▶ Surveillance démarrée', 'ok');
  poll();
  state.pollTimer = setInterval(poll, CONFIG.pollInterval);
}

// ══════════════════════════════════════════════════════
//  API REST
// ══════════════════════════════════════════════════════
app.get('/api/status', (req, res) => {
  res.json({ isRunning: state.isRunning, stats: state.stats, lastPoll: state.lastPoll, nextPoll: state.nextPoll, pollInterval: CONFIG.pollInterval, processedCount: state.processedIds.size, redisOk: !!(CONFIG.upstashUrl && CONFIG.upstashToken), version: SERVER_VERSION });
});

app.get('/api/logs',   (req, res) => res.json(state.logs.slice(0, 50)));
app.get('/api/events', (req, res) => res.json(state.events));

// ── TEST EMAIL — liste complète de tous les templates
app.post('/api/test-email', async (req, res) => {
  const { to, template } = req.body;
  if (!to) return res.status(400).json({ error: 'Email requis' });

  const TEMPLATES = {
    // ── DONS CLASSIQUES
    don_coureur:           { subject: '🧪 Test — ❤️ Nouveau don pour ton Défi Enfance !',          html: tplDonCoureur({ coureurPrenom: 'Pierre', donateur: 'Jean-Claude Martin', montant: '50', email_donateur: 'jc.martin@test.fr', association: 'Les Enfants du Soleil', motEncouragement: 'Allez Pierre, tu peux le faire !' }) },
    don_equipe:            { subject: '🧪 Test — 🏆 Nouveau don pour votre équipe !',               html: tplDonEquipe({ chefPrenom: 'Sophie', chefNom: 'Dupont', nomEquipe: 'Les Gazelles Solidaires', donateur: 'Marie Dupont', montant: '100', email_donateur: 'marie.dupont@test.fr', motEncouragement: 'Bravo à toute l\'équipe !' }) },
    don_nonfleche:         { subject: '🧪 Test — ❤️ Don non fléché reçu !',                        html: tplDonEquipe({ chefPrenom: 'Responsable', chefNom: 'Défi', nomEquipe: 'Défi Enfance', donateur: 'Thomas Bernard', montant: '30', email_donateur: 't.bernard@test.fr' }) },
    // ── PROMESSES DE DONS
    promesse_coureur:      { subject: '🧪 Test — 🏅 Promesse de don pour toi !',                   html: tplPromesseCoureur({ coureurPrenom: 'Pierre', donateur: 'Jean-Claude Martin', montantParKm: '5', email_donateur: 'jc.martin@test.fr', association: 'Les Enfants du Soleil', motEncouragement: 'Cours comme jamais, je te soutiens !', nbPromessesCoureur: 3, totalKmParCoureur: 12, nbPromessesEquipe: 7, totalKmParEquipe: 31 }) },
    promesse_equipe:       { subject: '🧪 Test — 🏅 Promesse de don pour votre équipe !',          html: tplPromesseEquipe({ chefPrenom: 'Sophie', chefNom: 'Dupont', nomEquipe: 'Les Gazelles Solidaires', donateur: 'Marc Leroy', montantParKm: '3', email_donateur: 'marc.leroy@test.fr', motEncouragement: 'Toute l\'équipe est incroyable !', nbPromessesEquipe: 5, totalKmParEquipe: 18 }) },
    merci_prometteur_coureur: { subject: '🧪 Test — 🙏 Merci pour votre promesse de don !',       html: tplMerciPrometteurCoureur({ prenomDonateur: 'Jean-Claude', montantParKm: '5', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil' }) },
    merci_prometteur_equipe:  { subject: '🧪 Test — 🙏 Merci pour votre promesse d\'équipe !',    html: tplMerciPrometteurEquipe({ prenomDonateur: 'Marc', montantParKm: '3', nomEquipe: 'Les Gazelles Solidaires' }) },
    // ── INSCRIPTIONS
    inscription_asso:      { subject: '🧪 Test — 🏃 Nouveau coureur pour votre cause !',           html: tplInscriptionAsso({ nomAsso: 'Espoir Enfants', coureur: 'Lucas Moreau', email_coureur: 'l.moreau@test.fr', ville: 'Angers', prenomReferent: 'Sophie' }) },
    inscription_coureur:   { subject: '🧪 Test — 🚀 Bienvenue coureur Défi Enfance !',             html: tplInscriptionCoureur({ prenom: 'Lucas', nomComplet: 'Lucas Moreau' }) },
    inscription_supporter: { subject: '🧪 Test — 🚀 Bienvenue supporter Défi Enfance !',           html: tplInscriptionSupporter({ prenom: 'Marie' }) },
    dejeuner:              { subject: '🧪 Test — 🥗 Confirmation panier repas Défi Enfance !',      html: tplDejeuner({ prenom: 'Sophie' }) },
    billets_en_gros:       { subject: '🧪 Test — 🎉 Merci pour votre règlement groupé !',          html: tplBilletsEnGros({ prenomRef: 'Sophie', nomStructure: 'Entreprise XYZ', nomEquipe: 'Les Gazelles Solidaires', montant: '500', date: '22/05/2026' }) },
    // ── MERCI DONATEURS
    merci_donateur:        { subject: '🧪 Test — ❤️ Merci pour votre don à Pierre !',              html: tplMerciDonateur({ prenomDonateur: 'Jean-Claude', montant: '50', donateur: 'Jean-Claude Martin', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil' }) },
    merci_donateur_equipe: { subject: '🧪 Test — ❤️ Merci pour votre don à l\'équipe !',          html: tplMerciDonateurEquipe({ prenomDonateur: 'Jean-Claude', montant: '100', donateur: 'Jean-Claude Martin', nomEquipe: 'Les Gazelles Solidaires' }) },
    merci_donateur_global: { subject: '🧪 Test — ❤️ Merci pour votre don !',                      html: tplMerciDonateurGlobal({ prenomDonateur: 'Jean-Claude', montant: '30' }) },
    merci_donateur_fidele: { subject: '🧪 Test — 🏅 Super Badge Donateur !',                      html: tplMerciDonateurFidele({ prenomDonateur: 'Jean-Claude', montant: '50' }) },
    merci_structure:       { subject: '🧪 Test — ❤️ Merci pour le don de votre entreprise !',     html: tplMerciDonateurStructure({ prenomDonateur: 'Sophie', montant: '200', nomStructure: 'Entreprise XYZ', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil' }) },
    // ── ENVOIS GROUPÉS — renvoie le vrai template si disponible, sinon placeholder
    groupe_angers_j10_coureurs:  { subject: '🧪 Test — 🎽 J-10 Angers Coureurs',        html: tplGroupeJ10Angers({ prenom: 'Sophie' }) },
    groupe_angers_j4_coureurs:   { subject: '🧪 Test — 📢 J-4 Angers Coureurs',          html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-4 Coureurs Angers' }) },
    groupe_angers_j4_supporters: { subject: '🧪 Test — 📢 J-4 Angers Supporters',        html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-4 Supporters Angers' }) },
    groupe_angers_j1_coureurs:   { subject: '🧪 Test — 📢 J-1 Angers Coureurs',          html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-1 Coureurs Angers' }) },
    groupe_angers_j1_supporters: { subject: '🧪 Test — 📢 J-1 Angers Supporters',        html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-1 Supporters Angers' }) },
    groupe_angers_jourj_coureurs:{ subject: '🧪 Test — 📢 Jour J Angers Coureurs',        html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'Jour J Coureurs Angers' }) },
    groupe_angers_jp1_coureurs:  { subject: '🧪 Test — 📢 J+1 Angers Coureurs',          html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J+1 Coureurs Angers' }) },
    groupe_angers_jp10_coureurs: { subject: '🧪 Test — 📢 J+10 Angers Coureurs',         html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J+10 Coureurs Angers' }) },
    groupe_joue_j10_coureurs:    { subject: '🧪 Test — 🎽 J-10 Joué Coureurs',           html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-10 Coureurs Joué' }) },
    groupe_joue_j4_coureurs:     { subject: '🧪 Test — 📢 J-4 Joué Coureurs',            html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-4 Coureurs Joué' }) },
    groupe_joue_j4_supporters:   { subject: '🧪 Test — 📢 J-4 Joué Supporters',          html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-4 Supporters Joué' }) },
    groupe_joue_j1_coureurs:     { subject: '🧪 Test — 📢 J-1 Joué Coureurs',            html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-1 Coureurs Joué' }) },
    groupe_joue_j1_supporters:   { subject: '🧪 Test — 📢 J-1 Joué Supporters',          html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-1 Supporters Joué' }) },
    groupe_joue_jourj_coureurs:  { subject: '🧪 Test — 📢 Jour J Joué Coureurs',          html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'Jour J Coureurs Joué' }) },
    groupe_joue_jp1_coureurs:    { subject: '🧪 Test — 📢 J+1 Joué Coureurs',            html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J+1 Coureurs Joué' }) },
    groupe_joue_jp10_coureurs:   { subject: '🧪 Test — 📢 J+10 Joué Coureurs',           html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J+10 Coureurs Joué' }) },
  };

  const tpl = TEMPLATES[template] || TEMPLATES['don_coureur'];
  const ok = await sendBrevo(to, tpl.subject, tpl.html);
  res.json({ success: ok });
});

app.post('/api/forcer-paiement', async (req, res) => {
  const { paiementId } = req.body;
  if (!paiementId) return res.status(400).json({ error: 'ID paiement requis' });
  addLog(`🔧 Envoi forcé : ${paiementId}`, 'info');
  try {
    let p = null;
    const isExternalId = isNaN(paiementId.replace(/[^0-9]/g, '')) || paiementId.includes('-') || paiementId.includes('GiveWP');
    if (isExternalId) {
      await sleep(OHME_DELAY_MS);
      const r = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?external_id=${encodeURIComponent(paiementId)}&limit=5`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
      if (!r.ok) return res.json({ success: false, error: `HTTP ${r.status}` });
      const items = (await r.json()).data || [];
      if (!items.length) return res.json({ success: false, error: `"${paiementId}" introuvable` });
      p = items[0];
    } else {
      await sleep(OHME_DELAY_MS);
      const r = await fetch(`${CONFIG.ohmeBase}/api/v1/payments/${paiementId}`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
      if (!r.ok) return res.json({ success: false, error: `HTTP ${r.status}` });
      p = (await r.json()).data || await r.json();
    }
    if (!p) return res.json({ success: false, error: 'Paiement introuvable' });
    state.processedIds.delete(String(p.id));
    await processPaymentsForced([p]);
    await saveProcessedIds();
    res.json({ success: true, message: `Paiement ${p.external_id || p.id} traité` });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/poll-now', async (req, res) => { await poll(); res.json({ success: true, stats: state.stats }); });

app.get('/api/dons-attente', (req, res) => res.json(state.donsEnAttente));

app.post('/api/dons-attente/:paiementId/valider', async (req, res) => {
  const { paiementId } = req.params;
  const don = state.donsEnAttente.find(d => String(d.paiementId) === String(paiementId));
  if (!don) return res.status(404).json({ error: `Don introuvable (ID: ${paiementId})` });
  let paiement = null;
  try { await sleep(OHME_DELAY_MS); const r = await fetch(`${CONFIG.ohmeBase}/api/v1/payments/${paiementId}`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }); if (r.ok) { paiement = (await r.json()).data || await r.json(); } } catch(e) {}
  if (!paiement) return res.json({ success: false, error: 'Impossible de relire le paiement dans Ohme' });

  const cf = paiement.custom_fields || paiement;
  const typeId = paiement.payment_type_id;
  const coureurParraine = (cf.coureur_parraine || '').trim();
  const equipeParraine  = (cf.equipe_parraine  || '').trim();
  const montantPromesse = parseFloat(cf.montant_promesse_don_par_km || 0);
  const isPromesse = montantPromesse > 0;
  const { donateur, emailDon, montant } = don;
  let ok = false;

  if (typeId === 3) {
    const nomAsso = (cf.asso_soutenue || '').trim();
    const eventNomValider = (cf.nom_de_levent || paiement.nom_de_levent || '');
    const ville = eventNomValider.replace(/défi\s*enfance?\s*/gi, '').replace(/\d{4}/g, '').trim();
    const isDejeunerValider = eventNomValider.toUpperCase().includes('#DEJEUNER') || eventNomValider.toUpperCase().includes('#DÉJEUNER');
    const contactC = await fetchOhmeContactById(paiement.contact_id);
    const prenomC = contactC?.firstname || contactC?.first_name || '';
    const coureur = `${prenomC} ${contactC?.lastname||contactC?.last_name||''}`.trim() || donateur;
    const emailC  = contactC?.email || '';

    // Cas déjeuner
    if (isDejeunerValider) {
      if (emailC) {
        const html = tplDejeuner({ prenom: prenomC || coureur });
        ok = await sendBrevo(emailC, '🥗 Votre panier repas Défi Enfance est confirmé !', html);
        if (ok) { state.stats.sent++; addLog(`✅ Email déjeuner validé → ${coureur}`, 'ok'); }
      } else { return res.json({ success: false, error: `Email introuvable pour ${coureur}` }); }

    } else {
      const isSupporterValider = eventNomValider.toUpperCase().includes('#SUPPORTERS');

      if (isSupporterValider) {
        // Supporter → email bienvenue supporter uniquement
        if (emailC) {
          const htmlSup = tplInscriptionSupporter({ prenom: prenomC || coureur });
          const okSup = await sendBrevo(emailC, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, htmlSup);
          if (okSup) { state.stats.sent++; addLog(`✅ Bienvenue supporter validé → ${coureur}`, 'ok'); ok = true; }
        } else { return res.json({ success: false, error: `Email introuvable pour ${coureur}` }); }

      } else {
        // Coureur → email bienvenue coureur + email asso si renseignée
        if (emailC) {
          const htmlCoureur = tplInscriptionCoureur({ prenom: prenomC || coureur, nomComplet: coureur });
          const okCoureur = await sendBrevo(emailC, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, htmlCoureur);
          if (okCoureur) { state.stats.sent++; addLog(`✅ Bienvenue coureur validé → ${coureur}`, 'ok'); ok = true; }
        }
        if (nomAsso) {
          const structure = await fetchOhmeStructureByName(nomAsso);
          const emailAsso = structure?.email_referent_defi_enfance || '';
          const prenomRef = structure?.prenom_du_referent_defi_enfance || '';
          if (emailAsso) {
            const htmlAsso = tplInscriptionAsso({ nomAsso, coureur, email_coureur: emailC, ville, prenomReferent: prenomRef });
            const okAsso = await sendBrevo(emailAsso, '🏃 Nouveau coureur — Défi Enfance !', htmlAsso);
            if (okAsso) { state.stats.sent++; addLog(`✅ Inscription validée → asso ${nomAsso}`, 'ok'); ok = true; }
          } else { addLog(`⚠️ Inscription validée — email asso "${nomAsso}" introuvable`, 'warn'); }
        }
        if (!ok) { return res.json({ success: false, error: "Email introuvable pour le coureur et l'association" }); }
      }
    }

  } else if (isPromesse) {
    const montantKm = montantPromesse.toString();
    if (coureurParraine) {
      const contact = await fetchOhmeContactByName(coureurParraine);
      const emailC  = contact?.email || '';
      if (emailC) {
        const html = tplPromesseCoureur({ coureurPrenom: coureurParraine.split(' ')[0], donateur, montantParKm: montantKm, email_donateur: emailDon, nbPromessesCoureur: 0, totalKmParCoureur: 0, nbPromessesEquipe: 0, totalKmParEquipe: 0 });
        ok = await sendBrevo(emailC, `🏅 Promesse de don pour ton Défi Enfance !`, html);
        if (ok) { state.stats.sent++; addLog(`✅ Promesse validée → coureur ${coureurParraine}`, 'ok'); }
        const htmlMerci = tplMerciPrometteurCoureur({ prenomDonateur: donateur.split(' ')[0], montantParKm: montantKm, coureurPrenom: coureurParraine.split(' ')[0], coureurNom: coureurParraine.split(' ').slice(1).join(' ') });
        const okMerci = await sendBrevo(emailDon, `🙏 Merci pour votre promesse !`, htmlMerci);
        if (okMerci) { state.stats.sent++; }
      } else { return res.json({ success: false, error: `Coureur "${coureurParraine}" introuvable` }); }
    } else if (equipeParraine) {
      const structure = await fetchOhmeStructureByName(equipeParraine);
      const chefEmail  = structure?.email_referent_defi_enfance || '';
      const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
      const chefNom    = structure?.nom_du_referent_defi_enfance || '';
      if (chefEmail) {
        const html = tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montantParKm: montantKm, email_donateur: emailDon, nbPromessesEquipe: 0, totalKmParEquipe: 0 });
        ok = await sendBrevo(chefEmail, `🏅 Promesse de don pour votre équipe !`, html);
        if (ok) { state.stats.sent++; addLog(`✅ Promesse validée → équipe ${equipeParraine}`, 'ok'); }
      } else { return res.json({ success: false, error: `Équipe "${equipeParraine}" introuvable` }); }
    } else { return res.json({ success: false, error: 'Promesse non fléchée — mettez à jour dans Ohme' }); }

  } else if (coureurParraine) {
    const contact = await fetchOhmeContactByName(coureurParraine);
    const emailC  = contact?.email || '';
    if (emailC) {
      const html = tplDonCoureur({ coureurPrenom: coureurParraine.split(' ')[0], donateur, montant, email_donateur: emailDon, association: (cf.asso_soutenue || '') });
      ok = await sendBrevo(emailC, '❤️ Nouveau don pour ton Défi Enfance !', html);
      if (ok) { state.stats.sent++; addLog(`✅ Don validé → ${coureurParraine}`, 'ok'); sendMerciDonateur({ email: emailDon, prenom: donateur.split(' ')[0], montant, donateur }); }
      const equipe = await fetchEquipeCoureur(contact?.id);
      if (equipe) { const s = await fetchOhmeStructureByName(equipe); if (s?.email_referent_defi_enfance) { const htmlE = tplDonEquipe({ chefPrenom: s.prenom_du_referent_defi_enfance || 'Bonjour', chefNom: s.nom_du_referent_defi_enfance || '', nomEquipe: equipe, donateur, montant, email_donateur: emailDon }); const okE = await sendBrevo(s.email_referent_defi_enfance, '❤️ Don pour votre équipe !', htmlE); if (okE) { state.stats.sent++; } } }
    } else { return res.json({ success: false, error: `Coureur "${coureurParraine}" introuvable` }); }

  } else if (equipeParraine) {
    const s = await fetchOhmeStructureByName(equipeParraine);
    if (s?.email_referent_defi_enfance) {
      const html = tplDonEquipe({ chefPrenom: s.prenom_du_referent_defi_enfance || 'Bonjour', chefNom: s.nom_du_referent_defi_enfance || '', nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon });
      ok = await sendBrevo(s.email_referent_defi_enfance, '❤️ Don pour votre équipe !', html);
      if (ok) { state.stats.sent++; sendMerciDonateur({ email: emailDon, prenom: donateur.split(' ')[0], montant, donateur }); addLog(`✅ Don validé → équipe ${equipeParraine}`, 'ok'); }
    } else { return res.json({ success: false, error: `Équipe "${equipeParraine}" introuvable` }); }
  } else {
    const s = await fetchOhmeStructureByName('Défi Enfance');
    if (s?.email_referent_defi_enfance) {
      const html = tplDonEquipe({ chefPrenom: s.prenom_du_referent_defi_enfance || 'Bonjour', chefNom: s.nom_du_referent_defi_enfance || '', nomEquipe: 'Défi Enfance', donateur, montant, email_donateur: emailDon });
      ok = await sendBrevo(s.email_referent_defi_enfance, '❤️ Don non fléché — Défi Enfance !', html);
      if (ok) { state.stats.sent++; sendMerciDonateur({ email: emailDon, prenom: donateur.split(' ')[0], montant, donateur }); addLog(`✅ Don non fléché → Défi Enfance`, 'ok'); }
    } else { return res.json({ success: false, error: 'Structure "Défi Enfance" introuvable' }); }
  }

  if (ok) { state.donsEnAttente = state.donsEnAttente.filter(d => String(d.paiementId) !== String(paiementId)); await saveDonsEnAttente(); }
  res.json({ success: ok });
});

app.post('/api/dons-attente/ignorer-tous', async (req, res) => {
  const count = state.donsEnAttente.length;
  state.donsEnAttente.forEach(d => state.processedIds.add(String(d.paiementId)));
  state.donsEnAttente = [];
  await saveDonsEnAttente(); await saveProcessedIds();
  addLog(`🗑️ ${count} don(s) ignorés`, 'info');
  res.json({ success: true, count });
});

app.post('/api/dons-attente/:paiementId/ignorer', async (req, res) => {
  const { paiementId } = req.params;
  state.donsEnAttente = state.donsEnAttente.filter(d => String(d.paiementId) !== String(paiementId));
  await saveDonsEnAttente();
  addLog(`🗑️ Don ignoré : ${paiementId}`, 'info');
  res.json({ success: true });
});

app.post('/api/rattrapage/start', async (req, res) => { res.json(await lancerRattrapage()); });
app.get('/api/rattrapage/status', (req, res) => {
  res.json({ running: rattrapage.running, total: rattrapage.total, done: rattrapage.done, skipped: rattrapage.skipped, sent: rattrapage.sent, errors: rattrapage.errors, startedAt: rattrapage.startedAt, finishedAt: rattrapage.finishedAt, log: rattrapage.log.slice(0, 100) });
});


// ══════════════════════════════════════════════════════
//  ENVOIS GROUPÉS — CONFIGURATION DES CAMPAGNES
// ══════════════════════════════════════════════════════

// Délai entre chaque email pour 800 emails en 30 min = 2250ms
const ENVOI_GROUPE_DELAY_MS = 2250;
const EMAIL_TEST_VICTOR = 'v.vieilfault@unionpourlenfance.com';


// Définition de toutes les campagnes disponibles
const CAMPAGNES = {
  // ── ANGERS
  'angers_j10_coureurs': {
    label: 'J-10 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🎽 Dans 9 jours, on court pour l\'enfance à Angers — tout ce qu\'il faut savoir !',
    template: (prenom) => tplGroupeJ10Angers({ prenom }),
  },
  'angers_j1_supporters': {
    label: 'J-1 Angers — Supporters',
    event: 'Défi Enfance #Supporters #Angers2026',
    destinataires: ['supporter'],
    sujet: '🎽 Dans 1 jour, soutenez les coureurs du Défi Enfance à Angers !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-1 Supporters Angers' }),
  },
  'angers_j4_coureurs': {
    label: 'J-4 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🏃 Plus que 4 jours — Défi Enfance Angers !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-4 Coureurs Angers' }),
  },
  'angers_j4_supporters': {
    label: 'J-4 Angers — Supporters',
    event: 'Défi Enfance #Supporters #Angers2026',
    destinataires: ['supporter'],
    sujet: '🏃 Plus que 4 jours — soutenez le Défi Enfance Angers !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-4 Supporters Angers' }),
  },
  'angers_j1_coureurs': {
    label: 'J-1 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🌟 Demain, c\'est le jour J — Défi Enfance Angers !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-1 Coureurs Angers' }),
  },
  'angers_jourj_coureurs': {
    label: 'Jour J Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🏁 C\'est aujourd\'hui ! Défi Enfance Angers — on vous attend !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'Jour J Coureurs Angers' }),
  },
  'angers_jp1_coureurs': {
    label: 'J+1 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🙏 Merci pour votre engagement — Défi Enfance Angers !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J+1 Coureurs Angers' }),
  },
  'angers_jp10_coureurs': {
    label: 'J+10 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '💌 10 jours après le Défi Enfance Angers…',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J+10 Coureurs Angers' }),
  },
  // ── JOUÉ-LÈS-TOURS
  'joue_j10_coureurs': {
    label: 'J-10 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🎽 Dans 9 jours, on court pour l\'enfance à Joué-lès-Tours !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-10 Coureurs Joué' }),
  },
  'joue_j1_supporters': {
    label: 'J-1 Joué — Supporters',
    event: 'Défi Enfance #Supporters #Joué-lès-Tours2026',
    destinataires: ['supporter'],
    sujet: '🎽 Dans 1 jour, soutenez les coureurs du Défi Enfance à Joué !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-1 Supporters Joué' }),
  },
  'joue_j4_coureurs': {
    label: 'J-4 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🏃 Plus que 4 jours — Défi Enfance Joué-lès-Tours !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-4 Coureurs Joué' }),
  },
  'joue_j4_supporters': {
    label: 'J-4 Joué — Supporters',
    event: 'Défi Enfance #Supporters #Joué-lès-Tours2026',
    destinataires: ['supporter'],
    sujet: '🏃 Plus que 4 jours — soutenez le Défi Enfance Joué !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-4 Supporters Joué' }),
  },
  'joue_j1_coureurs': {
    label: 'J-1 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🌟 Demain, c\'est le jour J — Défi Enfance Joué !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J-1 Coureurs Joué' }),
  },
  'joue_jourj_coureurs': {
    label: 'Jour J Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🏁 C\'est aujourd\'hui ! Défi Enfance Joué — on vous attend !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'Jour J Coureurs Joué' }),
  },
  'joue_jp1_coureurs': {
    label: 'J+1 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🙏 Merci pour votre engagement — Défi Enfance Joué !',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J+1 Coureurs Joué' }),
  },
  'joue_jp10_coureurs': {
    label: 'J+10 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '💌 10 jours après le Défi Enfance Joué…',
    template: (prenom) => tplGroupePlaceholder({ prenom, nomTemplate: 'J+10 Coureurs Joué' }),
  },
};

// ── État des envois groupés
const envoiGroupe = {
  running:    false,
  campagneId: null,
  label:      '',
  total:      0,
  done:       0,
  sent:       0,
  errors:     0,
  skipped:    0,
  log:        [],
  startedAt:  null,
  finishedAt: null,
};

function envoiGroupeLog(msg, type = 'info') {
  const entry = { ts: new Date().toISOString(), msg, type };
  envoiGroupe.log.unshift(entry);
  if (envoiGroupe.log.length > 500) envoiGroupe.log.pop();
  addLog(`[ENVOI GROUPÉ] ${msg}`, type);
}

// ── Récupérer tous les participants d'un événement Ohme
async function fetchParticipantsEvenement(nomEvent, typesDestinaires) {
  // typesDestinaires = ['coureur'] ou ['supporter'] ou ['coureur','supporter']
  const participants = [];
  const vus = new Set();

  try {
    // Récupérer tous les paiements billetterie (type 3)
    let cursor = null;
    while (true) {
      await sleep(OHME_DELAY_MS);
      const url = cursor
        ? `${CONFIG.ohmeBase}/api/v1/payments?limit=500&payment_type_id=3&cursor=${cursor}`
        : `${CONFIG.ohmeBase}/api/v1/payments?limit=500&payment_type_id=3`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
      });
      if (!res.ok) { envoiGroupeLog(`Erreur Ohme HTTP ${res.status}`, 'error'); break; }
      const json = await res.json();
      const items = json.data || [];

      for (const p of items) {
        const eventNom = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').trim();
        // Filtrer sur le nom exact de l'événement
        if (eventNom !== nomEvent) continue;

        const cf = p.custom_fields || p;
        const isSupporter = eventNom.toUpperCase().includes('#SUPPORTERS') ||
                            (cf.type_participant || '').toLowerCase().includes('supporter');
        const isDejeuner  = eventNom.toUpperCase().includes('#DEJEUNER') ||
                            eventNom.toUpperCase().includes('#DÉJEUNER');

        // Exclure les déjeuners dans tous les cas
        if (isDejeuner) continue;

        // Filtrer selon le type souhaité
        const typeP = isSupporter ? 'supporter' : 'coureur';
        if (!typesDestinaires.includes(typeP)) continue;

        // Éviter les doublons sur contact_id
        if (vus.has(String(p.contact_id))) continue;
        vus.add(String(p.contact_id));

        // Récupérer les infos du contact
        const contact = await fetchOhmeContactById(p.contact_id);
        if (!contact) continue;
        const prenom = contact.firstname || contact.first_name || '';
        const nom    = contact.lastname  || contact.last_name  || '';
        const email  = contact.email || '';
        if (!email) { envoiGroupeLog(`⚠️ Contact ${prenom} ${nom} — email vide, ignoré`, 'warn'); continue; }

        participants.push({ prenom: prenom || 'Participant', nom, email, contactId: contact.id, type: typeP });
      }

      if (items.length < 500) break;
      cursor = items[items.length - 1].id;
    }
  } catch(e) {
    envoiGroupeLog(`Exception fetchParticipants : ${e.message}`, 'error');
  }

  return participants;
}

// ── Lancer un envoi groupé
async function lancerEnvoiGroupe(campagneId) {
  if (envoiGroupe.running) return { error: 'Un envoi groupé est déjà en cours' };
  const campagne = CAMPAGNES[campagneId];
  if (!campagne) return { error: `Campagne "${campagneId}" introuvable` };

  Object.assign(envoiGroupe, {
    running: true, campagneId, label: campagne.label,
    total: 0, done: 0, sent: 0, errors: 0, skipped: 0,
    log: [], startedAt: new Date().toISOString(), finishedAt: null,
  });

  (async () => {
    try {
      envoiGroupeLog(`Démarrage : ${campagne.label}`, 'info');
      envoiGroupeLog(`Récupération des participants (${campagne.destinataires.join(', ')}) pour "${campagne.event}"…`, 'info');

      const participants = await fetchParticipantsEvenement(campagne.event, campagne.destinataires);
      envoiGroupe.total = participants.length;
      envoiGroupeLog(`✅ ${participants.length} destinataire(s) trouvé(s)`, 'ok');

      if (participants.length === 0) {
        envoiGroupeLog('⚠️ Aucun destinataire — envoi annulé', 'warn');
        return;
      }

      // Calcul du délai pour tenir dans 30 min
      const delaiMs = Math.max(ENVOI_GROUPE_DELAY_MS, Math.ceil((30 * 60 * 1000) / participants.length));
      const dureeMin = Math.ceil((participants.length * delaiMs) / 60000);
      envoiGroupeLog(`⏱️ Délai entre envois : ${delaiMs}ms — durée estimée : ~${dureeMin} min`, 'info');

      for (const p of participants) {
        envoiGroupe.done++;
        try {
          const html = campagne.template(p.prenom);
          const ok = await sendBrevo(p.email, campagne.sujet, html);
          if (ok) {
            envoiGroupe.sent++;
            state.stats.sent++;
            envoiGroupeLog(`✅ [${envoiGroupe.done}/${envoiGroupe.total}] ${p.prenom} ${p.nom} (${p.email})`, 'ok');
          } else {
            envoiGroupe.errors++;
            envoiGroupeLog(`❌ [${envoiGroupe.done}/${envoiGroupe.total}] Échec → ${p.email}`, 'error');
          }
        } catch(e) {
          envoiGroupe.errors++;
          envoiGroupeLog(`❌ Exception → ${p.email} : ${e.message}`, 'error');
        }
        // Délai entre chaque email
        await new Promise(r => setTimeout(r, delaiMs));
      }

      envoiGroupeLog(`🎉 Terminé — ${envoiGroupe.sent} envoyé(s), ${envoiGroupe.skipped} ignoré(s), ${envoiGroupe.errors} erreur(s)`, 'ok');
      addEvent('📢', `Envoi groupé terminé`, `${campagne.label} — ${envoiGroupe.sent} emails`, 'bill');

    } catch(e) {
      envoiGroupeLog(`Exception générale : ${e.message}`, 'error');
    } finally {
      envoiGroupe.running    = false;
      envoiGroupe.finishedAt = new Date().toISOString();
    }
  })();

  return { started: true, label: campagne.label };
}

// ── API — Envois groupés
app.get('/api/campagnes', (req, res) => {
  const liste = Object.entries(CAMPAGNES).map(([id, c]) => ({
    id,
    label:         c.label,
    event:         c.event,
    destinataires: c.destinataires,
    sujet:         c.sujet,
    placeholder:   c.template.toString().includes('tplGroupePlaceholder'),
  }));
  res.json(liste);
});

app.post('/api/campagnes/:id/preview', async (req, res) => {
  const campagne = CAMPAGNES[req.params.id];
  if (!campagne) return res.status(404).json({ error: 'Campagne introuvable' });
  if (envoiGroupe.running) return res.json({ error: 'Un envoi est déjà en cours' });
  try {
    envoiGroupeLog(`🔍 Comptage destinataires pour "${campagne.label}"…`, 'info');
    const participants = await fetchParticipantsEvenement(campagne.event, campagne.destinataires);
    res.json({ count: participants.length, label: campagne.label, event: campagne.event });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.post('/api/campagnes/:id/test', async (req, res) => {
  const campagne = CAMPAGNES[req.params.id];
  if (!campagne) return res.status(404).json({ error: 'Campagne introuvable' });
  if (envoiGroupe.running) return res.json({ error: 'Un envoi est déjà en cours' });
  try {
    const html = campagne.template('Victor');
    const ok = await sendBrevo(EMAIL_TEST_VICTOR, `[TEST] ${campagne.sujet}`, html);
    if (ok) {
      addLog(`🧪 Email test "${campagne.label}" envoyé à Victor`, 'ok');
      res.json({ success: true, message: `Email test envoyé à ${EMAIL_TEST_VICTOR}` });
    } else {
      res.json({ success: false, error: 'Échec envoi Brevo' });
    }
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/campagnes/:id/start', async (req, res) => {
  const result = await lancerEnvoiGroupe(req.params.id);
  res.json(result);
});

app.get('/api/campagnes/status', (req, res) => {
  res.json({
    running:    envoiGroupe.running,
    campagneId: envoiGroupe.campagneId,
    label:      envoiGroupe.label,
    total:      envoiGroupe.total,
    done:       envoiGroupe.done,
    sent:       envoiGroupe.sent,
    errors:     envoiGroupe.errors,
    skipped:    envoiGroupe.skipped,
    startedAt:  envoiGroupe.startedAt,
    finishedAt: envoiGroupe.finishedAt,
    log:        envoiGroupe.log.slice(0, 200),
  });
});

// ══════════════════════════════════════════════════════
//  KEEP-ALIVE
// ══════════════════════════════════════════════════════
const APP_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(async () => { try { await fetch(`${APP_URL}/api/status`); } catch (_) {} }, 14 * 60 * 1000);

// ══════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ Serveur Défi Enfance v${SERVER_VERSION} — port ${PORT}`);
  console.log(`   Redis Upstash : ${CONFIG.upstashUrl ? '✅' : '⚠️ NON CONFIGURÉ'}`);
  console.log(`   Brevo : ${CONFIG.brevoKey ? '✅' : '⚠️ manquant'}`);
});

initFromRedis();
