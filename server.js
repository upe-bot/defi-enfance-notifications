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
const SERVER_VERSION = '111';

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
  redisBlocked:   false,  // true si Redis inaccessible → envois bloqués
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
  const existing = state.donsEnAttente.find(d => d.paiementId === don.paiementId);
  if (existing) {
    // Mettre à jour le statut si déjà présent
    if (existing.typeLabel !== don.typeLabel) {
      existing.typeLabel  = don.typeLabel;
      existing.statutOhme = don.statutOhme;
      saveDonsEnAttente();
      addLog(`🔄 Statut mis à jour : ${don.donateur} — ${don.typeLabel}`, 'info');
    }
    return;
  }
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

  // ── Sécurité Redis : si Redis inaccessible → bloquer tous les envois
  if (!CONFIG.upstashUrl || !CONFIG.upstashToken) {
    console.log('[INIT] ⛔ Redis non configuré — envois bloqués par sécurité');
    state.redisBlocked = true;
    addLog('⛔ Redis non configuré — tous les envois sont bloqués par sécurité', 'error');
    startPolling(); // on démarre quand même pour les logs, mais sans envoyer
    return;
  }

  // Test de connexion Redis
  try {
    const testVal = await redisGet('defi_enfance_ping');
    console.log('[INIT] ✅ Connexion Redis OK');
    state.redisBlocked = false;
  } catch(e) {
    console.log(`[INIT] ⛔ Redis inaccessible : ${e.message} — envois bloqués`);
    state.redisBlocked = true;
    addLog(`⛔ Redis inaccessible — tous les envois sont bloqués par sécurité`, 'error');
    startPolling();
    return;
  }

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



// ── Cache contacts en mémoire (évite les appels répétés à Ohme)
const contactsCache = new Map(); // contactId → contact
const contactsByNameCache = new Map(); // nom complet lowercase → contact

function cacheContact(contact) {
  if (!contact) return;
  const id = String(contact.id || '');
  if (id) contactsCache.set(id, contact);
  const fullName = `${contact.firstname||contact.first_name||''} ${contact.lastname||contact.last_name||''}`.trim().toLowerCase();
  if (fullName) contactsByNameCache.set(fullName, contact);
}

// ── IDs événements Défi Enfance
const EVENT_ID_ANGERS = '36946';
const EVENT_ID_JOUE   = '36956';

// ── Fallback URLs
const URL_PROMESSE_FALLBACK = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
const URL_DON_FALLBACK      = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_event=all';

// ── Détecter l'event ID depuis le nom de l'événement
function getEventId(eventName) {
  const n = (eventName || '').toUpperCase();
  if (n.includes('JOUÉ') || n.includes('JOUE') || n.includes('TOURS')) return EVENT_ID_JOUE;
  if (n.includes('ANGERS')) return EVENT_ID_ANGERS;
  return null;
}

// ── Construire l'URL promesse de don pour un coureur
async function buildUrlPromesseCoureur(contactId, eventName) {
  const eventId = getEventId(eventName);
  if (!eventId || !contactId) return URL_PROMESSE_FALLBACK;
  try {
    const contact = await fetchOhmeContactById(contactId);
    if (!contact) return URL_PROMESSE_FALLBACK;
    const cf = contact.custom_fields || contact;
    const runnerId = eventId === EVENT_ID_ANGERS
      ? (cf.lien_url_don_defi_angers2026 || contact.lien_url_don_defi_angers2026 || '')
      : (cf.lien_url_don_defi_joue2026   || contact.lien_url_don_defi_joue2026   || '');
    if (!runnerId) return URL_PROMESSE_FALLBACK;
    return `https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_promise=1&de_event=${eventId}&de_runner=${runnerId}`;
  } catch(e) { return URL_PROMESSE_FALLBACK; }
}

// ── Construire l'URL page coureur (sans promesse)
async function buildUrlPageCoureur(contactId, eventName) {
  const eventId = getEventId(eventName);
  if (!eventId || !contactId) return URL_COUREURS;
  try {
    const contact = await fetchOhmeContactById(contactId);
    if (!contact) return URL_COUREURS;
    const cf = contact.custom_fields || contact;
    const runnerId = eventId === EVENT_ID_ANGERS
      ? (cf.lien_url_don_defi_angers2026 || contact.lien_url_don_defi_angers2026 || '')
      : (cf.lien_url_don_defi_joue2026   || contact.lien_url_don_defi_joue2026   || '');
    if (!runnerId) return URL_COUREURS;
    return `https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_event=${eventId}&de_runner=${runnerId}`;
  } catch(e) { return URL_COUREURS; }
}

// ── Construire l'URL promesse de don pour une équipe
async function buildUrlPromesseEquipe(structureId, nomEquipe, eventName) {
  const eventId = getEventId(eventName);
  if (!eventId) return URL_PROMESSE_FALLBACK;
  try {
    // Chercher via structureId ou nom
    let structure = null;
    if (structureId) {
      await sleep(OHME_DELAY_MS);
      const res = await fetch(`${CONFIG.ohmeBase}/api/v1/structures/${structureId}`, {
        headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
      });
      if (res.ok) { const j = await res.json(); structure = j.data || j; }
    }
    if (!structure && nomEquipe) structure = await fetchOhmeStructureByName(nomEquipe);
    if (!structure) return URL_PROMESSE_FALLBACK;
    const cf = structure.custom_fields || structure;
    const teamId = eventId === EVENT_ID_ANGERS
      ? (cf.numero_team_angers2026 || structure.numero_team_angers2026 || '')
      : (cf.numero_team_joue2026   || structure.numero_team_joue2026   || '');
    if (!teamId) return URL_PROMESSE_FALLBACK;
    return `https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_promise=1&de_event=${eventId}&de_team=${teamId}`;
  } catch(e) { return URL_PROMESSE_FALLBACK; }
}

// ── Construire l'URL page équipe (sans promesse)
async function buildUrlPageEquipe(structureId, nomEquipe, eventName) {
  const eventId = getEventId(eventName);
  if (!eventId) return URL_EQUIPES;
  try {
    let structure = null;
    if (structureId) {
      await sleep(OHME_DELAY_MS);
      const res = await fetch(`${CONFIG.ohmeBase}/api/v1/structures/${structureId}`, {
        headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
      });
      if (res.ok) { const j = await res.json(); structure = j.data || j; }
    }
    if (!structure && nomEquipe) structure = await fetchOhmeStructureByName(nomEquipe);
    if (!structure) return URL_EQUIPES;
    const cf = structure.custom_fields || structure;
    const teamId = eventId === EVENT_ID_ANGERS
      ? (cf.numero_team_angers2026 || structure.numero_team_angers2026 || '')
      : (cf.numero_team_joue2026   || structure.numero_team_joue2026   || '');
    if (!teamId) return URL_EQUIPES;
    return `https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=${eventId}&de_team=${teamId}`;
  } catch(e) { return URL_EQUIPES; }
}

const BLOC_RECUS_FISCAUX = `<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:18px 24px;text-align:center;margin-bottom:24px"><div style="font-size:.82rem;font-weight:600;color:#3d1830;margin-bottom:10px">🧾 Vos reçus fiscaux</div><div style="font-size:.8rem;color:#3d1830;margin-bottom:12px">Retrouvez ici tous vos reçus fiscaux du Défi Enfance en entrant votre e-mail</div><a href="${URL_RECUS}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:10px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🧾 Accéder à mes reçus fiscaux</a></div>`;

const BLOC_TEMOIGNAGES = `<div style="font-size:.9rem;font-weight:600;color:#1a0a12;margin-bottom:14px">Ces enfants ont besoin de vous :</div><div class="temoignage"><strong>"Ce sont les enfants de tout le monde. Ce sont les enfants de chacun."</strong><br><br>Jérôme Aucordier accompagne des enfants au quotidien dans un lieu de vie qui place chaque enfant au cœur de ses propres décisions. Pour lui, ces enfants ne sont pas des cas à gérer — ce sont un capital pour notre société.</div><div class="temoignage"><strong>"Défi Enfance, c'est un moyen que les jeunes soient entendus."</strong><br><br>Anne Loriot, éducatrice spécialisée en foyer, accueille des jeunes jour et nuit. Un jour, une jeune lui a dit : <em>"Est-ce que tu vas rester ?"</em> — une phrase qui dit tout. Ces enfants ne demandent pas grand-chose. Juste de la stabilité. Juste quelqu'un qui ne part pas.</div>`;

const BLOC_SOCIAUX = `<div style="text-align:center;margin-bottom:20px"><div style="font-size:.82rem;font-weight:600;color:#3d1830;margin-bottom:12px">Découvrez leurs témoignages :</div><div class="social-bar"><a href="${URL_LINKEDIN}" class="social-btn li">LinkedIn</a><a href="${URL_FACEBOOK}" class="social-btn fb">Facebook</a><a href="${URL_INSTAGRAM}" class="social-btn ig">Instagram</a></div></div>`;


// ── Bloc CTA Don/Promesse de don — inséré en fin de tous les emails participants
const BLOC_IFI = `<div style="background:linear-gradient(135deg,#f0f7ff,#f5f0ff);border:2px solid #1a56db;border-radius:14px;padding:18px 24px;margin-bottom:24px;text-align:center">
  <div style="font-size:.82rem;font-weight:700;color:#1a56db;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">🏛️ Don IFI pour soutenir le Défi Enfance ?</div>
  <div style="font-size:.8rem;color:#1a0a12;line-height:1.6;margin-bottom:12px">C'est possible via la <strong>Fondation Unis pour l'Enfance</strong>, sous égide de la Fondation pour l'Enfance reconnue d'utilité publique.<br>Trois leviers : le Défi Enfance · les lieux de vie aimants · l'insertion des jeunes majeurs.</div>
  <a href="https://www.fondation-enfance.org/creer-ma-fondation/fondations-et-fonds-abrites/fondation-unis-pour-lenfance/" style="display:inline-block;background:linear-gradient(135deg,#1a56db,#7c3aed);color:#fff!important;text-decoration:none;padding:10px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏛️ Faire un don IFI</a>
</div>`;


function blocCtaDonPromesse({ nomCoureur, nomEquipe }) {
  const cible = nomCoureur
    ? `pour <strong>${nomCoureur}</strong>`
    : nomEquipe
      ? `pour l'équipe <strong>${nomEquipe}</strong>`
      : 'pour soutenir les coureurs';
  return `<div style="background:linear-gradient(135deg,#f5f0ff,#fff0f8);border:2px solid #7c3aed;border-radius:16px;padding:22px 26px;margin-top:24px;margin-bottom:8px">
    <div style="font-family:'Antonio',Arial,sans-serif;font-size:1.1rem;color:#7c3aed;font-weight:700;margin-bottom:10px;text-align:center">❤️ Transformez chaque km en victoire pour l'enfance !</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:16px">
      Chaque foulée mérite d'être soutenue. En faisant un <strong>don</strong> ou une <strong>promesse de don au km</strong> ${cible}, vous devenez acteur du changement pour les enfants.<br><br>
      <span style="color:#7c3aed;font-weight:600">✨ Nouveauté exclusive Défi Enfance :</span> la <strong>Promesse de don au km</strong> est un engagement unique — vous promettez un montant par km couru, transformé en don réel <em>le soir même de la course</em>. Plus le coureur court, plus l'enfance gagne !
    </div>
    <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
      <a href="${URL_DON}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">❤️ Faire un don</a>
      <a href="${URL_DON}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Promettre un don au km</a>
    </div>
    <div style="text-align:center;margin-top:12px;font-size:.72rem;color:#888">66% de réduction fiscale sur l'IR · 60% sur l'IS pour les entreprises<br>50% des dons reversés directement aux associations choisies par les coureurs</div>
  </div>`;
}


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
    <div class="recap-row"><span>🏃 Promesses pour toi</span><span class="recap-num violet">${nbPromessesCoureur} promesse${nbPromessesCoureur > 1 ? 's' : ''}</span></div>
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
    <div style="font-size:.78rem;font-weight:700;color:#7c3aed;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">💡 Projection en fonction des km courus en 2h !</div>
    <div class="sc-line"><span>10 km courus</span><span><strong>${(m * 10).toFixed(0)} €</strong> générés</span></div>
    <div class="sc-line"><span>15 km courus</span><span><strong>${(m * 15).toFixed(0)} €</strong> générés</span></div>
    <div class="sc-line"><span>20 km courus</span><span><strong>${(m * 20).toFixed(0)} €</strong> générés</span></div>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — DONS (inchangés v67)
