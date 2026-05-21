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
  ${req.query.err ? '<div class="err">Mot de passe incorrect</div>' : ''}</div></td></tr></table></body></html>`);
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
const SERVER_VERSION = '124';

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

  // ── Verrou Redis anti-doublon au démarrage
  // Evite que deux instances Render traitent les paiements en même temps
  const lockKey = 'defi_enfance_startup_lock';
  const lockVal = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    const existingLock = await redisGet(lockKey);
    if (existingLock && existingLock.length > 5) {
      // Une autre instance tourne déjà — on attend 2 minutes avant de démarrer
      console.log(`[INIT] ⏳ Instance secondaire détectée (verrou actif) — pause 120s`);
      addLog('⏳ Instance secondaire détectée — pause 120s avant démarrage du poll', 'warn');
      await new Promise(r => setTimeout(r, 120000));
    }
    // Poser le verrou (expire dans 5 min)
    await redisSet(lockKey, lockVal);
    setTimeout(async () => {
      try {
        const cur = await redisGet(lockKey);
        if (cur === lockVal) await redisSet(lockKey, '');
      } catch(_) {}
    }, 5 * 60 * 1000);
  } catch(e) {
    console.log(`[INIT] ⚠️ Verrou Redis erreur : ${e.message} — on continue`);
  }

  state.processedIds  = await loadProcessedIds();
  state.donsEnAttente = await loadDonsEnAttente();
  console.log(`[INIT] ${state.donsEnAttente.length} don(s) en attente chargés`);
  const lastVersion = await getLastVersion();
  premierPoll = lastVersion !== SERVER_VERSION;

  // ── Sécurité critique : si Redis est vide (0 IDs) → forcer mode validation manuelle
  // même si la version est identique, pour éviter tout envoi accidentel
  if (!premierPoll && state.processedIds.size === 0) {
    premierPoll = true;
    console.log(`[INIT] ⚠️ Redis vide (0 IDs) — mode validation manuelle forcé par sécurité`);
    addLog('⚠️ Redis vide — mode validation manuelle forcé par sécurité', 'warn');
    await saveCurrentVersion();
  } else if (premierPoll) {
    console.log(`[INIT] 🆕 Nouvelle version (${lastVersion || 'aucune'} → ${SERVER_VERSION}) — mode validation manuelle`);
    await saveCurrentVersion();
  } else {
    console.log(`[INIT] ✅ Même version (${SERVER_VERSION}) — ${state.processedIds.size} IDs Redis — mode automatique`);
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
const contactsCache = new Map();

// ── Détection doublons paiements Ohme (même session)
// Clé = contactId|amount|coureur_parraine|equipe_parraine|payment_type_id
const paiementsSignatures = new Set();

function getPaiementSignature(p) {
  const cf = p.custom_fields || p;
  return [
    String(p.contact_id || ''),
    String(p.amount || ''),
    String(cf.coureur_parraine || '').trim().toLowerCase(),
    String(cf.equipe_parraine || '').trim().toLowerCase(),
    String(p.payment_type_id || ''),
    String(cf.montant_promesse_don_par_km || ''),
  ].join('|');
} // contactId → contact
const contactsByNameCache = new Map(); // nom complet lowercase → contact

// ── Index contactId → nomEquipe + assoSoutenue (construit depuis les paiements billetterie)
// Evite de paginer tous les paiements à chaque promesse/don
const equipeParContactId = new Map(); // contactId → nomEquipe
const assoParContactId   = new Map(); // contactId → nomAsso

async function buildEquipeIndex() {
  addLog('🏗️ Construction index équipes + assos…', 'info');
  let cursor = null;
  let nbEquipes = 0;
  let nbAssos = 0;
  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=3&limit=250&since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=3&limit=250&since_date=2026-01-01`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (!res.ok) { addLog(`⚠️ buildEquipeIndex HTTP ${res.status}`, 'warn'); break; }
    const json = await res.json();
    const items = json.data || [];
    for (const p of items) {
      if (!p.contact_id) continue;
      const cf = p.custom_fields || p;
      const equipe = (cf.equipe || '').trim();
      const asso   = (cf.asso_soutenue || '').trim();
      const eventName = (p.nom_de_levent || cf.nom_de_levent || '').toUpperCase();
      if (!eventName.includes('ENFANCE')) continue;
      const key = String(p.contact_id);
      if (equipe) { equipeParContactId.set(key, equipe); nbEquipes++; }
      if (asso)   { assoParContactId.set(key, asso);     nbAssos++; }
      // Log diagnostic pour contacts spécifiques
      if (key === '11259000003002230') addLog(`🔍 Index: Victor trouvé — equipe="${equipe}" asso="${asso}"`, 'info');
    }
    if (items.length < 250) break;
    cursor = json.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }
  addLog(`✅ Index : ${nbEquipes} équipe(s), ${nbAssos} asso(s) indexées`, 'ok');
}

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
    body{background:#f5f0f3 !important;background-color:#f5f0f3 !important;font-family:'Poppins',Arial,sans-serif;color:#1a0a12}
    .outer{max-width:600px;margin:0 auto;padding:24px 12px;background-color:#f5f0f3}
    /* Force Outlook */
    table.bg-wrap{background-color:#f5f0f3 !important}
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
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Nouveau don pour toi !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${coureurPrenom} 👋</div><div class="intro">Bonne nouvelle ! Un nouveau don vient d'être enregistré sur <strong>ta page de collecte Défi Enfance</strong>.</div><div class="don-box"><div class="don-amount">${montant} €</div><div class="don-label">Don reçu de ${donateur}</div></div><div class="card"><h3>📋 Coordonnées du donateur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#fb0089">${email_donateur}</a></div></div></div>${motLine}${motEncouragement && urlPageCoureur ? `<div style="text-align:center;margin-bottom:16px"><a href="${urlPageCoureur}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Promettre un don au km pour ${coureurPrenom}</a></div>` : ''}<div class="note magenta">💌 <strong>N'hésite pas à remercier ${donateur} personnellement</strong> — un message sincère fait toujours une grande différence !</div><div class="cta-box"><p>✨ <strong>Et si tu faisais grimper ta collecte encore plus haut ?</strong><br>Partage ta page et invite tes proches à te soutenir !</p><a href="${urlPageCoureur || URL_COUREURS}" class="cta-btn">🏃 Voir ma page de collecte</a></div>${blocCtaDonPromesse({ nomCoureur: coureurPrenom })}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant le don.${assoLine}</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplDonEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montant, email_donateur, motEncouragement, coureurPrenom, coureurNom, urlPageEquipe }) {
  const isDE   = nomEquipe === 'Défi Enfance';
  const motLine = motEncouragement ? `<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin:16px 0">
    <div style="font-size:.78rem;font-weight:700;color:#fb0089;margin-bottom:6px">💬 Mot d'encouragement de ${donateur}</div>
    <div style="font-size:.84rem;color:#3d1830;font-style:italic">"${motEncouragement}"</div>
  </div>` : '';
  const coureurLine = coureurPrenom ? `<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:12px 16px;margin:12px 0;font-size:.84rem;color:#3d1830">🏃 <strong>Ce don est fléché vers ${coureurPrenom} ${coureurNom || ''}</strong>, membre de votre équipe.</div>` : '';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
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
</div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour toi !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${coureurPrenom} 👋</div><div class="intro"><strong>${donateur}</strong> croit en toi et s'engage à faire un don sur ta page de collecte — <strong>le soir même de ta course</strong> — en fonction des kilomètres que tu auras courus !</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru par ${donateur}</div></div>${scenarios}${motLine}<div class="note violet">🚀 <strong>Plus tu courras de kilomètres, plus ${donateur} donnera pour l'enfance !</strong><br>Ce soutien est une vraie carotte : chaque foulée supplémentaire compte directement pour les enfants.</div>${recap}<div class="card violet"><h3 class="violet">📋 Coordonnées de votre supporter</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>Remercie ${donateur} dès maintenant</strong> — et donne-lui rendez-vous pour voir ton résultat le soir de la course !</div><div class="cta-box violet"><p>✨ <strong>Partage ta page de collecte</strong> pour multiplier les promesses de dons !<br>Chaque km que tu cours peut rapporter encore plus à l'enfance.</p><a href="${urlPageCoureur || URL_COUREURS}" class="cta-btn violet">🏃 Voir ma page de collecte</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse enregistrée automatiquement. Le don sera effectif après la course.${assoLine}</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour un coureur de votre équipe !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body">
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
<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email envoyé automatiquement dans les 10 minutes suivant la promesse.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montantParKm, email_donateur, motEncouragement, nbPromessesEquipe, totalKmParEquipe, urlPromesseEquipe, urlPageEquipe }) {
  const motLine  = motEncouragement ? `<div class="note violet" style="margin-top:16px">💬 <strong>Message de ${donateur} :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const recap    = blocRecapPromesses({ nbPromessesCoureur: 0, totalKmParCoureur: 0, nbPromessesEquipe, totalKmParEquipe, isCoureur: false });
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour votre équipe !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${chefPrenom} 👋</div><div style="margin-bottom:16px"><span class="badge violet">🏃 Équipe ${nomEquipe}</span></div><div class="intro">Excellente nouvelle ! <strong>${donateur}</strong> s'engage à faire un don pour votre équipe — <strong>le soir même de la course</strong> — proportionnellement aux kilomètres cumulés par vos coureurs !</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru — pour l'équipe ${nomEquipe}</div></div>${scenarios}${motLine}<div class="note violet">🚀 <strong>Chaque km couru par chacun de vos coureurs compte !</strong><br>Plus votre équipe performe collectivement, plus ${donateur} donnera pour l'enfance le soir même.</div>${recap}<div class="card violet"><h3 class="violet">📋 Coordonnées du supporter</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>Transmettez cette promesse à vos coureurs</strong> pour les motiver encore davantage — chaque foulée supplémentaire a un prix pour l'enfance !</div><div class="cta-box violet"><p>✨ <strong>Mobilisez l'équipe !</strong><br>Partagez cette promesse de don avec tous vos coureurs pour décupler leur motivation le jour J.</p><a href="${urlPromesseEquipe || URL_PROMESSE_FALLBACK}" class="cta-btn violet">🏅 Promettre un don au km</a></div><div style="text-align:center;margin-top:10px"><a href="${urlPageEquipe || URL_EQUIPES}" style="display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏆 Voir la page de l'équipe</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse enregistrée automatiquement. Le don sera effectif après la course.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → coureur
 */
function tplMerciPrometteurCoureur({ prenomDonateur, montantParKm, coureurPrenom, coureurNom, association, historiqueHtml }) {
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🙏 Merci pour votre<br>promesse de don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre promesse de <strong>${montantParKm} € par km</strong> pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''} est enregistrée. Elle sera transformée en don réel — <strong>le soir même de la course</strong> — selon les kilomètres courus.</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km couru par ${coureurPrenom}</div></div>${scenarios}<div class="note violet">💡 <strong>Comment ça fonctionne ?</strong><br>Le soir de la course, vous recevrez un email récapitulatif avec le résultat de ${coureurPrenom}. Il vous suffira alors de cliquer sur le lien de don et de saisir le montant correspondant aux km courus.</div><div style="text-align:center;background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border-radius:14px;padding:22px;margin-bottom:24px"><div style="margin-bottom:12px;font-size:.78rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em">L'impact de votre engagement</div><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#7c3aed">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#7c3aed">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="cta-box violet"><p>✨ <strong>Envie d'aller encore plus loin ?</strong><br>Partagez cette initiative autour de vous — vos proches peuvent aussi promettre un don par km !</p><a href="${URL_DON}" class="cta-btn violet">❤️ Page de don Défi Enfance</a></div><div class="divider"></div>${historiqueHtml || ""}<div style="font-size:.75rem;color:#888;text-align:center">Promesse de don enregistrée — le don sera réalisé après la course.<br>contact@defienfance.fr — defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → équipe
 */
function tplMerciPrometteurEquipe({ prenomDonateur, montantParKm, nomEquipe, historiqueHtml }) {
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🙏 Merci pour votre<br>promesse de don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre promesse de <strong>${montantParKm} € par km</strong> pour l'équipe <strong>${nomEquipe}</strong> est enregistrée. Elle sera transformée en don réel — <strong>le soir même de la course</strong> — selon les kilomètres cumulés par les coureurs de l'équipe.</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km couru — équipe ${nomEquipe}</div></div>${scenarios}<div class="note violet">💡 <strong>Comment ça fonctionne ?</strong><br>Le soir de la course, vous recevrez un email récapitulatif avec le résultat de l'équipe ${nomEquipe}. Il vous suffira alors de cliquer sur le lien de don et de saisir le montant correspondant.</div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="cta-box violet"><p>✨ <strong>Mobilisez votre entourage !</strong><br>Plus il y a de promesses sur cette équipe, plus leur motivation le jour J est décuplée !</p><a href="${URL_DON}" class="cta-btn violet">❤️ Page de don Défi Enfance</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse de don enregistrée — le don sera réalisé après la course.<br>contact@defienfance.fr — defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🎖️ Merci, Ambassadeur<br>du Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body">
<div class="greeting">Bonjour ${prenomDonateur} 👋</div>
<div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#f5f0ff);border-radius:16px;padding:24px;margin-bottom:22px">
  <div style="font-size:3.5rem;margin-bottom:10px">🎖️</div>
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1.5rem;color:#fb0089;font-weight:700;margin-bottom:6px">Vous êtes Ambassadeur du Défi Enfance !</div>
  <div style="font-size:.82rem;color:#3d1830;line-height:1.6">Votre engagement répété pour l'enfance est une force rare et précieuse.<br>Merci de croire, encore et encore, que chaque km compte.</div>
</div>
${coureurPrenom ? `<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,0.3);border-radius:10px;padding:12px 18px;margin-bottom:18px;text-align:center"><div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">✅ Votre don est bien fléché vers</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.2rem;color:#fb0089">${coureurPrenom} ${coureurNom || ''}</div></div>` : nomEquipe ? `<div style="background:linear-gradient(135deg,#fff5ef,#fff0f8);border:1.5px solid rgba(239,97,53,0.3);border-radius:10px;padding:12px 18px;margin-bottom:18px;text-align:center"><div style="font-size:.72rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">✅ Votre don est bien fléché vers l'équipe</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.2rem;color:#ef6135">${nomEquipe}</div></div>` : ''}
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
${historiqueHtml || ""}</div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplMerciDonateurFidele({ prenomDonateur, montant, historiqueHtml, coureurPrenom, coureurNom, nomEquipe }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🏅 Super Badge Donateur<br>du Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Vous avez de nouveau soutenu le Défi Enfance avec un don de <strong>${montant} €</strong>. Merci !</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="font-size:3rem;margin-bottom:8px">🏅</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089;font-weight:700">Vous êtes officiellement<br>Super Donateur du Défi Enfance !</div></div>${coureurPrenom ? `<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,0.3);border-radius:10px;padding:12px 18px;margin-bottom:18px;text-align:center"><div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">✅ Votre don est bien fléché vers</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.2rem;color:#fb0089">${coureurPrenom} ${coureurNom || ''}</div></div>` : nomEquipe ? `<div style="background:linear-gradient(135deg,#fff5ef,#fff0f8);border:1.5px solid rgba(239,97,53,0.3);border-radius:10px;padding:12px 18px;margin-bottom:18px;text-align:center"><div style="font-size:.72rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">✅ Votre don est bien fléché vers l'équipe</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.2rem;color:#ef6135">${nomEquipe}</div></div>` : ''}${historiqueHtml || ''}${BLOC_RECUS_FISCAUX}${BLOC_SOCIAUX}${blocCtaDonPromesse({})}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr — defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplMerciDonateurStructure({ prenomDonateur, montant, nomStructure, coureurPrenom, coureurNom, association, nomEquipe }) {
  const cible = coureurPrenom ? `pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''}` : nomEquipe ? `pour l'équipe <strong>${nomEquipe}</strong>` : 'au Défi Enfance';
  const salutation = prenomDonateur ? `Bonjour ${prenomDonateur} 👋` : `Bonjour 👋`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Merci pour le don de<br>${nomStructure} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">${salutation}</div><div class="intro">Merci pour le don de <strong>${montant} €</strong> de <strong>${nomStructure}</strong> ${cible}.</div><div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour le don de ${montant} € de ${nomStructure}.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplMerciDonateur({ prenomDonateur, montant, donateur, coureurPrenom, coureurNom, association, historiqueHtml }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>❤️ Merci pour votre don<br>à ${coureurPrenom} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div>
<div class="don-box" style="margin-bottom:20px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🏃 Coureur soutenu</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089">${coureurPrenom} ${coureurNom}</div>${association ? `<div style="font-size:.78rem;color:#3d1830;margin-top:4px">court pour l'Association <strong>${association}</strong></div>` : ''}</div>
<div class="intro">Votre don de <strong>${montant} €</strong> pour <strong>${coureurPrenom} ${coureurNom}</strong> fait une vraie différence. 50% va à l'<strong>Association ${association}</strong>, 50% au Plaidoyer du Défi Enfance.</div>
${historiqueHtml || ''}
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:.95rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 Allez encore plus loin — la Promesse de don au km !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Saviez-vous que vous pouvez faire une <strong>promesse de don au km</strong> directement sur la page de ${coureurPrenom} ? Vous vous engagez sur un montant par km — votre don est calculé le soir même selon ses km parcourus. Plus ${coureurPrenom} court, plus l'enfance gagne !<br><br><strong>Comment faire ?</strong> Cliquez sur "${coureurPrenom}" sur la page de collecte, puis sur <strong>"Faire une promesse de don"</strong>.</div>
  <div style="text-align:center"><a href="${URL_COUREURS}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏃 Voir la page de ${coureurPrenom}</a></div>
</div>
<div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplMerciDonateurEquipe({ prenomDonateur, montant, donateur, nomEquipe, historiqueHtml }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header orange"><h1>❤️ Merci pour votre don<br>via l'équipe ${nomEquipe} !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div>
<div class="don-box orange" style="margin-bottom:20px"><div style="font-size:.78rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🏆 Équipe soutenue</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.5rem;color:#ef6135">${nomEquipe}</div></div>
<div class="intro">Votre don de <strong>${montant} €</strong> pour l'équipe <strong>${nomEquipe}</strong> fait une vraie différence pour les enfants accompagnés par leurs associations !</div>${historiqueHtml || ''}<div style="text-align:center;background:linear-gradient(135deg,#fff5ef,#fff8ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#ef6135">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#ef6135">+40</span><span class="lbl">associations soutenues</span></div></div></div>
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:1rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 Et si vous alliez encore plus loin ?</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Savez-vous que vous pouvez faire une <strong>promesse de don au km</strong> pour les coureurs de l'équipe ${nomEquipe} ? Vous vous engagez sur un montant par km couru — et votre don est calculé et versé <em>le soir même de la course</em>, en fonction de leur performance. Plus ils courent, plus l'enfance gagne !</div>
  <div style="text-align:center"><a href="${URL_DON}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏅 Faire une promesse de don au km</a></div>
</div>
${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplMerciDonateurGlobal({ prenomDonateur, montant, historiqueHtml }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>❤️ Merci pour<br>votre don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre don de <strong>${montant} €</strong> au Défi Enfance fait une vraie différence dans la vie de milliers d'enfants. Merci du fond du cœur !</div>
${historiqueHtml || ''}
<div style="background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border:2px solid #7c3aed;border-radius:14px;padding:18px 22px;margin-bottom:22px">
  <div style="font-family:'Antonio',Arial,sans-serif;font-size:.95rem;color:#7c3aed;font-weight:700;margin-bottom:8px">🏅 Allez encore plus loin — la Promesse de don au km !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Saviez-vous que vous pouvez faire une <strong>promesse de don au km</strong> directement sur la page d'un coureur ? Vous vous engagez sur un montant par km — votre don est calculé le soir même selon les km parcourus.<br><br><strong>Comment faire ?</strong> Rendez-vous sur la page de collecte, cliquez sur un coureur, puis sur <strong>"Faire une promesse de don"</strong>.</div>
  <div style="text-align:center"><a href="${URL_COUREURS}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem">🏃 Voir les pages coureurs</a></div>
</div>
<div style="text-align:center;background:linear-gradient(135deg,#fff0f8,#fff5ef);border-radius:14px;padding:22px;margin-bottom:24px"><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Merci pour votre don de ${montant} €.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🎽 Dans ${j} jours,<br>on court pour l'enfance !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div><div class="body">
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

</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr — defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
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

</div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
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

</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplGroupeJ1Donateurs({ prenom, historiqueHtml, urlDon, urlProm }) {
  const urlD = urlDon  || 'https://defienfance.fr/faire-un-don/';
  const urlP = urlProm || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .action-item{display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
    .action-item:last-child{border-bottom:none}
    .action-num{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff;font-weight:700;font-size:.78rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>❤️ Merci pour votre soutien<br>au Défi Enfance !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div>
<div class="body">

<div class="greeting">Bonjour ${prenom} 👋</div>
<div class="intro">Demain, c'est le grand jour — le Défi Enfance 2026 à Angers ! Grâce à vous et à votre générosité, des coureurs vont s'élancer demain matin pour l'enfance. <strong>Votre soutien fait toute la différence.</strong></div>

${historiqueHtml || ''}

<div class="card" style="margin-bottom:20px">
  <h3>🎽 Demain au Parc Saint-Serge</h3>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7">Les coureurs que vous avez soutenus seront sur la ligne de départ à <strong>10h00</strong>. Si votre don est une promesse au km, le montant final sera calculé <strong>le soir même à 20h</strong> selon les km réellement parcourus. Vous recevrez une confirmation par email.</div>
</div>

<div class="card" style="margin-bottom:20px">
  <h3>💡 3 façons de continuer à agir</h3>
  <div class="action-item">
    <div class="action-num">1</div>
    <div><strong>Parlez-en autour de vous</strong><br>Vos collègues, amis, clients peuvent encore faire un don ou une promesse de don avant la course de demain. Chaque don compte !</div>
  </div>
  <div class="action-item">
    <div class="action-num">2</div>
    <div><strong>Tentez la promesse de don au km</strong><br>Vous ne l'avez pas encore fait ? C'est l'outil le plus puissant du Défi Enfance — votre don se calcule en live pendant la course selon les km parcourus.<br>
    <div style="margin-top:10px"><a href="${urlP}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#fb0089);color:#fff!important;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem">🏅 Faire une promesse de don au km</a></div></div>
  </div>
  <div class="action-item">
    <div class="action-num">3</div>
    <div><strong>Faites un nouveau don</strong><br>Votre générosité peut aller encore plus loin ! 100% des dons sont fléchés vers l'enfance : 50% pour les assos de terrain, 50% pour le plaidoyer.<br>
    <div style="margin-top:10px"><a href="${urlD}" style="display:inline-block;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff!important;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem">❤️ Faire un nouveau don</a></div></div>
  </div>
</div>

<div class="note magenta" style="margin-bottom:20px">💬 <strong>Votre mot d'encouragement</strong> est affiché sur le <a href="https://defienfance.fr/mur-de-dons/" style="color:#fb0089;font-weight:600">Mur des dons</a> — les coureurs le liront avant le départ !</div>

${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_IFI}${BLOC_RECUS_FISCAUX}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Merci du fond du cœur pour votre engagement.<br>Grâce à vous, chaque enfant a une chance. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>

</div></td></tr></table></body></html>`;
}

function tplGroupeJ2Referents({ prenom, urlPromesseEquipe, urlPageEquipe }) {
  const urlProm = urlPromesseEquipe || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const urlDon  = 'https://defienfance.fr/faire-un-don/';
  const urlPage = urlPageEquipe || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=all';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
  .action-item{display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
  .action-item:last-child{border-bottom:none}
  .action-num{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#fb0089,#ef6135);color:#fff;font-weight:700;font-size:.78rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
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

</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplGroupeJ1Angers({ prenom, numeroDossard, urlPageCoureur, urlPromesseCoureur }) {
  const urlDon  = urlPageCoureur     || 'https://defienfance.fr/faire-un-don/';
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .checklist-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830;text-align:left}
    .checklist-item:last-child{border-bottom:none}
    .rappel-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f5dced;font-size:.83rem;color:#3d1830;text-align:left}
    .rappel-item:last-child{border-bottom:none}
    .ep-inner{background:#fff;border-radius:10px;padding:20px 22px}
    .ep-objet-label{font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
    .ep-objet-val{font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px}
    .ep-body{font-size:.82rem;color:#3d1830;line-height:1.8;text-align:left}
    .ep-defiscal{background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem}
    .temoignage{background:#fff;border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:12px}
    .temoignage-quote{font-size:.84rem;color:#3d1830;font-style:italic;line-height:1.7;margin-bottom:6px}
    .temoignage-author{font-size:.75rem;color:#fb0089;font-weight:600}
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>🎽 Demain, c'est le jour J !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div>
<div class="body">

<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Demain matin, vous serez sur la ligne de départ du Défi Enfance. <strong>On est fiers de vous avoir parmi nous.</strong> Voici tout ce qu'il faut savoir pour arriver prêt(e) et serein(e) !</div>

${numeroDossard ? `<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:2px solid #fb0089;border-radius:14px;padding:16px 22px;margin-bottom:20px;text-align:center"><div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🎽 Votre numéro de dossard</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:3rem;color:#fb0089;font-weight:700;line-height:1">${numeroDossard}</div><div style="font-size:.75rem;color:#3d1830;margin-top:6px">À récupérer sur place dès 8h30</div></div>` : ''}

<div class="card" style="margin-bottom:20px">
  <h3>✅ Votre check-list</h3>
  <div class="checklist-item"><span>👕</span><div>Tenue de sport + T-Shirt de votre organisation</div></div>
  <div class="checklist-item"><span>👟</span><div>Chaussures de running</div></div>
  <div class="checklist-item"><span>💧</span><div>Bouteille d'eau</div></div>
  <div class="checklist-item"><span>📱</span><div>Tél/CB pour faire des dons en live</div></div>
  <div class="checklist-item"><span>⏰</span><div>Réveil réglé !</div></div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,0.25);border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">📌 Programme du vendredi 22 mai</div>
  <div class="rappel-item"><span>📍</span><div>Parc Saint-Serge, à côté de l'Iceparc — Angers</div></div>
  <div class="rappel-item"><span>🕗</span><div><strong>8h30</strong> — Ouverture du village &amp; retrait des dossards</div></div>
  <div class="rappel-item"><span>🏁</span><div><strong>10h00</strong> — Départ de la course</div></div>
  <div class="rappel-item"><span>🏆</span><div><strong>12h00</strong> — Remise des prix</div></div>
  <div class="rappel-item"><span>🍽️</span><div><strong>12h30</strong> — Déjeuner Agapè</div></div>
</div>

<div style="background:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.78rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">🎉 Embarquez votre entourage !</div>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7">Venez avec vos <strong>mascottes</strong>, les <strong>T-Shirts de vos organisations</strong>, embarquez vos amis, proches et collègues — ils pourront <strong>s'inscrire à la dernière minute comme supporters</strong> pour porter votre élan sur place ! Plus on est nombreux, plus l'énergie sera au rendez-vous. 🏃🎊</div>
</div>

<div style="background:#fff8f0;border-left:3px solid #ff8533;border-radius:0 10px 10px 0;padding:12px 18px;margin-bottom:20px;font-size:.83rem;color:#3d1830;text-align:left">🍴 <strong>Vous avez commandé un panier gourmand ?</strong> Pensez à le récupérer après la course au stand Agapè.</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border:1.5px solid rgba(251,0,137,0.15);border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💬 Un dernier élan ce soir ?</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Si vous souhaitez partager votre page de collecte ce soir à vos proches, voici un message tout prêt à copier-coller :</div>
  <div class="ep-inner">
    <div class="ep-objet-label">Objet</div>
    <div class="ep-objet-val">Je t'embarque pour mon Défi Enfance ce 22/05 à Angers ? 🏁</div>
    <div class="ep-body">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris aujourd'hui parce que j'ai décidé de relever un défi qui me tient particulièrement à cœur : le <strong>Défi Enfance</strong>.</p>
      <p style="margin:0 0 12px">Le secteur de l'aide à l'enfance traverse une crise sans précédent. Le système est aujourd'hui saturé : manque de places, manque de coordination, et surtout, une approche trop souvent cloisonnée qui laisse des enfants vulnérables sur le bord de la route.</p>
      <p style="margin:0 0 12px">L'objectif du Défi Enfance ? <strong>Casser ces silos.</strong> L'argent collecté permet de financer des projets innovants qui placent enfin l'intérêt de l'enfant au centre, en faisant travailler ensemble tous les acteurs qui l'entourent.</p>
      <p style="margin:0 0 12px">Pour y arriver, <strong>j'ai besoin de toi.</strong> Pour me soutenir : 👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don ou une promesse de don</a></p>
      <div class="ep-defiscal">💡 <strong>Le bonus fiscal :</strong> Ton don est défiscalisé à hauteur de 66%. Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0 0 12px">Un immense merci pour ton soutien et pour l'aide que tu apportes à ces enfants.</p>
      <p style="margin:0">À très vite,<br><strong>${prenom}</strong></p>
    </div>
  </div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border:1.5px solid rgba(251,0,137,0.2);border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px">💬 Ils témoignent pour l'enfance</div>
  <div class="temoignage">
    <div class="temoignage-quote">"Ce sont les enfants de tout le monde. Ce sont les enfants de chacun."</div>
    <div class="temoignage-author">Jérôme Aucordier</div>
    <div style="font-size:.74rem;color:#888;margin-top:2px">Accompagne des enfants dans un lieu de vie qui place chaque enfant au cœur de ses propres décisions. Pour lui, ces enfants ne sont pas des cas à gérer — ce sont un capital pour notre société.</div>
  </div>
  <div class="temoignage">
    <div class="temoignage-quote">"Défi Enfance, c'est un moyen que les jeunes soient entendus."</div>
    <div class="temoignage-author">Anne Loriot — éducatrice spécialisée en foyer</div>
    <div style="font-size:.74rem;color:#888;margin-top:2px">Accueille des jeunes jour et nuit. Un jour, une jeune lui a dit : "Est-ce que tu vas rester ?" — une phrase qui dit tout. Ces enfants ne demandent pas grand-chose. Juste de la stabilité. Juste quelqu'un qui ne part pas.</div>
  </div>
</div>

${BLOC_SOCIAUX}${BLOC_IFI}${BLOC_RECUS_FISCAUX}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Demain, chaque foulée compte pour l'enfance.<br><strong style="color:#fb0089">On court avec vous ! 🏁</strong></div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance 🤲</div>

</div></td></tr></table></body></html>`;
}