// ══════════════════════════════════════════════════════
function tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur, association, motEncouragement, urlPageCoureur, urlPromesseCoureur }) {
  const assoLine = association ? `<br>Association soutenue : <strong>${association}</strong>` : '';
  const motLine  = motEncouragement ? `<div class="note magenta" style="margin-top:16px">💬 <strong>Mot d'encouragement :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Nouveau don pour toi !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${coureurPrenom} 👋</div><div class="intro">Bonne nouvelle ! Un nouveau don vient d'être enregistré sur <strong>ta page de collecte Défi Enfance</strong>.</div><div class="don-box"><div class="don-amount">${montant} €</div><div class="don-label">Don reçu de ${donateur}</div></div><div class="card"><h3>📋 Coordonnées du donateur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#fb0089">${email_donateur}</a></div></div></div>${motLine}${motEncouragement && urlPageCoureur ? `<div style="text-align:center;margin-bottom:16px"><a href="${urlPageCoureur}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Promettre un don au km pour ${coureurPrenom}</a></div>` : ''}<div class="note magenta">💌 <strong>N'hésite pas à remercier ${donateur} personnellement</strong> — un message sincère fait toujours une grande différence !</div><div class="cta-box"><p>✨ <strong>Et si tu faisais grimper ta collecte encore plus haut ?</strong><br>Partage ta page et invite tes proches à te soutenir !</p><a href="${urlPageCoureur || URL_COUREURS}" class="cta-btn">🏃 Voir ma page de collecte</a></div>${blocCtaDonPromesse({ nomCoureur: coureurPrenom })}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant le don.${assoLine}</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplDonEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montant, email_donateur, motEncouragement, coureurPrenom, coureurNom, urlPageEquipe }) {
  const isDE   = nomEquipe === 'Défi Enfance';
  const motLine = motEncouragement ? `<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin:16px 0">
    <div style="font-size:.78rem;font-weight:700;color:#fb0089;margin-bottom:6px">💬 Mot d'encouragement de ${donateur}</div>
    <div style="font-size:.84rem;color:#3d1830;font-style:italic">"${motEncouragement}"</div>
  </div>` : '';
  const coureurLine = coureurPrenom ? `<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:12px 16px;margin:12px 0;font-size:.84rem;color:#3d1830">🏃 <strong>Ce don est fléché vers ${coureurPrenom} ${coureurNom || ''}</strong>, membre de votre équipe.</div>` : '';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header orange"><h1>${isDE ? '❤️ Nouveau don reçu !' : '🏆 Votre équipe vient de recevoir un don !'}</h1><p>Générateur de victoires pour l'enfance</p></div>
<div class="body">
<div class="greeting">Bonjour ${chefPrenom} 👋</div>

${!isDE ? `<div style="background:linear-gradient(135deg,#fff5ef,#fff0f8);border:2px solid #ef6135;border-radius:14px;padding:14px 20px;margin-bottom:18px;text-align:center">
  <div style="font-size:.72rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">🏆 Équipe soutenue</div>
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1.3rem;color:#ef6135">${nomEquipe}</div>
</div>` : ''}

<div class="intro">${isDE
  ? `<strong>${donateur}</strong> vient de faire un don de <strong>${montant} €</strong> au Défi Enfance. Ce don n'est pas encore fléché vers un coureur ou une équipe.`
  : `Belle nouvelle ! <strong>${donateur}</strong> vient de faire un don de <strong>${montant} €</strong> pour soutenir votre équipe au Défi Enfance. C'est un beau geste de solidarité pour l'enfance !`
}</div>

<div class="don-box orange"><div class="don-amount orange">${montant} €</div><div class="don-label">Don de ${donateur} pour ${isDE ? 'le Défi Enfance' : `l'équipe ${nomEquipe}`}</div></div>

${coureurLine}
${motLine}

<div class="card orange" style="margin-bottom:18px">
  <h3 class="orange">📋 Coordonnées du donateur</h3>
  <div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div>
  <div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#ef6135">${email_donateur}</a></div></div>
</div>

<div class="note magenta">💌 <strong>Prenez un moment pour remercier ${donateur} personnellement</strong> — un message chaleureux au nom de toute l'équipe fera une vraie différence et l'encouragera à renouveler son geste !</div>

${!isDE ? `<div class="cta-box orange"><p>✨ <strong>Partagez la page de votre équipe</strong> pour multiplier les soutiens !</p><a href="${urlPageEquipe || URL_EQUIPES}" class="cta-btn orange">🏆 Voir la page de notre équipe</a></div>` : `<div class="cta-box orange"><p>✨ Invitez ${donateur} à flécher son prochain don vers un coureur ou une équipe !</p><a href="${URL_DON}" class="cta-btn orange">❤️ Page de don Défi Enfance</a></div>`}

<div class="divider"></div>
<div style="font-size:.75rem;color:#888;text-align:center">Notification automatique envoyée dans les 10 minutes suivant le don.</div>
</div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — PROMESSES DE DON
// ══════════════════════════════════════════════════════

/**
 * Promesse de don → coureur parrainé
 * Envoie au coureur : quelqu'un s'engage à donner X€/km le soir de la course
 */
function tplPromesseCoureur({ coureurPrenom, donateur, montantParKm, email_donateur, association, motEncouragement, nbPromessesCoureur, totalKmParCoureur, nbPromessesEquipe, totalKmParEquipe, urlPromesseCoureur, urlPageCoureur }) {
  const assoLine = association ? `<br>Association soutenue : <strong>${association}</strong>` : '';
  const motLine  = motEncouragement ? `<div class="note violet" style="margin-top:16px">💬 <strong>Message de ${donateur} :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const recap    = blocRecapPromesses({ nbPromessesCoureur, totalKmParCoureur, nbPromessesEquipe, totalKmParEquipe, isCoureur: true });
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour toi !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${coureurPrenom} 👋</div><div class="intro"><strong>${donateur}</strong> croit en toi et s'engage à faire un don sur ta page de collecte — <strong>le soir même de ta course</strong> — en fonction des kilomètres que tu auras courus !</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru par ${donateur}</div></div>${scenarios}${motLine}<div class="note violet">🚀 <strong>Plus tu courras de kilomètres, plus ${donateur} donnera pour l'enfance !</strong><br>Ce soutien est une vraie carotte : chaque foulée supplémentaire compte directement pour les enfants.</div>${recap}<div class="card violet"><h3 class="violet">📋 Coordonnées de votre supporter</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>Remercie ${donateur} dès maintenant</strong> — et donne-lui rendez-vous pour voir ton résultat le soir de la course !</div><div class="cta-box violet"><p>✨ <strong>Partage ta page de collecte</strong> pour multiplier les promesses de dons !<br>Chaque km que tu cours peut rapporter encore plus à l'enfance.</p><a href="${urlPageCoureur || URL_COUREURS}" class="cta-btn violet">🏃 Voir ma page de collecte</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse enregistrée automatiquement. Le don sera effectif après la course.${assoLine}</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

/**
 * Promesse de don → chef d'équipe
 * Envoie au référent d'équipe : quelqu'un promet X€/km pour toute l'équipe
 */

function tplPromesseCoureurPourEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montantParKm, email_donateur, coureurPrenom, coureurNom, motEncouragement, nbPromessesEquipe, totalKmParEquipe, urlPageCoureur, urlPromesseCoureur }) {
  const motLine = motEncouragement ? `<div class="note violet" style="margin-top:16px">💬 <strong>Message de ${donateur} :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const recap = nbPromessesEquipe > 0 ? `<div class="recap-box">
    <div class="recap-title">📊 Promesses sur votre équipe</div>
    <div class="recap-row"><span>🏅 Total promesses équipe</span><span class="recap-num violet">${nbPromessesEquipe} promesse${nbPromessesEquipe > 1 ? 's' : ''}</span></div>
    <div class="recap-row"><span>💰 Total engagé / km (équipe)</span><span class="recap-num violet">${totalKmParEquipe} € / km</span></div>
  </div>` : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour un coureur de votre équipe !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body">
<div class="greeting">Bonjour ${chefPrenom} 👋</div>
<div style="margin-bottom:16px"><span class="badge violet">🏃 Équipe ${nomEquipe}</span></div>
<div class="intro"><strong>${donateur}</strong> vient de faire une <strong>promesse de don au km</strong> pour <strong>${coureurPrenom} ${coureurNom}</strong>, l'un des coureurs de votre équipe !</div>
<div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru par ${coureurPrenom} ${coureurNom}</div></div>
<div class="note violet">ℹ️ <strong>Important :</strong> cette promesse est fléchée uniquement sur <strong>${coureurPrenom} ${coureurNom}</strong>. Ce sont exclusivement les km parcourus par ${coureurPrenom} le jour de la course qui généreront ce don — pas ceux des autres membres de l'équipe.</div>
<div class="card violet"><h3 class="violet">📋 Coureur concerné</h3><div class="row"><span class="ic">🏃</span><div><strong>${coureurPrenom} ${coureurNom}</strong> — membre de l'équipe ${nomEquipe}</div></div><div class="row"><span class="ic">👤</span><div><strong>Promettant :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div>
${motLine}
<div class="note magenta">💌 <strong>Transmettez cette bonne nouvelle à ${coureurPrenom} !</strong> Cette promesse de don est un formidable moteur de motivation pour sa course.</div>
${recap}
<div class="cta-box violet"><p>✨ <strong>Encouragez d'autres supporters à promettre un don au km</strong> pour les coureurs de votre équipe !</p><a href="${urlPromesseCoureur || URL_PROMESSE_FALLBACK}" class="cta-btn violet">🏅 Promettre un don au km pour ${coureurPrenom}</a></div><div style="text-align:center;margin-top:10px"><a href="${urlPageCoureur || URL_COUREURS}" style="display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏃 Voir la page de ${coureurPrenom}</a></div>
<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant la promesse.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montantParKm, email_donateur, motEncouragement, nbPromessesEquipe, totalKmParEquipe, urlPromesseEquipe, urlPageEquipe }) {
  const motLine  = motEncouragement ? `<div class="note violet" style="margin-top:16px">💬 <strong>Message de ${donateur} :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const recap    = blocRecapPromesses({ nbPromessesCoureur: 0, totalKmParCoureur: 0, nbPromessesEquipe, totalKmParEquipe, isCoureur: false });
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour votre équipe !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${chefPrenom} 👋</div><div style="margin-bottom:16px"><span class="badge violet">🏃 Équipe ${nomEquipe}</span></div><div class="intro">Excellente nouvelle ! <strong>${donateur}</strong> s'engage à faire un don pour votre équipe — <strong>le soir même de la course</strong> — proportionnellement aux kilomètres cumulés par vos coureurs !</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru — pour l'équipe ${nomEquipe}</div></div>${scenarios}${motLine}<div class="note violet">🚀 <strong>Chaque km couru par chacun de vos coureurs compte !</strong><br>Plus votre équipe performe collectivement, plus ${donateur} donnera pour l'enfance le soir même.</div>${recap}<div class="card violet"><h3 class="violet">📋 Coordonnées du supporter</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>Transmettez cette promesse à vos coureurs</strong> pour les motiver encore davantage — chaque foulée supplémentaire a un prix pour l'enfance !</div><div class="cta-box violet"><p>✨ <strong>Mobilisez l'équipe !</strong><br>Partagez cette promesse de don avec tous vos coureurs pour décupler leur motivation le jour J.</p><a href="${urlPromesseEquipe || URL_PROMESSE_FALLBACK}" class="cta-btn violet">🏅 Promettre un don au km</a></div><div style="text-align:center;margin-top:10px"><a href="${urlPageEquipe || URL_EQUIPES}" style="display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏆 Voir la page de l'équipe</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse enregistrée automatiquement. Le don sera effectif après la course.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → coureur
 */
function tplMerciPrometteurCoureur({ prenomDonateur, montantParKm, coureurPrenom, coureurNom, association }) {
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🙏 Merci pour votre<br>promesse de don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre promesse de <strong>${montantParKm} € par km</strong> pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''} est enregistrée. Elle sera transformée en don réel — <strong>le soir même de la course</strong> — selon les kilomètres courus.</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km couru par ${coureurPrenom}</div></div>${scenarios}<div class="note violet">💡 <strong>Comment ça fonctionne ?</strong><br>Le soir de la course, vous recevrez un email récapitulatif avec le résultat de ${coureurPrenom}. Il vous suffira alors de cliquer sur le lien de don et de saisir le montant correspondant aux km courus.</div><div style="text-align:center;background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border-radius:14px;padding:22px;margin-bottom:24px"><div style="margin-bottom:12px;font-size:.78rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em">L'impact de votre engagement</div><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#7c3aed">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#7c3aed">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="cta-box violet"><p>✨ <strong>Envie d'aller encore plus loin ?</strong><br>Partagez cette initiative autour de vous — vos proches peuvent aussi promettre un don par km !</p><a href="${URL_DON}" class="cta-btn violet">❤️ Page de don Défi Enfance</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse de don enregistrée — le don sera réalisé après la course.<br>contact@defienfance.fr — defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → équipe
 */
function tplMerciPrometteurEquipe({ prenomDonateur, montantParKm, nomEquipe }) {
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🙏 Merci pour votre<br>promesse de don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre promesse de <strong>${montantParKm} € par km</strong> pour l'équipe <strong>${nomEquipe}</strong> est enregistrée. Elle sera transformée en don réel — <strong>le soir même de la course</strong> — selon les kilomètres cumulés par les coureurs de l'équipe.</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km couru — équipe ${nomEquipe}</div></div>${scenarios}<div class="note violet">💡 <strong>Comment ça fonctionne ?</strong><br>Le soir de la course, vous recevrez un email récapitulatif avec le résultat de l'équipe ${nomEquipe}. Il vous suffira alors de cliquer sur le lien de don et de saisir le montant correspondant.</div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="cta-box violet"><p>✨ <strong>Mobilisez votre entourage !</strong><br>Plus il y a de promesses sur cette équipe, plus leur motivation le jour J est décuplée !</p><a href="${URL_DON}" class="cta-btn violet">❤️ Page de don Défi Enfance</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse de don enregistrée — le don sera réalisé après la course.<br>contact@defienfance.fr — defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — MERCI DONATEUR (inchangés)
// ══════════════════════════════════════════════════════
function tplMerciDonateurAmbassadeur({ prenomDonateur, montant, coureurPrenom, coureurNom, association, nomEquipe, historiqueHtml }) {
  const cibleTitre = coureurPrenom ? `à ${coureurPrenom} ${coureurNom || ''}` : nomEquipe ? `via l'équipe ${nomEquipe}` : '';
  const cibleIntro = coureurPrenom
    ? `pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''}`
    : nomEquipe ? `pour l'équipe <strong>${nomEquipe}</strong>` : 'au Défi Enfance';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
  .korczak{background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:22px 26px;margin-bottom:22px;position:relative}
  .korczak::before{content:'"';position:absolute;top:-10px;left:16px;font-size:5rem;color:rgba(251,0,137,0.3);font-family:Georgia,serif;line-height:1}
  .korczak-text{font-size:.86rem;color:rgba(255,255,255,0.85);line-height:1.8;font-style:italic;margin-bottom:12px}
  .korczak-author{font-size:.72rem;color:rgba(251,0,137,0.8);font-weight:600;text-align:right}
  </style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🎖️ Merci, Ambassadeur<br>du Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body">
<div class="greeting">Bonjour ${prenomDonateur} 👋</div>
<div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#f5f0ff);border-radius:16px;padding:24px;margin-bottom:22px">
  <div style="font-size:3.5rem;margin-bottom:10px">🎖️</div>
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1.5rem;color:#fb0089;font-weight:700;margin-bottom:6px">Vous êtes Ambassadeur du Défi Enfance !</div>
  <div style="font-size:.82rem;color:#3d1830;line-height:1.6">Votre engagement répété pour l'enfance est une force rare et précieuse.<br>Merci de croire, encore et encore, que chaque km compte.</div>
</div>
<div class="intro">Votre nouveau don de <strong>${montant} €</strong> ${cibleIntro} vient renforcer votre soutien exceptionnel au Défi Enfance. Vous faites partie de ceux qui ne lâchent pas.</div>
${historiqueHtml}
<div class="korczak">
  <div class="korczak-text">Vous dites : "C'est fatigant de fréquenter les enfants." Vous avez raison. Vous ajoutez : "Parce qu'il faut se mettre à leur niveau, se baisser, s'incliner, se courber, se faire petit." Là, vous vous trompez. Ce n'est pas cela qui fatigue le plus. C'est plutôt le fait d'être obligé de s'élever jusqu'à la hauteur de leurs sentiments. De s'étirer, de s'allonger, de se hausser sur la pointe des pieds. Pour ne pas les blesser.</div>
  <div class="korczak-author">— Janusz Korczak, pédiatre et pédagogue polonais,<br>précurseur des droits de l'enfant</div>
</div>
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 La Promesse de don au km — l'arme secrète des Ambassadeurs</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">En tant qu'Ambassadeur, vous pouvez aller encore plus loin : faites une <strong>promesse de don au km</strong> directement sur la page d'un coureur. Votre don sera calculé et versé <em>le soir même de la course</em> selon les km parcourus — plus ils courent, plus l'enfance gagne !<br><br><strong>Comment faire ?</strong> Cliquez sur un coureur sur la page de collecte, puis sur le bouton <strong>"Faire une promesse de don"</strong>.</div>
  <div style="text-align:center"><a href="${URL_COUREURS}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏃 Voir les pages coureurs</a></div>
</div>
${BLOC_RECUS_FISCAUX}${BLOC_SOCIAUX}<div class="divider"></div>
<div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} € — vous faites partie de l'histoire du Défi Enfance.<br>contact@defienfance.fr — defienfance.fr</div>
</div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateurFidele({ prenomDonateur, montant, historiqueHtml }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🏅 Super Badge Donateur<br>du Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Vous avez de nouveau soutenu le Défi Enfance avec un don de <strong>${montant} €</strong>. Merci !</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="font-size:3rem;margin-bottom:8px">🏅</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089;font-weight:700">Vous êtes officiellement<br>Super Donateur du Défi Enfance !</div></div>${historiqueHtml || ''}${BLOC_RECUS_FISCAUX}${BLOC_SOCIAUX}${blocCtaDonPromesse({})}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr — defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateurStructure({ prenomDonateur, montant, nomStructure, coureurPrenom, coureurNom, association, nomEquipe }) {
  const cible = coureurPrenom ? `pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''}` : nomEquipe ? `pour l'équipe <strong>${nomEquipe}</strong>` : 'au Défi Enfance';
  const salutation = prenomDonateur ? `Bonjour ${prenomDonateur} 👋` : `Bonjour 👋`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Merci pour le don de<br>${nomStructure} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">${salutation}</div><div class="intro">Merci pour le don de <strong>${montant} €</strong> de <strong>${nomStructure}</strong> ${cible}.</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour le don de ${montant} € de ${nomStructure}.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateur({ prenomDonateur, montant, donateur, coureurPrenom, coureurNom, association, historiqueHtml }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Merci pour votre don<br>à ${coureurPrenom} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div>
<div class="don-box" style="margin-bottom:20px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🏃 Coureur soutenu</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089">${coureurPrenom} ${coureurNom}</div>${association ? `<div style="font-size:.78rem;color:#3d1830;margin-top:4px">court pour l'Association <strong>${association}</strong></div>` : ''}</div>
<div class="intro">Votre don de <strong>${montant} €</strong> pour <strong>${coureurPrenom} ${coureurNom}</strong> fait une vraie différence. 50% va à l'<strong>Association ${association}</strong>, 50% au Plaidoyer du Défi Enfance.</div>
${historiqueHtml || ''}
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:.95rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 Allez encore plus loin — la Promesse de don au km !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Saviez-vous que vous pouvez faire une <strong>promesse de don au km</strong> directement sur la page de ${coureurPrenom} ? Vous vous engagez sur un montant par km — votre don est calculé le soir même selon ses km parcourus. Plus ${coureurPrenom} court, plus l'enfance gagne !<br><br><strong>Comment faire ?</strong> Cliquez sur "${coureurPrenom}" sur la page de collecte, puis sur <strong>"Faire une promesse de don"</strong>.</div>
  <div style="text-align:center"><a href="${URL_COUREURS}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏃 Voir la page de ${coureurPrenom}</a></div>
</div>
<div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateurEquipe({ prenomDonateur, montant, donateur, nomEquipe, historiqueHtml }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header orange"><h1>❤️ Merci pour votre don<br>via l'équipe ${nomEquipe} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div>
<div class="don-box orange" style="margin-bottom:20px"><div style="font-size:.78rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🏆 Équipe soutenue</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.5rem;color:#ef6135">${nomEquipe}</div></div>
<div class="intro">Votre don de <strong>${montant} €</strong> pour l'équipe <strong>${nomEquipe}</strong> fait une vraie différence pour les enfants accompagnés par leurs associations !</div>${historiqueHtml || ''}<div style="text-align:center;background:linear-gradient(135deg,#fff5ef,#fff8ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#ef6135">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#ef6135">+40</span><span class="lbl">associations soutenues</span></div></div></div>
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 Et si vous alliez encore plus loin ?</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Savez-vous que vous pouvez faire une <strong>promesse de don au km</strong> pour les coureurs de l'équipe ${nomEquipe} ? Vous vous engagez sur un montant par km couru — et votre don est calculé et versé <em>le soir même de la course</em>, en fonction de leur performance. Plus ils courent, plus l'enfance gagne !</div>
  <div style="text-align:center"><a href="${URL_DON}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Faire une promesse de don au km</a></div>
</div>
${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplMerciDonateurGlobal({ prenomDonateur, montant, historiqueHtml }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>❤️ Merci pour<br>votre don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> au Défi Enfance fait une vraie différence dans la vie de milliers d'enfants. Merci du fond du cœur !</div>
${historiqueHtml || ''}
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:.95rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 Allez encore plus loin — la Promesse de don au km !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Saviez-vous que vous pouvez faire une <strong>promesse de don au km</strong> directement sur la page d'un coureur ? Vous vous engagez sur un montant par km — votre don est calculé le soir même selon les km parcourus.<br><br><strong>Comment faire ?</strong> Rendez-vous sur la page de collecte, cliquez sur un coureur, puis sur <strong>"Faire une promesse de don"</strong>.</div>
  <div style="text-align:center"><a href="${URL_COUREURS}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏃 Voir les pages coureurs</a></div>
</div>
<div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  TEMPLATES EMAIL — BILLETTERIE (inchangés)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  TEMPLATES — ENVOIS GROUPÉS
// ══════════════════════════════════════════════════════

const URL_DEJEUNER_ANGERS = 'https://luma.com/defi-dejeuner-angers2026';

function tplGroupeJ10Angers({ prenom, nbJours, urlPageCoureur, urlPromesseCoureur }) {
  const j = nbJours || 8;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .programme-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
    .programme-item:last-child{border-bottom:none}
    .programme-ic{font-size:1.1rem;flex-shrink:0;width:24px;text-align:center}
    .programme-time{font-weight:700;color:#fb0089;min-width:48px;flex-shrink:0}
    .liste-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f5e5d5;font-size:.84rem;color:#3d1830}
    .liste-item:last-child{border-bottom:none}
  </style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🎽 Dans ${j} jours,<br>on court pour l'enfance !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div><div class="body">
<div class="greeting">Bonjour ${prenom} 👋</div>
<div class="intro">Dans ${j} jours, c'est le grand jour ! 🎉 Nous sommes vraiment impatients de vous retrouver au <strong>Parc Saint-Serge</strong> pour cette deuxième édition du Défi Enfance à Angers. Vous faites partie d'une belle aventure — voici tout ce qu'il faut savoir pour arriver prêt(e) et serein(e) ! 💪</div>

<div class="card" style="margin-bottom:22px"><h3>🤲 Pourquoi est-ce qu'on court ?</h3>
<div style="font-size:.86rem;color:#3d1830;line-height:1.7">Le Défi Enfance, c'est bien plus qu'une course — c'est un élan collectif pour soutenir tout le secteur de l'aide à l'enfance. Chaque kilomètre parcouru, chaque don collecté va compter.<br><br>Dès maintenant, faites décoller votre collecte ! <strong>50% des dons</strong> vont directement aux associations choisies, <strong>50%</strong> soutiennent le plaidoyer pour les enfants en France. 🙏<br><br><strong>Nouveauté exclusive :</strong> faites et faites faire des <strong>promesses de dons au km</strong> — une manière percutante de challenger vos proches pour la cause de l'enfance ! C'est seulement en générant des dons et/ou des promesses de dons autour de vous que l'Association que vous avez sélectionnée à l'inscription sera effectivement soutenue par le Défi Enfance. <strong>Alors n'hésitez plus, passez des appels</strong> et inspirez-vous de l'exemple d'email présenté à la fin de cet email !</div>
<div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:16px">
  <a href="${urlPromesseCoureur || URL_PROMESSE_FALLBACK}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Promettre un don au km</a>
  <a href="${urlPageCoureur || URL_DON}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">❤️ Ma page de collecte</a>
</div>
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
<div class="liste-item"><span>📱</span><div>CB/Tél pour faire des dons en live</div></div>
<div class="liste-item"><span>⚡</span><div>Votre énergie et votre bonne humeur !</div></div>
</div>

<div class="note magenta">🎽 <strong>Votre dossard</strong><br>Vous recevrez un email le <strong>jeudi 21 mai</strong> avec votre numéro de dossard. Il ne vous restera plus qu'à le récupérer sur place dès 8h30 et à enfiler vos baskets ! 👟</div>


<div style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:20px 24px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email prêt à envoyer à vos proches</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,0.5);margin-bottom:16px">Copiez-collez ce message à vos amis, collègues, clients, fournisseurs…</div>
  <div style="background:#fff;border-radius:10px;padding:20px 22px">
    <div style="font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Objet</div>
    <div style="font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px">Plus qu'un défi sportif, une urgence pour l'enfance 🏁</div>
    <div style="font-size:.82rem;color:#3d1830;line-height:1.8">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris parce que j'ai décidé de relever un défi qui me tient particulièrement à cœur : le <strong>Défi Enfance</strong>.</p>
      <p style="margin:0 0 12px">Comme tu le sais peut-être, le secteur de l'aide à l'enfance traverse une crise sans précédent. Le système est aujourd'hui "embolisé" : manque de places, manque de coordination, et surtout, une approche trop souvent cloisonnée qui laisse des enfants vulnérables sur le bord de la route.</p>
      <p style="margin:0 0 12px">L'objectif du Défi Enfance est simple : <strong>casser ces silos</strong>. L'argent collecté permet de financer des projets innovants qui placent l'intérêt de l'enfant au centre, en faisant travailler ensemble tous les acteurs qui l'entourent. C'est en décloisonnant nos pratiques que nous réussirons à protéger durablement ces parcours de vie.</p>
      <p style="margin:0 0 12px"><strong>J'ai besoin de ton aide</strong> pour atteindre mon objectif de collecte.</p>
      <p style="margin:0 0 12px">Chaque don, même modeste, est un signal fort envoyé à ceux qui se battent sur le terrain. Les fonds sont directement fléchés vers mon équipe et reversés aux associations partenaires.</p>
      <p style="margin:0 0 12px">Pour me soutenir, c'est par ici : 👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don</a></p>
      <div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem">💡 <strong>Ton don est défiscalisé à hauteur de 66%.</strong> Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0 0 12px">Un immense merci pour ton soutien, tes encouragements et pour l'aide que tu apportes à ces enfants.</p>
      <p style="margin:0">À très vite,<br><strong>${prenom}</strong></p>
    </div>
  </div>
</div>
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;line-height:1.8">Pour toute question : <a href="mailto:contact@defienfance.fr" style="color:#fb0089;font-weight:600">contact@defienfance.fr</a> 📩<br><br><strong>On vous attend avec impatience — allez, plus que ${j} jours ! 🏁</strong></div>
<div style="margin-top:16px;font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— L'équipe du Défi Enfance 🤲</div>

</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr — defienfance.fr</div></div></div></body></html>`;
}

// Placeholder pour les futurs templates — à compléter au fur et à mesure

function tplGroupeJ4Angers({ prenom, nbJours, nomAsso, urlPageCoureur, urlPromesseCoureur, urlPageEquipe, nomEquipe }) {
  const j = nbJours || 4;
  const assoBlock = nomAsso
    ? `<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:16px 20px;margin-bottom:20px;text-align:center">
        <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">🏳️ Votre association soutenue</div>
        <div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089">${nomAsso}</div>
        <div style="font-size:.75rem;color:#3d1830;margin-top:4px">50% de chaque don reversé directement à ${nomAsso} ✅</div>
      </div>`
    : '';
  const equipeBlock = nomEquipe && urlPageEquipe
    ? `<div style="text-align:center;margin-bottom:20px"><a href="${urlPageEquipe}" style="display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏆 Page de mon équipe ${nomEquipe}</a></div>`
    : '';
  const urlDon = urlPageCoureur || 'https://defienfance.fr/faire-un-don/';
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const assoNom = nomAsso || 'votre association';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
  .liste-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
  .liste-item:last-child{border-bottom:none}
  .ep-inner{background:#fff;border-radius:10px;padding:20px 22px}
  .ep-objet-label{font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
  .ep-objet-val{font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px}
  .ep-body{font-size:.82rem;color:#3d1830;line-height:1.8}
  .ep-defiscal{background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem}
  </style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>🏃 Faites décoller votre collecte<br>pour l'enfance !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div>
<div class="body">
<div class="greeting">Bonjour ${prenom} 👋</div>
<div class="intro">Dans <strong>${j} jours</strong>, vous courrez pour l'enfance à Angers. Mais avant le départ, il y a quelque chose d'aussi important que vos entraînements : <strong>mobiliser votre entourage pour qu'il soutienne votre engagement !</strong></div>

${assoBlock}

<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:18px 20px;margin-bottom:20px;text-align:center">
  <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">💰 100% des dons vont à l'enfance</div>
  <div style="display:flex;border-radius:10px;overflow:hidden;margin-bottom:10px">
    <div style="flex:1;padding:14px 10px;color:#fff;text-align:center;background:linear-gradient(135deg,#fb0089,#ef6135)"><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;font-weight:700">50%</div><div style="font-size:.7rem;margin-top:3px">${assoNom}</div></div>
    <div style="flex:1;padding:14px 10px;color:#fff;text-align:center;background:linear-gradient(135deg,#ef6135,#ff8533)"><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;font-weight:700">50%</div><div style="font-size:.7rem;margin-top:3px">Plaidoyer pour l'enfance</div></div>
  </div>
  <div style="font-size:.74rem;color:#666">66% réduction fiscale IR · 60% IS pour les entreprises</div>
</div>

<div class="card violet" style="margin-bottom:20px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 La Promesse de don au km — l'arme secrète du Défi Enfance !</div>
  <div style="font-size:.83rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Invitez vos proches à <strong>promettre un don au km</strong> directement sur votre page de collecte. Ils s'engagent sur un montant par km — votre don est calculé le soir même.<br><br>✨ <strong>Effet live pendant la course :</strong> à chaque tour, un don supplémentaire s'implémente en live sur votre jauge !</div>
  <div style="text-align:center"><a href="${urlProm}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:12px 26px;border-radius:99px;font-weight:700;font-size:.85rem">🏅 Inviter à promettre un don au km</a></div>
</div>

<div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">
  <a href="${urlDon}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:12px 26px;border-radius:99px;font-weight:700;font-size:.85rem">❤️ Ma page de collecte</a>
  <a href="${urlProm}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:12px 26px;border-radius:99px;font-weight:700;font-size:.85rem">🏅 Inviter à promettre</a>
</div>
${equipeBlock}

<div class="card" style="margin-bottom:20px">
  <h3>📱 Comment ça marche ?</h3>
  <div class="liste-item"><span>1️⃣</span><div>Partagez le lien de votre page de collecte à vos contacts</div></div>
  <div class="liste-item"><span>2️⃣</span><div>Ils font un <strong>don classique</strong> ou une <strong>promesse de don au km</strong></div></div>
  <div class="liste-item"><span>3️⃣</span><div>Vous recevez <strong>un email à chaque nouveau don</strong> — votre page s'alimente automatiquement !</div></div>
  <div class="liste-item"><span>4️⃣</span><div>Le soir de la course, les promesses se transforment en dons réels selon vos km parcourus</div></div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border:1.5px solid rgba(251,0,137,0.25);border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">💬 Lisez les mots de vos donateurs !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Vos donateurs laissent des messages d'encouragement sur le <strong>Mur des dons</strong>. De beaux moments de solidarité !</div>
  <div style="background:#fff;border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:14px">
    <div style="font-size:.83rem;color:#3d1830;line-height:1.6;font-style:italic;margin-bottom:6px">"Je n'ai aucun doute sur votre motivation 🏃 Profitez de ce moment tous ensemble pour soutenir cette belle et touchante association. Go go la team ESPL !"</div>
    <div style="font-size:.72rem;color:#fb0089;font-weight:600">Isabelle B.</div>
    <div style="font-size:.7rem;color:#888">Pour l'équipe Campus ESPL · Angers</div>
  </div>
  <div style="text-align:center"><a href="https://defienfance.fr/mur-de-dons/" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem">💬 Voir tous les messages du Mur des dons</a></div>
</div>

<div style="background:linear-gradient(135deg,#f0f7ff,#f5f0ff);border:1.5px solid rgba(124,58,237,0.2);border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">🏃 Découvrez les motivations des coureurs !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Chaque coureur a une raison unique de s'engager. Ces motivations sont un moteur puissant — partagez les vôtres !</div>
  <div style="background:#fff;border-radius:10px;padding:12px 16px;display:flex;gap:12px;align-items:flex-start;margin-bottom:14px">
    <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#fb0089,#ef6135);display:flex;align-items:center;justify-content:center;color:#fff;font-size:.75rem;font-weight:700;flex-shrink:0">AM</div>
    <div>
      <div style="font-size:.82rem;font-weight:700;color:#3d1830">Amina M.</div>
      <div style="font-size:.7rem;color:#888;margin-bottom:4px">SAF Normandie – UPE</div>
      <div style="font-size:.78rem;color:#3d1830;line-height:1.5;font-style:italic">"Je cours pour collecter des dons pour acheter le matériel médical du futur pédiatre de notre établissement de Normandie qui rassemble 50 familles d'accueil !"</div>
    </div>
  </div>
  <div style="text-align:center"><a href="https://defienfance.fr/motivations-des-coureurs/" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem">🏃 Découvrir toutes les motivations</a></div>
</div>

<div style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:20px 24px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email prêt à envoyer à vos proches</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,0.5);margin-bottom:16px">Copiez-collez ce message à vos amis, collègues, clients, fournisseurs…</div>
  <div class="ep-inner">
    <div class="ep-objet-label">Objet</div>
    <div class="ep-objet-val">Plus qu'un défi sportif, une urgence pour l'enfance 🏁</div>
    <div class="ep-body">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris parce que j'ai décidé de relever un défi qui me tient particulièrement à cœur : le <strong>Défi Enfance</strong>.</p>
      <p style="margin:0 0 12px">Comme tu le sais peut-être, le secteur de l'aide à l'enfance traverse une crise sans précédent. Le système est aujourd'hui "embolisé" : manque de places, manque de coordination, et surtout, une approche trop souvent cloisonnée qui laisse des enfants vulnérables sur le bord de la route.</p>
      <p style="margin:0 0 12px">L'objectif du Défi Enfance est simple : <strong>casser ces silos</strong>. L'argent collecté permet de financer des projets innovants qui placent l'intérêt de l'enfant au centre, en faisant travailler ensemble tous les acteurs qui l'entourent. C'est en décloisonnant nos pratiques que nous réussirons à protéger durablement ces parcours de vie.</p>
      <p style="margin:0 0 12px"><strong>J'ai besoin de ton aide pour atteindre mon objectif de collecte.</strong></p>
      <p style="margin:0 0 12px">Chaque don, même modeste, est un signal fort envoyé à ceux qui se battent sur le terrain. Les fonds sont directement fléchés vers mon équipe et reversés aux associations partenaires.</p>
      <p style="margin:0 0 12px">Pour me soutenir, c'est par ici : 👉 <a href="https://defienfance.fr/faire-un-don/" style="color:#fb0089;font-weight:600">Faire un don</a></p>
      <div class="ep-defiscal">💡 <strong>Ton don est défiscalisé à hauteur de 66%.</strong> Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0 0 12px">Un immense merci pour ton soutien, tes encouragements et pour l'aide que tu apportes à ces enfants.</p>
      <p style="margin:0">À très vite,<br><strong>${prenom}</strong></p>
    </div>
  </div>
</div>

${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Ensemble, on va soulever les énergies pour l'enfance.<br>Plus que ${j} jours — allez ${prenom} ! 🏁</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance 🤲</div>

</div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}





function tplGroupeJ10Joue({ prenom, nbJours, urlPageCoureur, urlPromesseCoureur }) {
  const j = nbJours || 10;
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const urlDon  = urlPageCoureur     || 'https://defienfance.fr/faire-un-don/';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .programme-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
    .programme-item:last-child{border-bottom:none}
    .programme-ic{font-size:1.1rem;flex-shrink:0;width:24px;text-align:center}
    .programme-time{font-weight:700;color:#fb0089;min-width:52px;flex-shrink:0}
    .liste-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f5e5d5;font-size:.84rem;color:#3d1830}
    .liste-item:last-child{border-bottom:none}
  </style></head><body><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>🎽 Dans ${j} jours,<br>on court pour l'enfance !</h1><p>Défi Enfance · Joué-lès-Tours · 29 mai 2026</p></div>
<div class="body">

<div class="greeting">Bonjour ${prenom} 👋</div>
<div class="intro">Dans <strong>${j} jours</strong>, c'est le grand jour ! 🎉 Nous sommes vraiment impatients de vous retrouver au <strong>Parc des Bretonnières</strong> pour cette <strong>toute première édition</strong> du Défi Enfance à Joué-lès-Tours. Vous faites partie d'une belle aventure, et nous tenons à ce que votre journée soit inoubliable — voici tout ce qu'il faut savoir pour arriver prêt(e) et serein(e) ! 💪</div>

<div class="card" style="margin-bottom:22px">
  <h3>🤲 Pourquoi est-ce qu'on court ?</h3>
  <div style="font-size:.86rem;color:#3d1830;line-height:1.7">Le Défi Enfance, c'est bien plus qu'une course. C'est un élan collectif pour la protection de l'enfance : chaque kilomètre parcouru, chaque don collecté compte. <strong>50%</strong> vont directement aux associations de terrain choisies par votre équipe, <strong>50%</strong> soutiennent le plaidoyer pour les enfants en France.<br><br>Pour cette <strong>première à Joué-lès-Tours</strong>, nous sommes fiers de vous avoir à nos côtés. Merci d'en faire partie. 🙏<br><br><strong>Nouveauté exclusive :</strong> faites et faites faire des <strong>promesses de dons au km</strong> — une manière percutante de challenger vos proches pour la cause de l'enfance ! C'est seulement en générant des dons et/ou des promesses de dons autour de vous que l'Association que vous avez sélectionnée à l'inscription sera effectivement soutenue par le Défi Enfance. <strong>Alors n'hésitez plus, passez des appels !</strong></div>
  <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:16px">
    <a href="${urlProm}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Promettre un don au km</a>
    <a href="${urlDon}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">❤️ Ma page de collecte</a>
  </div>
</div>

<div class="card" style="margin-bottom:22px">
  <h3>📅 Programme du 29 mai</h3>
  <div class="programme-item"><span class="programme-ic">🕐</span><span class="programme-time">13h00</span><div>Ouverture du village &amp; récupération des dossards</div></div>
  <div class="programme-item"><span class="programme-ic">🎤</span><span class="programme-time">13h45</span><div>Discours officiels</div></div>
  <div class="programme-item"><span class="programme-ic">🏃</span><span class="programme-time">14h30</span><div><strong>Départ de la course</strong> — 2h de dépassement de soi !</div></div>
  <div class="programme-item"><span class="programme-ic">🍰</span><span class="programme-time">16h00</span><div>Goûter offert à tous les participants</div></div>
  <div class="programme-item"><span class="programme-ic">🏆</span><span class="programme-time">16h30</span><div>Remise des prix</div></div>
  <div style="margin-top:12px;font-size:.82rem;color:#3d1830">📍 <strong>Parc des Bretonnières</strong> — Joué-lès-Tours</div>
</div>

<div class="card orange" style="margin-bottom:22px">
  <h3 class="orange">🍰 Le goûter — offert à tous !</h3>
  <div style="font-size:.86rem;color:#3d1830;line-height:1.7">À partir de <strong>16h00</strong>, un goûter est offert à tous les participants. Rien à commander, rien à prévoir — c'est notre façon de terminer cette belle après-midi ensemble ! 🎉</div>
</div>

<div class="card" style="margin-bottom:22px">
  <h3>🏘️ Le village de course</h3>
  <div style="font-size:.86rem;color:#3d1830;line-height:1.7">Entre l'arrivée et la remise des prix, le village sera animé et plein de vie ! Venez à la rencontre des associations qui œuvrent chaque jour pour l'enfance, profitez des animations et partagez ce moment avec vos coéquipiers. C'est l'occasion de voir concrètement l'impact de votre engagement. 💚</div>
</div>

<div class="card" style="margin-bottom:22px">
  <h3>👟 Ce qu'il faut apporter</h3>
  <div class="liste-item"><span>👕</span><div>Tenue de sport adaptée</div></div>
  <div class="liste-item"><span>👟</span><div>Chaussures de running</div></div>
  <div class="liste-item"><span>💧</span><div>Bouteille d'eau (de l'eau sera disponible sur le site)</div></div>
  <div class="liste-item"><span>📱</span><div>CB/Tél pour faire des dons en live</div></div>
  <div class="liste-item"><span>⚡</span><div>Votre énergie et votre bonne humeur !</div></div>
</div>

<div class="note magenta">🎽 <strong>Votre dossard</strong><br>Vous recevrez un email la veille, le <strong>jeudi 28 mai</strong>, avec votre numéro de dossard. Il ne vous restera plus qu'à le récupérer sur place dès 13h00 et à enfiler vos baskets ! 👟</div>

${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_IFI}${BLOC_RECUS_FISCAUX}

<div style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:20px 24px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email prêt à envoyer à vos proches</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,0.5);margin-bottom:16px">Copiez-collez ce message à vos amis, collègues, clients, fournisseurs…</div>
  <div style="background:#fff;border-radius:10px;padding:20px 22px">
    <div style="font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Objet</div>
    <div style="font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px">Plus qu'un défi sportif, une urgence pour l'enfance 🏁</div>
    <div style="font-size:.82rem;color:#3d1830;line-height:1.8">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris parce que j'ai décidé de relever un défi qui me tient particulièrement à cœur : le <strong>Défi Enfance</strong>.</p>
      <p style="margin:0 0 12px">Comme tu le sais peut-être, le secteur de l'aide à l'enfance traverse une crise sans précédent. Le système est aujourd'hui "embolisé" : manque de places, manque de coordination, et surtout, une approche trop souvent cloisonnée qui laisse des enfants vulnérables sur le bord de la route.</p>
      <p style="margin:0 0 12px">L'objectif du Défi Enfance est simple : <strong>casser ces silos</strong>. L'argent collecté permet de financer des projets innovants qui placent l'intérêt de l'enfant au centre, en faisant travailler ensemble tous les acteurs qui l'entourent. C'est en décloisonnant nos pratiques que nous réussirons à protéger durablement ces parcours de vie.</p>
      <p style="margin:0 0 12px"><strong>J'ai besoin de ton aide</strong> pour atteindre mon objectif de collecte.</p>
      <p style="margin:0 0 12px">Chaque don, même modeste, est un signal fort envoyé à ceux qui se battent sur le terrain. Les fonds sont directement fléchés vers mon équipe et reversés aux associations partenaires.</p>
      <p style="margin:0 0 12px">Pour me soutenir, c'est par ici : 👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don</a></p>
      <div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem">💡 <strong>Ton don est défiscalisé à hauteur de 66%.</strong> Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0 0 12px">Un immense merci pour ton soutien, tes encouragements et pour l'aide que tu apportes à ces enfants.</p>
      <p style="margin:0">À très vite,<br><strong>${prenom}</strong></p>
    </div>
  </div>
</div>
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;line-height:1.8">Pour toute question : <a href="mailto:contact@defienfance.com" style="color:#fb0089;font-weight:600">contact@defienfance.com</a> 📩<br><br><strong>On vous attend avec impatience — allez, plus que ${j} jours ! 🏁</strong></div>
<div style="margin-top:16px;font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— L'équipe du Défi Enfance 🤲</div>

</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplGroupeJ2Referents({ prenom, urlPromesseEquipe, urlPageEquipe }) {
  const urlProm = urlPromesseEquipe || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const urlDon  = 'https://defienfance.fr/faire-un-don/';
  const urlPage = urlPageEquipe || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=all';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
  .action-item{display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
  .action-item:last-child{border-bottom:none}
  .action-num{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff;font-weight:700;font-size:.78rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  </style></head><body><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>🏃 J-2 — Boostons<br>nos collectes de dons !</h1><p>Message spécial référents d'équipe · Angers · 22 mai 2026</p></div>
<div class="body">

<div class="greeting">Bonjour ${prenom} 👋</div>
<div class="intro">Chers référents d'équipe de coureurs,<br><br>À seulement <strong>deux jours</strong> de notre rendez-vous au Parc Saint-Serge à Angers, notre enthousiasme est au maximum ! En tant que référents d'équipe, vous êtes les <strong>ambassadeurs clés</strong> pour faire grimper notre compteur de solidarité.</div>

<!-- Vidéo Victor -->
<div style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:20px 24px;margin-bottom:22px;text-align:center">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">🎥 Message personnel aux référents d'équipe</div>
  <a href="https://www.youtube.com/shorts/-AT4nCYk7zo" style="display:block;max-width:280px;margin:0 auto 14px;border-radius:12px;overflow:hidden;text-decoration:none;position:relative">
    <img src="https://img.youtube.com/vi/-AT4nCYk7zo/hqdefault.jpg" alt="Message de Victor Vieilfault" style="width:100%;display:block;border-radius:12px">
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56px;height:56px;background:rgba(251,0,137,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center">
      <div style="width:0;height:0;border-style:solid;border-width:10px 0 10px 18px;border-color:transparent transparent transparent #fff;margin-left:4px"></div>
    </div>
  </a>
  <a href="https://www.youtube.com/shorts/-AT4nCYk7zo" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">▶️ Regarder le message</a>
</div>

<div class="card" style="margin-bottom:22px">
  <h3>🚀 Comment mobiliser dès aujourd'hui ?</h3>
  <div class="action-item">
    <div class="action-num">1</div>
    <div>
      <strong style="color:#7c3aed">Activez les promesses de dons</strong><br>
      Encouragez vos proches et réseaux pro à promettre un montant par km parcouru par votre équipe ou l'un de vos coureurs. Cela donne un véritable <em>"pouvoir d'agir"</em> à vos coureurs.<br>
      Le soir de la course à <strong>20h</strong>, le système calculera automatiquement le don final selon les km réels parcourus.<br>
      <div style="margin-top:10px"><a href="${urlProm}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem">🏅 Promettre un don au km pour mon équipe</a></div>
    </div>
  </div>
  <div class="action-item">
    <div class="action-num">2</div>
    <div>
      <strong style="color:#fb0089">Soutenez vos causes</strong><br>
      Pour rappel, <strong>50% des dons</strong> collectés sur vos pages d'équipe ou les pages de vos coureurs seront directement fléchés vers les associations que vous avez choisies à l'inscription.<br>
      <div style="margin-top:10px"><a href="${urlDon}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem">❤️ Page de don Défi Enfance</a></div>
    </div>
  </div>
  <div class="action-item">
    <div class="action-num">3</div>
    <div>
      <strong style="color:#ef6135">Zéro gestion pour vous</strong><br>
      L'organisation s'occupe de tout. Les donateurs reçoivent immédiatement leur reçu fiscal par email, et <strong>vous êtes notifié à chaque nouveau don</strong>.
    </div>
  </div>
  <div class="action-item">
    <div class="action-num">4</div>
    <div>
      <strong style="color:#3d1830">Osez le téléphone !</strong><br>
      Partager sa page par email ou sur LinkedIn est une bonne base, mais <strong>appeler directement un ami, un client ou un fournisseur</strong> pour lui présenter votre cause reste le moyen le plus efficace pour déclencher un don.
    </div>
  </div>
</div>

<div class="note" style="background:#f5f0ff;border-left-color:#7c3aed;margin-bottom:22px">
  💳 <strong>Solutions de dons en direct disponibles le jour J :</strong> CB, Lydia, dons par SMS — sur place le 22 mai au Parc Saint-Serge.
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,0.25);border-radius:14px;padding:18px 22px;margin-bottom:22px;text-align:center">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🏆 Votre page d'équipe</div>
  <a href="${urlPage}" style="display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏆 Voir la page de mon équipe</a>
</div>

<div style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:20px 24px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email / post prêt à partager à vos proches</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,0.5);margin-bottom:16px">Copiez-collez ce message à vos coureurs pour qu'ils le partagent autour d'eux</div>
  <div style="background:#fff;border-radius:10px;padding:20px 22px">
    <div style="font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Objet</div>
    <div style="font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px">Plus qu'un défi sportif, une urgence pour l'enfance 🏁</div>
    <div style="font-size:.82rem;color:#3d1830;line-height:1.8">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris parce que j'ai décidé de relever un défi qui me tient particulièrement à cœur : le <strong>Défi Enfance</strong>.</p>
      <p style="margin:0 0 12px">Comme tu le sais peut-être, le secteur de l'aide à l'enfance traverse une crise sans précédent. Le système est aujourd'hui "embolisé" : manque de places, manque de coordination, et surtout, une approche trop souvent cloisonnée qui laisse des enfants vulnérables sur le bord de la route.</p>
      <p style="margin:0 0 12px">L'objectif du Défi Enfance est simple : <strong>casser ces silos</strong>. L'argent collecté permet de financer des projets innovants qui placent l'intérêt de l'enfant au centre, en faisant travailler ensemble tous les acteurs qui l'entourent. C'est en décloisonnant nos pratiques que nous réussirons à protéger durablement ces parcours de vie.</p>
      <p style="margin:0 0 12px"><strong>J'ai besoin de ton aide</strong> pour atteindre mon objectif de collecte.</p>
      <p style="margin:0 0 12px">Chaque don, même modeste, est un signal fort envoyé à ceux qui se battent sur le terrain. Les fonds sont directement fléchés vers mon équipe et reversés aux associations partenaires.</p>
      <p style="margin:0 0 12px">Pour me soutenir, c'est par ici : 👉 <a href="https://defienfance.fr/faire-un-don/" style="color:#fb0089;font-weight:600">Faire un don</a></p>
      <div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem">💡 <strong>Ton don est défiscalisé à hauteur de 66%.</strong> Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0 0 12px">Un immense merci pour ton soutien, tes encouragements et pour l'aide que tu apportes à ces enfants.</p>
      <p style="margin:0">À très vite, <strong>Victor</strong></p>
    </div>
  </div>
</div>

${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;line-height:1.8;margin-bottom:16px">Si vous avez la moindre question d'ici vendredi, n'hésitez pas à contacter Victor directement au <strong><a href="tel:0603021945" style="color:#fb0089">06 03 02 19 45</a></strong>.</div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Merci pour votre incroyable engagement,<br>rendez-vous vendredi sur la ligne de départ !</div>
<div style="font-size:.84rem;color:#fb0089;font-weight:700;text-align:center;margin-bottom:4px">Haut les cœurs,</div>
<div style="font-size:.82rem;color:#3d1830;text-align:center">Victor Vieilfault<br>Responsable du Défi Enfance · <a href="tel:0603021945" style="color:#fb0089">06 03 02 19 45</a></div>

</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplGroupeJ1Angers({ prenom, numeroDossard, urlPageCoureur, urlPromesseCoureur }) {
  const dossardBlock = numeroDossard
    ? `<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:16px 22px;margin-bottom:20px;text-align:center">
        <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🎽 Votre numéro de dossard</div>
        <div style="font-family:'Antonio',Arial,sans-serif;font-size:3rem;color:#fb0089;font-weight:700;line-height:1">${numeroDossard}</div>
      </div>`
    : '';
  const urlDon  = urlPageCoureur     || 'https://defienfance.fr/faire-un-don/';
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
  .checklist-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
  .checklist-item:last-child{border-bottom:none}
  .rappel-item{display:flex;align-items:flex-start;gap:10px;padding:6px 0;font-size:.83rem;color:#3d1830}
  .ep-inner{background:#fff;border-radius:10px;padding:20px 22px}
  .ep-objet-label{font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
  .ep-objet-val{font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px}
  .ep-body{font-size:.82rem;color:#3d1830;line-height:1.8}
  .ep-defiscal{background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem}
  </style></head><body><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>🎽 Demain, c'est le jour J !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div>
<div class="body">
<div class="greeting">Bonjour ${prenom} 👋</div>
<div class="intro">Demain, vous serez sur la ligne de départ du Défi Enfance. <strong>On est fiers de vous avoir parmi nous.</strong></div>

${dossardBlock}

<div class="card" style="margin-bottom:20px">
  <h3>✅ Votre check-list</h3>
  <div class="checklist-item"><span>📋</span><div>Dossard ou email de confirmation prêt</div></div>
  <div class="checklist-item"><span>👕</span><div>Tenue de sport préparée</div></div>
  <div class="checklist-item"><span>👟</span><div>Chaussures de running</div></div>
  <div class="checklist-item"><span>💧</span><div>Bouteille d'eau</div></div>
  <div class="checklist-item"><span>📱</span><div>Tél/CB pour faire des dons en live</div></div>
  <div class="checklist-item"><span>⏰</span><div>Réveil réglé !</div></div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,0.25);border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">📌 Rappels pratiques</div>
  <div class="rappel-item"><span>📍</span><div><strong>Rendez-vous vendredi 22 mai</strong> au Parc Saint Serge à côté de l'Iceparc à Angers</div></div>
  <div class="rappel-item"><span>🕗</span><div><strong>Ouverture du village :</strong> 8h30</div></div>
  <div class="rappel-item"><span>🎽</span><div><strong>Retrait des dossards :</strong> 8h30 – 9h15</div></div>
  <div class="rappel-item"><span>🏁</span><div><strong>Départ de la course :</strong> 10h00</div></div>
  <div class="rappel-item"><span>🏆</span><div><strong>Remise des prix :</strong> 12h00</div></div>
  <div class="rappel-item"><span>🍽️</span><div><strong>Déjeuner Agapè :</strong> 12h30</div></div>
</div>

<div class="note" style="background:#fff8f0;border-left-color:#ff8533;margin-bottom:20px">🍴 <strong>Vous avez commandé un panier gourmand ?</strong> Pensez à le récupérer après la course au stand Agapè.</div>

<div class="card" style="margin-bottom:20px">
  <h3>🏃 Votre Défi prend tout son sens si vous embarquez votre entourage !</h3>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">
    Vous courrez demain pour l'enfance — mais <strong>votre impact sera décuplé</strong> si vous invitez vos proches, collègues ou clients à vous soutenir par un don ou une promesse de don.<br><br>
    Chaque donateur retrouve son mot d'encouragement sur le <strong>Mur des dons</strong> — un beau geste de solidarité qui reste gravé. Chaque promesse de don se transforme en don réel selon vos km parcourus, <em>en live le soir même de la course</em>.
  </div>
  <div style="text-align:center;margin-bottom:12px">
    <a href="https://defienfance.fr/mur-de-dons/" style="font-size:.78rem;color:#fb0089;font-weight:600;text-decoration:underline">💬 Voir le Mur des dons</a>
  </div>
  <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap">
    <a href="${urlDon}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">❤️ Ma page de collecte</a>
    <a href="${urlProm}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Promettre un don au km</a>
  </div>
</div>

<div style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:20px 24px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email prêt à envoyer à vos proches</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,0.5);margin-bottom:16px">Copiez-collez ce message à vos amis, collègues, clients…</div>
  <div class="ep-inner">
    <div class="ep-objet-label">Objet</div>
    <div class="ep-objet-val">Je t'embarque pour mon Défi Enfance ce 22/05 à Angers ? 🏁</div>
    <div class="ep-body">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris aujourd'hui parce que j'ai décidé de relever un défi qui me tient particulièrement à cœur : le <strong>Défi Enfance</strong>.</p>
      <p style="margin:0 0 12px">Le secteur de l'aide à l'enfance traverse une crise sans précédent. Le système est aujourd'hui saturé : manque de places, manque de coordination, et surtout, une approche trop souvent cloisonnée qui laisse des enfants vulnérables sur le bord de la route.</p>
      <p style="margin:0 0 12px">L'objectif du Défi Enfance ? <strong>Casser ces silos.</strong> L'argent collecté permet de financer des projets innovants qui placent enfin l'intérêt de l'enfant au centre, en faisant travailler ensemble tous les acteurs qui l'entourent. C'est en décloisonnant les pratiques que nous réussirons à protéger durablement ces parcours de vie.</p>
      <p style="margin:0 0 12px">Pour y arriver, <strong>j'ai besoin de toi.</strong> Je me suis fixé un objectif de collecte, et chaque don – même modeste – est un signal fort envoyé à ceux qui se battent chaque jour sur le terrain. L'intégralité des fonds sera directement reversée aux associations partenaires via mon équipe.</p>
      <p style="margin:0 0 12px">Pour me soutenir et faire bouger les lignes : 👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don ou une promesse de don</a></p>
      <div class="ep-defiscal">💡 <strong>Le bonus fiscal :</strong> Ton don est défiscalisé à hauteur de 66%. Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0 0 12px">Un immense merci pour ton soutien, tes encouragements et pour l'aide précieuse que tu apportes à ces enfants.</p>
      <p style="margin:0">À très vite,<br><strong>${prenom}</strong></p>
    </div>
  </div>
</div>

${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_IFI}${BLOC_RECUS_FISCAUX}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Demain, chaque foulée compte pour l'enfance.<br><strong style="color:#fb0089">On court avec vous ! 🏁</strong></div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance 🤲</div>

</div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplGroupePlaceholder({ prenom, nomTemplate, nbJours }) {
  const j = nbJours || '?';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🔧 Template à venir</h1><p>${nomTemplate}</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">Ce template (${nomTemplate}) est en cours de création. Il sera disponible prochainement.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">contact@defienfance.fr</div></div></div></body></html>`;
}


function tplNouveauCoureurEquipe({ prenomPrometteur, nomEquipe, montantParKm, nbCoureurs, donEstime, donPrecedent, augmentation }) {
  const scenarios = `<div class="promesse-scenario">
    <div style="font-size:.78rem;font-weight:700;color:#7c3aed;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">💡 Projection en fonction des km courus en 2h !</div>
    <div class="sc-line"><span>Avant (${nbCoureurs - 1} coureur${nbCoureurs - 1 > 1 ? 's' : ''})</span><span><strong>${donPrecedent} €</strong> estimés</span></div>
    <div class="sc-line"><span>Maintenant (${nbCoureurs} coureurs)</span><span><strong>${donEstime} €</strong> estimés (+${augmentation} €)</span></div>
  </div>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
  .promesse-scenario{background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:1px solid #e5d5f5;border-radius:12px;padding:14px 18px;margin-bottom:14px;font-size:.84rem;color:#3d1830}
  .sc-line{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e5d5f5;font-size:.82rem}
  .sc-line:last-child{border-bottom:none;font-weight:700;color:#7c3aed}
  </style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Votre promesse de don<br>vient de grandir !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body">
<div class="greeting">Bonjour ${prenomPrometteur} 👋</div>
<div class="intro">Excellente nouvelle ! Un nouveau coureur vient de rejoindre l'équipe <strong>${nomEquipe}</strong> — et votre promesse de don au km prend encore plus de valeur !</div>
<div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km — votre engagement pour l'équipe ${nomEquipe}</div></div>
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1rem;color:#7c3aed;font-weight:700;margin-bottom:10px">🏃 L'équipe s'agrandit !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px"><strong>${nomEquipe}</strong> compte maintenant <strong>${nbCoureurs} coureurs</strong>. Chacun vise en moyenne 10 km — soit <strong>${nbCoureurs * 10} km cumulés</strong> le jour de la course.</div>
  ${scenarios}
</div>
<div class="note violet">🌟 <strong>Vous êtes un acteur à part entière du Défi Enfance !</strong><br>Votre promesse de don n'est pas qu'un engagement financier — c'est un moteur de motivation pour chaque coureur. Ils savent que chaque foulée compte concrètement pour l'enfance grâce à vous.</div>
<div style="background:linear-gradient(135deg,#fff0f8,#f5f0ff);border:1px solid rgba(124,58,237,0.2);border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:.95rem;color:#fb0089;font-weight:700;margin-bottom:8px">📢 Devenez ambassadeur de la promesse de don !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Vous connaissez d'autres personnes qui pourraient soutenir un coureur ou une équipe par une promesse au km ? Partagez ce concept exclusif autour de vous — c'est la façon la plus percutante de transformer l'effort physique en impact pour les enfants.</div>
  <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
    <a href="${URL_COUREURS}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Promettre un don au km</a>
    <a href="${URL_DON}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:700;font-size:.82rem">❤️ Faire un don</a>
  </div>
</div>
${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_IFI}${BLOC_RECUS_FISCAUX}<div class="divider"></div>
<div style="font-size:.75rem;color:#888;text-align:center">Notification automatique suite à l'inscription d'un nouveau coureur dans l'équipe ${nomEquipe}.<br>contact@defienfance.fr — defienfance.fr</div>
</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplInscriptionAsso({ nomAsso, coureur, email_coureur, ville, prenomReferent }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🏃 Nouveau coureur<br>pour votre cause !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomReferent || ''} 👋</div><div class="intro">Un coureur vient de <strong>choisir votre association ${nomAsso}</strong> pour courir lors du <strong>Défi Enfance${ville ? ' de ' + ville : ''}</strong> !</div><div class="don-box"><div class="don-amount" style="font-size:1.8rem">${coureur}</div><div class="don-label">Nouveau coureur inscrit</div></div><div class="card"><h3>📋 Coordonnées du coureur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${coureur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_coureur}" style="color:#fb0089">${email_coureur}</a></div></div></div><div class="note magenta">💌 <strong>Prenez contact avec ${coureur}</strong> pour le remercier et l'accueillir chaleureusement !</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">💡 Présentez vos actions. Plus le coureur est engagé, plus sa collecte sera importante !</div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Association : <strong>${nomAsso}</strong><br>Email envoyé automatiquement dans les 10 minutes suivant l'inscription.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}


function tplDejeuner({ prenom }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🥗 Votre panier repas<br>est confirmé !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">Votre commande de repas est <strong>validée</strong> pour le Défi Enfance d'Angers — 22 mai 2026 !</div><div class="don-box" style="text-align:left;padding:20px 26px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;text-align:center">🧺 Votre panier gourmand</div><div class="row"><span class="ic">🥙</span><div>Bagel poulet, mozzarella, pesto &amp; tomates confites</div></div><div class="row"><span class="ic">🧁</span><div>Muffin maison aux fruits rouges</div></div><div class="row"><span class="ic">🍎</span><div>Une pomme</div></div><div class="row"><span class="ic">💧</span><div>Une eau</div></div></div><div class="note magenta" style="margin-bottom:22px">🎓 <strong>Panier préparé par Agapè Anjou</strong>, une école de production angevine qui forme des jeunes de 15 à 25 ans aux métiers de la restauration.<br><br>Merci — votre commande est <strong>solidaire</strong> : les 12 € versés viennent soutenir leur parcours.</div><div class="cta-box" style="text-align:left"><p style="text-align:center">📍 <strong>Récupération de votre panier</strong></p><div style="font-size:.86rem;color:#3d1830;line-height:1.8;margin-top:8px"><div>🕛 <strong>Dès 12h</strong> — après la course</div><div>📌 <strong>Stand Agapè Anjou</strong> sur le village de la course</div><div>👤 Dites simplement <strong>votre nom</strong> à l'accueil</div></div></div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">À tout à l'heure sur le Défi Enfance !<br><strong style="color:#fb0089">— Team Défi Enfance</strong></div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}
function tplInscriptionCoureur({ prenom, nomComplet, nomAsso }) {
  const assoBlock = nomAsso
    ? `<div class="don-box" style="margin-bottom:20px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🏳️ Votre association soutenue</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089">${nomAsso}</div><div style="font-size:.78rem;color:#3d1830;margin-top:4px">Votre choix a bien été pris en compte ✅</div></div>`
    : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div>${assoBlock}<div class="intro">🚀 Vous pouvez désormais aider l'Association que vous avez choisie en invitant vos réseaux pro et perso à faire un don !</div><div class="cta-box"><p>Partagez le lien de don à vos contacts — en choisissant votre nom dans le formulaire, ils soutiennent votre collecte pour votre Association et le Plaidoyer du Défi Enfance.</p><a href="${URL_DON}" class="cta-btn">❤️ Page de don Défi Enfance</a></div><div class="note magenta">💡 Leur don est éligible à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur l'IR ou 60% sur l'IS.</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">📊 Suivez vos dons sur le <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">classement général</a> du Défi Enfance.</div>${blocCtaDonPromesse({ nomCoureur: nomComplet })}<div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Ensemble, on va soulever les énergies pour l'enfance !<br>Merci pour votre engagement.</div><div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplInscriptionSupporter({ prenom }) {
  const URL_ASSOS = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=associations&de_event=all';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">En tant que supporter, vous avez un rôle privilégié pour soutenir les coureurs engagés pour le Défi Enfance !</div><div class="card"><h3>💪 Comment agir dès maintenant ?</h3><div class="row"><span class="ic">🏃</span><div>Découvrez <a href="${URL_ASSOS}" style="color:#fb0089;font-weight:600">la liste des associations</a></div></div><div class="row"><span class="ic">❤️</span><div>Parrainez un coureur ou une équipe par un don</div></div><div class="row"><span class="ic">📢</span><div>Partagez la <a href="${URL_DON}" style="color:#fb0089;font-weight:600">page Faire un don</a></div></div></div><div class="note magenta">💡 Dons éligibles à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur l'IR ou 60% sur l'IS.</div>${blocCtaDonPromesse({})}<div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic">Ensemble, nous allons soulever les énergies pour l'enfance !<br><strong style="color:#fb0089">— Team Défi Enfance</strong></div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

function tplBilletsEnGros({ prenomRef, nomStructure, nomEquipe, montant, date }) {
  const equipeLabel = nomEquipe || nomStructure;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🎉 Merci pour votre<br>règlement groupé !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomRef || ''} 👋</div><div style="margin-bottom:16px;text-align:center"><span class="badge">🏃 Équipe ${equipeLabel}</span></div><div class="intro">La Team Défi Enfance est <strong>fière</strong> de savoir l'équipe <strong>${equipeLabel}</strong> embarquée dans l'aventure !</div><div class="don-box"><div class="don-amount" style="font-size:2.2rem">${montant} €</div><div class="don-label">Règlement groupé reçu — 📅 ${date}</div></div><div class="note magenta">🙏 Ce règlement représente bien plus qu'un paiement — c'est le signal de départ d'une belle aventure collective !</div><div class="cta-box"><p>🚀 <strong>Faites décoller la collecte de votre équipe !</strong></p><a href="${URL_EQUIPES}" class="cta-btn">🏆 Voir la page de notre équipe</a></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email suite au règlement groupé.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></body></html>`;
}

// ══════════════════════════════════════════════════════
//  MERCI DONATEUR (don classique)
// ══════════════════════════════════════════════════════


// ── Récupérer tous les promettants d'une équipe et leurs montants promis
async function fetchPromettantsEquipe(nomEquipe) {
  if (!nomEquipe) return [];
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?limit=250&since_date=2026-01-01`, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (!res.ok) return [];
    const json = await res.json();
    const promettants = [];
    for (const p of (json.data || [])) {
      const cf = p.custom_fields || p;
      const montantPromesse = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (!montantPromesse) continue;
      const equipeParraine = (cf.equipe_parraine || '').trim();
      if (equipeParraine.toLowerCase() !== nomEquipe.toLowerCase()) continue;
      // Récupérer les infos du promettant
      const contact = await fetchOhmeContactById(p.contact_id);
      if (!contact || !contact.email) continue;
      const prenom = contact.firstname || contact.first_name || '';
      promettants.push({
        email: contact.email,
        prenom: prenom || 'Supporter',
        montantParKm: montantPromesse,
        contactId: contact.id,
      });
    }
    return promettants;
  } catch(e) {
    addLog(`⚠️ fetchPromettantsEquipe erreur : ${e.message}`, 'warn');
    return [];
  }
}

// ── Compter les coureurs d'une équipe
async function fetchNbCoureurs(nomEquipe) {
  if (!nomEquipe) return 0;
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01`, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (!res.ok) return 0;
    const json = await res.json();
    const vus = new Set();
    for (const p of (json.data || [])) {
      const cf = p.custom_fields || p;
      const equipe = (cf.equipe || '').trim();
      if (equipe.toLowerCase() !== nomEquipe.toLowerCase()) continue;
      const eventName = (p.nom_de_levent || cf.nom_de_levent || '').toUpperCase();
      if (!eventName.includes('ENFANCE')) continue;
      if (eventName.includes('SUPPORTERS')) continue;
      vus.add(String(p.contact_id));
    }
    return vus.size;
  } catch(e) { return 0; }
}

// ── Récupérer l'historique des dons/promesses d'un contact (avec timeout 3s)
async function fetchHistoriqueDons(contactId) {
  if (!contactId) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `${CONFIG.ohmeBase}/api/v1/payments?contact_id=${contactId}&limit=50`,
      {
        headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return [];
    const json = await res.json();
    const items = (json.data || []).filter(p => {
      const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').trim();
      return eventName && (p.payment_type_id === 1); // uniquement les dons
    });
    // Trier par date décroissante
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return items.slice(0, 10); // max 10 entrées
  } catch(e) {
    addLog(`⚠️ fetchHistoriqueDons timeout/erreur : ${e.message}`, 'warn');
    return [];
  }
}

// ── Formater l'historique en HTML pour les emails merci
function formatHistoriqueDons(items) {
  if (!items || items.length === 0) return '';
  const lignes = items.map(p => {
    const cf = p.custom_fields || p;
    const date = p.date ? new Date(p.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '??';
    const montant = p.amount || '?';
    const isPromesse = parseFloat(cf.montant_promesse_don_par_km || 0) > 0;
    const coureur = (cf.coureur_parraine || '').trim();
    const equipe  = (cf.equipe_parraine  || '').trim();
    const asso    = (cf.asso_soutenue    || '').trim();

    let cible = '';
    if (coureur) cible = `à <strong>${coureur}</strong>${asso ? ` <span style="color:#888">(soutient ${asso})</span>` : ''}`;
    else if (equipe) cible = `à l'équipe <strong>${equipe}</strong>`;
    else cible = 'au Défi Enfance';

    if (isPromesse) {
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px dashed rgba(124,58,237,0.15);font-size:.82rem;color:#3d1830">
        <span>🏅 <strong>${date}</strong> — Promesse de ${cf.montant_promesse_don_par_km}€/km ${cible}</span>
      </div>`;
    } else {
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px dashed rgba(251,0,137,0.15);font-size:.82rem;color:#3d1830">
        <span>❤️ <strong>${date}</strong> — Don de <strong>${montant}€</strong> ${cible}</span>
      </div>`;
    }
  }).join('');

  return `<div style="background:linear-gradient(135deg,#fff8f0,#fff0f8);border:1px solid rgba(251,0,137,0.2);border-radius:12px;padding:16px 20px;margin-bottom:22px">
    <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">📋 Vos soutiens au Défi Enfance</div>
    ${lignes}
  </div>`;
}

async function sendMerciDonateur({ email, prenom, montant, donateur, coureurPrenom, coureurNom, association, nomEquipe, contactId, isStructure, nomStructure }) {
  if (!email) return;

  // Compter les dons de ce contact
  let nbDons = 0;
  if (contactId) { nbDons = state.donsParContact[contactId] || 0; state.donsParContact[contactId] = nbDons + 1; }

  // Récupérer l'historique depuis Ohme (avec fallback silencieux)
  const historiqueItems = await fetchHistoriqueDons(contactId);
  const historiqueHtml  = formatHistoriqueDons(historiqueItems);

  let html, subject;

  if (isStructure && nomStructure) {
    // Don d'une structure
    subject = coureurPrenom
      ? `❤️ Merci pour le don de ${nomStructure} à ${coureurPrenom} !`
      : nomEquipe
        ? `❤️ Merci pour le don de ${nomStructure} via l'équipe ${nomEquipe} !`
        : `❤️ Merci pour le don de ${nomStructure} !`;
    html = tplMerciDonateurStructure({ prenomDonateur: prenom, montant, nomStructure, coureurPrenom, coureurNom, association, nomEquipe });

  } else if (nbDons >= 2) {
    // 3ème don et + → Ambassadeur avec Korczak
    subject = coureurPrenom
      ? `🎖️ Merci Ambassadeur — votre don à ${coureurPrenom} !`
      : nomEquipe
        ? `🎖️ Merci Ambassadeur — votre don via l'équipe ${nomEquipe} !`
        : '🎖️ Merci, Ambassadeur du Défi Enfance !';
    html = tplMerciDonateurAmbassadeur({ prenomDonateur: prenom, montant, coureurPrenom, coureurNom, association, nomEquipe, historiqueHtml });

  } else if (nbDons === 1) {
    // 2ème don → Super Badge Donateur
    subject = coureurPrenom
      ? `🏅 Super Badge Donateur — votre don à ${coureurPrenom} !`
      : nomEquipe
        ? `🏅 Super Badge Donateur — votre don via l'équipe ${nomEquipe} !`
        : '🏅 Super Badge Donateur du Défi Enfance !';
    html = tplMerciDonateurFidele({ prenomDonateur: prenom, montant, historiqueHtml });

  } else if (coureurPrenom) {
    // 1er don → coureur
    subject = `❤️ Merci pour votre don à ${coureurPrenom} !`;
    html = tplMerciDonateur({ prenomDonateur: prenom, montant, donateur, coureurPrenom, coureurNom: coureurNom || '', association: association || '', historiqueHtml });

  } else if (nomEquipe) {
    // 1er don → équipe
    subject = `❤️ Merci pour votre don via l'équipe ${nomEquipe} !`;
    html = tplMerciDonateurEquipe({ prenomDonateur: prenom, montant, donateur, nomEquipe, historiqueHtml });

  } else {
    // Don global
    subject = '❤️ Merci pour votre don au Défi Enfance !';
    html = tplMerciDonateurGlobal({ prenomDonateur: prenom, montant, historiqueHtml });
  }

  const ok = await sendBrevo(email, subject, html);
  if (ok) { state.stats.sent++; addLog(`✅ Email merci envoyé à ${prenom} (${email}) — don n°${nbDons + 1}`, 'ok'); }
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

  // En premierPoll : pagination complète pour récupérer TOUS les paiements
  // En poll normal : 250 derniers suffisent (Redis protège des doublons)
  if (premierPoll) {
    addLog('📦 PremierPoll — récupération paginée de tous les paiements…', 'info');
    let all = [];
    let cursor = null;
    const limit = 250;
    try {
      while (true) {
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=${limit}&since_date=2026-03-01&cursor=${cursor}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=${limit}&since_date=2026-03-01`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const items = json.data || [];
        all = all.concat(items);
        if (items.length < limit) break;
        cursor = json.cursor || (items.length > 0 ? items[items.length - 1].id : null);
        if (!cursor) break;
        addLog(`📦 Pagination : ${all.length} paiements récupérés…`, 'info');
        await sleep(OHME_DELAY_MS);
      }
      addLog(`📦 PremierPoll — ${all.length} paiement(s) récupérés au total`, 'info');
      return all;
    } catch(e) {
      addLog(`Erreur Ohme (pagination) : ${e.message}`, 'error');
      state.stats.errors++;
      return all;
    }
  }

  // Poll normal : 250 derniers
  try {
    const url = `${CONFIG.ohmeBase}/api/v1/payments?limit=250&since_date=2026-03-01`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data || [];
  } catch (e) { addLog(`Erreur Ohme : ${e.message}`, 'error'); state.stats.errors++; return []; }
}

async function fetchOhmeContactById(contactId) {
  if (!contactId) return null;
  const key = String(contactId);
  if (contactsCache.has(key)) return contactsCache.get(key);
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/contacts/${contactId}`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res.ok) return null;
    const json = await res.json();
    const contact = json.data || json;
    cacheContact(contact);
    return contact;
  } catch(e) { return null; }
}

async function fetchOhmeContactByName(name) {
  if (!name) return null;
  const nameLower = name.trim().toLowerCase();

  // Stratégie 0 : cache en mémoire — instantané
  if (contactsByNameCache.has(nameLower)) {
    addLog(`🔍 Contact "${name}" trouvé en cache`, 'info');
    return contactsByNameCache.get(nameLower);
  }

  try {
    // Stratégie 1 : contacts déjà en cache via leur ID → chercher le bon nom
    for (const contact of contactsCache.values()) {
      const fullName = `${contact.firstname||contact.first_name||''} ${contact.lastname||contact.last_name||''}`.trim().toLowerCase();
      if (fullName === nameLower) {
        contactsByNameCache.set(nameLower, contact);
        return contact;
      }
    }

    // Stratégie 2 : fallback via /api/v1/contacts (peut causer 422 sur certains champs)
    await sleep(OHME_DELAY_MS);
    const parts = name.trim().split(' ');
    const params = new URLSearchParams({ limit: '5' });
    if (parts[0]) params.set('firstname', parts[0]);
    if (parts.slice(1).join(' ')) params.set('lastname', parts.slice(1).join(' '));
    const res = await fetch(`${CONFIG.ohmeBase}/api/v1/contacts?${params}`, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (res.ok) {
      const json = await res.json();
      const items = json.data || [];
      const contact = items.find(c => `${c.firstname||c.first_name||''} ${c.lastname||c.last_name||''}`.trim().toLowerCase() === nameLower) || items[0];
      if (contact) {
        cacheContact(contact);
        addLog(`🔍 Contact trouvé via API contacts : ${name}`, 'info');
        return { ...contact, email: contact.email || '' };
      }
    } else {
      addLog(`⚠️ fetchOhmeContactByName HTTP ${res.status} pour "${name}"`, 'warn');
    }

    // Stratégie 3 : chercher dans les paiements billetterie (lent mais fiable)
    // Seulement si les stratégies précédentes ont échoué
    addLog(`🔍 Recherche de "${name}" dans les paiements billetterie…`, 'info');
    await sleep(OHME_DELAY_MS);
    const res2 = await fetch(
      `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=3&limit=250&since_date=2026-01-01`,
      { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
    );
    if (res2.ok) {
      const json2 = await res2.json();
      for (const p of (json2.data || [])) {
        if (!p.contact_id) continue;
        const contact = await fetchOhmeContactById(p.contact_id); // mis en cache automatiquement
        if (!contact) continue;
        const fullName = `${contact.firstname||contact.first_name||''} ${contact.lastname||contact.last_name||''}`.trim().toLowerCase();
        if (fullName === nameLower) {
          addLog(`🔍 Contact "${name}" trouvé dans billetterie`, 'info');
          return contact;
        }
      }
    }

    addLog(`⚠️ fetchOhmeContactByName — "${name}" introuvable partout`, 'warn');
    return null;
  } catch(e) { addLog(`⚠️ fetchOhmeContactByName erreur : ${e.message}`, 'warn'); return null; }
}

async function fetchEquipeCoureur(contactId) {
  if (!contactId) return null;
  try {
    // Pagination complète — filtre local par contact_id (filtre URL non supporté par Ohme)
    let cursor = null;
    while (true) {
      await sleep(OHME_DELAY_MS);
      const url = cursor
        ? `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=3&limit=250&since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
        : `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=3&limit=250&since_date=2026-01-01`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
      });
      if (!res.ok) { addLog(`⚠️ fetchEquipeCoureur HTTP ${res.status}`, 'warn'); return null; }
      const json = await res.json();
      const items = json.data || [];
      for (const p of items) {
        if (String(p.contact_id) !== String(contactId)) continue;
        const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').toUpperCase();
        if (!eventName.includes('ENFANCE')) continue;
        const equipe = ((p.custom_fields || p).equipe || '').trim();
        if (equipe) { addLog(`🔍 Équipe coureur trouvée : ${equipe}`, 'info'); return equipe; }
      }
      if (items.length < 250) break;
      cursor = json.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
      if (!cursor) break;
    }
    addLog(`⚠️ fetchEquipeCoureur — aucune équipe trouvée pour contact ${contactId}`, 'warn');
    return null;
  } catch(e) { addLog(`⚠️ fetchEquipeCoureur erreur : ${e.message}`, 'warn'); return null; }
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
    // Priorité 1 : structure_id direct sur le paiement → le plus fiable
    if (p.structure_id) {
      try {
        await sleep(OHME_DELAY_MS);
        const resS = await fetch(`${CONFIG.ohmeBase}/api/v1/structures/${p.structure_id}`, {
          headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
        });
        if (resS.ok) {
          const jsonS = await resS.json();
          const s  = jsonS.data || jsonS;
          const cf = s.custom_fields || s;
          const emailRef  = cf.email_referent_defi_enfance     || s.email_referent_defi_enfance     || emailContact;
          const prenomRef = cf.prenom_du_referent_defi_enfance || s.prenom_du_referent_defi_enfance || prenomContact;
          const nomS = s.name || '';
          addLog(`🏢 Don structure (via structure_id ${p.structure_id}) : ${nomS} — email: ${emailRef || 'VIDE'}`, 'info');
          if (nomS || emailRef) return { donateur: nomS, emailDon: emailRef, prenomMerci: prenomRef, isStructure: true, nomStructure: nomS };
        }
      } catch(e) { addLog(`⚠️ fetchInfosDonateur structure_id ${p.structure_id} : ${e.message}`, 'warn'); }
    }

    // Priorité 2 : contact lié à une structure (contact.structure)
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

    // Priorité 3 : structure_name sur le paiement
    if (p.structure_name) {
      const structure = await fetchOhmeStructureByName(p.structure_name).catch(() => null);
      if (structure) {
        const cf = structure.custom_fields || structure;
        return { donateur: structure.name || p.structure_name, emailDon: cf.email_referent_defi_enfance || emailContact, prenomMerci: cf.prenom_du_referent_defi_enfance || '', isStructure: true, nomStructure: structure.name || p.structure_name };
      }
      return { donateur: p.structure_name, emailDon: emailContact, prenomMerci: '', isStructure: true, nomStructure: p.structure_name };
    }

    // Fallback : infos du contact
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
  if (state.redisBlocked) { addLog('⛔ Envoi bloqué — Redis inaccessible', 'warn'); return false; }
  // Nettoyer l'email : trim + suppression caractères invisibles
  const toClean = (to || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (!toClean || !toClean.includes('@')) {
    addLog(`⚠️ Brevo — email invalide ou vide : "${toClean}" (original: "${to}")`, 'warn');
    return false;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': CONFIG.brevoKey, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: { name: CONFIG.senderName, email: CONFIG.senderEmail }, to: [{ email: toClean }], subject, htmlContent: html }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); addLog(`Brevo erreur ${res.status} : ${err.message || ''} — email: "${toClean}"`, 'error'); state.stats.errors++; return false; }
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

    // Ignorer les dons "attendus" — pas d'email, juste comptabilisé
    const qualiteParticipant = (
      (p.custom_fields && p.custom_fields.qualite_du_participant) ||
      p.qualite_du_participant || ''
    ).toLowerCase().trim();
    if (qualiteParticipant === 'don attendu') {
      addLog(`⏭️ Paiement ${p.id} ignoré — "don attendu" (pas d'email)`, 'info');
      state.processedIds.add(String(p.id));
      continue;
    }
    if (qualiteParticipant === 'exclu') {
      addLog(`⏭️ Paiement ${p.id} ignoré — "exclu" (pas d'email)`, 'info');
      state.processedIds.add(String(p.id));
      continue;
    }

    // Bloquer les paiements non effectués — mis en attente (pas dans processedIds)
    // → au prochain poll, si le statut a changé, le paiement sera retraité automatiquement
    const paymentCompleted = p.payment_completed;
    const paymentStatus    = (p.payment_status || '').toLowerCase().trim();
    const statusDefinitifEchec = ['cancelled','customer_approval_denied','failed','charged_back','cheque_rejected'];
    const statusEnCours        = ['pending_customer_approval','pending_submission','submitted'];

    if (paymentCompleted === false || (paymentStatus && statusDefinitifEchec.includes(paymentStatus))) {
      // Échec définitif → ignorer sans mettre en attente
      addLog(`⏭️ Paiement ${p.id} ignoré définitivement — statut : "${paymentStatus || 'payment_completed:false'}"`, 'info');
      state.processedIds.add(String(p.id));
      continue;
    }

    if (paymentStatus && statusEnCours.includes(paymentStatus)) {
      // En cours de validation → mettre en attente sans marquer comme traité
      // Il sera retraité automatiquement au prochain poll si le statut change
      const statutLabel = {
        'pending_customer_approval': "En attente d'autorisation",
        'pending_submission':        "En attente d'envoi",
        'submitted':                 'En attente de traitement',
      }[paymentStatus] || paymentStatus;

      const cf = p.custom_fields || p;
      const typeId = p.payment_type_id;
      const montant = p.amount || '?';
      const date = p.date || new Date().toISOString();
      const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').trim();
      const typeLabel = typeId === 1 ? 'Don' : typeId === 3 ? 'Inscription' : 'Paiement';

      // Récupérer les infos du contact pour l'affichage
      let donateur = 'Inconnu', emailDon = '';
      const contact = await fetchOhmeContactById(p.contact_id);
      if (contact) {
        const prenom = contact.firstname || contact.first_name || '';
        const nom    = contact.lastname  || contact.last_name  || '';
        donateur = `${prenom} ${nom}`.trim() || `Participant (ID ${p.contact_id})`;
        emailDon = contact.email || '';
      }

      addDonEnAttente({
        paiementId: String(p.id),
        donateur,
        emailDon,
        montant,
        date,
        eventName: eventNom,
        typeLabel: `${typeLabel} — ⏳ ${statutLabel}`,
        modeValidation: false,
        statutOhme: paymentStatus,
      });
      addLog(`⏳ Paiement ${p.id} (${donateur}) en attente — statut Ohme : "${statutLabel}"`, 'warn');
      // NE PAS ajouter dans processedIds → sera retraité au prochain poll
      continue;
    }

    // ── MODE PREMIER POLL
    if (premierPoll && !ignoreDate) {
      // Si l'ID est déjà dans Redis → déjà traité, skip silencieux (pas de doublon)
      if (state.processedIds.has(String(p.id))) { continue; }
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
          const urlPageCoureur     = await buildUrlPageCoureur(contact?.id, eventName);
          const urlPromesseCoureur = await buildUrlPromesseCoureur(contact?.id, eventName);
          const html = tplDonCoureur({ coureurPrenom, donateur, montant, email_donateur: emailDon, association: assoSoutenue, motEncouragement, urlPageCoureur, urlPromesseCoureur });
          const ok = await sendBrevo(emailCoureur, `❤️ [live] ${prenomMerci || donateur.split(' ')[0]} a fait un don pour vous !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Don ${montant}€ → ${coureurParraine}`, 'ok'); addEvent('❤️', `Don de ${montant} €`, `${donateur} → ${coureurParraine}`, 'don'); sendMerciDonateur({ email: emailDon, prenom: prenomMerci || donateur.split(' ')[0], montant, donateur, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: assoSoutenue, contactId: p.contact_id, isStructure, nomStructure }); }
          const equipe = await fetchEquipeCoureur(contact?.id);
          if (equipe) {
            const structure = await fetchOhmeStructureByName(equipe);
            const chefEmail = structure?.email_referent_defi_enfance || '';
            const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
            const chefNom   = structure?.nom_du_referent_defi_enfance || '';
            if (chefEmail) {
              const urlPageEquipe = await buildUrlPageEquipe(null, equipe, eventName);
              const htmlE = tplDonEquipe({ chefPrenom, chefNom, nomEquipe: equipe, donateur, montant, email_donateur: emailDon, motEncouragement, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), urlPageEquipe });
              const okE = await sendBrevo(chefEmail, `❤️ Don de ${donateur} pour ${coureurPrenom} — équipe ${equipe} !`, htmlE);
              if (okE) { state.stats.sent++; addLog(`✅ Don → chef équipe ${equipe}`, 'ok'); }
            }
          }
        } else { addLog(`⚠️ Coureur "${coureurParraine}" introuvable`, 'warn'); }
      } else if (equipeParraine) {
        const structure = await fetchOhmeStructureByName(equipeParraine);
        const chefEmail = structure?.email_referent_defi_enfance || '';
        const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
        const chefNom   = structure?.nom_du_referent_defi_enfance || '';
        if (chefEmail) {
          const urlPageEquipeDirect = await buildUrlPageEquipe(null, equipeParraine, eventName);
          const html = tplDonEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon, motEncouragement, urlPageEquipe: urlPageEquipeDirect });
          const ok = await sendBrevo(chefEmail, `❤️ Don pour votre équipe de ${donateur} !`, html);
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

        if (emailCoureur) {
          // Récupérer les totaux de promesses + équipe du coureur
          const promCoureur = await fetchTotalPromessesCoureur(contact?.id);
          const equipe      = await fetchEquipeCoureur(contact?.id);
          const promEquipe  = equipe ? await fetchTotalPromessesEquipe(equipe) : { nb: 0, total: 0 };

          // URLs personnalisées
          const urlPromesseCoureur = await buildUrlPromesseCoureur(contact?.id, eventName);
          const urlPageCoureur     = await buildUrlPageCoureur(contact?.id, eventName);

          // 1. Email au coureur
          const html = tplPromesseCoureur({ coureurPrenom, donateur, montantParKm: montantKm, email_donateur: emailDon, association: assoSoutenue, motEncouragement, nbPromessesCoureur: promCoureur.nb, totalKmParCoureur: promCoureur.total, nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total, urlPromesseCoureur, urlPageCoureur });
          const ok = await sendBrevo(emailCoureur, `🏅 ${prenomMerci || donateur.split(' ')[0]} promet ${montantKm}€/km pour toi !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Promesse ${montantKm}€/km → coureur ${coureurParraine}`, 'ok'); addEvent('🏅', `Promesse ${montantKm}€/km`, `${donateur} → ${coureurParraine}`, 'don'); }

          // 2. Email merci au prometteur
          const htmlMerci = tplMerciPrometteurCoureur({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantParKm: montantKm, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: assoSoutenue });
          const okMerci = await sendBrevo(emailDon, `🙏 Merci pour votre promesse de don au coureur ${coureurPrenom} !`, htmlMerci);
          if (okMerci) { state.stats.sent++; addLog(`✅ Merci promesse envoyé à ${donateur}`, 'ok'); }

          // 3. Email au chef d'équipe — même logique que pour les dons
          if (equipe) {
            const structure  = await fetchOhmeStructureByName(equipe);
            const chefEmail  = structure?.email_referent_defi_enfance || '';
            const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
            const chefNom    = structure?.nom_du_referent_defi_enfance || '';
            if (chefEmail) {
              const urlPageCoureurE     = await buildUrlPageCoureur(contact?.id, eventName);
              const urlPromesseCoureurE = await buildUrlPromesseCoureur(contact?.id, eventName);
              const htmlEquipe = tplPromesseCoureurPourEquipe({ chefPrenom, chefNom, nomEquipe: equipe, donateur, montantParKm: montantKm, email_donateur: emailDon, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), motEncouragement, nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total, urlPageCoureur: urlPageCoureurE, urlPromesseCoureur: urlPromesseCoureurE });
              const okE = await sendBrevo(chefEmail, `🏅 Promesse de ${donateur} pour ${coureurPrenom} — équipe ${equipe} !`, htmlEquipe);
              if (okE) { state.stats.sent++; addLog(`✅ Promesse ${montantKm}€/km → chef équipe ${equipe}`, 'ok'); }
            } else { addLog(`⚠️ Promesse → équipe "${equipe}" — email référent introuvable`, 'warn'); }
          } else { addLog(`⚠️ Promesse → coureur "${coureurParraine}" — pas d'équipe trouvée`, 'warn'); }

        } else { addLog(`⚠️ Promesse → coureur "${coureurParraine}" introuvable ou sans email`, 'warn'); }

      } else if (equipeParraine) {
        const structure = await fetchOhmeStructureByName(equipeParraine);
        const chefEmail  = structure?.email_referent_defi_enfance || '';
        const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
        const chefNom    = structure?.nom_du_referent_defi_enfance || '';
        const promEquipe = await fetchTotalPromessesEquipe(equipeParraine);

        if (chefEmail) {
          // URLs personnalisées équipe
          const urlPromesseEquipe = await buildUrlPromesseEquipe(null, equipeParraine, eventName);
          const urlPageEquipe     = await buildUrlPageEquipe(null, equipeParraine, eventName);
          // 1. Email au chef d'équipe
          const html = tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montantParKm: montantKm, email_donateur: emailDon, motEncouragement, nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total, urlPromesseEquipe, urlPageEquipe });
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
      // Champ Oui/Non Ohme → peut être booléen true/false ou string "oui"/"non"
      const achatEnGrosRaw = cf.achat_billets_en_gros;
      // Log pour diagnostiquer la valeur exacte retournée par Ohme
      addLog(`🔍 achat_billets_en_gros brut : ${JSON.stringify(achatEnGrosRaw)} (type: ${typeof achatEnGrosRaw})`, 'info');
      const achatEnGros = achatEnGrosRaw === true
        || achatEnGrosRaw === 'true'
        || achatEnGrosRaw === 1
        || achatEnGrosRaw === '1'
        || (typeof achatEnGrosRaw === 'string' && achatEnGrosRaw.toLowerCase() === 'oui')
        || (typeof achatEnGrosRaw === 'string' && achatEnGrosRaw.toLowerCase() === 'yes');

      if (achatEnGros) {
        const equipeOrg  = (cf.equipe || '').trim();
        const montantOrg = p.amount || '?';
        const dateOrg    = p.date ? new Date(p.date).toLocaleDateString('fr-FR') : '';

        let emailOrg = '', prenomOrg = '', nomOrg = '';

        // Cas 1 : paiement lié à une structure directement (structure_id)
        if (p.structure_id) {
          addLog(`🏢 Achat en gros via structure_id : ${p.structure_id}`, 'info');
          await sleep(OHME_DELAY_MS);
          try {
            const resS = await fetch(`${CONFIG.ohmeBase}/api/v1/structures/${p.structure_id}`, {
              headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
            });
            if (resS.ok) {
              const jsonS = await resS.json();
              const s  = jsonS.data || jsonS;
              const cf2 = s.custom_fields || s;
              emailOrg  = cf2.email_referent_defi_enfance  || s.email_referent_defi_enfance  || '';
              prenomOrg = cf2.prenom_du_referent_defi_enfance || s.prenom_du_referent_defi_enfance || '';
              nomOrg    = s.name || '';
              addLog(`🏢 Structure trouvée : ${nomOrg} — email: ${emailOrg || 'VIDE'}`, 'info');
            }
          } catch(e) { addLog(`⚠️ Erreur récupération structure ${p.structure_id} : ${e.message}`, 'warn'); }
        }

        // Cas 2 : paiement lié à un contact (contact_id) → fallback via fetchInfosDonateur
        if (!emailOrg && p.contact_id) {
          addLog(`👤 Achat en gros via contact_id : ${p.contact_id}`, 'info');
          const infosOrg = await fetchInfosDonateur(p);
          emailOrg  = infosOrg.emailDon   || '';
          prenomOrg = infosOrg.prenomMerci || '';
          nomOrg    = infosOrg.nomStructure || infosOrg.donateur || '';
        }

        if (emailOrg) {
          const html = tplBilletsEnGros({ prenomRef: prenomOrg, nomStructure: nomOrg, nomEquipe: equipeOrg, montant: montantOrg, date: dateOrg });
          const ok = await sendBrevo(emailOrg, `🎉 Merci pour votre règlement groupé — Équipe ${equipeOrg || nomOrg} !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Billets en gros → ${nomOrg} (${emailOrg})`, 'ok'); addEvent('🎉', `Billets en gros`, `${nomOrg} — ${montantOrg}€`, 'bill'); }
        } else {
          addLog(`⚠️ Achat en gros — aucun email trouvé (structure_id: ${p.structure_id || 'N/A'}, contact_id: ${p.contact_id || 'N/A'})`, 'warn');
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
        if (emailCoureur) { const html = tplInscriptionCoureur({ prenom: prenomC || coureur, nomComplet: coureur, nomAsso }); const ok = await sendBrevo(emailCoureur, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, html); if (ok) { state.stats.sent++; addLog(`✅ Bienvenue coureur → ${coureur}`, 'ok'); addEvent('🚀', `Bienvenue coureur`, coureur, 'bill'); } }

        // ── Notifier les promettants de l'équipe si le coureur rejoint une équipe
        if (equipeC) {
          const promettants = await fetchPromettantsEquipe(equipeC);
          if (promettants.length > 0) {
            const nbCoureurs  = await fetchNbCoureurs(equipeC);
            const nbPrecedent = Math.max(1, nbCoureurs - 1);
            for (const promettant of promettants) {
              const donEstime    = Math.round(nbCoureurs  * 10 * promettant.montantParKm);
              const donPrecedent = Math.round(nbPrecedent * 10 * promettant.montantParKm);
              const augmentation = donEstime - donPrecedent;
              const htmlProm = tplNouveauCoureurEquipe({ prenomPrometteur: promettant.prenom, nomEquipe: equipeC, montantParKm: promettant.montantParKm, nbCoureurs, donEstime, donPrecedent, augmentation });
              const okProm = await sendBrevo(promettant.email, `🏅 Votre promesse de don vient de grandir — ${coureur} rejoint l'équipe ${equipeC} !`, htmlProm);
              if (okProm) { state.stats.sent++; addLog(`✅ Notif promettant ${promettant.prenom} → équipe ${equipeC}`, 'ok'); }
              await sleep(OHME_DELAY_MS);
            }
            addLog(`✅ ${promettants.length} promettant(s) notifié(s) pour équipe ${equipeC}`, 'ok');
            addEvent('🏅', `Promettants notifiés`, `${coureur} → équipe ${equipeC}`, 'don');
          }
        }

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
  res.json({ isRunning: state.isRunning, stats: state.stats, lastPoll: state.lastPoll, nextPoll: state.nextPoll, pollInterval: CONFIG.pollInterval, processedCount: state.processedIds.size, redisOk: !!(CONFIG.upstashUrl && CONFIG.upstashToken) && !state.redisBlocked,
    redisBlocked: state.redisBlocked, version: SERVER_VERSION });
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
    promesse_coureur_equipe: { subject: '🧪 Test — 🏅 Promesse coureur → Référent équipe !',    html: tplPromesseCoureurPourEquipe({ chefPrenom: 'Sophie', chefNom: 'Dupont', nomEquipe: 'Les Gazelles', donateur: 'Marc Leroy', montantParKm: '5', email_donateur: 'marc@test.fr', coureurPrenom: 'Pierre', coureurNom: 'Martin', nbPromessesEquipe: 3, totalKmParEquipe: 12 }) },
    promesse_equipe:       { subject: '🧪 Test — 🏅 Promesse de don pour votre équipe !',          html: tplPromesseEquipe({ chefPrenom: 'Sophie', chefNom: 'Dupont', nomEquipe: 'Les Gazelles Solidaires', donateur: 'Marc Leroy', montantParKm: '3', email_donateur: 'marc.leroy@test.fr', motEncouragement: 'Toute l\'équipe est incroyable !', nbPromessesEquipe: 5, totalKmParEquipe: 18 }) },
    merci_prometteur_coureur: { subject: '🧪 Test — 🙏 Merci pour votre promesse de don !',       html: tplMerciPrometteurCoureur({ prenomDonateur: 'Jean-Claude', montantParKm: '5', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil' }) },
    merci_prometteur_equipe:  { subject: '🧪 Test — 🙏 Merci pour votre promesse d\'équipe !',    html: tplMerciPrometteurEquipe({ prenomDonateur: 'Marc', montantParKm: '3', nomEquipe: 'Les Gazelles Solidaires' }) },
    // ── INSCRIPTIONS
    inscription_asso:      { subject: '🧪 Test — 🏃 Nouveau coureur pour votre cause !',           html: tplInscriptionAsso({ nomAsso: 'Espoir Enfants', coureur: 'Lucas Moreau', email_coureur: 'l.moreau@test.fr', ville: 'Angers', prenomReferent: 'Sophie' }) },
    inscription_coureur:   { subject: '🧪 Test — 🚀 Bienvenue coureur Défi Enfance !',             html: tplInscriptionCoureur({ prenom: 'Lucas', nomComplet: 'Lucas Moreau', nomAsso: 'Espoir Enfants' }) },
    inscription_supporter: { subject: '🧪 Test — 🚀 Bienvenue supporter Défi Enfance !',           html: tplInscriptionSupporter({ prenom: 'Marie' }) },
    dejeuner:              { subject: '🧪 Test — 🥗 Confirmation panier repas Défi Enfance !',      html: tplDejeuner({ prenom: 'Sophie' }) },
    nouveau_coureur_equipe: { subject: '🧪 Test — 🏅 Nouveau coureur dans votre équipe !',       html: tplNouveauCoureurEquipe({ prenomPrometteur: 'Jean-Claude', nomEquipe: 'Les Gazelles Solidaires', montantParKm: 5, nbCoureurs: 6, donEstime: 300, donPrecedent: 250, augmentation: 50 }) },
    billets_en_gros:       { subject: '🧪 Test — 🎉 Merci pour votre règlement groupé !',          html: tplBilletsEnGros({ prenomRef: 'Sophie', nomStructure: 'Entreprise XYZ', nomEquipe: 'Les Gazelles Solidaires', montant: '500', date: '22/05/2026' }) },
    // ── MERCI DONATEURS
    merci_donateur:        { subject: '🧪 Test — ❤️ Merci pour votre don à Pierre !',              html: tplMerciDonateur({ prenomDonateur: 'Jean-Claude', montant: '50', donateur: 'Jean-Claude Martin', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil' }) },
    merci_donateur_equipe: { subject: '🧪 Test — ❤️ Merci pour votre don à l\'équipe !',          html: tplMerciDonateurEquipe({ prenomDonateur: 'Jean-Claude', montant: '100', donateur: 'Jean-Claude Martin', nomEquipe: 'Les Gazelles Solidaires' }) },
    merci_donateur_global: { subject: '🧪 Test — ❤️ Merci pour votre don !',                      html: tplMerciDonateurGlobal({ prenomDonateur: 'Jean-Claude', montant: '30' }) },
    merci_donateur_fidele:    { subject: '🧪 Test — 🏅 Super Badge Donateur (2ème don) !',          html: tplMerciDonateurFidele({ prenomDonateur: 'Jean-Claude', montant: '50', historiqueHtml: '' }) },
    merci_ambassadeur:        { subject: '🧪 Test — 🎖️ Merci Ambassadeur du Défi Enfance !',        html: tplMerciDonateurAmbassadeur({ prenomDonateur: 'Jean-Claude', montant: '50', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil', historiqueHtml: '' }) },
    merci_structure:       { subject: '🧪 Test — ❤️ Merci pour le don de votre entreprise !',     html: tplMerciDonateurStructure({ prenomDonateur: 'Sophie', montant: '200', nomStructure: 'Entreprise XYZ', coureurPrenom: 'Pierre', coureurNom: 'Martin', association: 'Les Enfants du Soleil' }) },
    // ── ENVOIS GROUPÉS — renvoie le vrai template si disponible, sinon placeholder
    groupe_angers_j10_coureurs:  { subject: '🧪 Test — 🎽 J-8 Angers Coureurs',        html: tplGroupeJ10Angers({ prenom: 'Sophie' }) },
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
          const htmlCoureur = tplInscriptionCoureur({ prenom: prenomC || coureur, nomComplet: coureur, nomAsso });
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
    const infosPromesse = await fetchInfosDonateur(paiement);
    const prenomPrometteur = infosPromesse.prenomMerci || donateur.split(' ')[0];
    if (coureurParraine) {
      const contact = await fetchOhmeContactByName(coureurParraine);
      const emailC  = contact?.email || '';
      if (emailC) {
        const html = tplPromesseCoureur({ coureurPrenom: coureurParraine.split(' ')[0], donateur, montantParKm: montantKm, email_donateur: emailDon, nbPromessesCoureur: 0, totalKmParCoureur: 0, nbPromessesEquipe: 0, totalKmParEquipe: 0 });
        ok = await sendBrevo(emailC, `🏅 Promesse de don pour ton Défi Enfance !`, html);
        if (ok) { state.stats.sent++; addLog(`✅ Promesse validée → coureur ${coureurParraine}`, 'ok'); }
        const htmlMerci = tplMerciPrometteurCoureur({ prenomDonateur: prenomPrometteur, montantParKm: montantKm, coureurPrenom: coureurParraine.split(' ')[0], coureurNom: coureurParraine.split(' ').slice(1).join(' ') });
        const okMerci = await sendBrevo(emailDon, `🙏 Merci pour votre promesse de don au coureur ${coureurParraine.split(' ')[0]} !`, htmlMerci);
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
    const infosValider = await fetchInfosDonateur(paiement);
    const prenomMerciValider = infosValider.prenomMerci || donateur.split(' ')[0];
    const contact = await fetchOhmeContactByName(coureurParraine);
    const emailC  = contact?.email || '';
    if (emailC) {
      const html = tplDonCoureur({ coureurPrenom: coureurParraine.split(' ')[0], donateur, montant, email_donateur: emailDon, association: (cf.asso_soutenue || '') });
      ok = await sendBrevo(emailC, '❤️ Nouveau don pour ton Défi Enfance !', html);
      if (ok) { state.stats.sent++; addLog(`✅ Don validé → ${coureurParraine}`, 'ok'); sendMerciDonateur({ email: emailDon, prenom: prenomMerciValider, montant, donateur, isStructure: infosValider.isStructure, nomStructure: infosValider.nomStructure }); }
      const equipe = await fetchEquipeCoureur(contact?.id);
      if (equipe) { const s = await fetchOhmeStructureByName(equipe); if (s?.email_referent_defi_enfance) { const htmlE = tplDonEquipe({ chefPrenom: s.prenom_du_referent_defi_enfance || 'Bonjour', chefNom: s.nom_du_referent_defi_enfance || '', nomEquipe: equipe, donateur, montant, email_donateur: emailDon, coureurPrenom: coureurParraine.split(' ')[0], coureurNom: coureurParraine.split(' ').slice(1).join(' ') }); const okE = await sendBrevo(s.email_referent_defi_enfance, `❤️ Don de ${donateur} pour ${coureurParraine.split(' ')[0]} — équipe ${equipe} !`, htmlE); if (okE) { state.stats.sent++; } } }
    } else { return res.json({ success: false, error: `Coureur "${coureurParraine}" introuvable` }); }

  } else if (equipeParraine) {
    const infosValider = await fetchInfosDonateur(paiement);
    const prenomMerciValider = infosValider.prenomMerci || donateur.split(' ')[0];
    const s = await fetchOhmeStructureByName(equipeParraine);
    if (s?.email_referent_defi_enfance) {
      const html = tplDonEquipe({ chefPrenom: s.prenom_du_referent_defi_enfance || 'Bonjour', chefNom: s.nom_du_referent_defi_enfance || '', nomEquipe: equipeParraine, donateur, montant, email_donateur: emailDon });
      ok = await sendBrevo(s.email_referent_defi_enfance, `❤️ Don pour votre équipe de ${donateur.split(' ')[0]} !`, html);
      if (ok) { state.stats.sent++; sendMerciDonateur({ email: emailDon, prenom: prenomMerciValider, montant, donateur, isStructure: infosValider.isStructure, nomStructure: infosValider.nomStructure }); addLog(`✅ Don validé → équipe ${equipeParraine}`, 'ok'); }
    } else { return res.json({ success: false, error: `Équipe "${equipeParraine}" introuvable` }); }
  } else {
    const s = await fetchOhmeStructureByName('Défi Enfance');
    if (s?.email_referent_defi_enfance) {
      const html = tplDonEquipe({ chefPrenom: s.prenom_du_referent_defi_enfance || 'Bonjour', chefNom: s.nom_du_referent_defi_enfance || '', nomEquipe: 'Défi Enfance', donateur, montant, email_donateur: emailDon });
      ok = await sendBrevo(s.email_referent_defi_enfance, '❤️ Don non fléché — Défi Enfance !', html);
      if (ok) {
        state.stats.sent++;
        const infosValider = await fetchInfosDonateur(paiement);
        sendMerciDonateur({ email: emailDon, prenom: infosValider.prenomMerci || donateur.split(' ')[0], montant, donateur, isStructure: infosValider.isStructure, nomStructure: infosValider.nomStructure });
        addLog(`✅ Don non fléché → Défi Enfance`, 'ok');
      }
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




// ══════════════════════════════════════════════════════
//  TRAÇAGE CAMPAGNES — Redis
// ══════════════════════════════════════════════════════
async function getContactsDejaEnvoyes(campagneId) {
  try {
    const raw = await redisGet(`defi_enfance_campagne_${campagneId}`);
    if (raw) return new Set(JSON.parse(raw));
  } catch(e) {}
  return new Set();
}

async function saveContactsEnvoyes(campagneId, contactIds) {
  try {
    const existing = await getContactsDejaEnvoyes(campagneId);
    contactIds.forEach(id => existing.add(String(id)));
    await redisSet(`defi_enfance_campagne_${campagneId}`, JSON.stringify([...existing]));
  } catch(e) {
    addLog(`⚠️ Impossible de sauvegarder les contacts envoyés pour ${campagneId}`, 'warn');
  }
}

// ══════════════════════════════════════════════════════
//  ENVOIS GROUPÉS — CONFIGURATION DES CAMPAGNES
// ══════════════════════════════════════════════════════

// Délai entre chaque email pour 800 emails en 30 min = 2250ms
const ENVOI_GROUPE_DELAY_MS = 3000;
const EMAIL_TEST_VICTOR = 'v.vieilfault@unionpourlenfance.com';


// Définition de toutes les campagnes disponibles
const CAMPAGNES = {
  // ── ANGERS
  'angers_j10_coureurs': {
    label: 'J-10 Angers — Coureurs (infos pratiques)',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🎽 Dans 8 jours, on court pour l\'enfance à Angers — tout ce qu\'il faut savoir !',
    template: (prenom, nbJours) => tplGroupeJ10Angers({ prenom, nbJours }),
  },
  'angers_j1_supporters': {
    label: 'J-1 Angers — Supporters',
    event: 'Défi Enfance #Supporters #Angers2026',
    destinataires: ['supporter'],
    sujet: '🎽 Dans 1 jour, soutenez les coureurs du Défi Enfance à Angers !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-1 Supporters Angers' }),
  },
  'angers_j4_coureurs': {
    label: 'J-4 Angers — Coureurs (go dons + promesses)',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🚀 C\'est le moment de faire décoller ta collecte !',
    template: (prenom, nbJours, extra) => tplGroupeJ4Angers({ prenom, nbJours, nomAsso: extra?.nomAsso, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur, urlPageEquipe: extra?.urlPageEquipe, nomEquipe: extra?.nomEquipe }),
    personnalise: true,
  },
  'angers_j4_supporters': {
    label: 'J-4 Angers — Supporters',
    event: 'Défi Enfance #Supporters #Angers2026',
    destinataires: ['supporter'],
    sujet: '🏃 Plus que 4 jours — soutenez le Défi Enfance Angers !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-4 Supporters Angers' }),
  },
  'angers_j1_coureurs': {
    label: 'J-1 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🌟 Demain, c\'est le jour J — Défi Enfance Angers !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-1 Coureurs Angers' }),
  },
  'angers_jourj_coureurs': {
    label: 'Jour J Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🏁 C\'est aujourd\'hui ! Défi Enfance Angers — on vous attend !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'Jour J Coureurs Angers' }),
  },
  'angers_jp1_coureurs': {
    label: 'J+1 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '🙏 Merci pour votre engagement — Défi Enfance Angers !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J+1 Coureurs Angers' }),
  },
  'angers_jp10_coureurs': {
    label: 'J+10 Angers — Coureurs',
    event: 'Défi Enfance #Course #Angers2026',
    destinataires: ['coureur'],
    sujet: '💌 10 jours après le Défi Enfance Angers…',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J+10 Coureurs Angers' }),
  },
  // ── JOUÉ-LÈS-TOURS
  'joue_j10_coureurs': {
    label: 'J-10 Joué — Coureurs (infos pratiques)',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🎽 Dans 9 jours, on court pour l\'enfance à Joué-lès-Tours !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-10 Coureurs Joué' }),
  },
  'joue_j1_supporters': {
    label: 'J-1 Joué — Supporters',
    event: 'Défi Enfance #Supporters #Joué-lès-Tours2026',
    destinataires: ['supporter'],
    sujet: '🎽 Dans 1 jour, soutenez les coureurs du Défi Enfance à Joué !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-1 Supporters Joué' }),
  },
  'joue_j4_coureurs': {
    label: 'J-4 Joué — Coureurs (go dons + promesses)',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🏃 Plus que 4 jours — Défi Enfance Joué-lès-Tours !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-4 Coureurs Joué' }),
  },
  'joue_j4_supporters': {
    label: 'J-4 Joué — Supporters',
    event: 'Défi Enfance #Supporters #Joué-lès-Tours2026',
    destinataires: ['supporter'],
    sujet: '🏃 Plus que 4 jours — soutenez le Défi Enfance Joué !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-4 Supporters Joué' }),
  },
  'joue_j1_coureurs': {
    label: 'J-1 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🌟 Demain, c\'est le jour J — Défi Enfance Joué !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J-1 Coureurs Joué' }),
  },
  'joue_jourj_coureurs': {
    label: 'Jour J Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🏁 C\'est aujourd\'hui ! Défi Enfance Joué — on vous attend !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'Jour J Coureurs Joué' }),
  },
  'joue_jp1_coureurs': {
    label: 'J+1 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '🙏 Merci pour votre engagement — Défi Enfance Joué !',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J+1 Coureurs Joué' }),
  },
  'joue_jp10_coureurs': {
    label: 'J+10 Joué — Coureurs',
    event: 'Défi Enfance #Course #Joué-lès-Tours2026',
    destinataires: ['coureur'],
    sujet: '💌 10 jours après le Défi Enfance Joué…',
    template: (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'J+10 Coureurs Joué' }),
  },
};

// ── État des envois groupés
const envoiGroupe = {
  running:    false,
  campagneId: null,
  label:      '',
  nbJours:    null,
  suspended:  false,
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
async function fetchParticipantsEvenement(nomEvent, typesDestinaires, depuisUtc = null) {
  // typesDestinaires = ['coureur'] ou ['supporter'] ou ['coureur','supporter']
  // depuisUtc = date ISO UTC optionnelle — filtre les inscrits après cette date
  const dateFiltre = depuisUtc ? new Date(depuisUtc) : null;
  if (dateFiltre) envoiGroupeLog(`🗓️ Filtre "depuis" : ${depuisUtc} (UTC)`, 'info');

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

        // Filtre date "depuis" — utilise created_at ou date du paiement
        if (dateFiltre) {
          const datePaiement = new Date(p.created_at || p.date || 0);
          if (datePaiement <= dateFiltre) continue;
        }

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

        const cfP = p.custom_fields || p;
        participants.push({
          prenom:       prenom || 'Participant',
          nom,
          email,
          contactId:    contact.id,
          type:         typeP,
          datePaiement: p.created_at || p.date,
          nomAsso:      (cfP.asso_soutenue || '').trim(),
          nomEquipe:    (cfP.equipe        || '').trim(),
          eventName:    (p.nom_de_levent || cfP.nom_de_levent || nomEvent).trim(),
        });
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



// ── Registre des templates pour les envois groupés libres
const TEMPLATES_SUJETS = {
  'groupe_j4_angers_coureurs':    '🚀 C\'est le moment de faire décoller ta collecte !',
  'groupe_j10_angers_coureurs':   '🎽 Dans 8 jours, on court pour l\'enfance à Angers — tout ce qu\'il faut savoir !',
  'groupe_j2_referents_angers':   '🏃 J-2 spécial référents d\'équipe : Boostons nos collectes de dons !',
  'groupe_j10_joue_coureurs':      '🎽 Dans 10 jours, on court pour l\'enfance à Joué-lès-Tours — tout ce qu\'il faut savoir !',
  'groupe_j1_angers_coureurs':    '🎽 ${prenom}, demain c\'est le jour J 🎽',
  'inscription_coureur':          'Heureux de votre inscription au Défi Enfance !',
  'inscription_supporter':        'Heureux de votre inscription au Défi Enfance !',
  'inscription_asso':             '🏃 Nouveau coureur — Défi Enfance !',
  'merci_donateur':               '❤️ Merci pour votre don !',
  'merci_donateur_equipe':        '❤️ Merci pour votre don !',
  'merci_donateur_global':        '❤️ Merci pour votre don au Défi Enfance !',
  'nouveau_coureur_equipe':       '🏅 Votre promesse de don vient de grandir !',
  'placeholder':                  '📢 Défi Enfance — Information importante',
};

function getTemplateFunction(templateId) {
  const map = {
    'groupe_j4_angers_coureurs':  (prenom, nbJours, extra) => tplGroupeJ4Angers({ prenom, nbJours, ...extra }),
    'groupe_j10_angers_coureurs': (prenom, nbJours, extra) => tplGroupeJ10Angers({ prenom, nbJours, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_j2_referents_angers':  (prenom, nbJours, extra) => tplGroupeJ2Referents({ prenom, urlPromesseEquipe: extra?.urlPromesseEquipe, urlPageEquipe: extra?.urlPageEquipe }),
    'groupe_j10_joue_coureurs':    (prenom, nbJours, extra) => tplGroupeJ10Joue({ prenom, nbJours, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_j1_angers_coureurs':  (prenom, nbJours, extra) => tplGroupeJ1Angers({ prenom, numeroDossard: extra?.numeroDossard, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'inscription_coureur':        (prenom, _, extra) => tplInscriptionCoureur({ prenom, nomComplet: prenom, nomAsso: extra?.nomAsso }),
    'inscription_supporter':      (prenom) => tplInscriptionSupporter({ prenom }),
    'inscription_asso':           (prenom, _, extra) => tplInscriptionAsso({ nomAsso: extra?.nomAsso || '', coureur: prenom, email_coureur: '', ville: '', prenomReferent: prenom }),
    'merci_donateur':             (prenom) => tplMerciDonateurGlobal({ prenomDonateur: prenom, montant: '?', historiqueHtml: '' }),
    'merci_donateur_equipe':      (prenom, _, extra) => tplMerciDonateurEquipe({ prenomDonateur: prenom, montant: '?', donateur: prenom, nomEquipe: extra?.nomEquipe || '', historiqueHtml: '' }),
    'nouveau_coureur_equipe':     (prenom, _, extra) => tplNouveauCoureurEquipe({ prenomPrometteur: prenom, nomEquipe: extra?.nomEquipe || '', montantParKm: '?', nbCoureurs: 1, donEstime: 0, donPrecedent: 0, augmentation: 0 }),
    'placeholder':                (prenom, nbJours) => tplGroupePlaceholder({ prenom, nbJours, nomTemplate: 'Envoi groupé' }),
  };
  return map[templateId] || null;
}

// ══════════════════════════════════════════════════════
//  FETCH DESTINATAIRES — envois groupés refondés
// ══════════════════════════════════════════════════════

const EVENTS_MAP = {
  'angers_coureurs':   ['Défi Enfance #Course #Angers2026'],
  'joue_coureurs':     ['Défi Enfance #Course #Joué-lès-Tours2026'],
  'global_coureurs':   ['Défi Enfance #Course #Angers2026', 'Défi Enfance #Course #Joué-lès-Tours2026'],
  'angers_supporters': ['Défi Enfance #Supporters #Angers2026'],
  'joue_supporters':   ['Défi Enfance #Supporters #Joué-lès-Tours2026'],
  'global_supporters': ['Défi Enfance #Supporters #Angers2026', 'Défi Enfance #Supporters #Joué-lès-Tours2026'],
  'dejeuner':          ['Défi Enfance #Déjeuner #Angers2026'],
};

// Convertir heure française → UTC ISO string
function heuresFranceVersUTC(dateTimeLocal) {
  if (!dateTimeLocal) return null;
  // dateTimeLocal = "2026-05-13T23:25" (heure France)
  // France été = UTC+2 → soustraire 2h
  const d = new Date(dateTimeLocal);
  if (isNaN(d.getTime())) return null;
  const utc = new Date(d.getTime() - 2 * 60 * 60 * 1000);
  return utc.toISOString();
}

async function fetchDestinataires({ typeDestinataire, filtreEquipe, depuisFrance, nbJours }) {
  // typeDestinataire : 'angers_coureurs' | 'joue_coureurs' | 'global_coureurs' |
  //                   'angers_supporters' | 'joue_supporters' | 'global_supporters' |
  //                   'dejeuner' | 'referents_equipe' | 'assos_soutenues' | 'donateurs'

  const depuisUtc = heuresFranceVersUTC(depuisFrance);
  const dateFiltre = depuisUtc ? new Date(depuisUtc) : null;

  const destinataires = [];
  const emailsVus = new Set();

  try {

    // ── CAS 1 : Coureurs / Supporters / Déjeuner (paiements billetterie type 3)
    if (['angers_coureurs','joue_coureurs','global_coureurs',
         'angers_supporters','joue_supporters','global_supporters','dejeuner'].includes(typeDestinataire)) {

      const eventsAttendus = EVENTS_MAP[typeDestinataire] || [];
      let cursor = null;

      while (true) {
        await sleep(OHME_DELAY_MS);
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01`;

        const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!res.ok) { addLog(`⚠️ Ohme HTTP ${res.status} (fetchDestinataires billetterie)`, 'warn'); break; }
        const json = await res.json();
        const items = json.data || [];

        for (const p of items) {
          const cf = p.custom_fields || p;
          const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').trim();

          // Filtre event
          if (!eventsAttendus.some(e => eventNom.toLowerCase().includes(e.toLowerCase().replace('défi enfance ', '')))) continue;

          // Filtre date
          if (dateFiltre) {
            const datePmt = new Date(p.created_at || p.date || 0);
            if (datePmt <= dateFiltre) continue;
          }

          // Filtre équipe
          if (filtreEquipe) {
            const equipeP = (cf.equipe || '').toLowerCase();
            if (!equipeP.includes(filtreEquipe.toLowerCase())) continue;
          }

          // Filtre qualité
          const qualite = (cf.qualite_du_participant || '').toLowerCase().trim();
          if (qualite === 'don attendu' || qualite === 'exclu') continue;

          if (!p.contact_id) continue;
          await sleep(300);
          const contact = await fetchOhmeContactById(p.contact_id);
          if (!contact || !contact.email) continue;
          if (emailsVus.has(contact.email)) continue;
          emailsVus.add(contact.email);

          const prenom = contact.firstname || contact.first_name || '';
          const nom    = contact.lastname  || contact.last_name  || '';
          const cfContact = contact.custom_fields || contact;
          const isAngers = eventNom.toUpperCase().includes('ANGERS');
          const numeroDossard = isAngers
            ? (cfContact.numero_dossard_angers_2026 || contact.numero_dossard_angers_2026 || '')
            : (cfContact.numero_de_dossard_joue2026 || contact.numero_de_dossard_joue2026 || '');
          destinataires.push({
            prenom:        prenom || 'Participant',
            nom,
            email:         contact.email,
            contactId:     contact.id,
            nomAsso:       (cf.asso_soutenue || '').trim(),
            nomEquipe:     (cf.equipe || '').trim(),
            eventName:     eventNom,
            datePaiement:  p.created_at || p.date,
            numeroDossard: String(numeroDossard || ''),
          });
        }

        if (items.length < 250) break;
        cursor = json.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
        if (!cursor) break;
        addLog(`📦 Pagination destinataires : ${destinataires.length} trouvés…`, 'info');
      }
    }

    // ── CAS 2 : Référents d'équipe (global, Angers, ou Joué)
    else if (['referents_equipe','referents_equipe_angers','referents_equipe_joue'].includes(typeDestinataire)) {

      // Déterminer le filtre event selon le type
      const eventFiltreRef = typeDestinataire === 'referents_equipe_angers'
        ? 'angers2026'
        : typeDestinataire === 'referents_equipe_joue'
          ? 'joué'
          : null; // global = tous

      // Récupérer les paiements billetterie pour trouver les équipes actives
      const equipesActives = new Set(); // nomEquipe → Set
      let cursor = null;
      while (true) {
        await sleep(OHME_DELAY_MS);
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!res.ok) { addLog(`⚠️ Ohme HTTP ${res.status} (référents)`, 'warn'); break; }
        const json = await res.json();
        const items = json.data || [];
        for (const p of items) {
          const cf = p.custom_fields || p;
          const equipe = (cf.equipe || '').trim();
          if (!equipe) continue;
          const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').toLowerCase();
          // Filtre par ville si nécessaire
          if (eventFiltreRef && !eventNom.includes(eventFiltreRef)) continue;
          equipesActives.add(equipe);
        }
        if (items.length < 250) break;
        cursor = json.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
        if (!cursor) break;
      }

      addLog(`📦 ${equipesActives.size} équipe(s) active(s) trouvée(s)`, 'info');

      // Filtrer par équipe si renseigné
      const equipesFiltrees = filtreEquipe
        ? [...equipesActives].filter(e => e.toLowerCase().includes(filtreEquipe.toLowerCase()))
        : [...equipesActives];

      // Récupérer les structures correspondantes
      for (const nomEquipe of equipesFiltrees) {
        await sleep(OHME_DELAY_MS);
        const structure = await fetchOhmeStructureByName(nomEquipe);
        if (!structure) continue;
        const cf = structure.custom_fields || structure;
        const email = cf.email_referent_defi_enfance || structure.email_referent_defi_enfance || '';
        const prenom = cf.prenom_du_referent_defi_enfance || structure.prenom_du_referent_defi_enfance || '';
        const nom    = cf.nom_du_referent_defi_enfance   || structure.nom_du_referent_defi_enfance   || '';
        if (!email || emailsVus.has(email)) continue;
        emailsVus.add(email);
        destinataires.push({ prenom: prenom || nomEquipe, nom, email, contactId: `struct_${structure.id}`, nomEquipe, nomAsso: '', eventName: typeDestinataire.includes('joue') ? 'Défi Enfance #Course #Joué-lès-Tours2026' : 'Défi Enfance #Course #Angers2026', datePaiement: null });
      }
    }

    // ── CAS 2bis : Coureurs solo (sans équipe)
    else if (['coureurs_solo_angers','coureurs_solo_joue','coureurs_solo_global'].includes(typeDestinataire)) {

      const eventsAttendus = typeDestinataire === 'coureurs_solo_angers'
        ? ['Défi Enfance #Course #Angers2026']
        : typeDestinataire === 'coureurs_solo_joue'
          ? ['Défi Enfance #Course #Joué-lès-Tours2026']
          : ['Défi Enfance #Course #Angers2026', 'Défi Enfance #Course #Joué-lès-Tours2026'];

      let cursor = null;
      while (true) {
        await sleep(OHME_DELAY_MS);
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!res.ok) { addLog(`⚠️ Ohme HTTP ${res.status} (coureurs solo)`, 'warn'); break; }
        const json = await res.json();
        const items = json.data || [];

        for (const p of items) {
          const cf = p.custom_fields || p;
          const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').trim();
          const equipe   = (cf.equipe || '').trim();

          // Filtre event
          if (!eventsAttendus.some(e => eventNom.toLowerCase().includes(e.toLowerCase().replace('défi enfance ', '')))) continue;

          // Solo = pas d'équipe renseignée
          if (equipe) continue;

          // Filtre date
          if (dateFiltre) {
            const datePmt = new Date(p.created_at || p.date || 0);
            if (datePmt <= dateFiltre) continue;
          }

          const qualite = (cf.qualite_du_participant || '').toLowerCase().trim();
          if (qualite === 'don attendu' || qualite === 'exclu') continue;

          if (!p.contact_id) continue;
          await sleep(300);
          const contact = await fetchOhmeContactById(p.contact_id);
          if (!contact || !contact.email || emailsVus.has(contact.email)) continue;
          emailsVus.add(contact.email);

          const prenom = contact.firstname || contact.first_name || '';
          const nom    = contact.lastname  || contact.last_name  || '';
          const cfContact = contact.custom_fields || contact;
          const isAngers = eventNom.toUpperCase().includes('ANGERS');
          const numeroDossard = isAngers
            ? (cfContact.numero_dossard_angers_2026 || contact.numero_dossard_angers_2026 || '')
            : (cfContact.numero_de_dossard_joue2026 || contact.numero_de_dossard_joue2026 || '');

          destinataires.push({
            prenom: prenom || 'Participant', nom, email: contact.email,
            contactId: contact.id, nomAsso: (cf.asso_soutenue || '').trim(),
            nomEquipe: '', eventName: eventNom,
            datePaiement: p.created_at || p.date, numeroDossard: String(numeroDossard || ''),
          });
        }

        if (items.length < 250) break;
        cursor = json.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
        if (!cursor) break;
        addLog(`📦 Pagination coureurs solo : ${destinataires.length} trouvés…`, 'info');
      }
    }

    // ── CAS 3 : Assos soutenues
    else if (typeDestinataire === 'assos_soutenues') {
      const assosActives = new Set();
      await sleep(OHME_DELAY_MS);
      const res = await fetch(`${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01`, {
        headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
      });
      if (res.ok) {
        const json = await res.json();
        for (const p of (json.data || [])) {
          const cf = p.custom_fields || p;
          const asso = (cf.asso_soutenue || '').trim();
          if (asso) assosActives.add(asso);
        }
      }

      for (const nomAsso of assosActives) {
        await sleep(OHME_DELAY_MS);
        const structure = await fetchOhmeStructureByName(nomAsso);
        if (!structure) continue;
        const cf = structure.custom_fields || structure;
        const email = cf.email_referent_defi_enfance || structure.email_referent_defi_enfance || '';
        const prenom = cf.prenom_du_referent_defi_enfance || structure.prenom_du_referent_defi_enfance || '';
        const nom    = cf.nom_du_referent_defi_enfance   || structure.nom_du_referent_defi_enfance   || '';
        if (!email || emailsVus.has(email)) continue;
        emailsVus.add(email);
        destinataires.push({ prenom: prenom || nomAsso, nom, email, contactId: `struct_${structure.id}`, nomAsso, nomEquipe: '', eventName: '', datePaiement: null });
      }
    }

    // ── CAS 4 : Donateurs
    else if (typeDestinataire === 'donateurs') {
      let cursor = null;
      while (true) {
        await sleep(OHME_DELAY_MS);
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=1&since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=1&since_date=2026-01-01`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!res.ok) { addLog(`⚠️ Ohme HTTP ${res.status} (fetchDestinataires donateurs)`, 'warn'); break; }
        const json = await res.json();
        const items = json.data || [];
        for (const p of items) {
          if (dateFiltre) {
            const datePmt = new Date(p.created_at || p.date || 0);
            if (datePmt <= dateFiltre) continue;
          }
          if (!p.contact_id) continue;
          await sleep(300);
          const contact = await fetchOhmeContactById(p.contact_id);
          if (!contact || !contact.email || emailsVus.has(contact.email)) continue;
          emailsVus.add(contact.email);
          const prenom = contact.firstname || contact.first_name || '';
          const nom    = contact.lastname  || contact.last_name  || '';
          destinataires.push({ prenom: prenom || 'Donateur', nom, email: contact.email, contactId: contact.id, nomAsso: '', nomEquipe: '', eventName: '', datePaiement: p.date });
        }
        if (items.length < 250) break;
        cursor = json.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
        if (!cursor) break;
      }
    }

  } catch(e) {
    addLog(`⚠️ fetchDestinataires erreur : ${e.message}`, 'warn');
  }

  return destinataires;
}

// ══════════════════════════════════════════════════════
//  GESTION DES DOUBLONS — ENVOIS GROUPÉS
// ══════════════════════════════════════════════════════

// ── Détecter les doublons dans une liste de participants
// Retourne { uniques: [...], doublons: [{email, participants: [...], isReferent, nomEquipe}] }
async function detecterDoublons(participants) {
  const parEmail = {};
  for (const p of participants) {
    if (!parEmail[p.email]) parEmail[p.email] = [];
    parEmail[p.email].push(p);
  }

  const uniques   = [];
  const doublons  = [];

  for (const [email, groupe] of Object.entries(parEmail)) {
    if (groupe.length === 1) {
      uniques.push(groupe[0]);
    } else {
      // Vérifier si cet email est celui d'un référent d'équipe
      // Stratégie simple : comparer avec les emails déjà chargés dans le groupe
      let isReferent = false;
      let nomEquipe  = '';
      // Pas d'appel API Ohme pour éviter les erreurs 500
      // On marque comme référent si tous les participants du groupe ont la même équipe
      const equipesGroupe = [...new Set(groupe.map(p => p.nomEquipe).filter(Boolean))];
      if (equipesGroupe.length === 1) {
        nomEquipe  = equipesGroupe[0];
        // On considère que c'est potentiellement un référent si une seule équipe
        // L'utilisateur verra le nom de l'équipe et pourra décider
        isReferent = false; // Laisser l'utilisateur choisir dans tous les cas
      }

      doublons.push({ email, participants: groupe, isReferent, nomEquipe });
    }
  }

  return { uniques, doublons };
}

// État des doublons en attente de validation
const doublonsEnAttente = {
  campagneId:   null,
  depuisUtc:    null,
  nbJours:      null,
  uniques:      [],
  doublons:     [],
  choix:        {}, // email → contactId choisi
  ts:           null,
};

async function lancerEnvoiGroupe(campagneId, depuisUtc = null, nbJours = null) {
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

      const tous = await fetchParticipantsEvenement(campagne.event, campagne.destinataires, depuisUtc);
      if (depuisUtc) envoiGroupeLog(`🗓️ Filtre actif : inscrits depuis ${depuisUtc} uniquement`, 'info');

      // Exclure les contacts déjà envoyés (traçage Redis)
      const dejaEnvoyes = await getContactsDejaEnvoyes(campagneId);
      const filtres = tous.filter(p => !dejaEnvoyes.has(String(p.contactId)));
      envoiGroupe.skipped = tous.length - filtres.length;

      envoiGroupeLog(`✅ ${tous.length} participant(s) trouvé(s) — ${filtres.length} à envoyer (${envoiGroupe.skipped} déjà envoyés)`, 'ok');

      if (filtres.length === 0) {
        envoiGroupeLog('⚠️ Tous les participants ont déjà reçu cet email — envoi annulé', 'warn');
        return;
      }

      // Détecter les doublons d'email
      envoiGroupeLog('🔍 Détection des doublons en cours…', 'info');
      const { uniques, doublons } = await detecterDoublons(filtres);

      if (doublons.length > 0) {
        envoiGroupeLog(`⚠️ ${doublons.length} doublon(s) détecté(s) — validation requise avant envoi`, 'warn');
        doublonsEnAttente.campagneId = campagneId;
        doublonsEnAttente.depuisUtc  = depuisUtc;
        doublonsEnAttente.nbJours    = nbJours;
        doublonsEnAttente.uniques    = uniques;
        doublonsEnAttente.doublons   = doublons;
        doublonsEnAttente.choix      = {};
        doublonsEnAttente.ts         = new Date().toISOString();
        envoiGroupe.running    = false;
        envoiGroupe.finishedAt = new Date().toISOString();
        envoiGroupe.suspended  = true;
        envoiGroupe.label      = campagne.label;
        addEvent('⚠️', `Doublons détectés`, `${doublons.length} doublon(s) — validation requise`, 'bill');
        addLog(`⚠️ Envoi suspendu — ${doublons.length} doublon(s) à valider dans le dashboard`, 'warn');
        return;
      }

      envoiGroupe.suspended = false;
      const participants = uniques;
      envoiGroupe.total = participants.length;

      // Calcul du délai pour tenir dans 30 min
      const delaiMs = ENVOI_GROUPE_DELAY_MS; // 3 secondes fixes entre chaque email
      const dureeMin = Math.ceil((participants.length * delaiMs) / 60000);
      envoiGroupeLog(`⏱️ Délai entre envois : ${delaiMs}ms — durée estimée : ~${dureeMin} min`, 'info');

      const contactsEnvoyesCetteFois = [];

      for (const p of participants) {
        envoiGroupe.done++;
        try {
          // Pour les templates personnalisés, calculer les URLs du coureur
          let extraData = null;
          if (campagne.personnalise) {
            const urlPageCoureur     = await buildUrlPageCoureur(p.contactId, p.eventName || campagne.event);
            const urlPromesseCoureur = await buildUrlPromesseCoureur(p.contactId, p.eventName || campagne.event);
            const urlPageEquipe      = p.nomEquipe ? await buildUrlPageEquipe(null, p.nomEquipe, p.eventName || campagne.event) : null;
            extraData = { nomAsso: p.nomAsso, nomEquipe: p.nomEquipe, urlPageCoureur, urlPromesseCoureur, urlPageEquipe };
          }
          const html = campagne.template(p.prenom, nbJours, extraData);
          const sujetFinal = nbJours ? campagne.sujet.replace(/\d+ jours?/gi, `${nbJours} jours`) : campagne.sujet;
          const ok = await sendBrevo(p.email, sujetFinal, html);
          if (ok) {
            envoiGroupe.sent++;
            state.stats.sent++;
            contactsEnvoyesCetteFois.push(String(p.contactId));
            envoiGroupeLog(`✅ [${envoiGroupe.done}/${envoiGroupe.total}] ${p.prenom} ${p.nom} (${p.email})`, 'ok');
          } else {
            envoiGroupe.errors++;
            envoiGroupeLog(`❌ [${envoiGroupe.done}/${envoiGroupe.total}] Échec → ${p.email}`, 'error');
          }
        } catch(e) {
          envoiGroupe.errors++;
          envoiGroupeLog(`❌ Exception → ${p.email} : ${e.message}`, 'error');
        }
        await new Promise(r => setTimeout(r, delaiMs));
      }

      // Sauvegarder les contacts envoyés dans Redis
      if (contactsEnvoyesCetteFois.length > 0) {
        await saveContactsEnvoyes(campagneId, contactsEnvoyesCetteFois);
        envoiGroupeLog(`💾 ${contactsEnvoyesCetteFois.length} contact(s) sauvegardés dans Redis`, 'info');
      }

      envoiGroupeLog(`🎉 Terminé — ${envoiGroupe.sent} envoyé(s), ${envoiGroupe.skipped} déjà envoyé(s), ${envoiGroupe.errors} erreur(s)`, 'ok');
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

// ── GET doublons en attente
app.get('/api/campagnes/doublons', (req, res) => {
  res.json({
    pending:    doublonsEnAttente.campagneId !== null,
    campagneId: doublonsEnAttente.campagneId,
    doublons:   doublonsEnAttente.doublons.map(d => ({
      email:        d.email,
      isReferent:   d.isReferent,
      nomEquipe:    d.nomEquipe,
      participants: d.participants.map(p => ({
        contactId: p.contactId,
        prenom:    p.prenom,
        nom:       p.nom,
        nomAsso:   p.nomAsso,
        nomEquipe: p.nomEquipe,
      })),
    })),
    ts: doublonsEnAttente.ts,
  });
});

// ── POST valider les choix de doublons et reprendre l'envoi
app.post('/api/campagnes/doublons/valider', async (req, res) => {
  if (!doublonsEnAttente.campagneId) return res.json({ error: 'Aucun doublon en attente' });

  const choix = req.body.choix || {}; // { email: contactId } pour les non-référents

  // Construire la liste finale des participants
  const participantsFinals = [...doublonsEnAttente.uniques];

  for (const doublon of doublonsEnAttente.doublons) {
    if (doublon.isReferent) {
      // Référent → envoyer au premier participant avec mention "faire suivre"
      const p = doublon.participants[0];
      participantsFinals.push({ ...p, isReferentDoublon: true, nbEquipiers: doublon.participants.length - 1, nomEquipeDoublon: doublon.nomEquipe });
    } else {
      // Non-référent → utiliser le choix de l'utilisateur
      const contactIdChoisi = choix[doublon.email];
      if (!contactIdChoisi || contactIdChoisi === 'SKIP') {
        addLog(`⛔ Doublon ignoré — email ${doublon.email} (choix: ne pas envoyer)`, 'info');
        continue; // Ne pas envoyer à cet email
      }
      const pChoisi = doublon.participants.find(p => String(p.contactId) === String(contactIdChoisi));
      if (!pChoisi) return res.json({ error: `Contact ${contactIdChoisi} introuvable` });
      participantsFinals.push(pChoisi);
    }
  }

  // Relancer l'envoi avec la liste finale
  const campagneId = doublonsEnAttente.campagneId;
  const depuisUtc  = doublonsEnAttente.depuisUtc;
  const nbJours    = doublonsEnAttente.nbJours;

  // Reset doublons
  doublonsEnAttente.campagneId = null;
  doublonsEnAttente.doublons   = [];
  doublonsEnAttente.uniques    = [];

  // Reprendre l'envoi directement avec la liste validée
  const campagne = CAMPAGNES[campagneId];
  if (!campagne) return res.json({ error: 'Campagne introuvable' });

  envoiGroupe.running   = true;
  envoiGroupe.suspended = false;
  envoiGroupe.total     = participantsFinals.length;
  envoiGroupe.done      = 0;
  envoiGroupe.sent      = 0;
  envoiGroupe.errors    = 0;

  (async () => {
    try {
      const delaiMs = ENVOI_GROUPE_DELAY_MS; // 3 secondes fixes
      envoiGroupeLog(`🚀 Reprise après validation doublons — ${participantsFinals.length} destinataire(s)`, 'ok');
      const contactsEnvoyesCetteFois = [];

      for (const p of participantsFinals) {
        envoiGroupe.done++;
        try {
          let extraData = null;
          if (campagne.personnalise) {
            const urlPageCoureur     = await buildUrlPageCoureur(p.contactId, p.eventName || campagne.event);
            const urlPromesseCoureur = await buildUrlPromesseCoureur(p.contactId, p.eventName || campagne.event);
            const urlPageEquipe      = p.nomEquipe ? await buildUrlPageEquipe(null, p.nomEquipe, p.eventName || campagne.event) : null;
            extraData = { nomAsso: p.nomAsso, nomEquipe: p.nomEquipe, urlPageCoureur, urlPromesseCoureur, urlPageEquipe };
          }
          const html = campagne.template(p.prenom, nbJours, extraData);
          const sujetFinal = nbJours ? campagne.sujet.replace(/\d+ jours?/gi, `${nbJours} jours`) : campagne.sujet;

          // Ajouter mention "faire suivre" si référent doublon
          const sujetRef = p.isReferentDoublon ? `[À transmettre à votre équipe] ${sujetFinal}` : sujetFinal;
          const ok = await sendBrevo(p.email, sujetRef, html);
          if (ok) {
            envoiGroupe.sent++;
            state.stats.sent++;
            contactsEnvoyesCetteFois.push(String(p.contactId));
            const tag = p.isReferentDoublon ? `[Référent +${p.nbEquipiers} équipiers]` : '';
            envoiGroupeLog(`✅ [${envoiGroupe.done}/${envoiGroupe.total}] ${p.prenom} ${p.nom} ${tag}`, 'ok');
          } else {
            envoiGroupe.errors++;
          }
        } catch(e) { envoiGroupe.errors++; }
        await new Promise(r => setTimeout(r, delaiMs));
      }

      if (contactsEnvoyesCetteFois.length > 0) await saveContactsEnvoyes(campagneId, contactsEnvoyesCetteFois);
      envoiGroupeLog(`🎉 Terminé — ${envoiGroupe.sent} envoyé(s), ${envoiGroupe.errors} erreur(s)`, 'ok');
      addEvent('📢', `Envoi groupé terminé`, `${campagne.label} — ${envoiGroupe.sent} emails`, 'bill');
    } catch(e) { envoiGroupeLog(`Exception : ${e.message}`, 'error'); }
    finally { envoiGroupe.running = false; envoiGroupe.finishedAt = new Date().toISOString(); }
  })();

  res.json({ success: true, total: participantsFinals.length });
});

// ── POST ignorer les doublons et annuler
app.post('/api/campagnes/doublons/annuler', (req, res) => {
  doublonsEnAttente.campagneId = null;
  doublonsEnAttente.doublons   = [];
  doublonsEnAttente.uniques    = [];
  envoiGroupe.suspended = false;
  addLog('🗑️ Doublons annulés — envoi groupé annulé', 'info');
  res.json({ success: true });
});


// ── GET /api/envoi-groupe/preview — comptage + aperçu 10 premiers
app.post('/api/envoi-groupe/preview', async (req, res) => {
  if (envoiGroupe.running) return res.json({ error: 'Un envoi est déjà en cours' });
  const { typeDestinataire, filtreEquipe, depuisFrance, nbJours, template, choixDoublons } = req.body;
  if (!typeDestinataire) return res.json({ error: 'typeDestinataire requis' });
  if (!template) return res.json({ error: 'template requis' });

  try {
    envoiGroupeLog(`🔍 Comptage : ${typeDestinataire}…`, 'info');
    const tous = await fetchDestinataires({ typeDestinataire, filtreEquipe, depuisFrance, nbJours });
    const dejaEnvoyes = await getContactsDejaEnvoyes(`custom_${typeDestinataire}_${template}`);
    const nouveaux = tous.filter(p => !dejaEnvoyes.has(String(p.contactId)));

    // ── Détection des doublons (100% locale, sans appel API Ohme)
    const parEmail = {};
    for (const p of nouveaux) {
      if (!parEmail[p.email]) parEmail[p.email] = [];
      parEmail[p.email].push(p);
    }
    const doublons = Object.entries(parEmail)
      .filter(([, groupe]) => groupe.length > 1)
      .map(([email, groupe]) => ({
        email,
        participants: groupe.map(p => ({
          contactId: p.contactId,
          prenom:    p.prenom,
          nom:       p.nom,
          nomEquipe: p.nomEquipe,
          nomAsso:   p.nomAsso,
        })),
      }));

    // ── Si des choix ont été soumis, résoudre les doublons
    let destinatairesFinals = [];
    if (doublons.length > 0 && choixDoublons) {
      // Construire la liste finale avec les choix
      const emailsResolus = new Set();
      for (const [email, groupe] of Object.entries(parEmail)) {
        if (groupe.length === 1) {
          destinatairesFinals.push(groupe[0]);
        } else {
          const choix = choixDoublons[email];
          if (!choix || choix === 'SKIP') {
            // Ignorer cet email
          } else {
            const pChoisi = groupe.find(p => String(p.contactId) === String(choix));
            if (pChoisi) destinatairesFinals.push(pChoisi);
          }
          emailsResolus.add(email);
        }
      }
    } else if (doublons.length === 0) {
      destinatairesFinals = nouveaux;
    }

    const apercu = nouveaux.slice(0, 10).map(p => ({
      prenom: p.prenom, nom: p.nom, email: p.email,
      nomEquipe: p.nomEquipe, nomAsso: p.nomAsso,
    }));

    res.json({
      count:               choixDoublons ? destinatairesFinals.length : nouveaux.length,
      total:               tous.length,
      dejaEnvoyes:         dejaEnvoyes.size,
      apercu,
      doublons,            // Liste des doublons à résoudre
      doublonsResolus:     choixDoublons ? true : false,
      destinatairesFinals: choixDoublons ? destinatairesFinals.map(p => p.contactId) : null,
      typeDestinataire,
      template,
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// ── POST /api/envoi-groupe/start — lancer l'envoi
app.post('/api/envoi-groupe/start', async (req, res) => {
  if (envoiGroupe.running) return res.json({ error: 'Un envoi est déjà en cours' });
  const { typeDestinataire, filtreEquipe, depuisFrance, nbJours, template, contactIdsFinals } = req.body;
  if (!typeDestinataire || !template) return res.json({ error: 'typeDestinataire et template requis' });

  const campagneId = `custom_${typeDestinataire}_${template}`;
  envoiGroupe.running   = true;
  envoiGroupe.suspended = false;
  envoiGroupe.label     = `${typeDestinataire} → ${template}`;
  envoiGroupe.total     = 0;
  envoiGroupe.done      = 0;
  envoiGroupe.sent      = 0;
  envoiGroupe.errors    = 0;
  envoiGroupe.skipped   = 0;
  envoiGroupe.startedAt = new Date().toISOString();
  envoiGroupe.finishedAt = null;
  envoiGroupe.log       = [];

  res.json({ success: true, label: envoiGroupe.label });

  // Lancer en async
  (async () => {
    try {
      envoiGroupeLog(`🚀 Démarrage envoi groupé : ${typeDestinataire} → template: ${template}`, 'info');
      let participants = [];

      if (contactIdsFinals && contactIdsFinals.length > 0) {
        // Doublons déjà résolus côté client — récupérer uniquement ces contacts
        envoiGroupeLog(`✅ Liste validée reçue — ${contactIdsFinals.length} destinataire(s)`, 'ok');
        const tous = await fetchDestinataires({ typeDestinataire, filtreEquipe, depuisFrance, nbJours });
        const idsSet = new Set(contactIdsFinals.map(String));
        participants = tous.filter(p => idsSet.has(String(p.contactId)));
      } else {
        const tous = await fetchDestinataires({ typeDestinataire, filtreEquipe, depuisFrance, nbJours });
        const dejaEnvoyes = await getContactsDejaEnvoyes(campagneId);
        const filtres = tous.filter(p => !dejaEnvoyes.has(String(p.contactId)));
        envoiGroupe.skipped = tous.length - filtres.length;
        envoiGroupeLog(`✅ ${filtres.length} destinataire(s) à envoyer (${envoiGroupe.skipped} déjà envoyés)`, 'ok');

        // Vérification doublons locale
        const parEmail = {};
        for (const p of filtres) {
          if (!parEmail[p.email]) parEmail[p.email] = [];
          parEmail[p.email].push(p);
        }
        const aDesDoublons = Object.values(parEmail).some(g => g.length > 1);
        if (aDesDoublons) {
          envoiGroupeLog('⚠️ Doublons détectés non résolus — relancez après validation dans le comptage', 'warn');
          envoiGroupe.running = false;
          envoiGroupe.finishedAt = new Date().toISOString();
          return;
        }
        participants = filtres;
      }

      if (participants.length === 0) { envoiGroupeLog('⚠️ Aucun destinataire — envoi annulé', 'warn'); return; }
      envoiGroupe.total = participants.length;
      const contactsEnvoyesCetteFois = [];

      // Récupérer le template
      const tplFn = getTemplateFunction(template);
      if (!tplFn) { envoiGroupeLog(`❌ Template "${template}" introuvable`, 'error'); return; }

      for (const p of participants) {
        envoiGroupe.done++;
        try {
          const html = tplFn(p.prenom, nbJours ? parseInt(nbJours) : null, {
            nomAsso: p.nomAsso, nomEquipe: p.nomEquipe,
            urlPageCoureur:      await buildUrlPageCoureur(p.contactId, p.eventName),
            urlPromesseCoureur:  await buildUrlPromesseCoureur(p.contactId, p.eventName),
            urlPageEquipe:       p.nomEquipe ? await buildUrlPageEquipe(null, p.nomEquipe, p.eventName) : null,
            urlPromesseEquipe:   p.nomEquipe ? await buildUrlPromesseEquipe(null, p.nomEquipe, p.eventName) : null,
            numeroDossard:       p.numeroDossard || '',
          });
          const campagne = CAMPAGNES[campagneId] || { sujet: template };
          const sujetBase = TEMPLATES_SUJETS[template] || template;
          const sujetFinal = nbJours ? sujetBase.replace(/\d+ jours?/gi, `${nbJours} jours`) : sujetBase;
          const ok = await sendBrevo(p.email, sujetFinal, html);
          if (ok) {
            envoiGroupe.sent++;
            state.stats.sent++;
            contactsEnvoyesCetteFois.push(String(p.contactId));
            envoiGroupeLog(`✅ [${envoiGroupe.done}/${envoiGroupe.total}] ${p.prenom} ${p.nom} (${p.email})`, 'ok');
          } else {
            envoiGroupe.errors++;
            envoiGroupeLog(`❌ [${envoiGroupe.done}/${envoiGroupe.total}] Échec → ${p.email}`, 'error');
          }
        } catch(e) {
          envoiGroupe.errors++;
          envoiGroupeLog(`❌ Exception → ${p.email} : ${e.message}`, 'error');
        }
        await new Promise(r => setTimeout(r, ENVOI_GROUPE_DELAY_MS));
      }

      if (contactsEnvoyesCetteFois.length > 0) await saveContactsEnvoyes(campagneId, contactsEnvoyesCetteFois);
      envoiGroupeLog(`🎉 Terminé — ${envoiGroupe.sent} envoyé(s), ${envoiGroupe.errors} erreur(s)`, 'ok');
      addEvent('📢', `Envoi groupé terminé`, `${envoiGroupe.label} — ${envoiGroupe.sent} emails`, 'bill');

    } catch(e) { envoiGroupeLog(`Exception : ${e.message}`, 'error'); }
    finally { envoiGroupe.running = false; envoiGroupe.finishedAt = new Date().toISOString(); }
  })();
});

// ── POST /api/envoi-groupe/test — envoyer à Victor uniquement
app.post('/api/envoi-groupe/test', async (req, res) => {
  const { template, nbJours } = req.body;
  const tplFn = getTemplateFunction(template);
  if (!tplFn) return res.json({ error: `Template "${template}" introuvable` });
  try {
    const nbJ = nbJours ? parseInt(nbJours) : null;
    const html = tplFn('Victor', nbJ, { nomAsso: 'Association Test', nomEquipe: 'Équipe Test', urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK, urlPageEquipe: URL_EQUIPES });
    const sujetBase = TEMPLATES_SUJETS[template] || `[TEST] ${template}`;
    const sujetFinal = nbJ ? sujetBase.replace(/\d+ jours?/gi, `${nbJ} jours`) : sujetBase;
    const ok = await sendBrevo(EMAIL_TEST_VICTOR, `[TEST] ${sujetFinal}`, html);
    if (ok) { addLog(`🧪 Test envoi groupé "${template}" → Victor`, 'ok'); res.json({ success: true }); }
    else res.json({ success: false, error: 'Échec Brevo' });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

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
  const depuisUtc = req.body.depuisUtc || null;
  try {
    envoiGroupeLog(`🔍 Comptage destinataires pour "${campagne.label}"${depuisUtc ? ` (depuis ${depuisUtc})` : ''}…`, 'info');
    const tous = await fetchParticipantsEvenement(campagne.event, campagne.destinataires, depuisUtc);
    const dejaEnvoyes = await getContactsDejaEnvoyes(req.params.id);
    const nouveaux = tous.filter(p => !dejaEnvoyes.has(String(p.contactId)));
    res.json({ count: nouveaux.length, total: tous.length, dejaEnvoyes: dejaEnvoyes.size, label: campagne.label, event: campagne.event, depuisUtc });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.post('/api/campagnes/:id/test', async (req, res) => {
  const campagne = CAMPAGNES[req.params.id];
  if (!campagne) return res.status(404).json({ error: 'Campagne introuvable' });
  if (envoiGroupe.running) return res.json({ error: 'Un envoi est déjà en cours' });
  try {
    const nbJoursTest = req.body.nbJours ? parseInt(req.body.nbJours) : null;
    // Pour les templates personnalisés, utiliser des données de test
    const extraTest = campagne.personnalise ? {
      nomAsso: 'Association Test',
      nomEquipe: 'Équipe Test',
      urlPageCoureur: URL_COUREURS,
      urlPromesseCoureur: URL_PROMESSE_FALLBACK,
      urlPageEquipe: URL_EQUIPES,
    } : null;
    const html = campagne.template('Victor', nbJoursTest, extraTest);
    const sujetTest = nbJoursTest
      ? campagne.sujet.replace(/\d+ jours?/gi, `${nbJoursTest} jours`)
      : campagne.sujet;
    const ok = await sendBrevo(EMAIL_TEST_VICTOR, `[TEST] ${sujetTest}`, html);
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
  const depuisUtc = req.body.depuisUtc || null;
  const nbJours  = req.body.nbJours ? parseInt(req.body.nbJours) : null;
  const result = await lancerEnvoiGroupe(req.params.id, depuisUtc, nbJours);
  res.json(result);
});

app.get('/api/campagnes/status', (req, res) => {
  res.json({
    running:    envoiGroupe.running,
    suspended:  envoiGroupe.suspended || false,
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

// Vider le cache contacts toutes les 2h pour éviter les fuites mémoire
setInterval(() => {
  const sizeBefore = contactsCache.size;
  contactsCache.clear();
  contactsByNameCache.clear();
  if (sizeBefore > 0) addLog(`🗑️ Cache contacts vidé (${sizeBefore} entrées)`, 'info');
}, 2 * 60 * 60 * 1000);

// ══════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ Serveur Défi Enfance v${SERVER_VERSION} — port ${PORT}`);
  console.log(`   Redis Upstash : ${CONFIG.upstashUrl ? '✅' : '⚠️ NON CONFIGURÉ'}`);
  console.log(`   Brevo : ${CONFIG.brevoKey ? '✅' : '⚠️ manquant'}`);
});

initFromRedis();
