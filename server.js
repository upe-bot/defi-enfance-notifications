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
    return res.redirect('/');
  }
  res.redirect('/login?err=1');
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'dash_token=; Path=/; Max-Age=0');
  return res.redirect('/login');
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
const SERVER_VERSION = '130';

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

  // ── Sécurité : si Redis vide (0 IDs) → charger tous les IDs Ohme silencieusement
  // sans envoyer d'emails, puis passer en mode automatique
  if (state.processedIds.size === 0) {
    console.log(`[INIT] ⚠️ Redis vide — chargement silencieux de tous les IDs Ohme…`);
    addLog('⚠️ Redis vide — chargement silencieux de tous les IDs Ohme…', 'warn');
    try {
      let cursor = null;
      let nbIds = 0;
      while (true) {
        await sleep(OHME_DELAY_MS);
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&since_date=2025-01-01&cursor=${encodeURIComponent(cursor)}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&since_date=2025-01-01`;
        const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!r || !r.ok) { addLog(`⚠️ Chargement IDs HTTP ${r?.status || 'erreur'} — mode validation manuelle forcé`, 'warn'); premierPoll = true; break; }
        const j = await r.json();
        const items = j.data || [];
        items.forEach(p => { if (p.id) { state.processedIds.add(String(p.id)); nbIds++; } });
        if (items.length < 250) break;
        cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
        if (!cursor) break;
      }
      if (state.processedIds.size > 0) {
        await saveProcessedIds();
        await saveCurrentVersion();
        premierPoll = false;
        addLog(`✅ ${state.processedIds.size} IDs chargés — mode automatique direct`, 'ok');
      }
    } catch(e) {
      addLog(`⚠️ Chargement IDs erreur : ${e.message} — mode validation manuelle`, 'warn');
      premierPoll = true;
    }
  }

  if (premierPoll) {
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


<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td bgcolor="#1a0a12" style="background-color:#1a0a12;border-radius:14px;padding:20px 24px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email prêt à envoyer à vos proches</div>
  <div style="font-size:.72rem;color:#aaaaaa;margin-bottom:16px">Copiez-collez ce message à vos amis, collègues, clients, fournisseurs…</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:10px;padding:20px 22px">
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
  </td></tr></table>
</td></tr></table>

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
function tplGroupeJ10JoueV2({ prenom, nbJours, urlPageCoureur, urlPromesseCoureur }) {
  const j = nbJours || 10;
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const urlDon  = urlPageCoureur     || 'https://defienfance.fr/faire-un-don/';

  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.52.36.jpeg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.53.42.jpeg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.54.49.jpeg';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .programme-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830}
    .programme-item:last-child{border-bottom:none}
    .programme-ic{font-size:1.1rem;flex-shrink:0;width:24px;text-align:center}
    .programme-time{font-weight:700;color:#fb0089;min-width:52px;flex-shrink:0}
    .liste-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f5e5d5;font-size:.84rem;color:#3d1830}
    .liste-item:last-child{border-bottom:none}
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:0"><tr><td bgcolor="#fb0089" style="background-color:#fb0089;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#ffffff;margin:0 0 6px">🎽 ${prenom}, dans ${j} jours<br>c'est votre tour !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · Joué-lès-Tours · 29 mai 2026</p></td></tr></table>
<div class="body">

<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Dans <strong>${j} jours</strong>, c'est le grand jour pour Joué-lès-Tours ! 🎉 Et ce que vous avez vu se passer à Angers le 22 mai va vous donner encore plus d'élan pour faire de cette <strong>première édition à Joué</strong> quelque chose d'exceptionnel. Voici tout ce qu'il faut savoir ! 💪</div>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🏁 Ce qui s'est passé à Angers le 22 mai</div>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:14px;text-align:left">La <strong>2e édition du Défi Enfance à Angers</strong> a été une transformation réussie. Près de <strong>600 coureurs participants, des centaines de supporters et de nombreux bénévoles</strong> ont envahi le Parc Saint-Serge pour courir pour l'enfance. Des dizaines d'équipes d'entreprises, d'écoles, d'associations et d'institutions côte à côte.</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px"><tr>
    <td width="49%" style="padding-right:4px;vertical-align:top"><img src="${IMG1}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:8px;display:block"></td>
    <td width="49%" style="padding-left:4px;vertical-align:top"><img src="${IMG2}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:8px;display:block"></td>
  </tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px"><tr>
    <td><img src="${IMG3}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:8px;display:block"></td>
  </tr></table>
  <div style="background-color:#fff;border-left:3px solid #fb0089;border-radius:0 8px 8px 0;padding:12px 16px;font-size:.83rem;color:#3d1830;font-style:italic">
    💬 <strong>Témoignage d'un chef d'entreprise angevin :</strong><br>
    "Course incroyable. Moment super avec les équipes. On a déjà motivé une entreprise partenaire de venir l'année prochaine !"
  </div>
</div>

<div style="background-color:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:12px;padding:16px 20px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🏆 Angers vs Joué — l'émulation est lancée !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;text-align:left">Angers a posé la barre. <strong>Joué-lès-Tours peut faire mieux !</strong> Collecte de dons, km parcourus, énergie collective — tout est encore ouvert. C'est votre tour de montrer ce que la Touraine a dans les jambes pour l'enfance. 💚</div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🏅 La promesse de don — le vrai game changer</div>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:12px;text-align:left">À Angers, les <strong>promesses de dons au km</strong> ont transformé la collecte. Chaque km couru avait une valeur concrète — et les donateurs étaient <strong>connectés en temps réel</strong> à la performance de leurs coureurs. <strong>C'est le levier le plus puissant pour votre collecte.</strong></div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px;text-align:left">Le principe : un proche vous promet <strong>X€ par km</strong>. Vous courez, il donne selon votre performance. <strong>Plus vous courez, plus l'enfance gagne.</strong> Pas besoin de décider d'un montant à l'avance — et votre réseau sera naturellement motivé à vous encourager à fond !</div>
  <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap">
    <a href="${urlProm}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">🏅 Faire promettre un don au km</a>
    <a href="${urlDon}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">❤️ Ma page de collecte</a>
  </div>
</div>

<div class="card" style="margin-bottom:22px">
  <h3>📅 Programme du 29 mai à Joué</h3>
  <div class="programme-item"><span class="programme-ic">🕐</span><span class="programme-time">13h00</span><div>Ouverture du village &amp; récupération des dossards</div></div>
  <div class="programme-item"><span class="programme-ic">🎤</span><span class="programme-time">13h45</span><div>Discours officiels</div></div>
  <div class="programme-item"><span class="programme-ic">🏃</span><span class="programme-time">14h30</span><div><strong>Départ de la course</strong> — 2h de dépassement de soi !</div></div>
  <div class="programme-item"><span class="programme-ic">🍰</span><span class="programme-time">16h00</span><div>Goûter offert à tous les participants</div></div>
  <div class="programme-item"><span class="programme-ic">🏆</span><span class="programme-time">16h30</span><div>Remise des prix</div></div>
  <div style="margin-top:12px;font-size:.82rem;color:#3d1830">📍 <strong>Parc des Bretonnières</strong> — Joué-lès-Tours</div>
</div>

<div class="card" style="margin-bottom:22px">
  <h3>👟 Ce qu'il faut apporter</h3>
  <div class="liste-item"><span>👕</span><div>Tenue de sport + T-Shirt de votre organisation</div></div>
  <div class="liste-item"><span>👟</span><div>Chaussures de running</div></div>
  <div class="liste-item"><span>💧</span><div>Bouteille d'eau (de l'eau sera disponible sur site)</div></div>
  <div class="liste-item"><span>📱</span><div>CB/Tél pour faire des dons en live</div></div>
  <div class="liste-item"><span>⚡</span><div>Votre énergie et votre bonne humeur !</div></div>
</div>

<div class="note magenta">🎽 <strong>Votre dossard</strong><br>Vous recevrez un email la veille, le <strong>jeudi 28 mai</strong>, avec votre numéro de dossard. Il ne vous restera plus qu'à le récupérer sur place dès 13h00 !</div>

<div style="text-align:center;margin-bottom:20px">
  <div style="font-size:.78rem;color:#3d1830;margin-bottom:10px;text-align:left">🔍 <strong>Dossards disponibles</strong> la veille au soir (28 mai, 21h max) — <strong>résultats de la course</strong> disponibles le lundi 1er juin 18h max.</div>
  <a href="https://upe-bot.github.io/defi-enfance-dossard/index.html" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🎽 Retrouver mon dossard &amp; mes résultats</a>
</div>

<div style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:20px 24px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email prêt à envoyer à vos proches</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,0.5);margin-bottom:16px">Copiez-collez ce message à vos amis, collègues, clients, fournisseurs…</div>
  <div style="background:#fff;border-radius:10px;padding:20px 22px">
    <div style="font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Objet</div>
    <div style="font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px">Plus qu'un défi sportif, une urgence pour l'enfance 🏁</div>
    <div style="font-size:.82rem;color:#3d1830;line-height:1.8">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris parce que je cours le <strong>29 mai à Joué-lès-Tours</strong> pour le Défi Enfance — et j'ai besoin de ton soutien !</p>
      <p style="margin:0 0 12px">Le secteur de l'aide à l'enfance traverse une crise sans précédent. Le Défi Enfance finance des projets innovants pour <strong>casser les silos</strong> et placer l'intérêt de l'enfant au centre. Les fonds sont directement fléchés vers l'association choisie par mon équipe.</p>
      <p style="margin:0 0 12px">Tu peux me soutenir de deux façons :<br>👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don direct</a><br>👉 <a href="${urlProm}" style="color:#7c3aed;font-weight:600">Promettre un don au km</a> — tu choisis un montant par km que je parcours, et tu verses seulement le soir de la course selon ma performance !</p>
      <div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem">💡 <strong>Ton don est défiscalisé à hauteur de 66%.</strong> Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0 0 12px">Un immense merci pour ton soutien !</p>
      <p style="margin:0">À très vite,<br><strong>${prenom}</strong></p>
    </div>
  </div>
</div>

${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_IFI}${BLOC_RECUS_FISCAUX}
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;line-height:1.8">Pour toute question : <a href="mailto:contact@defienfance.com" style="color:#fb0089;font-weight:600">contact@defienfance.com</a> 📩<br><br><strong>On vous attend avec impatience — allez, plus que ${j} jours ! 🏁</strong></div>
<div style="margin-top:16px;font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— L'équipe du Défi Enfance 🤲</div>

</div></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></td></tr></table></div></td></tr></table></body></html>`;
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



// ── Classements Défi Enfance Angers 2026 (intégrés)
const CLASSEMENT_INDIVIDUEL = {
  545: { classement: 1, nbTours: 29, nom: "GAUDY Wilfried", equipe: "AXA Prévoyance et Patrimoine", kms: 23.78 },
  532: { classement: 2, nbTours: 29, nom: "LEBRETON Victor", equipe: "Pas à Pas 49", kms: 23.78 },
  181: { classement: 3, nbTours: 26, nom: "LEGUY Emmanuel", equipe: "Becouze", kms: 21.32 },
  460: { classement: 4, nbTours: 26, nom: "BOISNEAU Pierre", equipe: "6e Régiment du Génie d\'Angers", kms: 21.32 },
  75: { classement: 5, nbTours: 26, nom: "DELORME Aurélien", equipe: "Becouze", kms: 21.32 },
  57: { classement: 6, nbTours: 26, nom: "DUBAIL Arthur", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 21.32 },
  317: { classement: 7, nbTours: 26, nom: "LEBORGNE Léopold", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 21.32 },
  567: { classement: 8, nbTours: 26, nom: "GENET DE CHATENAY Baptiste", equipe: "Les pompiers du SDIS 49", kms: 21.32 },
  605: { classement: 9, nbTours: 26, nom: "LAFLEUR Marc", equipe: "Les pompiers du SDIS 49", kms: 21.32 },
  109: { classement: 10, nbTours: 26, nom: "DUFRÊNE Camille", equipe: "Pause Angevine - UPE", kms: 21.32 },
  406: { classement: 11, nbTours: 26, nom: "SOURISSEAU Mélissa", equipe: "Campus Coach Angers", kms: 21.32 },
  552: { classement: 12, nbTours: 25, nom: "(COLIBRI) Yoan", equipe: "Colibri", kms: 20.5 },
  471: { classement: 13, nbTours: 25, nom: "LUISIER Rémy", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 20.5 },
  176: { classement: 14, nbTours: 25, nom: "MIRET Eloi", equipe: "Nameshield", kms: 20.5 },
  193: { classement: 15, nbTours: 25, nom: "PETIT Étienne", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 20.5 },
  436: { classement: 16, nbTours: 25, nom: "VESNIER Paola", equipe: "Paola Vesnier", kms: 20.5 },
  194: { classement: 17, nbTours: 25, nom: "SUBRA Étienne", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 20.5 },
  137: { classement: 18, nbTours: 25, nom: "ROCHE Christophe", equipe: "Octopus Patrimoine", kms: 20.5 },
  336: { classement: 19, nbTours: 24, nom: "MALLET LOUIS", equipe: "Ecole Saint Serge", kms: 19.68 },
  383: { classement: 20, nbTours: 24, nom: "SOULARD Marion", equipe: "Marie Durand", kms: 19.68 },
  302: { classement: 21, nbTours: 24, nom: "DE LA ROUSSERIE Lancelot", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 19.68 },
  229: { classement: 22, nbTours: 24, nom: "KOFFI Guillaume", equipe: "Guillaume KOFFI", kms: 19.68 },
  59: { classement: 23, nbTours: 24, nom: "ROUSSEAU Arthur", equipe: "AXA Prévoyance et Patrimoine", kms: 19.68 },
  415: { classement: 24, nbTours: 24, nom: "DEVOS Muriel", equipe: "FSDV", kms: 19.68 },
  29: { classement: 25, nbTours: 24, nom: "JACQUET Alix", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 19.68 },
  97: { classement: 26, nbTours: 23, nom: "MAÏSTO Benoît", equipe: "6e Régiment du Génie d\'Angers", kms: 18.86 },
  17: { classement: 27, nbTours: 23, nom: "MILLE Alexandre", equipe: "Nameshield", kms: 18.86 },
  163: { classement: 28, nbTours: 23, nom: "COSNEAU Dom", equipe: "Réseau Entreprendre Maine et Loire", kms: 18.86 },
  129: { classement: 29, nbTours: 23, nom: "RAYNAUD DE FITTE Charles", equipe: "Saint Jean Espérance", kms: 18.86 },
  222: { classement: 30, nbTours: 23, nom: "GERBIER Gaspard", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 18.86 },
  257: { classement: 31, nbTours: 23, nom: "ROLAND Jean", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 18.86 },
  344: { classement: 32, nbTours: 22, nom: "LE PERRU Lucille", equipe: "Becouze", kms: 18.04 },
  634: { classement: 33, nbTours: 22, nom: "MOUSSA Konate", equipe: "Agapè Anjou", kms: 18.04 },
  39: { classement: 34, nbTours: 22, nom: "CHAMPION Amélie", equipe: "FSDV", kms: 18.04 },
  432: { classement: 35, nbTours: 22, nom: "TETARD Olivier", equipe: "Angers Technopole", kms: 18.04 },
  113: { classement: 36, nbTours: 22, nom: "CHALET Candice", equipe: "Candice Chalet", kms: 18.04 },
  7: { classement: 37, nbTours: 22, nom: "(COLIBRI) Adrien", equipe: "Colibri", kms: 18.04 },
  547: { classement: 38, nbTours: 22, nom: "LEGUEN Xavier", equipe: "FSDV", kms: 18.04 },
  519: { classement: 39, nbTours: 22, nom: "PATTYN Thomas", equipe: "AXA Prévoyance et Patrimoine", kms: 18.04 },
  110: { classement: 40, nbTours: 22, nom: "DUVEAU Camille", equipe: "Becouze", kms: 18.04 },
  521: { classement: 41, nbTours: 22, nom: "BONHOURE Timothée", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 18.04 },
  409: { classement: 42, nbTours: 22, nom: "BOUTIN Michel", equipe: "123 Cessions", kms: 18.04 },
  542: { classement: 43, nbTours: 22, nom: "MOLS VIVIANE Viviane", equipe: "Réseau Entreprendre Maine et Loire", kms: 18.04 },
  326: { classement: 44, nbTours: 22, nom: "MALET Loïc", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 18.04 },
  98: { classement: 45, nbTours: 21, nom: "TERTRAIS Bertrand", equipe: "AXA Prévoyance et Patrimoine", kms: 17.22 },
  370: { classement: 46, nbTours: 21, nom: "THOMAS Manon", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 17.22 },
  368: { classement: 47, nbTours: 21, nom: "MICHENEAU Manon", equipe: "Marie Durand", kms: 17.22 },
  43: { classement: 48, nbTours: 21, nom: "HIRON Anaïs", equipe: "Anaïs Hiron", kms: 17.22 },
  335: { classement: 49, nbTours: 21, nom: "DE LA ROUSSERIE Louis", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 17.22 },
  402: { classement: 50, nbTours: 21, nom: "DE ROECK Mayeul", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 17.22 },
  581: { classement: 51, nbTours: 21, nom: "TOUCHET Damien", equipe: "Les pompiers du SDIS 49", kms: 17.22 },
  311: { classement: 52, nbTours: 21, nom: "ROUGER Léandre", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 17.22 },
  287: { classement: 53, nbTours: 20, nom: "HAVARD Julien", equipe: "6e Régiment du Génie d\'Angers", kms: 16.4 },
  182: { classement: 54, nbTours: 20, nom: "PARMENTIER Emmanuel", equipe: "AXA Prévoyance et Patrimoine", kms: 16.4 },
  27: { classement: 55, nbTours: 20, nom: "FLAMA Alix", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 16.4 },
  510: { classement: 56, nbTours: 20, nom: "RAMÉ Théodore", equipe: "FSDV", kms: 16.4 },
  65: { classement: 57, nbTours: 20, nom: "ROMBOUT AUBIN", equipe: "Pause Angevine - UPE", kms: 16.4 },
  274: { classement: 58, nbTours: 20, nom: "RENOUL Joseph", equipe: "Saint Jean Espérance", kms: 16.4 },
  423: { classement: 59, nbTours: 20, nom: "RAMÉ Nicolas", equipe: "FSDV", kms: 16.4 },
  63: { classement: 60, nbTours: 20, nom: "ER RAMACH Atimad", equipe: "N.I.A.H.", kms: 16.4 },
  127: { classement: 61, nbTours: 20, nom: "DE MOLLANS Charles", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 16.4 },
  185: { classement: 62, nbTours: 20, nom: "GABORY Enzo", equipe: "SDEL Energis Angers", kms: 16.4 },
  543: { classement: 63, nbTours: 20, nom: "GAZOUM Wahid", equipe: "Wahid Gazoum", kms: 16.4 },
  143: { classement: 64, nbTours: 20, nom: "JACQUET Clémence", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 16.4 },
  602: { classement: 65, nbTours: 20, nom: "JARRY Ludovic", equipe: "Les pompiers du SDIS 49", kms: 16.4 },
  474: { classement: 66, nbTours: 19, nom: "BERTHET Robinson", equipe: "Campus ESPL", kms: 15.58 },
  51: { classement: 67, nbTours: 19, nom: "BOURSIN Anthony", equipe: "Becouze", kms: 15.58 },
  501: { classement: 68, nbTours: 19, nom: "VERARDO Sylvain", equipe: "Sylvain Verardo", kms: 15.58 },
  283: { classement: 69, nbTours: 19, nom: "ROY JULES", equipe: "Ecole Saint Serge", kms: 15.58 },
  452: { classement: 70, nbTours: 19, nom: "BEAUDOIN Pavel", equipe: "AFOCAL", kms: 15.58 },
  220: { classement: 71, nbTours: 19, nom: "TEPA Gaël", equipe: "6e Régiment du Génie d\'Angers", kms: 15.58 },
  238: { classement: 72, nbTours: 19, nom: "PEZET HELIO", equipe: "Ecole Saint Serge", kms: 15.58 },
  14: { classement: 73, nbTours: 19, nom: "AUTIN alexandre", equipe: "6e Régiment du Génie d\'Angers", kms: 15.58 },
  175: { classement: 74, nbTours: 19, nom: "BAUMARD Eloi", equipe: "Ecole Saint Serge", kms: 15.58 },
  380: { classement: 75, nbTours: 19, nom: "DE LA VILLESBOISNET Marie-Liesse", equipe: "Marie-Liesse de La Villesboisnet", kms: 15.58 },
  150: { classement: 76, nbTours: 19, nom: "BELLIN Coralie", equipe: "Coralie Belin", kms: 15.58 },
  189: { classement: 77, nbTours: 19, nom: "MARIAS Erin", equipe: "Marie Durand", kms: 15.58 },
  600: { classement: 78, nbTours: 19, nom: "LARDEUX Louann", equipe: "Les pompiers du SDIS 49", kms: 15.58 },
  608: { classement: 79, nbTours: 19, nom: "HUMEAU Marine", equipe: "Les pompiers du SDIS 49", kms: 15.58 },
  19: { classement: 80, nbTours: 19, nom: "CHATELIER Alexis", equipe: "FSDV", kms: 15.58 },
  11: { classement: 81, nbTours: 18, nom: "MACKAY Alasdair", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  524: { classement: 82, nbTours: 18, nom: "PAHI Tiurai", equipe: "6e Régiment du Génie d\'Angers", kms: 14.76 },
  523: { classement: 83, nbTours: 18, nom: "ARAI Tita", equipe: "6e Régiment du Génie d\'Angers", kms: 14.76 },
  174: { classement: 84, nbTours: 18, nom: "SAIVRE Elodie", equipe: "Solar Bird", kms: 14.76 },
  494: { classement: 85, nbTours: 18, nom: "POULAIN stanislas", equipe: "Solar Bird", kms: 14.76 },
  205: { classement: 86, nbTours: 18, nom: "DES JAMONIERES Félicie", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  546: { classement: 87, nbTours: 18, nom: "MICHEL WILLIAM", equipe: "Marie Durand", kms: 14.76 },
  214: { classement: 88, nbTours: 18, nom: "LE GRELLE Fr Eric", equipe: "Saint Jean Espérance", kms: 14.76 },
  343: { classement: 89, nbTours: 18, nom: "DE MAS LATRIE Lucile", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  55: { classement: 90, nbTours: 18, nom: "JOLIVET Arnaud", equipe: "Nameshield", kms: 14.76 },
  403: { classement: 91, nbTours: 18, nom: "PELÉ Mélanie", equipe: "FSDV", kms: 14.76 },
  112: { classement: 92, nbTours: 18, nom: "MOREAU Camille", equipe: "FSDV", kms: 14.76 },
  367: { classement: 93, nbTours: 18, nom: "MÊME Manon", equipe: "FSDV", kms: 14.76 },
  341: { classement: 94, nbTours: 18, nom: "CASTAY Lucie", equipe: "FSDV", kms: 14.76 },
  149: { classement: 95, nbTours: 18, nom: "LAMALLE Côme", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  288: { classement: 96, nbTours: 18, nom: "LEMARCHAND Julien", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 14.76 },
  446: { classement: 97, nbTours: 18, nom: "POUPON Paul", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  4: { classement: 98, nbTours: 18, nom: "RAMÉ Adélaïde", equipe: "FSDV", kms: 14.76 },
  240: { classement: 99, nbTours: 18, nom: "PEDERSEN Héloïse", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  83: { classement: 100, nbTours: 18, nom: "MARIE-JEANNE Aymeric", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  70: { classement: 101, nbTours: 18, nom: "DE BAGNEAUX Augustin", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  177: { classement: 102, nbTours: 18, nom: "CHATIN DE CHASTAING Elvire", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  431: { classement: 103, nbTours: 18, nom: "CHEVILLARD Olivier", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  306: { classement: 104, nbTours: 18, nom: "ROCHAIS Laurie", equipe: "Marie Durand", kms: 14.76 },
  458: { classement: 105, nbTours: 18, nom: "DE MAS LATRIE Pia", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  272: { classement: 106, nbTours: 18, nom: "DE QUATREBARBES Joseph", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 14.76 },
  299: { classement: 107, nbTours: 17, nom: "MITTON KEVIN", equipe: "Assureurs associés", kms: 13.94 },
  633: { classement: 108, nbTours: 17, nom: "LYLIA Sieger", equipe: "6e Régiment du Génie d\'Angers", kms: 13.94 },
  316: { classement: 109, nbTours: 17, nom: "BOLO Léopold", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  87: { classement: 110, nbTours: 17, nom: "REYNARD BAPTISTE", equipe: "Ecole Saint Serge", kms: 13.94 },
  442: { classement: 111, nbTours: 17, nom: "BLANDIN Paul", equipe: "Ecole Saint Serge", kms: 13.94 },
  128: { classement: 112, nbTours: 17, nom: "GASCOGNE Charles", equipe: "Octopus Patrimoine", kms: 13.94 },
  466: { classement: 113, nbTours: 17, nom: "MOREAU Quentin", equipe: "Solar Bird", kms: 13.94 },
  506: { classement: 114, nbTours: 17, nom: "BABOU Teo", equipe: "Saint Jean Espérance", kms: 13.94 },
  187: { classement: 115, nbTours: 17, nom: "MEDARD Enzo", equipe: "Enzo Medard", kms: 13.94 },
  437: { classement: 116, nbTours: 17, nom: "YOU Pascale", equipe: "Saint Jean Espérance", kms: 13.94 },
  102: { classement: 117, nbTours: 17, nom: "DE MOLLANS Blandine", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  221: { classement: 118, nbTours: 17, nom: "BRANCOUR Gaëtane", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  201: { classement: 119, nbTours: 17, nom: "MAILLET Evelyne", equipe: "Angers Technopole", kms: 13.94 },
  282: { classement: 120, nbTours: 17, nom: "HERIDEL Jules", equipe: "Réseau Entreprendre Maine et Loire", kms: 13.94 },
  269: { classement: 121, nbTours: 17, nom: "JAMIN Joffrey", equipe: "FSDV", kms: 13.94 },
  186: { classement: 122, nbTours: 17, nom: "LAVAUD Enzo", equipe: "Campus ESPL", kms: 13.94 },
  329: { classement: 123, nbTours: 17, nom: "GODINEAU Lolita", equipe: "Marie Durand", kms: 13.94 },
  618: { classement: 124, nbTours: 17, nom: "POLLET Scarlett", equipe: "ANJOU LOIRE TERRITOIRE", kms: 13.94 },
  262: { classement: 125, nbTours: 17, nom: "KUN-DARBOIS Jeanne", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  404: { classement: 126, nbTours: 17, nom: "BONHOURE Melchior", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  90: { classement: 127, nbTours: 17, nom: "BOUSQUET Baudouin", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  484: { classement: 128, nbTours: 17, nom: "HERUBEL Sixtine", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  630: { classement: 129, nbTours: 17, nom: "QUEINNEC Tanguy", equipe: "Marie Durand", kms: 13.94 },
  580: { classement: 130, nbTours: 17, nom: "THOMY Cyrille", equipe: "Les pompiers du SDIS 49", kms: 13.94 },
  145: { classement: 131, nbTours: 17, nom: "JERRO Clement", equipe: "Saint Jean Espérance", kms: 13.94 },
  325: { classement: 132, nbTours: 17, nom: "CHAUVIN Lise", equipe: "FSDV", kms: 13.94 },
  429: { classement: 133, nbTours: 17, nom: "DE VILLELE Olga", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.94 },
  492: { classement: 134, nbTours: 16, nom: "LEROUX Sophie", equipe: "La Rose Fraternelle", kms: 13.12 },
  505: { classement: 135, nbTours: 16, nom: "GIRMAY Teame", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 13.12 },
  556: { classement: 136, nbTours: 16, nom: "GOMIS FOURNIER Youri", equipe: "Ecole Saint Serge", kms: 13.12 },
  217: { classement: 137, nbTours: 16, nom: "CLABAU Frédéric", equipe: "Angers Technopole", kms: 13.12 },
  359: { classement: 138, nbTours: 16, nom: "AMARI LEGOT Malek", equipe: "Ecole Saint Serge", kms: 13.12 },
  192: { classement: 139, nbTours: 16, nom: "DELETANG Ethan", equipe: "Agapè Anjou", kms: 13.12 },
  58: { classement: 140, nbTours: 16, nom: "DUBOIS STOYANOV Arthur", equipe: "Ecole Saint Serge", kms: 13.12 },
  365: { classement: 141, nbTours: 16, nom: "CARRÉ Manon", equipe: "Octopus Patrimoine", kms: 13.12 },
  54: { classement: 142, nbTours: 16, nom: "BOULERY Arnaud", equipe: "Octopus Patrimoine", kms: 13.12 },
  337: { classement: 143, nbTours: 16, nom: "RICHER Louis", equipe: "Solar Bird", kms: 13.12 },
  650: { classement: 144, nbTours: 16, nom: "ALEXANDRA Dubois", equipe: "Ecole Saint Serge", kms: 13.12 },
  563: { classement: 145, nbTours: 16, nom: "HERAULT Antoine", equipe: "Les pompiers du SDIS 49", kms: 13.12 },
  467: { classement: 146, nbTours: 16, nom: "PERCHAIS Quitterie", equipe: "Quitterie Perchais", kms: 13.12 },
  374: { classement: 147, nbTours: 16, nom: "FURET Marie", equipe: "Marie Furet", kms: 13.12 },
  465: { classement: 148, nbTours: 16, nom: "FRESNAIS Quentin", equipe: "Solar Bird", kms: 13.12 },
  197: { classement: 149, nbTours: 16, nom: "KUN-DARBOIS Eugénie", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.12 },
  156: { classement: 150, nbTours: 16, nom: "OSMAN MADHI Deka", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 13.12 },
  6: { classement: 151, nbTours: 16, nom: "BERGEROT Adèle", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.12 },
  332: { classement: 152, nbTours: 16, nom: "MORIANCOURT Lou", equipe: "Réseau Entreprendre Maine et Loire", kms: 13.12 },
  256: { classement: 153, nbTours: 16, nom: "FEYBESSE Jade", equipe: "Jade feybesse", kms: 13.12 },
  652: { classement: 154, nbTours: 16, nom: "LOICE Dureau", equipe: "Marie Durand", kms: 13.12 },
  226: { classement: 155, nbTours: 16, nom: "THOMAS Gregory", equipe: "Marie Durand", kms: 13.12 },
  86: { classement: 156, nbTours: 16, nom: "MOCQUET Baptiste", equipe: "ANJOU LOIRE TERRITOIRE", kms: 13.12 },
  234: { classement: 157, nbTours: 16, nom: "EL QASSIMI Haitam", equipe: "Campus ESPL", kms: 13.12 },
  334: { classement: 158, nbTours: 16, nom: "COLLOT Louis", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.12 },
  470: { classement: 159, nbTours: 16, nom: "MARIAS Rebecca", equipe: "Marie Durand", kms: 13.12 },
  509: { classement: 160, nbTours: 16, nom: "D\'OYSONVILLE Théodore", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.12 },
  216: { classement: 161, nbTours: 16, nom: "PETIT François", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 13.12 },
  576: { classement: 162, nbTours: 16, nom: "HERVE Corentin", equipe: "Les pompiers du SDIS 49", kms: 13.12 },
  612: { classement: 163, nbTours: 16, nom: "VIDREQUIN Mickael", equipe: "Les pompiers du SDIS 49", kms: 13.12 },
  598: { classement: 164, nbTours: 16, nom: "RETHORE Kevin", equipe: "Les pompiers du SDIS 49", kms: 13.12 },
  40: { classement: 165, nbTours: 16, nom: "RAMÉ Amicie", equipe: "FSDV", kms: 13.12 },
  104: { classement: 166, nbTours: 15, nom: "DIALLO Boubacar", equipe: "T\'CAP-T\'PRO", kms: 12.3 },
  243: { classement: 167, nbTours: 15, nom: "CROCOMBETTE Hilaire", equipe: "Excellence Ruralités", kms: 12.3 },
  611: { classement: 168, nbTours: 15, nom: "CHALLET Maxime", equipe: "ANJOU LOIRE TERRITOIRE", kms: 12.3 },
  388: { classement: 169, nbTours: 15, nom: "AIGRON Mathéo", equipe: "La Rose Fraternelle", kms: 12.3 },
  277: { classement: 170, nbTours: 15, nom: "YLEND Joy", equipe: "Ecole Saint Serge", kms: 12.3 },
  165: { classement: 171, nbTours: 15, nom: "MARTINET EDGAR", equipe: "Ecole Saint Serge", kms: 12.3 },
  190: { classement: 172, nbTours: 15, nom: "CHENE Estéban", equipe: "Ecole Saint Serge", kms: 12.3 },
  232: { classement: 173, nbTours: 15, nom: "TRIN Guillaume", equipe: "Octopus Patrimoine", kms: 12.3 },
  358: { classement: 174, nbTours: 15, nom: "CHIFFOLEAU Maia", equipe: "Ecole Saint Serge", kms: 12.3 },
  472: { classement: 175, nbTours: 15, nom: "QIAL Riad", equipe: "Ecole Saint Serge", kms: 12.3 },
  445: { classement: 176, nbTours: 15, nom: "MILLAN Paul", equipe: "Saint Jean Espérance", kms: 12.3 },
  89: { classement: 177, nbTours: 15, nom: "MAUSSION Bastien", equipe: "FSDV", kms: 12.3 },
  296: { classement: 178, nbTours: 15, nom: "PERREAULT Karine", equipe: "FSDV", kms: 12.3 },
  541: { classement: 179, nbTours: 15, nom: "PAYRAUDEAU Virginie", equipe: "FSDV", kms: 12.3 },
  157: { classement: 180, nbTours: 15, nom: "DELOBELLE Delphine", equipe: "Agapè Anjou", kms: 12.3 },
  270: { classement: 181, nbTours: 15, nom: "AUPIAIS Johann", equipe: "FSDV", kms: 12.3 },
  462: { classement: 182, nbTours: 15, nom: "LEUYET Pierre", equipe: "Saint Jean Espérance", kms: 12.3 },
  121: { classement: 183, nbTours: 15, nom: "LEMALE Célestin", equipe: "AFOCAL", kms: 12.3 },
  289: { classement: 184, nbTours: 15, nom: "LORAND Juliette", equipe: "AFOCAL", kms: 12.3 },
  107: { classement: 185, nbTours: 15, nom: "BOISSEAU Camille", equipe: "Campus Coach Angers", kms: 12.3 },
  515: { classement: 186, nbTours: 15, nom: "SUBRANNE Thierry", equipe: "Thierry Subranne", kms: 12.3 },
  88: { classement: 187, nbTours: 15, nom: "BENAYAD Basma", equipe: "N.I.A.H.", kms: 12.3 },
  133: { classement: 188, nbTours: 15, nom: "PITON chloé", equipe: "chloé piton", kms: 12.3 },
  198: { classement: 189, nbTours: 15, nom: "VINCENT Eugénie", equipe: "ARIFTS", kms: 12.3 },
  303: { classement: 190, nbTours: 15, nom: "BRILLET Laura", equipe: "Réseau Entreprendre Maine et Loire", kms: 12.3 },
  258: { classement: 191, nbTours: 15, nom: "BEUQUE Jean-Lin", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 12.3 },
  427: { classement: 192, nbTours: 15, nom: "FOURNIER Océane", equipe: "Réseau Entreprendre Maine et Loire", kms: 12.3 },
  557: { classement: 193, nbTours: 15, nom: "ANTHONIOZ Yves", equipe: "Saint Jean Espérance", kms: 12.3 },
  397: { classement: 194, nbTours: 15, nom: "MELIN Maxime", equipe: "SDEL Energis Angers", kms: 12.3 },
  2: { classement: 195, nbTours: 15, nom: "LAHROU Abla", equipe: "N.I.A.H.", kms: 12.3 },
  339: { classement: 196, nbTours: 15, nom: "TESSIER Louise", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 12.3 },
  517: { classement: 197, nbTours: 15, nom: "DE FLAUJAC Thomas", equipe: "Saint Jean Espérance", kms: 12.3 },
  242: { classement: 198, nbTours: 14, nom: "(COLIBRI) Hermann", equipe: "Colibri", kms: 11.48 },
  224: { classement: 199, nbTours: 14, nom: "CHATIN DE CHASTAING Gladys", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 11.48 },
  233: { classement: 200, nbTours: 14, nom: "MARY Gwen", equipe: "Département de Maine-et-Loire", kms: 11.48 },
  440: { classement: 201, nbTours: 14, nom: "JANNIN Patricia", equipe: "Yendouboame", kms: 11.48 },
  482: { classement: 202, nbTours: 14, nom: "LEDROIT Sarah", equipe: "6e Régiment du Génie d\'Angers", kms: 11.48 },
  119: { classement: 203, nbTours: 14, nom: "DIEPPEDALLE Cécile", equipe: "Becouze", kms: 11.48 },
  401: { classement: 204, nbTours: 14, nom: "BEUQUE Mayeul", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 11.48 },
  461: { classement: 205, nbTours: 14, nom: "COTTREAU Pierre", equipe: "Nameshield", kms: 11.48 },
  292: { classement: 206, nbTours: 14, nom: "MARTINIS Justine", equipe: "Nameshield", kms: 11.48 },
  516: { classement: 207, nbTours: 14, nom: "DABOUT Thomas", equipe: "Nameshield", kms: 11.48 },
  223: { classement: 208, nbTours: 14, nom: "BOUSQUET Gauthier", equipe: "Le Gouvernail", kms: 11.48 },
  152: { classement: 209, nbTours: 14, nom: "GESLIN Cyriaque", equipe: "Le Gouvernail", kms: 11.48 },
  246: { classement: 210, nbTours: 14, nom: "ZENAINI Ilias", equipe: "La Rose Fraternelle", kms: 11.48 },
  166: { classement: 211, nbTours: 14, nom: "APALONE Efraim", equipe: "La Rose Fraternelle", kms: 11.48 },
  398: { classement: 212, nbTours: 14, nom: "POUILLART MAXIME", equipe: "Ecole Saint Serge", kms: 11.48 },
  384: { classement: 213, nbTours: 14, nom: "GOURDON Marley", equipe: "Ecole Saint Serge", kms: 11.48 },
  638: { classement: 214, nbTours: 14, nom: "NOA Motteau", equipe: "Agapè Anjou", kms: 11.48 },
  211: { classement: 215, nbTours: 14, nom: "LABRUT Florian", equipe: "FSDV", kms: 11.48 },
  140: { classement: 216, nbTours: 14, nom: "ALLAIS Claude", equipe: "La cravate solidaire", kms: 11.48 },
  392: { classement: 217, nbTours: 14, nom: "GAUMER Maud", equipe: "Maud GAUMER", kms: 11.48 },
  488: { classement: 218, nbTours: 14, nom: "ROBERT Solene", equipe: "Solene ROBERT", kms: 11.48 },
  84: { classement: 219, nbTours: 14, nom: "BEILLARD Baptiste", equipe: "LVA Le Logis", kms: 11.48 },
  85: { classement: 220, nbTours: 14, nom: "BOLO Baptiste", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 11.48 },
  148: { classement: 221, nbTours: 14, nom: "DE LA VOLPILIERE Clotilde", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 11.48 },
  356: { classement: 222, nbTours: 14, nom: "SCOFFIER Maguelone", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 11.48 },
  421: { classement: 223, nbTours: 14, nom: "ATONATTY Nicolas", equipe: "AXA Prévoyance et Patrimoine", kms: 11.48 },
  441: { classement: 224, nbTours: 14, nom: "GUENANTEN Patrick", equipe: "AXA Prévoyance et Patrimoine", kms: 11.48 },
  450: { classement: 225, nbTours: 14, nom: "LAROCHE Pauline", equipe: "Marie Durand", kms: 11.48 },
  405: { classement: 226, nbTours: 14, nom: "JUDEE Melie", equipe: "Marie Durand", kms: 11.48 },
  613: { classement: 227, nbTours: 14, nom: "BENDCOR Nelwel", equipe: "ETHIK KEHF", kms: 11.48 },
  577: { classement: 228, nbTours: 14, nom: "PRAMPART Corentin", equipe: "ETHIK KEHF", kms: 11.48 },
  310: { classement: 229, nbTours: 14, nom: "LEMASSON Léa", equipe: "SDEL Energis Angers", kms: 11.48 },
  559: { classement: 230, nbTours: 14, nom: "DE LA CROIX Zita", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 11.48 },
  586: { classement: 231, nbTours: 14, nom: "BOUCHET Fabien", equipe: "Les pompiers du SDIS 49", kms: 11.48 },
  497: { classement: 232, nbTours: 13, nom: "CHAVANES Suzanne", equipe: "Le Gouvernail", kms: 10.66 },
  375: { classement: 233, nbTours: 13, nom: "THIBIERGE marie", equipe: "La Tilma", kms: 10.66 },
  419: { classement: 234, nbTours: 13, nom: "DARRAS Nathalie", equipe: "La Tilma", kms: 10.66 },
  535: { classement: 235, nbTours: 13, nom: "WILLOTEAUX Victor", equipe: "Campus ESPL", kms: 10.66 },
  263: { classement: 236, nbTours: 13, nom: "BLOT Jean-Philippe", equipe: "SDEL Energis Angers", kms: 10.66 },
  96: { classement: 237, nbTours: 13, nom: "MESSIE Benoit", equipe: "Assureurs associés", kms: 10.66 },
  530: { classement: 238, nbTours: 13, nom: "DE BAGNEAUX Vianney", equipe: "Vianney de Bagneaux", kms: 10.66 },
  381: { classement: 239, nbTours: 13, nom: "TEVENINO Marie-rose", equipe: "6e Régiment du Génie d\'Angers", kms: 10.66 },
  417: { classement: 240, nbTours: 13, nom: "MYRIAM LUISIER Myriam", equipe: "La Rose Fraternelle", kms: 10.66 },
  92: { classement: 241, nbTours: 13, nom: "FRIA Baya", equipe: "Agapè Anjou", kms: 10.66 },
  568: { classement: 242, nbTours: 13, nom: "PICARD Béatrice", equipe: "Les pompiers du SDIS 49", kms: 10.66 },
  78: { classement: 243, nbTours: 13, nom: "VERNIER-ESNAULT Aurore", equipe: "ALDEV", kms: 10.66 },
  61: { classement: 244, nbTours: 13, nom: "LE PICART Asaël-Néhémie", equipe: "Ecole Saint Serge", kms: 10.66 },
  47: { classement: 245, nbTours: 13, nom: "TESSON Anne-Sophie", equipe: "Anne-Sophie Tesson", kms: 10.66 },
  276: { classement: 246, nbTours: 13, nom: "BILLOUIN Joulia", equipe: "Ecole Saint Serge", kms: 10.66 },
  26: { classement: 247, nbTours: 13, nom: "BOUVIER ALIX", equipe: "Ecole Saint Serge", kms: 10.66 },
  321: { classement: 248, nbTours: 13, nom: "DOUCET-BLIN LILOU", equipe: "Ecole Saint Serge", kms: 10.66 },
  447: { classement: 249, nbTours: 13, nom: "PROVOST PAUL", equipe: "Octopus Patrimoine", kms: 10.66 },
  72: { classement: 250, nbTours: 13, nom: "GAUD Aurélie", equipe: "Aurélie Gaud", kms: 10.66 },
  304: { classement: 251, nbTours: 13, nom: "ZASSO Lauren", equipe: "Lauren Zasso", kms: 10.66 },
  378: { classement: 252, nbTours: 13, nom: "ANSCUTTER Marieke", equipe: "FSDV", kms: 10.66 },
  315: { classement: 253, nbTours: 13, nom: "DE FOUGEROUX Léontine", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 10.66 },
  639: { classement: 254, nbTours: 13, nom: "ELVINA Jacquet", equipe: "Agapè Anjou", kms: 10.66 },
  549: { classement: 255, nbTours: 13, nom: "SCHNABEL Yann", equipe: "Saint Jean Espérance", kms: 10.66 },
  433: { classement: 256, nbTours: 13, nom: "BESNIER Ombline", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 10.66 },
  23: { classement: 257, nbTours: 13, nom: "RIVIERE Alice", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 10.66 },
  588: { classement: 258, nbTours: 13, nom: "ADOUM IDRISS Fatimé", equipe: "ETHIK KEHF", kms: 10.66 },
  235: { classement: 259, nbTours: 13, nom: "JOUSSEAUME PETIT Héléna", equipe: "AXA Prévoyance et Patrimoine", kms: 10.66 },
  411: { classement: 260, nbTours: 13, nom: "POTTIER Mickael", equipe: "SDEL Energis Angers", kms: 10.66 },
  322: { classement: 261, nbTours: 13, nom: "NEDELCHEVA Lina", equipe: "Nameshield", kms: 10.66 },
  486: { classement: 262, nbTours: 13, nom: "LECOQ-VALLON Sixtine", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 10.66 },
  408: { classement: 263, nbTours: 13, nom: "PAPIN Menehould", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 10.66 },
  475: { classement: 264, nbTours: 13, nom: "DE QUATREBARBES Roch", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 10.66 },
  81: { classement: 265, nbTours: 13, nom: "(COLIBRI) Ayaan", equipe: "Colibri", kms: 10.66 },
  122: { classement: 266, nbTours: 13, nom: "PUEL Célestin", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 10.66 },
  512: { classement: 267, nbTours: 12, nom: "GALLOUEDEC Thibault", equipe: "À Deux Mains", kms: 9.84 },
  520: { classement: 268, nbTours: 12, nom: "ROBIN Timéo", equipe: "T\'CAP-T\'PRO", kms: 9.84 },
  361: { classement: 269, nbTours: 12, nom: "DIALLO Mamadou Aliou", equipe: "T\'CAP-T\'PRO", kms: 9.84 },
  544: { classement: 270, nbTours: 12, nom: "CESBRON Wilfried", equipe: "Wilfried Cesbron", kms: 9.84 },
  617: { classement: 271, nbTours: 12, nom: "DEGUIL Sarah", equipe: "ANJOU LOIRE TERRITOIRE", kms: 9.84 },
  366: { classement: 272, nbTours: 12, nom: "CHEDET Manon", equipe: "Campus ESPL", kms: 9.84 },
  513: { classement: 273, nbTours: 12, nom: "ROYER thibault", equipe: "ADEPAPE-Repairs! 49", kms: 9.84 },
  24: { classement: 274, nbTours: 12, nom: "PEHU Alicia", equipe: "Assureurs associés", kms: 9.84 },
  105: { classement: 275, nbTours: 12, nom: "PROSPER BRIEUC", equipe: "Ecole Saint Serge", kms: 9.84 },
  1: { classement: 276, nbTours: 12, nom: "LE PICART AAINA ANGE", equipe: "Ecole Saint Serge", kms: 9.84 },
  298: { classement: 277, nbTours: 12, nom: "DIA Karl", equipe: "Ecole Saint Serge", kms: 9.84 },
  579: { classement: 278, nbTours: 12, nom: "CROUZET Cyril", equipe: "ANJOU LOIRE TERRITOIRE", kms: 9.84 },
  154: { classement: 279, nbTours: 12, nom: "AUGUSTUS Danicia", equipe: "La Rose Fraternelle", kms: 9.84 },
  451: { classement: 280, nbTours: 12, nom: "TEKLE Paulos", equipe: "La Rose Fraternelle", kms: 9.84 },
  155: { classement: 281, nbTours: 12, nom: "BERRANGER ESCAR Daphné", equipe: "Ecole Saint Serge", kms: 9.84 },
  364: { classement: 282, nbTours: 12, nom: "BROSSET Manon", equipe: "AFOCAL", kms: 9.84 },
  531: { classement: 283, nbTours: 12, nom: "BOUREZ Victoire", equipe: "Le Gouvernail", kms: 9.84 },
  313: { classement: 284, nbTours: 12, nom: "PAROIS Lénaïc", equipe: "AFOCAL", kms: 9.84 },
  188: { classement: 285, nbTours: 12, nom: "REVEILLANT Eric", equipe: "Le Gouvernail", kms: 9.84 },
  518: { classement: 286, nbTours: 12, nom: "NGUYEN Thomas", equipe: "Campus ESPL", kms: 9.84 },
  525: { classement: 287, nbTours: 12, nom: "GUENNEC TOAN", equipe: "Ecole Saint Serge", kms: 9.84 },
  118: { classement: 288, nbTours: 12, nom: "CLEMENCEAU Cecile", equipe: "Cecile Clemenceau", kms: 9.84 },
  338: { classement: 289, nbTours: 12, nom: "HARDY LOUISE", equipe: "Ecole Saint Serge", kms: 9.84 },
  635: { classement: 290, nbTours: 12, nom: "NATHANAEL Godard", equipe: "Agapè Anjou", kms: 9.84 },
  135: { classement: 291, nbTours: 12, nom: "LAUDE Christiane", equipe: "La cravate solidaire", kms: 9.84 },
  170: { classement: 292, nbTours: 12, nom: "CADIOU Elise", equipe: "FSDV", kms: 9.84 },
  489: { classement: 293, nbTours: 12, nom: "LE MARCHAND Solène", equipe: "FSDV", kms: 9.84 },
  208: { classement: 294, nbTours: 12, nom: "BOPP Florence", equipe: "PARRAINS PAR MILLE", kms: 9.84 },
  624: { classement: 295, nbTours: 12, nom: "PIET pauline", equipe: "pauline piet", kms: 9.84 },
  312: { classement: 296, nbTours: 12, nom: "BARKALLAH LENA", equipe: "Ecole Saint Serge", kms: 9.84 },
  44: { classement: 297, nbTours: 12, nom: "MAGHERBI ANAS", equipe: "Ecole Saint Serge", kms: 9.84 },
  449: { classement: 298, nbTours: 12, nom: "CHEVRINAIS Pauline", equipe: "FSDV", kms: 9.84 },
  209: { classement: 299, nbTours: 12, nom: "MOURAIT Florence", equipe: "FSDV", kms: 9.84 },
  281: { classement: 300, nbTours: 12, nom: "BAREAU MAHAZA Jules", equipe: "Ecole Saint Serge", kms: 9.84 },
  144: { classement: 301, nbTours: 12, nom: "LEPLOMB Clémence", equipe: "FSDV", kms: 9.84 },
  539: { classement: 302, nbTours: 12, nom: "SCHOT Violette", equipe: "La cravate solidaire", kms: 9.84 },
  454: { classement: 303, nbTours: 12, nom: "LEBEAU Pénélope", equipe: "La cravate solidaire", kms: 9.84 },
  106: { classement: 304, nbTours: 12, nom: "BERGE Camille", equipe: "La cravate solidaire", kms: 9.84 },
  485: { classement: 305, nbTours: 12, nom: "LABORDE Sixtine", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.84 },
  248: { classement: 306, nbTours: 12, nom: "(COLIBRI) Ines", equipe: "Colibri", kms: 9.84 },
  173: { classement: 307, nbTours: 12, nom: "POIDEVIN Elodie", equipe: "Yendouboame", kms: 9.84 },
  183: { classement: 308, nbTours: 12, nom: "COSTALAT Emmy", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.84 },
  91: { classement: 309, nbTours: 12, nom: "PERROUD Baudouin", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.84 },
  399: { classement: 310, nbTours: 12, nom: "DE BETHUNE HESDIGNEUL Maximilien", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.84 },
  349: { classement: 311, nbTours: 12, nom: "MARESCAUX Madeleine", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.84 },
  585: { classement: 312, nbTours: 12, nom: "BORHIS Evan", equipe: "ETHIK KEHF", kms: 9.84 },
  15: { classement: 313, nbTours: 12, nom: "BIZON Alexandre", equipe: "Nameshield", kms: 9.84 },
  626: { classement: 314, nbTours: 12, nom: "MOHAMED ALI Mahnoor", equipe: "Mahnoor Mohamed Ali", kms: 9.84 },
  490: { classement: 315, nbTours: 12, nom: "DEHEN Solveig", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.84 },
  271: { classement: 316, nbTours: 11, nom: "RAULIN Jonathan", equipe: "T\'CAP-T\'PRO", kms: 9.02 },
  641: { classement: 317, nbTours: 11, nom: "AURELIEN Bechu", equipe: "Esperancia", kms: 9.02 },
  410: { classement: 318, nbTours: 11, nom: "DURAND Michèle", equipe: "Yendouboame", kms: 9.02 },
  301: { classement: 319, nbTours: 11, nom: "DE MIOLLIS Laëtitia", equipe: "Les Cahutes de Louise", kms: 9.02 },
  230: { classement: 320, nbTours: 11, nom: "MESSIÉ Guillaume", equipe: "Assureurs associés", kms: 9.02 },
  266: { classement: 321, nbTours: 11, nom: "LE CAM Jildaz", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.02 },
  204: { classement: 322, nbTours: 11, nom: "DE FOUGEROUX Félicie", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.02 },
  305: { classement: 323, nbTours: 11, nom: "MARCHAL Laurette", equipe: "Campus ESPL", kms: 9.02 },
  413: { classement: 324, nbTours: 11, nom: "BANCHEREAU Morgane", equipe: "Département de Maine-et-Loire", kms: 9.02 },
  424: { classement: 325, nbTours: 11, nom: "CAM Nina", equipe: "Angers Technopole", kms: 9.02 },
  200: { classement: 326, nbTours: 11, nom: "LE FESSANT Eve", equipe: "Angers Technopole", kms: 9.02 },
  18: { classement: 327, nbTours: 11, nom: "BOURDAIS Alexiane", equipe: "Angers Technopole", kms: 9.02 },
  66: { classement: 328, nbTours: 11, nom: "DUSSOT AMATO Audrey", equipe: "Le Gouvernail", kms: 9.02 },
  241: { classement: 329, nbTours: 11, nom: "MEDAWAR hermance", equipe: "AFOCAL", kms: 9.02 },
  599: { classement: 330, nbTours: 11, nom: "GAMRY Lèmia", equipe: "ETHIK KEHF", kms: 9.02 },
  31: { classement: 331, nbTours: 11, nom: "KARAMOKO Aliya", equipe: "Le Gouvernail", kms: 9.02 },
  331: { classement: 332, nbTours: 11, nom: "MONTIBERT Lou", equipe: "Ecole Saint Serge", kms: 9.02 },
  318: { classement: 333, nbTours: 11, nom: "(COLIBRI) Liam", equipe: "Colibri", kms: 9.02 },
  293: { classement: 334, nbTours: 11, nom: "BACAR Kaïs", equipe: "La Rose Fraternelle", kms: 9.02 },
  307: { classement: 335, nbTours: 11, nom: "ROUAULT HOGDAY Layana", equipe: "Le Gouvernail", kms: 9.02 },
  522: { classement: 336, nbTours: 11, nom: "DE CARVALHO Timothée", equipe: "Le Gouvernail", kms: 9.02 },
  196: { classement: 337, nbTours: 11, nom: "DE KERGORLAY Eugénie", equipe: "Le Gouvernail", kms: 9.02 },
  203: { classement: 338, nbTours: 11, nom: "DIAKITE Fatoumata", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 9.02 },
  649: { classement: 339, nbTours: 11, nom: "AFIFA Barkallah", equipe: "Ecole Saint Serge", kms: 9.02 },
  463: { classement: 340, nbTours: 11, nom: "PETIT Pierre", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.02 },
  352: { classement: 341, nbTours: 11, nom: "CHEVRIER Maelys", equipe: "Maelys Chevrier", kms: 9.02 },
  297: { classement: 342, nbTours: 11, nom: "POIDEVIN Karine", equipe: "Yendouboame", kms: 9.02 },
  236: { classement: 343, nbTours: 11, nom: "DURAND Hélène", equipe: "Yendouboame", kms: 9.02 },
  284: { classement: 344, nbTours: 11, nom: "COUDRAIN Julie", equipe: "AXA Prévoyance et Patrimoine", kms: 9.02 },
  130: { classement: 345, nbTours: 11, nom: "M\'HADHBI Chayma", equipe: "N.I.A.H.", kms: 9.02 },
  265: { classement: 346, nbTours: 11, nom: "BONNET Jeremy", equipe: "Saint Jean Espérance", kms: 9.02 },
  354: { classement: 347, nbTours: 11, nom: "AMITRANO Maeva", equipe: "AFOCAL", kms: 9.02 },
  659: { classement: 348, nbTours: 11, nom: "DOSSARD 659", equipe: null, kms: 9.02 },
  593: { classement: 349, nbTours: 11, nom: "COCHARD Joachim", equipe: "ETHIK KEHF", kms: 9.02 },
  239: { classement: 350, nbTours: 11, nom: "MAILLET Héloïse", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.02 },
  207: { classement: 351, nbTours: 11, nom: "LEE Fidelis", equipe: "Saint Jean Espérance", kms: 9.02 },
  694: { classement: 352, nbTours: 11, nom: "DOSSARD 694", equipe: null, kms: 9.02 },
  603: { classement: 353, nbTours: 11, nom: "BEZIN Mackeal", equipe: "ETHIK KEHF", kms: 9.02 },
  342: { classement: 354, nbTours: 11, nom: "ROLAND Lucie", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 9.02 },
  590: { classement: 355, nbTours: 11, nom: "DAUDIN Florian", equipe: "Les pompiers du SDIS 49", kms: 9.02 },
  587: { classement: 356, nbTours: 11, nom: "GIRARDEAU Fabien", equipe: "Les pompiers du SDIS 49", kms: 9.02 },
  357: { classement: 357, nbTours: 11, nom: "HERSART DE LA VILLEMARQUÉ Mahé", equipe: "We are lovers", kms: 9.02 },
  117: { classement: 358, nbTours: 11, nom: "GAULT catherine", equipe: "ALDEV", kms: 9.02 },
  439: { classement: 359, nbTours: 11, nom: "COCHIN Patricia", equipe: "ALDEV", kms: 9.02 },
  319: { classement: 360, nbTours: 10, nom: "BELLANGER Lilas", equipe: "Campus ESPL", kms: 8.2 },
  20: { classement: 361, nbTours: 10, nom: "VICARI Alexis", equipe: "Xilo Menuiserie", kms: 8.2 },
  468: { classement: 362, nbTours: 10, nom: "(COLIBRI) Rachel", equipe: "Colibri", kms: 8.2 },
  34: { classement: 363, nbTours: 10, nom: "GARNICA LEMARCHAND Amada", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 8.2 },
  180: { classement: 364, nbTours: 10, nom: "PASCO Emilien", equipe: "AFOCAL", kms: 8.2 },
  548: { classement: 365, nbTours: 10, nom: "AITOUELHAJ Yanis", equipe: "Le Gouvernail", kms: 8.2 },
  493: { classement: 366, nbTours: 10, nom: "ROULLOIS Stacie", equipe: "Assureurs associés", kms: 8.2 },
  249: { classement: 367, nbTours: 10, nom: "SOTKINE Iris", equipe: "Assureurs associés", kms: 8.2 },
  79: { classement: 368, nbTours: 10, nom: "GOULET Axel", equipe: "Ecole Saint Serge", kms: 8.2 },
  38: { classement: 369, nbTours: 10, nom: "MANCEAU Amélia", equipe: "Angers Technopole", kms: 8.2 },
  511: { classement: 370, nbTours: 10, nom: "JUCHET Théophile", equipe: "Le Gouvernail", kms: 8.2 },
  275: { classement: 371, nbTours: 10, nom: "MARTIN Joséphine", equipe: "Le Gouvernail", kms: 8.2 },
  309: { classement: 372, nbTours: 10, nom: "DROUOT Léa", equipe: "Ecole Saint Serge", kms: 8.2 },
  261: { classement: 373, nbTours: 10, nom: "FERRANDON JEANNE", equipe: "Ecole Saint Serge", kms: 8.2 },
  351: { classement: 374, nbTours: 10, nom: "ANGER Maelis", equipe: "AFOCAL", kms: 8.2 },
  206: { classement: 375, nbTours: 10, nom: "MARTIN Félix", equipe: "Le Gouvernail", kms: 8.2 },
  245: { classement: 376, nbTours: 10, nom: "YOUKOU Hyomé", equipe: "Le Gouvernail", kms: 8.2 },
  60: { classement: 377, nbTours: 10, nom: "DE KERGORLAY Arthus", equipe: "Le Gouvernail", kms: 8.2 },
  48: { classement: 378, nbTours: 10, nom: "BOUET Annette", equipe: "Ecole Saint Serge", kms: 8.2 },
  93: { classement: 379, nbTours: 10, nom: "KARAMOKO Benjamin", equipe: "Le Gouvernail", kms: 8.2 },
  252: { classement: 380, nbTours: 10, nom: "GREZELEAU DELAUNAY IZILE", equipe: "Ecole Saint Serge", kms: 8.2 },
  558: { classement: 381, nbTours: 10, nom: "DE KERGORLAY Zélie", equipe: "Le Gouvernail", kms: 8.2 },
  178: { classement: 382, nbTours: 10, nom: "GUERBAA Elyes", equipe: "Le Gouvernail", kms: 8.2 },
  444: { classement: 383, nbTours: 10, nom: "KUGENER Paul", equipe: "LVA Le Logis", kms: 8.2 },
  340: { classement: 384, nbTours: 10, nom: "COINTREAU LOUISON", equipe: "Ecole Saint Serge", kms: 8.2 },
  280: { classement: 385, nbTours: 10, nom: "GIRAUD Judith", equipe: "Le Gouvernail", kms: 8.2 },
  480: { classement: 386, nbTours: 10, nom: "TOURNEUX SANNA", equipe: "Ecole Saint Serge", kms: 8.2 },
  255: { classement: 387, nbTours: 10, nom: "MARTIN Jacques", equipe: "Le Gouvernail", kms: 8.2 },
  100: { classement: 388, nbTours: 10, nom: "SIDIBE Bintou", equipe: "Agence Kalia", kms: 8.2 },
  285: { classement: 389, nbTours: 10, nom: "PICARD-BODARD Julie", equipe: "Agence Kalia", kms: 8.2 },
  428: { classement: 390, nbTours: 10, nom: "PLACET Océane", equipe: "Ecole Saint Serge", kms: 8.2 },
  159: { classement: 391, nbTours: 10, nom: "GERMOND Denis", equipe: "Département de Maine-et-Loire", kms: 8.2 },
  476: { classement: 392, nbTours: 10, nom: "PAULMIER Romaric", equipe: "AXA Prévoyance et Patrimoine", kms: 8.2 },
  479: { classement: 393, nbTours: 10, nom: "ELINEAU Sandra", equipe: "AXA Prévoyance et Patrimoine", kms: 8.2 },
  213: { classement: 394, nbTours: 10, nom: "BLOND Florine", equipe: "LVA Le Logis", kms: 8.2 },
  68: { classement: 395, nbTours: 10, nom: "ROUSVAL Audrey", equipe: "LVA Le Logis", kms: 8.2 },
  583: { classement: 396, nbTours: 10, nom: "LANGLAIS Emilie", equipe: "AFOCAL", kms: 8.2 },
  195: { classement: 397, nbTours: 10, nom: "DE BETUNE HESDIGNEUL Eugénie", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 8.2 },
  225: { classement: 398, nbTours: 10, nom: "ROUVRAIS Glenn", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 8.2 },
  120: { classement: 399, nbTours: 10, nom: "BARON-PLANTE Cédric", equipe: "Campus ESPL", kms: 8.2 },
  82: { classement: 400, nbTours: 10, nom: "AMIR IBRAHIM Aymen", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 8.2 },
  167: { classement: 401, nbTours: 10, nom: "JEDO OMAR Ekhlas", equipe: "LE JARDIN DE COCAGNE ANGEVIN", kms: 8.2 },
  164: { classement: 402, nbTours: 10, nom: "(COLIBRI) Dylan", equipe: "Colibri", kms: 8.2 },
  254: { classement: 403, nbTours: 10, nom: "GADENNE Jacques", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 8.2 },
  330: { classement: 404, nbTours: 10, nom: "ROUVRAIS Lorenn", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 8.2 },
  56: { classement: 405, nbTours: 9, nom: "TEXIER Arthis", equipe: "T\'CAP-T\'PRO", kms: 7.38 },
  425: { classement: 406, nbTours: 9, nom: "VERDIÈRE Noé", equipe: "T\'CAP-T\'PRO", kms: 7.38 },
  507: { classement: 407, nbTours: 9, nom: "FOUBLE Théo", equipe: "T\'CAP-T\'PRO", kms: 7.38 },
  202: { classement: 408, nbTours: 9, nom: "ADAM Ezzedine", equipe: "SDEL Energis Angers", kms: 7.38 },
  514: { classement: 409, nbTours: 9, nom: "CAUSSE Thibaut", equipe: "Xilo Menuiserie", kms: 7.38 },
  373: { classement: 410, nbTours: 9, nom: "CAUSSE Marie", equipe: "Xilo Menuiserie", kms: 7.38 },
  5: { classement: 411, nbTours: 9, nom: "VILLEMAIN Adélaïde", equipe: "À Deux Mains", kms: 7.38 },
  126: { classement: 412, nbTours: 9, nom: "FAJARDO Charleen", equipe: "Département de Maine-et-Loire", kms: 7.38 },
  138: { classement: 413, nbTours: 9, nom: "PASQUIER Claire", equipe: "Marie Durand", kms: 7.38 },
  536: { classement: 414, nbTours: 9, nom: "CHAUVIGNÉ VICTORIA", equipe: "Ecole Saint Serge", kms: 7.38 },
  168: { classement: 415, nbTours: 9, nom: "DE CARVALHO Eléonore", equipe: "Le Gouvernail", kms: 7.38 },
  10: { classement: 416, nbTours: 9, nom: "YATERA Aïcha", equipe: "Le Gouvernail", kms: 7.38 },
  286: { classement: 417, nbTours: 9, nom: "FLECHET-CHARNEAU Julien", equipe: "ADEPAPE-Repairs! 49", kms: 7.38 },
  390: { classement: 418, nbTours: 9, nom: "THIERRY Mathéo", equipe: "Le Gouvernail", kms: 7.38 },
  538: { classement: 419, nbTours: 9, nom: "FARGUE Vincent", equipe: "Le Gouvernail", kms: 7.38 },
  615: { classement: 420, nbTours: 9, nom: "MC CLENDON Noah", equipe: "ETHIK KEHF", kms: 7.38 },
  574: { classement: 421, nbTours: 9, nom: "GOHORE Christian", equipe: "ETHIK KEHF", kms: 7.38 },
  114: { classement: 422, nbTours: 9, nom: "GRAEMIGER CAPUCINE", equipe: "Ecole Saint Serge", kms: 7.38 },
  426: { classement: 423, nbTours: 9, nom: "BELLARD Noémie", equipe: "Becouze", kms: 7.38 },
  247: { classement: 424, nbTours: 9, nom: "ROUEZ Illona", equipe: "Agence Kalia", kms: 7.38 },
  50: { classement: 425, nbTours: 9, nom: "GADENNE Anselme", equipe: "Le Gouvernail", kms: 7.38 },
  41: { classement: 426, nbTours: 9, nom: "ORFALI Amira", equipe: "Ecole Saint Serge", kms: 7.38 },
  348: { classement: 427, nbTours: 9, nom: "ROUAULT-HOGDAY Lyam", equipe: "Le Gouvernail", kms: 7.38 },
  146: { classement: 428, nbTours: 9, nom: "FORCARD Clémentine", equipe: "Ecole Saint Serge", kms: 7.38 },
  578: { classement: 429, nbTours: 9, nom: "BOUKERROU Cyril", equipe: "ETHIK KEHF", kms: 7.38 },
  37: { classement: 430, nbTours: 9, nom: "REVEL Amaury", equipe: "FSDV", kms: 7.38 },
  582: { classement: 431, nbTours: 9, nom: "AZZOUG Danya", equipe: "ETHIK KEHF", kms: 7.38 },
  9: { classement: 432, nbTours: 9, nom: "FOURNIER Agathe", equipe: "La cravate solidaire", kms: 7.38 },
  385: { classement: 433, nbTours: 9, nom: "MILLET Marthe", equipe: "La cravate solidaire", kms: 7.38 },
  456: { classement: 434, nbTours: 9, nom: "PAPIN Philomène", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 7.38 },
  455: { classement: 435, nbTours: 9, nom: "JACQUET Perrine", equipe: "FSDV", kms: 7.38 },
  74: { classement: 436, nbTours: 9, nom: "RICHÉ Aurélie", equipe: "SDEL Energis Angers", kms: 7.38 },
  625: { classement: 437, nbTours: 9, nom: "MOHAMED ALI Samar", equipe: "Samar Mohamed Ali", kms: 7.38 },
  28: { classement: 438, nbTours: 9, nom: "GARRIGOU GRANDCHAMP Alix", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 7.38 },
  53: { classement: 439, nbTours: 9, nom: "BONY Armand", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 7.38 },
  591: { classement: 440, nbTours: 9, nom: "GROLLEAU François-Xavier", equipe: "Les pompiers du SDIS 49", kms: 7.38 },
  422: { classement: 441, nbTours: 9, nom: "PIERRE Nicolas", equipe: "AXA Prévoyance et Patrimoine", kms: 7.38 },
  491: { classement: 442, nbTours: 8, nom: "JOLLIVET Sophie", equipe: "Nameshield", kms: 6.56 },
  139: { classement: 443, nbTours: 8, nom: "DELATOUR Clara", equipe: "Assureurs associés", kms: 6.56 },
  219: { classement: 444, nbTours: 8, nom: "DEVIRIEUX Gabriel", equipe: "AFOCAL", kms: 6.56 },
  658: { classement: 445, nbTours: 8, nom: "LUC 658", equipe: "APEX", kms: 6.56 },
  657: { classement: 446, nbTours: 8, nom: "NATHAN 657", equipe: "APEX", kms: 6.56 },
  328: { classement: 447, nbTours: 8, nom: "RIVAULT Lola", equipe: "AFOCAL", kms: 6.56 },
  643: { classement: 448, nbTours: 8, nom: "TOMAS Marquis", equipe: "Esperancia", kms: 6.56 },
  324: { classement: 449, nbTours: 8, nom: "MANARANCHE-MICHON Lisa", equipe: "ADEPAPE-Repairs! 49", kms: 6.56 },
  654: { classement: 450, nbTours: 8, nom: "DOSSARD 654", equipe: null, kms: 6.56 },
  147: { classement: 451, nbTours: 8, nom: "BOUREUX Clotilde", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 6.56 },
  420: { classement: 452, nbTours: 8, nom: "GOURDON Nathalie", equipe: "AFOCAL", kms: 6.56 },
  346: { classement: 453, nbTours: 8, nom: "BRAZILLE Ludivine", equipe: "AFOCAL", kms: 6.56 },
  46: { classement: 454, nbTours: 8, nom: "NIANGORAN Angéline", equipe: "Le Gouvernail", kms: 6.56 },
  350: { classement: 455, nbTours: 8, nom: "MARTIN Madeleine", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 6.56 },
  527: { classement: 456, nbTours: 8, nom: "TEILLET TOM", equipe: "Ecole Saint Serge", kms: 6.56 },
  123: { classement: 457, nbTours: 8, nom: "(COLIBRI) Céline", equipe: "Colibri", kms: 6.56 },
  400: { classement: 458, nbTours: 8, nom: "PLANTARD ALDEBERT Maya", equipe: "Ecole Saint Serge", kms: 6.56 },
  260: { classement: 459, nbTours: 8, nom: "BASSINAT JEANNE", equipe: "Ecole Saint Serge", kms: 6.56 },
  502: { classement: 460, nbTours: 8, nom: "GODARD Sylvie", equipe: "ADEPAPE-Repairs! 49", kms: 6.56 },
  571: { classement: 461, nbTours: 8, nom: "BOMPAS Bryan", equipe: "ADEPAPE-Repairs! 49", kms: 6.56 },
  244: { classement: 462, nbTours: 8, nom: "GAUTRON-GOINEAU HYLA", equipe: "Ecole Saint Serge", kms: 6.56 },
  529: { classement: 463, nbTours: 8, nom: "HUVELIN Véronique", equipe: "Le Gouvernail", kms: 6.56 },
  387: { classement: 464, nbTours: 8, nom: "BONNEROT Martine", equipe: "Le Gouvernail", kms: 6.56 },
  33: { classement: 465, nbTours: 8, nom: "AIT OUELHAJ Almes", equipe: "Le Gouvernail", kms: 6.56 },
  443: { classement: 466, nbTours: 8, nom: "BOURGEOIS Paul", equipe: "Le Gouvernail", kms: 6.56 },
  191: { classement: 467, nbTours: 8, nom: "LUISIER Esther", equipe: "Le Gouvernail", kms: 6.56 },
  49: { classement: 468, nbTours: 8, nom: "GADENNE Annonciade", equipe: "Le Gouvernail", kms: 6.56 },
  478: { classement: 469, nbTours: 8, nom: "DJABRAILOVA Salima", equipe: "La Rose Fraternelle", kms: 6.56 },
  103: { classement: 470, nbTours: 8, nom: "GADENNE Bosco", equipe: "Le Gouvernail", kms: 6.56 },
  640: { classement: 471, nbTours: 8, nom: "MEHDI Seghaier", equipe: "Agapè Anjou", kms: 6.56 },
  636: { classement: 472, nbTours: 8, nom: "HAMDI Garbaa", equipe: "Agapè Anjou", kms: 6.56 },
  560: { classement: 473, nbTours: 8, nom: "RABALLAND ZOE", equipe: "Ecole Saint Serge", kms: 6.56 },
  651: { classement: 474, nbTours: 8, nom: "SOPHIE Graemiger", equipe: "Ecole Saint Serge", kms: 6.56 },
  589: { classement: 475, nbTours: 8, nom: "DABO Fatoumata", equipe: "ETHIK KEHF", kms: 6.56 },
  290: { classement: 476, nbTours: 8, nom: "BOUTRUCHE Julyano", equipe: "LVA Le Logis", kms: 6.56 },
  134: { classement: 477, nbTours: 8, nom: "BOONE Christelle", equipe: "FSDV", kms: 6.56 },
  637: { classement: 478, nbTours: 8, nom: "THOMAS De La Villeon", equipe: "Agapè Anjou", kms: 6.56 },
  355: { classement: 479, nbTours: 8, nom: "GUILLET Magalie", equipe: "Campus ESPL", kms: 6.56 },
  396: { classement: 480, nbTours: 8, nom: "DE ROBIEN Maxime", equipe: "AXA Prévoyance et Patrimoine", kms: 6.56 },
  430: { classement: 481, nbTours: 8, nom: "BETIL Olivier", equipe: "Nameshield", kms: 6.56 },
  171: { classement: 482, nbTours: 8, nom: "(COLIBRI) Ellyana", equipe: "Colibri", kms: 6.56 },
  601: { classement: 483, nbTours: 8, nom: "CROCHARD Lucille", equipe: "ANJOU LOIRE TERRITOIRE", kms: 6.56 },
  227: { classement: 484, nbTours: 7, nom: "D\'ABBADIE Guilhem", equipe: "Le Gouvernail", kms: 5.74 },
  448: { classement: 485, nbTours: 7, nom: "RAMÉ Paul", equipe: "Xilo Menuiserie", kms: 5.74 },
  76: { classement: 486, nbTours: 7, nom: "HARDY Aurélien", equipe: "Pas à Pas 49", kms: 5.74 },
  259: { classement: 487, nbTours: 7, nom: "BEAUGENDRE Jean-Loic", equipe: "Saint Jean Espérance", kms: 5.74 },
  503: { classement: 488, nbTours: 7, nom: "LUISIER Syméon", equipe: "Le Gouvernail", kms: 5.74 },
  376: { classement: 489, nbTours: 7, nom: "FAVRE Marie-Capucine", equipe: "Le Gouvernail", kms: 5.74 },
  80: { classement: 490, nbTours: 7, nom: "RIVAS ACOSTA Axel", equipe: "AFOCAL", kms: 5.74 },
  369: { classement: 491, nbTours: 7, nom: "MOREAU Manon", equipe: "Marie Durand", kms: 5.74 },
  73: { classement: 492, nbTours: 7, nom: "MEUNIER Aurélie", equipe: "Marie Durand", kms: 5.74 },
  231: { classement: 493, nbTours: 7, nom: "PICHOT Guillaume", equipe: "Le Gouvernail", kms: 5.74 },
  125: { classement: 494, nbTours: 7, nom: "LIGNEL Céline", equipe: "Campus ESPL", kms: 5.74 },
  487: { classement: 495, nbTours: 7, nom: "DELESTRE sofya", equipe: "Campus ESPL", kms: 5.74 },
  169: { classement: 496, nbTours: 7, nom: "CAYREL Éléonore", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 5.74 },
  12: { classement: 497, nbTours: 7, nom: "JUSTEAU Albane", equipe: "Le Gouvernail", kms: 5.74 },
  300: { classement: 498, nbTours: 7, nom: "(COLIBRI) Kingley", equipe: "Colibri", kms: 5.74 },
  372: { classement: 499, nbTours: 7, nom: "GIRAUD Mariam", equipe: "Le Gouvernail", kms: 5.74 },
  295: { classement: 500, nbTours: 7, nom: "KOUDIAN Kamilia", equipe: "Le Gouvernail", kms: 5.74 },
  294: { classement: 501, nbTours: 7, nom: "DIAKHABY Kaki", equipe: "Le Gouvernail", kms: 5.74 },
  32: { classement: 502, nbTours: 7, nom: "(COLIBRI) Almedina", equipe: "Colibri", kms: 5.74 },
  363: { classement: 503, nbTours: 7, nom: "(COLIBRI) Manon", equipe: "Colibri", kms: 5.74 },
  504: { classement: 504, nbTours: 7, nom: "(COLIBRI) Taylor", equipe: "Colibri", kms: 5.74 },
  508: { classement: 505, nbTours: 7, nom: "MARCHESSEAU Théo", equipe: "LVA Le Logis", kms: 5.74 },
  52: { classement: 506, nbTours: 7, nom: "(COLIBRI) Antoine", equipe: "Colibri", kms: 5.74 },
  279: { classement: 507, nbTours: 7, nom: "BÉCHU JP", equipe: "Esperancia", kms: 5.74 },
  172: { classement: 508, nbTours: 7, nom: "BAILLY Elodie", equipe: "ANJOU LOIRE TERRITOIRE", kms: 5.74 },
  619: { classement: 509, nbTours: 7, nom: "MERAND Steven", equipe: "Les pompiers du SDIS 49", kms: 5.74 },
  609: { classement: 510, nbTours: 6, nom: "NDOUBA Marvin", equipe: "ETHIK KEHF", kms: 4.92 },
  565: { classement: 511, nbTours: 6, nom: "GUILBAULT Arron", equipe: "ETHIK KEHF", kms: 4.92 },
  273: { classement: 512, nbTours: 6, nom: "ESQUIER Joseph", equipe: "Solar Bird", kms: 4.92 },
  314: { classement: 513, nbTours: 6, nom: "(COLIBRI) Léo", equipe: "Colibri", kms: 4.92 },
  116: { classement: 514, nbTours: 6, nom: "LEGRAS Cassandre", equipe: "T\'CAP-T\'PRO", kms: 4.92 },
  308: { classement: 515, nbTours: 6, nom: "BONNEAU Léa", equipe: "T\'CAP-T\'PRO", kms: 4.92 },
  457: { classement: 516, nbTours: 6, nom: "AUDOYER Pia", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 4.92 },
  500: { classement: 517, nbTours: 6, nom: "MÉNORET Sylvain", equipe: "ADEPAPE-Repairs! 49", kms: 4.92 },
  67: { classement: 518, nbTours: 6, nom: "MANATA GOMES AUDREY", equipe: "Campus ESPL", kms: 4.92 },
  623: { classement: 519, nbTours: 6, nom: "DAGNET SOULAIGRE Youness", equipe: "ETHIK KEHF", kms: 4.92 },
  616: { classement: 520, nbTours: 6, nom: "DE SOUSA CARREIRA Samira", equipe: "ETHIK KEHF", kms: 4.92 },
  360: { classement: 521, nbTours: 6, nom: "DIABY Mamadou", equipe: "Le Gouvernail", kms: 4.92 },
  184: { classement: 522, nbTours: 6, nom: "(COLIBRI) Enzo", equipe: "Colibri", kms: 4.92 },
  551: { classement: 523, nbTours: 6, nom: "CHOUCHEN Yasmina", equipe: "Le Gouvernail", kms: 4.92 },
  124: { classement: 524, nbTours: 6, nom: "HUNAULT Céline", equipe: "ANJOU LOIRE TERRITOIRE", kms: 4.92 },
  35: { classement: 525, nbTours: 6, nom: "LEMEE Amance", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 4.92 },
  562: { classement: 526, nbTours: 6, nom: "GARREAU Anthony", equipe: "Les pompiers du SDIS 49", kms: 4.92 },
  610: { classement: 527, nbTours: 5, nom: "CHANGEON MONOT Matheo", equipe: "ETHIK KEHF", kms: 4.1 },
  435: { classement: 528, nbTours: 5, nom: "GUITTON Ophélie", equipe: "Ophélie GUITTON", kms: 4.1 },
  62: { classement: 529, nbTours: 5, nom: "OUTIOU Atilio", equipe: "Marie Durand", kms: 4.1 },
  95: { classement: 530, nbTours: 5, nom: "CHARRUAU Benoit", equipe: "Saint Jean Espérance", kms: 4.1 },
  362: { classement: 531, nbTours: 5, nom: "NIANGORAN Mandine", equipe: "Le Gouvernail", kms: 4.1 },
  253: { classement: 532, nbTours: 5, nom: "GIRAUDEAU Jacky", equipe: "T\'CAP-T\'PRO", kms: 4.1 },
  438: { classement: 533, nbTours: 5, nom: "(COLIBRI) Patricia", equipe: "Colibri", kms: 4.1 },
  646: { classement: 534, nbTours: 5, nom: "THÉO Keller", equipe: "La Maison commune - UPE", kms: 4.1 },
  540: { classement: 535, nbTours: 5, nom: "RIZZI VIRGIL", equipe: "Nameshield", kms: 4.1 },
  394: { classement: 536, nbTours: 5, nom: "RIZZI Maxence", equipe: "Nameshield", kms: 4.1 },
  528: { classement: 537, nbTours: 5, nom: "(COLIBRI) Tonyo", equipe: "Colibri", kms: 4.1 },
  345: { classement: 538, nbTours: 5, nom: "(COLIBRI) Lucy", equipe: "Colibri", kms: 4.1 },
  629: { classement: 539, nbTours: 5, nom: "PONSARD Charlotte", equipe: "Esperancia", kms: 4.1 },
  131: { classement: 540, nbTours: 5, nom: "(COLIBRI) Cheyenne", equipe: "Colibri", kms: 4.1 },
  407: { classement: 541, nbTours: 5, nom: "(COLIBRI) Melvin", equipe: "Colibri", kms: 4.1 },
  550: { classement: 542, nbTours: 5, nom: "GODEFROY Yannick", equipe: "Marie Durand", kms: 4.1 },
  71: { classement: 543, nbTours: 5, nom: "MARTIN Augustin", equipe: "Le Gouvernail", kms: 4.1 },
  483: { classement: 544, nbTours: 5, nom: "QUEVREUX GARNIER Shaina", equipe: "Marie Durand", kms: 4.1 },
  199: { classement: 545, nbTours: 5, nom: "(COLIBRI) Eve", equipe: "Colibri", kms: 4.1 },
  533: { classement: 546, nbTours: 5, nom: "MARÉCHAL Victor", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 4.1 },
  69: { classement: 547, nbTours: 5, nom: "BOUREUX Augustin", equipe: "Cours Bienheureux Charles d\'Autriche", kms: 4.1 },
  333: { classement: 548, nbTours: 4, nom: "MONNIER Lou-Ann", equipe: "AFOCAL", kms: 3.28 },
  477: { classement: 549, nbTours: 4, nom: "CIMETIÈRE Sacha", equipe: "Xilo Menuiserie", kms: 3.28 },
  495: { classement: 550, nbTours: 4, nom: "(COLIBRI) Stéphane", equipe: "Colibri", kms: 3.28 },
  561: { classement: 551, nbTours: 4, nom: "SAUNIER RANARISON Zyhann", equipe: "Marie Durand", kms: 3.28 },
  291: { classement: 552, nbTours: 4, nom: "DERRIEN Justine", equipe: "Justine DERRIEN", kms: 3.28 },
  644: { classement: 553, nbTours: 4, nom: "STYLIVEN Menard", equipe: "La Maison commune - UPE", kms: 3.28 },
  108: { classement: 554, nbTours: 4, nom: "CHOMBART Camille", equipe: "Marraine et vous", kms: 3.28 },
  481: { classement: 555, nbTours: 4, nom: "(COLIBRI) Sara", equipe: "Colibri", kms: 3.28 },
  115: { classement: 556, nbTours: 4, nom: "(COLIBRI) Caroline", equipe: "Colibri", kms: 3.28 },
  142: { classement: 557, nbTours: 4, nom: "(COLIBRI) Clémence", equipe: "Colibri", kms: 3.28 },
  386: { classement: 558, nbTours: 4, nom: "MARTIN Martin", equipe: "Angers Technopole", kms: 3.28 },
  647: { classement: 559, nbTours: 4, nom: "LAURA Germon", equipe: "La Maison commune - UPE", kms: 3.28 },
  655: { classement: 560, nbTours: 4, nom: "KINDA 655", equipe: "APEX", kms: 3.28 },
  656: { classement: 561, nbTours: 4, nom: "GHASSAN 656", equipe: "APEX", kms: 3.28 },
  323: { classement: 562, nbTours: 4, nom: "(COLIBRI) Lino", equipe: "Colibri", kms: 3.28 },
  498: { classement: 563, nbTours: 4, nom: "SUZANNE OUVRARD Suzanne", equipe: "PARRAINS PAR MILLE", kms: 3.28 },
  141: { classement: 564, nbTours: 4, nom: "BIDAL CLAUDINE", equipe: "ANJOU LOIRE TERRITOIRE", kms: 3.28 },
  469: { classement: 565, nbTours: 4, nom: "(COLIBRI) Rafael", equipe: "Colibri", kms: 3.28 },
  653: { classement: 566, nbTours: 3, nom: "BOREL NDJOMO", equipe: "Solar Bird", kms: 2.46 },
  371: { classement: 567, nbTours: 3, nom: "(COLIBRI) Marcellino", equipe: "Colibri", kms: 2.46 },
  179: { classement: 568, nbTours: 3, nom: "SUTER Emérentienne", equipe: "À Deux Mains", kms: 2.46 },
  632: { classement: 569, nbTours: 3, nom: "CAMERON REKIAN", equipe: "Pause Angevine - UPE", kms: 2.46 },
  30: { classement: 570, nbTours: 3, nom: "(COLIBRI) Alixia", equipe: "Colibri", kms: 2.46 },
  320: { classement: 571, nbTours: 3, nom: "(COLIBRI) Lilou", equipe: "Colibri", kms: 2.46 },
  648: { classement: 572, nbTours: 3, nom: "MARTINE Bigot", equipe: "ALDEV", kms: 2.46 },
  268: { classement: 573, nbTours: 3, nom: "BOURGEOIS Joachim", equipe: "Le Gouvernail", kms: 2.46 },
  153: { classement: 574, nbTours: 3, nom: "SAUVETRE Cyril", equipe: "Marie Durand", kms: 2.46 },
  584: { classement: 575, nbTours: 3, nom: "AMOUGOU Enzo", equipe: "ETHIK KEHF", kms: 2.46 },
  151: { classement: 576, nbTours: 2, nom: "GENEVOIS Cybélia", equipe: "ADEPAPE-Repairs! 49", kms: 1.64 },
  42: { classement: 577, nbTours: 2, nom: "(COLIBRI) Anais", equipe: "Colibri", kms: 1.64 },
  621: { classement: 578, nbTours: 2, nom: "MORIN GROSBOIS Tanguy", equipe: "ETHIK KEHF", kms: 1.64 },
  464: { classement: 579, nbTours: 2, nom: "BONAMY Pierre-Louis", equipe: "Maîtrise des Pays de la Loire", kms: 1.64 },
  215: { classement: 580, nbTours: 2, nom: "DE LA PERRAUDIERE Francois", equipe: "Francois de La Perraudiere", kms: 1.64 },
  162: { classement: 581, nbTours: 2, nom: "(COLIBRI) Djama", equipe: "Colibri", kms: 1.64 },
  21: { classement: 582, nbTours: 2, nom: "DE KERGORLAY Alice", equipe: "Association EFATA - La Boussole", kms: 1.64 },
  416: { classement: 583, nbTours: 2, nom: "LOPEZ Muriel", equipe: "Département de Maine-et-Loire", kms: 1.64 },
  136: { classement: 584, nbTours: 2, nom: "BELLEC Christine", equipe: "Marie Durand", kms: 1.64 },
  459: { classement: 585, nbTours: 2, nom: "(COLIBRI) Pierre", equipe: "Colibri", kms: 1.64 },
  642: { classement: 586, nbTours: 1, nom: "DAMIEN schouteden", equipe: "Pause Angevine - UPE", kms: 0.82 },
  379: { classement: 587, nbTours: 1, nom: "FAVRE Marie-Laure", equipe: "Le Gouvernail", kms: 0.82 },
  45: { classement: 588, nbTours: 1, nom: "MACHINE ANGEL", equipe: "Département de Maine-et-Loire", kms: 0.82 },
  660: { classement: 589, nbTours: 1, nom: "DOSSARD 660", equipe: null, kms: 0.82 },
};

const CLASSEMENT_EQUIPES = {
  "Cours Bienheureux Charles d'Autriche": { classement: 1,  kms: 995.50 },
  "Ecole Saint Serge":                    { classement: 2,  kms: 515.00 },
  "FSDV":                                 { classement: 3,  kms: 360.80 },
  "Le Gouvernail":                        { classement: 4,  kms: 352.60 },
  "Les pompiers du SDIS 49":             { classement: 5,  kms: 232.10 },
  "Marie Durand":                         { classement: 6,  kms: 210.70 },
  "Colibri":                              { classement: 7,  kms: 204.20 },
  "Saint Jean Espérance":                 { classement: 8,  kms: 179.60 },
  "AXA Prévoyance et Patrimoine":         { classement: 9,  kms: 168.10 },
  "6e Régiment du Génie d'Angers":       { classement: 10, kms: 153.30 },
  "AFOCAL":                               { classement: 11, kms: 137.80 },
  "ETHIK KEHF":                           { classement: 12, kms: 134.50 },
  "LE JARDIN DE COCAGNE ANGEVIN":        { classement: 13, kms: 132.80 },
  "Nameshield":                           { classement: 14, kms: 130.40 },
  "Campus ESPL":                          { classement: 15, kms: 121.40 },
  "Becouze":                              { classement: 16, kms: 113.20 },
  "Agapè Anjou":                          { classement: 17, kms: 105.80 },
  "La Rose Fraternelle":                  { classement: 18, kms: 94.30  },
  "Réseau Entreprendre Maine et Loire":   { classement: 19, kms: 88.60  },
  "Angers Technopole":                    { classement: 20, kms: 83.60  },
  "Octopus Patrimoine":                   { classement: 21, kms: 83.60  },
  "ANJOU LOIRE TERRITOIRE":              { classement: 22, kms: 79.50  },
  "T'CAP-T'PRO":                         { classement: 23, kms: 77.10  },
  "Solar Bird":                           { classement: 24, kms: 77.10  },
  "SDEL Energis Angers":                  { classement: 25, kms: 76.30  },
  "Assureurs associés":                   { classement: 26, kms: 66.40  },
  "La cravate solidaire":                 { classement: 27, kms: 65.60  },
  "N.I.A.H.":                            { classement: 28, kms: 50.00  },
  "Yendouboame":                          { classement: 29, kms: 48.40  },
  "LVA Le Logis":                         { classement: 30, kms: 48.40  },
  "ADEPAPE-Repairs! 49":                  { classement: 31, kms: 43.50  },
  "Pause Angevine - UPE":                 { classement: 32, kms: 41.00  },
  "Département de Maine-et-Loire":        { classement: 33, kms: 38.50  },
  "Campus Coach Angers":                  { classement: 34, kms: 33.60  },
  "Xilo Menuiserie":                      { classement: 35, kms: 32.00  },
  "ALDEV":                                { classement: 36, kms: 31.20  },
  "Pas à Pas 49":                         { classement: 37, kms: 29.50  },
  "Esperancia":                           { classement: 38, kms: 25.40  },
  "Agence Kalia":                         { classement: 40, kms: 23.80  },
  "La Tilma":                             { classement: 41, kms: 21.30  },
  "Paola Vesnier":                        { classement: 42, kms: 20.50  },
  "À Deux Mains":                         { classement: 43, kms: 19.70  },
  "APEX":                                 { classement: 44, kms: 19.70  },
  "Guillaume KOFFI":                      { classement: 45, kms: 19.70  },
  "Candice Chalet":                       { classement: 46, kms: 18.00  },
  "123 Cessions":                         { classement: 47, kms: 18.00  },
  "Anaïs Hiron":                          { classement: 48, kms: 17.20  },
  "Wahid Gazoum":                         { classement: 49, kms: 16.40  },
  "Sylvain Verardo":                      { classement: 50, kms: 15.60  },
  "Marie-Liesse de La Villesboisnet":     { classement: 51, kms: 15.60  },
  "Coralie Belin":                        { classement: 52, kms: 15.60  },
  "Enzo Medard":                          { classement: 53, kms: 13.90  },
  "PARRAINS PAR MILLE":                   { classement: 54, kms: 13.10  },
  "Quitterie Perchais":                   { classement: 55, kms: 13.10  },
  "Marie Furet":                          { classement: 56, kms: 13.10  },
  "Jade feybesse":                        { classement: 57, kms: 13.10  },
  "Excellence Ruralités":                 { classement: 58, kms: 12.30  },
  "Thierry Subranne":                     { classement: 59, kms: 12.30  },
  "chloé piton":                          { classement: 60, kms: 12.30  },
  "ARIFTS":                               { classement: 61, kms: 12.30  },
  "Maud GAUMER":                          { classement: 62, kms: 11.50  },
  "Solene ROBERT":                        { classement: 63, kms: 11.50  },
  "La Maison commune - UPE":              { classement: 64, kms: 10.70  },
  "Vianney de Bagneaux":                  { classement: 65, kms: 10.70  },
  "Anne-Sophie Tesson":                   { classement: 66, kms: 10.70  },
  "Aurélie Gaud":                         { classement: 67, kms: 10.70  },
  "Lauren Zasso":                         { classement: 68, kms: 10.70  },
  "Wilfried Cesbron":                     { classement: 69, kms: 9.80   },
  "Cecile Clemenceau":                    { classement: 70, kms: 9.80   },
  "pauline piet":                         { classement: 71, kms: 9.80   },
  "Mahnoor Mohamed Ali":                  { classement: 72, kms: 9.80   },
  "Les Cahutes de Louise":                { classement: 73, kms: 9.00   },
  "Maelys Chevrier":                      { classement: 74, kms: 9.00   },
  "We are lovers":                        { classement: 75, kms: 9.00   },
  "Samar Mohamed Ali":                    { classement: 76, kms: 7.40   },
  "Ophélie GUITTON":                      { classement: 77, kms: 4.10   },
  "Justine DERRIEN":                      { classement: 78, kms: 3.30   },
  "Marraine et vous":                     { classement: 79, kms: 3.30   },
  "Maîtrise des Pays de la Loire":        { classement: 80, kms: 1.60   },
  "Francois de La Perraudiere":           { classement: 81, kms: 1.60   },
  "Association EFATA - La Boussole":      { classement: 82, kms: 1.60   },
};

const NB_COUREURS_ANGERS = 589;
const DOSSARDS_ANGERS_2026 = new Set([545,532,181,460,75,57,317,567,605,109,406,552,471,176,193,436,194,137,336,383,302,229,59,415,29,97,17,163,129,222,257,344,634,39,432,113,7,547,519,110,521,409,542,326,98,370,368,43,335,402,581,311,287,182,27,510,65,274,423,63,127,185,543,143,602,474,51,501,283,452,220,238,14,175,380,150,189,600,608,19,11,524,523,174,494,205,546,214,343,55,403,112,367,341,149,288,446,4,240,83,70,177,431,306,458,272,299,633,316,87,442,128,466,506,187,437,102,221,201,282,269,186,329,618,262,404,90,484,630,580,145,325,429,492,505,556,217,359,192,58,365,54,337,650,563,467,374,465,197,156,6,332,256,652,226,86,234,334,470,509,216,576,612,598,40,104,243,611,388,277,165,190,232,358,472,445,89,296,541,157,270,462,121,289,107,515,88,133,198,303,258,427,557,397,2,339,517,242,224,233,440,482,119,401,461,292,516,223,152,246,166,398,384,638,211,140,392,488,84,85,148,356,421,441,450,405,613,577,310,559,586,497,375,419,535,263,96,530,381,417,92,568,78,61,47,276,26,321,447,72,304,378,315,639,549,433,23,588,235,411,322,486,408,475,81,122,512,520,361,544,617,366,513,24,105,1,298,579,154,451,155,364,531,313,188,518,525,118,338,635,135,170,489,208,624,312,44,449,209,281,144,539,454,106,485,248,173,183,91,399,349,585,15,626,490,271,641,410,301,230,266,204,305,413,424,200,18,66,241,599,31,331,318,293,307,522,196,203,649,463,352,297,236,284,130,265,354,659,593,239,207,694,603,342,590,587,357,117,439,319,20,468,34,180,548,493,249,79,38,511,275,309,261,351,206,245,60,48,93,252,558,178,444,340,280,480,255,100,285,428,159,476,479,213,68,583,195,225,120,82,167,164,254,330,56,425,507,202,514,373,5,126,138,536,168,10,286,390,538,615,574,114,426,247,50,41,348,146,578,37,582,9,385,456,455,74,625,28,53,591,422,491,139,219,658,657,328,643,324,654,147,420,346,46,350,527,123,400,260,502,571,244,529,387,33,443,191,49,478,103,640,636,560,651,589,290,134,637,355,396,430,171,601,227,448,76,259,503,376,80,369,73,231,125,487,169,12,300,372,295,294,32,363,504,508,52,279,172,619,609,565,273,314,116,308,457,500,67,623,616,360,184,551,124,35,562,610,435,62,95,362,253,438,646,540,394,528,345,629,131,407,550,71,483,199,533,69,333,477,495,561,291,644,108,481,115,142,386,647,655,656,323,498,141,469,653,371,179,632,30,320,648,268,153,584,151,42,621,464,215,162,21,416,136,459,642,379,45,660]);
const NB_EQUIPES_ANGERS  = 82;


function tplGroupeMerciCoureurAngers({ prenom, dossard, nomCoureur, equipe, kmsPerso, classementPerso, kmsEquipe, classementEquipe, estSolo }) {
  const infoPerso   = CLASSEMENT_INDIVIDUEL[parseInt(dossard)] || {};
  const infoEquipe  = CLASSEMENT_EQUIPES[equipe] || {};
  const kmsP        = infoPerso.kms       || kmsPerso       || 0;
  const classP      = infoPerso.classement || classementPerso || '?';
  const kmsE        = infoEquipe.kms      || kmsEquipe      || 0;
  const classE      = infoEquipe.classement || classementEquipe || '?';

  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.52.36.jpeg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.53.42.jpeg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.54.49.jpeg';

  const blocPerso = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px"><tr>
    <td width="48%" align="center" bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:12px;padding:14px 10px">
      <div style="font-size:.65rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">🏁 Votre distance</div>
      <div style="font-family:Arial,sans-serif;font-size:1.8rem;color:#fb0089;font-weight:700;line-height:1.1">${kmsP.toFixed(1)} km</div>
      <div style="font-size:.72rem;color:#3d1830;margin-top:4px">🏅 ${classP}e / ${NB_COUREURS_ANGERS} coureurs</div>
    </td>
    <td width="4%"></td>
    ${!estSolo ? `<td width="48%" align="center" bgcolor="#fff5ef" style="background-color:#fff5ef;border:2px solid #ef6135;border-radius:12px;padding:14px 10px">
      <div style="font-size:.65rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">🏆 Votre équipe</div>
      <div style="font-family:Arial,sans-serif;font-size:1.8rem;color:#ef6135;font-weight:700;line-height:1.1">${kmsE.toFixed(1)} km</div>
      <div style="font-size:.72rem;color:#3d1830;margin-top:4px">🥇 ${classE}e / ${NB_EQUIPES_ANGERS} équipes</div>
    </td>` : `<td width="48%" align="center" bgcolor="#f5f0ff" style="background-color:#f5f0ff;border:2px solid #7c3aed;border-radius:12px;padding:14px 10px">
      <div style="font-size:.65rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">🏃 Coureur solo</div>
      <div style="font-family:Arial,sans-serif;font-size:1.1rem;color:#7c3aed;font-weight:700;line-height:1.3">Vous avez couru<br>pour l'enfance !</div>
    </td>`}
  </tr></table>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>🏁 Merci ${prenom} !<br>Vous avez couru pour l'enfance !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div>

<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Aujourd'hui vous avez relevé le défi — et quelle journée ! <strong>650 coureurs, 100 supporters, 30 bénévoles</strong> ont transformé le Parc Saint-Serge en élan collectif pour l'enfance. Cette <strong>2e édition est une transformation réussie</strong> — le Défi Enfance s'est installé durablement à Angers.</div>

${blocPerso}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" style="padding:8px 0"><a href="https://upe-bot.github.io/defi-enfance-dossard/index.html" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🏆 Voir le classement général</a></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
  <td width="49%" style="padding-right:6px"><img src="${IMG1}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
  <td width="49%" style="padding-left:6px"><img src="${IMG2}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
</tr></table>

<div style="background-color:#fff0f8;border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:20px;font-size:.84rem;color:#3d1830;font-style:italic;text-align:left">
  💬 <strong>Témoignage d'un chef d'entreprise :</strong><br>
  "Course incroyable. Moment super avec les équipes. On a déjà motivé une entreprise partenaire de venir l'année prochaine !"
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Des dizaines d'équipes d'<strong>entreprises, d'écoles, d'associations et d'institutions</strong> ont couru côte à côte. <strong>Cette aventure humaine est une ligne de départ.</strong> Nous avons tous quelque chose à faire pour l'enfance. Merci d'en faire partie.</div>

<img src="${IMG3}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block;margin-bottom:20px">

${!estSolo && kmsE > 0 ? `<div style="background-color:#fff5ef;border:1.5px solid rgba(239,97,53,0.3);border-radius:12px;padding:14px 18px;margin-bottom:20px;text-align:left"><div style="font-size:.72rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🏆 Votre équipe — ${equipe}</div><div style="font-size:.84rem;color:#3d1830;line-height:1.6">Votre équipe a parcouru <strong>${kmsE.toFixed(1)} km</strong> au total — <strong>${classE}e</strong> au classement des équipes sur ${NB_EQUIPES_ANGERS}. Bravo à toute l'équipe !</div></div>` : ''}

<div style="background-color:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:12px;padding:16px 20px;margin-bottom:18px;text-align:left">
  <div style="font-size:.72rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🚀 La collecte continue !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:10px">La collecte sur vos coureurs et vos équipes se poursuit <strong>jusqu'à la fin du mois de mai</strong>. Continuez de récolter des dons auprès de vos réseaux pro et perso pour faire grimper vos collectes pour l'enfance.</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7">🏃 <strong>Un Défi Enfance à Joué-lès-Tours a lieu dans une semaine !</strong> Angers fera-t-il mieux que Joué en km parcourus et collecte de dons ? L'émulation est bonne ! N'hésitez pas à inviter vos connaissances de Touraine à se joindre à ce bel élan du Défi Enfance !</div>
</div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Chaque foulée compte. Chaque km parcouru fait la différence.<br><strong style="color:#fb0089">Merci d'avoir couru pour l'enfance ! 🏁</strong></div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance 🤝</div>
</div></td></tr></table></body></html>`;
}


function tplGroupeMerciDonateurAngers({ prenom, historiqueHtml, totalDons, nbDons }) {
  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.52.36.jpeg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.53.42.jpeg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.54.49.jpeg';
  const URL_CLASSEMENT = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const URL_COLLECTE   = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_event=36946';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:0"><tr><td bgcolor="#fb0089" style="background-color:#fb0089;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#ffffff;margin:0 0 6px">❤️ Merci ${prenom} —<br>vous êtes les pionniers du Défi Enfance !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · Angers · 22 mai 2026</p></td></tr></table>

<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Le <strong>22 mai 2026</strong>, le Défi Enfance a couru à Angers — et vous, en tant que <strong>Donateur</strong>, vous étiez là, dans les coulisses, à rendre chaque foulée possible. <strong>Merci.</strong> Votre soutien ne s'arrête pas à un chiffre — il représente un engagement concret pour des enfants vulnérables. Vous faites partie du Défi Enfance à part entière.</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px"><tr>
  <td width="49%" style="padding-right:4px;vertical-align:top"><img src="${IMG1}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
  <td width="49%" style="padding-left:4px;vertical-align:top"><img src="${IMG3}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
</tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
  <td><img src="${IMG2}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
</tr></table>

<div style="background-color:#fff0f8;border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:20px;font-size:.84rem;color:#3d1830;font-style:italic;text-align:left">
  💬 <strong>Témoignage d'un chef d'entreprise :</strong><br>
  "Course incroyable. Moment super avec les équipes. On a déjà motivé une entreprise partenaire de venir l'année prochaine !"
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Près de <strong>600 coureurs participants, des centaines de supporters et de nombreux bénévoles</strong> ont transformé le Parc Saint-Serge en élan collectif pour l'enfance. Des dizaines d'équipes d'<strong>entreprises, d'écoles, d'associations et d'institutions</strong> ont couru côte à côte. <strong>Cette 2e édition est une transformation réussie — le Défi Enfance s'est installé durablement à Angers.</strong></div>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">❤️ Vos dons au Défi Enfance</div>
  ${historiqueHtml}
  <div style="font-size:.84rem;color:#3d1830;margin-top:12px;font-weight:600">Total : <span style="color:#fb0089">${totalDons > 0 ? totalDons.toFixed(2) + ' €' : 'voir ci-dessus'}</span> — ${nbDons} don(s)</div>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Vous êtes les <strong>pionniers du Défi Enfance</strong> — les premiers soutiens, les premiers ambassadeurs. Grâce à vous, des enfants vulnérables bénéficient de projets innovants qui brisent les silos et placent enfin leur intérêt au centre. <strong>On compte sur vous pour la suite.</strong></div>

<div style="background-color:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🚀 La collecte continue jusqu'au 31 mai minuit !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:10px">La collecte pour les coureurs et équipes du Défi Enfance Angers reste ouverte <strong>jusqu'au 31 mai à minuit</strong>. Vous pouvez refaire un don aux coureurs et équipes que vous avez soutenus pour les féliciter et affermir votre engagement pour l'Enfance — chaque euro compte !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7">Et dans une semaine, <strong>le Défi Enfance débarque à Joué-lès-Tours (29 mai)</strong> — l'élan continue !</div>
</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
  <td align="center" style="padding:4px"><a href="${URL_CLASSEMENT}" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">🏆 Classement général Angers</a></td>
  <td align="center" style="padding:4px"><a href="${URL_COLLECTE}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">❤️ Soutenir la collecte Angers</a></td>
</tr></table>

${BLOC_RECUS_FISCAUX}${BLOC_IFI}${BLOC_SOCIAUX}
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Merci d'être là. On continue ensemble pour l'enfance. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}


function tplGroupeMerciDonateurJoue({ prenom, historiqueHtml, totalDons, nbDons }) {
  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.52.36.jpeg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.53.42.jpeg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.54.49.jpeg';
  const URL_CLASSEMENT  = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const URL_COLLECTE    = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=36946';
  const URL_MUR_DONS    = 'https://defienfance.fr/mur-de-dons/';
  const URL_MOTIVATIONS = 'https://defienfance.fr/motivations-des-coureurs/';
  const URL_SUPPORTER   = 'https://luma.com/defi-supporters-jouelestours2026';
  const URL_COUREUR     = 'https://luma.com/defi-course-jouelestours2026';
  const URL_PROMESSE    = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:0"><tr><td bgcolor="#fb0089" style="background-color:#fb0089;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#ffffff;margin:0 0 6px">🏁 Angers a montré la voie —<br>Joué-lès-Tours entre en scène !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · Angers · 22 mai 2026</p></td></tr></table>

<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Vendredi 22 mai, sous un soleil radieux, le Défi Enfance a couru à Angers — et quelle course ! Voici ce que vous avez raté… et ce qui vous attend à <strong>Joué-lès-Tours le 29 mai !</strong> 🎉</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px"><tr>
  <td width="49%" style="padding-right:4px;vertical-align:top"><img src="${IMG1}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
  <td width="49%" style="padding-left:4px;vertical-align:top"><img src="${IMG3}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
</tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
  <td><img src="${IMG2}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
</tr></table>

<div style="background-color:#fff0f8;border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:20px;font-size:.84rem;color:#3d1830;font-style:italic;text-align:left">
  💬 <strong>Témoignage d'un chef d'entreprise angevin :</strong><br>
  "Course incroyable. Moment super avec les équipes. On a déjà motivé une entreprise partenaire de venir l'année prochaine !"
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Près de <strong>600 coureurs participants, des centaines de supporters et de nombreux bénévoles</strong> ont envahi le Parc Saint-Serge. Des dizaines d'équipes d'entreprises, d'écoles, d'associations et d'institutions côte à côte. <strong>Cette 2e édition est une transformation réussie — le Défi Enfance s'installe durablement !</strong></div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
  <td align="center" style="padding:4px"><a href="${URL_CLASSEMENT}" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">🏆 Classement général Angers</a></td>
  <td align="center" style="padding:4px"><a href="${URL_COLLECTE}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">❤️ Collecte des équipes Angers</a></td>
</tr></table>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">❤️ Vos dons au Défi Enfance</div>
  ${historiqueHtml}
  <div style="font-size:.84rem;color:#3d1830;margin-top:12px;font-weight:600">Total : <span style="color:#fb0089">${totalDons > 0 ? totalDons.toFixed(2) + ' €' : 'voir ci-dessus'}</span> — ${nbDons} don(s)</div>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Vous êtes les <strong>premiers ambassadeurs du Défi Enfance</strong> — les pionniers, ceux qui ont cru en ce projet avant tout le monde. Votre soutien donne de l'élan à toute la communauté. <strong>Merci d'être là.</strong></div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px"><tr>
  <td align="center" style="padding:4px"><a href="${URL_MUR_DONS}" style="display:inline-block;background-color:#ef6135;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">💌 Le mur des donateurs</a></td>
  <td align="center" style="padding:4px"><a href="${URL_MOTIVATIONS}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">💪 Motivations des coureurs</a></td>
</tr></table>

<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🏅 Transformez l'essai — Joué le 29 mai !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:12px">Le <strong>29 mai à Joué-lès-Tours</strong>, c'est au tour de la Touraine de courir pour l'enfance ! Voici comment vous pouvez amplifier votre impact :</div>
  <div style="font-size:.83rem;color:#3d1830;line-height:1.8;margin-bottom:14px">
    🏅 <strong>Faire une promesse de don au km</strong> — le vrai game changer ! Choisissez un montant par km parcouru par un coureur ou une équipe, et versez seulement après la course selon leur performance.<br>
    👟 <strong>S'inscrire comme supporter</strong> — les inscriptions sont encore ouvertes, convoyez votre entourage !<br>
    🏃 <strong>Inscrire un coureur</strong> — il est encore temps de rejoindre la course !
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" style="padding:4px"><a href="${URL_PROMESSE}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🏅 Promettre un don au km</a></td>
    <td align="center" style="padding:4px"><a href="${URL_SUPPORTER}" style="display:inline-block;background-color:#16a34a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🎉 S'inscrire supporter</a></td>
    <td align="center" style="padding:4px"><a href="${URL_COUREUR}" style="display:inline-block;background-color:#ef6135;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🏃 Inscrire un coureur</a></td>
  </tr></table>
</div>

${BLOC_RECUS_FISCAUX}${BLOC_IFI}${BLOC_SOCIAUX}
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">L'aventure continue — merci d'en faire partie. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}


function tplGroupeJ2ReferentsJoue({ prenom, nbJours, urlPromesseEquipe, urlPageEquipe }) {
  const j      = nbJours || 7;
  const urlProm = urlPromesseEquipe || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const urlDon  = 'https://defienfance.fr/faire-un-don/';
  const urlPage = urlPageEquipe || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=all';
  const URL_DOSSARD = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.52.36.jpeg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.53.42.jpeg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.54.49.jpeg';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
  .action-item{display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830;text-align:left}
  .action-item:last-child{border-bottom:none}
  .action-num{width:28px;height:28px;border-radius:50%;background-color:#fb0089;color:#fff;font-weight:700;font-size:.78rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#fb0089" style="background-color:#fb0089;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#ffffff;margin:0 0 6px">🏃 J-${j} — Boostons<br>nos collectes de dons !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Message spécial référents d'équipe · Joué-lès-Tours · 29 mai 2026</p></td></tr></table>

<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:16px;text-align:left">Chers référents d'équipe de coureurs,<br><br>À seulement <strong>${j} jours</strong> de notre rendez-vous au Parc des Bretonnières à Joué-lès-Tours, notre enthousiasme est au maximum ! En tant que référents d'équipe, vous êtes les <strong>ambassadeurs clés</strong> pour faire grimper notre compteur de solidarité et votre collecte d'équipe pour les associations que vous soutenez !</div>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🎥 Mini-webinaire référents — mardi 27 mai 12h-12h30</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:12px">Rejoignez-nous <strong>mardi 27 mai de 12h à 12h30</strong> pour un mini-webinaire de 30 minutes dédié aux référents d'équipe. Vous aurez accès à toutes les infos pratiques sur la course et saurez exactement comment booster votre collecte de dons d'ici le 29 mai !</div>
  <a href="https://luma.com/webi-defi-joue-j-3" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">🎥 Je m'inscris au webinaire</a>
</div>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🏁 Ce qui s'est passé à Angers le 22 mai</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px;text-align:left">La <strong>2e édition du Défi Enfance à Angers</strong> a été une transformation réussie. Près de <strong>600 coureurs participants, des centaines de supporters et de nombreux bénévoles</strong> ont envahi le Parc Saint-Serge sous un soleil radieux. Des dizaines d'équipes d'entreprises, d'écoles, d'associations et d'institutions côte à côte.</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px"><tr>
    <td width="49%" style="padding-right:4px;vertical-align:top"><img src="${IMG1}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:8px;display:block"></td>
    <td width="49%" style="padding-left:4px;vertical-align:top"><img src="${IMG3}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:8px;display:block"></td>
  </tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px"><tr>
    <td><img src="${IMG2}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:8px;display:block"></td>
  </tr></table>
  <div style="background-color:#fff;border-left:3px solid #fb0089;border-radius:0 8px 8px 0;padding:12px 16px;font-size:.83rem;color:#3d1830;font-style:italic;text-align:left">
    💬 <strong>Témoignage d'un chef d'entreprise angevin :</strong><br>
    "Course incroyable. Moment super avec les équipes. On a déjà motivé une entreprise partenaire de venir l'année prochaine !"
  </div>
</div>

<div style="background-color:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🏆 Angers vs Joué — l'émulation est lancée !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;text-align:left">Angers a posé la barre. <strong>Joué-lès-Tours peut faire mieux !</strong> Collecte de dons, km parcourus, énergie collective — tout est encore ouvert. C'est votre tour de montrer ce que la Touraine a dans les jambes pour l'enfance. 💚</div>
</div>

<div class="card" style="margin-bottom:22px">
  <h3 style="text-align:left">🚀 Comment mobiliser dès aujourd'hui ?</h3>
  <div class="action-item">
    <div class="action-num">1</div>
    <div style="text-align:left">
      <strong style="color:#7c3aed">Activez les promesses de dons</strong><br>
      Encouragez vos proches et réseaux pro à promettre un montant par km parcouru par votre équipe ou l'un de vos coureurs. Cela donne un véritable <em>"pouvoir d'agir"</em> à vos coureurs. Le soir de la course à <strong>20h</strong>, ils recevront un e-mail automatique avec le montant du don à réaliser selon les km réels parcourus par leur coureur ou équipe parrainé(e). Chaque donateur peut bien sûr réaliser plusieurs promesses de dons !<br>
      <div style="margin-top:10px"><a href="${urlProm}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🏅 Promettre un don au km pour mon équipe</a></div>
    </div>
  </div>
  <div class="action-item">
    <div class="action-num">2</div>
    <div style="text-align:left">
      <strong style="color:#fb0089">Soutenez vos causes</strong><br>
      Pour rappel, <strong>50% des dons</strong> collectés sur vos pages d'équipe ou les pages de vos coureurs seront directement fléchés vers les associations que vous avez choisies à l'inscription.<br>
      <div style="margin-top:10px"><a href="${urlDon}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">❤️ Page de don Défi Enfance</a></div>
    </div>
  </div>
  <div class="action-item">
    <div class="action-num">3</div>
    <div style="text-align:left">
      <strong style="color:#ef6135">Zéro gestion pour vous</strong><br>
      L'organisation s'occupe de tout. Les donateurs reçoivent immédiatement leur reçu fiscal par email, et <strong>vous êtes notifié à chaque nouveau don</strong>.
    </div>
  </div>
  <div class="action-item">
    <div class="action-num">4</div>
    <div style="text-align:left">
      <strong style="color:#3d1830">Osez le téléphone !</strong><br>
      Partager sa page par email ou sur LinkedIn est une bonne base, mais <strong>appeler directement un ami, un client ou un fournisseur</strong> pour lui présenter votre cause reste le moyen le plus efficace pour déclencher un don.
    </div>
  </div>
</div>

<div style="background-color:#fff0f8;border:1.5px solid rgba(251,0,137,0.2);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🎽 Numéros de dossard de votre équipe</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:12px;text-align:left">En tant que référent, vous aurez accès à la liste complète des numéros de dossard de <strong>tous les coureurs de votre équipe</strong> via le lien ci-dessous, disponible la veille de la course.</div>
  <a href="${URL_DOSSARD}" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">🎽 Dossards &amp; classements de mon équipe</a>
</div>

<div style="background-color:#fff5ef;border:1.5px solid rgba(239,97,53,0.3);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🏆 Votre page d'équipe</div>
  <a href="${urlPage}" style="display:inline-block;background-color:#ef6135;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">🏆 Voir la page de mon équipe</a>
</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td bgcolor="#1a0a12" style="background-color:#1a0a12;border-radius:14px;padding:20px 24px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">✉️ Email prêt à partager à vos proches</div>
  <div style="font-size:.72rem;color:#aaaaaa;margin-bottom:16px">Copiez-collez ce message à vos coureurs pour qu'ils le partagent autour d'eux</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:10px;padding:20px 22px">
    <div style="font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Objet</div>
    <div style="font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px">Plus qu'un défi sportif, une urgence pour l'enfance 🏁</div>
    <div style="font-size:.82rem;color:#3d1830;line-height:1.8;text-align:left">
      <p style="margin:0 0 12px">Bonjour [Prénom],</p>
      <p style="margin:0 0 12px">Je t'écris parce que j'ai décidé de relever un défi qui me tient particulièrement à cœur : le <strong>Défi Enfance</strong>.</p>
      <p style="margin:0 0 12px">Le secteur de l'aide à l'enfance traverse une crise sans précédent. Le Défi Enfance finance des projets innovants pour <strong>casser les silos</strong> et placer l'intérêt de l'enfant au centre.</p>
      <p style="margin:0 0 12px"><strong>J'ai besoin de ton aide.</strong> Pour me soutenir : 👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don</a> ou <a href="${urlProm}" style="color:#7c3aed;font-weight:600">promettre un don au km</a></p>
      <div style="background-color:#fff0f8;border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem">💡 <strong>Ton don est défiscalisé à hauteur de 66%.</strong> Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
      <p style="margin:0">À très vite, <strong>${prenom}</strong></p>
    </div>
  </td></tr></table>
</td></tr></table>

${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:left;margin-bottom:8px">Si vous avez la moindre question, n'hésitez pas à contacter Victor directement au <strong><a href="tel:0603021945" style="color:#fb0089">06 03 02 19 45</a></strong>.</div>
<div style="font-size:.84rem;color:#3d1830;font-style:italic;margin-bottom:8px;text-align:left">Merci pour votre incroyable engagement — rendez-vous jeudi sur la ligne de départ !</div>
<div style="font-size:.84rem;color:#fb0089;font-weight:700;margin-bottom:4px;text-align:left">Haut les cœurs,</div>
<div style="font-size:.82rem;color:#3d1830;text-align:left">Victor Vieilfault<br>Responsable du Défi Enfance · <a href="tel:0603021945" style="color:#fb0089">06 03 02 19 45</a></div>

</div><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></td></tr></table></div></td></tr></table></body></html>`;
}

function tplGroupeJourJPromesses({ prenom, promesses }) {
  // promesses = [{ type: 'coureur'|'equipe', nom, montantKm, kmParcourus, montantDu, urlDon }]
  const totalDu = promesses.reduce((s, p) => s + (p.montantDu || 0), 0);

  const blocPromesses = promesses.map((p, i) => {
    const label = p.type === 'coureur' ? `${p.nom}` : `l'équipe ${p.nom}`;
    const montantAffiche = p.montantDu > 0
      ? `<strong style="color:#fb0089;font-size:1.1rem">${p.montantDu.toFixed(2)} €</strong>`
      : `<span style="color:#888;font-size:.84rem">km non encore saisis</span>`;

    return `<div style="background:#fff;border:1.5px solid rgba(251,0,137,0.2);border-radius:12px;padding:16px 20px;margin-bottom:14px">
  <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${p.type === 'coureur' ? '🏃 Coureur parrainé' : '🏆 Équipe parrainée'}</div>
  <div style="font-size:.95rem;font-weight:700;color:#3d1830;margin-bottom:8px">${p.nom}</div>
  <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px">
    <div style="font-size:.82rem;color:#3d1830">🏅 <strong>${p.montantKm} €/km</strong> promis</div>
    ${p.kmParcourus ? `<div style="font-size:.82rem;color:#3d1830">🏁 <strong>${p.kmParcourus} km</strong> parcourus</div>` : ''}
    <div style="font-size:.82rem;color:#3d1830">💰 Don calculé : ${montantAffiche}</div>
  </div>
  <a href="${p.urlDon}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem;font-family:Arial,sans-serif">
    ❤️ Je concrétise ma promesse pour ${label}
  </a>
</div>`;
  }).join('');

  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.52.36.jpeg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.53.42.jpeg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-dossard/main/WhatsApp%20Image%202026-05-22%20at%2016.54.49.jpeg';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<div class="header mixed"><h1>🏁 Le Défi Enfance Angers 2026<br>s'est élancé — merci pour vos promesses !</h1><p>Défi Enfance · Angers · 22 mai 2026</p></div>

<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Aujourd'hui, <strong>Près de 600 coureurs participants, des centaines de supporters</strong> se sont réunis au Parc Saint-Serge d'Angers pour cette 2e édition du Défi Enfance. Une transformation réussie — <strong>le Défi Enfance s'est installé durablement à Angers !</strong></div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
  <td width="49%" style="padding-right:6px"><img src="${IMG1}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
  <td width="49%" style="padding-left:6px"><img src="${IMG2}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block"></td>
</tr></table>

<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border-left:3px solid #fb0089;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:20px;font-size:.84rem;color:#3d1830;font-style:italic;text-align:left">
  💬 <strong>Témoignage d'un chef d'entreprise :</strong><br>
  "Course incroyable. Moment super avec les équipes. On a déjà motivé une entreprise partenaire de venir l'année prochaine !"
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Des dizaines d'équipes d'<strong>entreprises, d'écoles, d'associations et d'institutions</strong> ont couru côte à côte pour l'enfance. <strong>Cette aventure humaine à laquelle vous participez en tant que donateur est une ligne de départ.</strong> Nous avons tous quelque chose à faire pour l'enfance.</div>

<img src="${IMG3}" alt="Défi Enfance Angers 2026" width="100%" style="border-radius:10px;display:block;margin-bottom:20px">

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:center">
  <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">💰 Total de vos promesses</div>
  <div style="font-family:Arial,sans-serif;font-size:2.5rem;color:#fb0089;font-weight:700;line-height:1.2">${totalDu > 0 ? totalDu.toFixed(2) + ' €' : 'À calculer'}</div>
  <div style="font-size:.75rem;color:#3d1830;margin-top:6px">Selon les km réellement parcourus</div>
</div>

<div style="font-size:.88rem;font-weight:700;color:#3d1830;margin-bottom:14px;text-align:left">🏅 Vos promesses de don — concrétisez-les ce soir !</div>

${blocPromesses}

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" style="padding:8px 0"><a href="https://upe-bot.github.io/defi-enfance-dossard/index.html" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🏆 Voir le classement général</a></td></tr></table><div style="background-color:#fff8f0;border-left:3px solid #ef6135;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:20px;font-size:.84rem;color:#3d1830;text-align:left">
  ✨ <strong>Envie d'aller encore plus loin ?</strong> Si l'énergie de cette journée vous a touché, vous pouvez donner davantage que votre promesse. Chaque euro supplémentaire fait une vraie différence pour les enfants.
  <div style="margin-top:12px"><a href="https://defienfance.fr/faire-un-don/" style="display:inline-block;background-color:#ef6135;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">❤️ Faire un don supplémentaire</a></div>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Un immense <strong>merci pour votre engagement</strong> — votre promesse de don a donné de l'élan à nos coureurs aujourd'hui. Grâce à vous et à tous les donateurs, le Défi Enfance 2026 est une nouvelle victoire pour l'enfance. 🤝</div>

<div style="background-color:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:12px;padding:16px 20px;margin-bottom:18px;text-align:left">
  <div style="font-size:.72rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🚀 La collecte continue !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:10px">La collecte sur vos coureurs et vos équipes se poursuit <strong>jusqu'à la fin du mois de mai</strong>. Continuez de récolter des dons auprès de vos réseaux pro et perso pour faire grimper vos collectes pour l'enfance.</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7">🏃 <strong>Un Défi Enfance à Joué-lès-Tours a lieu dans une semaine !</strong> Angers fera-t-il mieux que Joué en km parcourus et collecte de dons ? L'émulation est bonne ! N'hésitez pas à inviter vos connaissances de Touraine à se joindre à ce bel élan du Défi Enfance !</div>
</div>${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Merci d'avoir cru en nous. On continue ensemble. 🏁</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance 🤝</div>

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
  const blocDossard = numeroDossard
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:16px 22px"><div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Votre numero de dossard</div><div style="font-family:Arial,sans-serif;font-size:48px;color:#fb0089;font-weight:700;line-height:1.2">${numeroDossard}</div><div style="font-size:.75rem;color:#3d1830;margin-top:6px">A recuperer sur place des 8h30</div><div style="margin-top:14px"><a href="https://upe-bot.github.io/defi-enfance-dossard/index.html" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">Je retrouve mon dossard</a></div></td></tr></table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" style="padding:8px 0"><a href="https://upe-bot.github.io/defi-enfance-dossard/index.html" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">Je retrouve mon dossard</a></td></tr></table>`;

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
${blocDossard}
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
  <div class="temoignage"><div class="temoignage-quote">"Ce sont les enfants de tout le monde. Ce sont les enfants de chacun."</div><div class="temoignage-author">Jérôme Aucordier</div><div style="font-size:.74rem;color:#888;margin-top:2px">Accompagne des enfants dans un lieu de vie qui place chaque enfant au cœur de ses propres décisions. Pour lui, ces enfants ne sont pas des cas à gérer — ce sont un capital pour notre société.</div></div>
  <div class="temoignage"><div class="temoignage-quote">"Défi Enfance, c'est un moyen que les jeunes soient entendus."</div><div class="temoignage-author">Anne Loriot — éducatrice spécialisée en foyer</div><div style="font-size:.74rem;color:#888;margin-top:2px">Accueille des jeunes jour et nuit. Un jour, une jeune lui a dit : "Est-ce que tu vas rester ?" — une phrase qui dit tout. Ces enfants ne demandent pas grand-chose. Juste de la stabilité. Juste quelqu'un qui ne part pas.</div></div>
</div>
${BLOC_SOCIAUX}${BLOC_IFI}${BLOC_RECUS_FISCAUX}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Demain, chaque foulée compte pour l'enfance.<br><strong style="color:#fb0089">On court avec vous ! 🏁</strong></div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance 🤲</div>
</div></td></tr></table></body></html>`;
}

function tplGroupePlaceholder({ prenom, nomTemplate, nbJours }) {
  const j = nbJours || '?';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🔧 Template à venir</h1><p>${nomTemplate}</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">Ce template (${nomTemplate}) est en cours de création. Il sera disponible prochainement.</div></div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Votre promesse de don<br>vient de grandir !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body">
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
</div><div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplInscriptionAsso({ nomAsso, coureur, email_coureur, ville, prenomReferent }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🏃 Nouveau coureur<br>pour votre cause !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomReferent || ''} 👋</div><div class="intro">Un coureur vient de <strong>choisir votre association ${nomAsso}</strong> pour courir lors du <strong>Défi Enfance${ville ? ' de ' + ville : ''}</strong> !</div><div class="don-box"><div class="don-amount" style="font-size:1.8rem">${coureur}</div><div class="don-label">Nouveau coureur inscrit</div></div><div class="card"><h3>📋 Coordonnées du coureur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${coureur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_coureur}" style="color:#fb0089">${email_coureur}</a></div></div></div><div class="note magenta">💌 <strong>Prenez contact avec ${coureur}</strong> pour le remercier et l'accueillir chaleureusement !</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">💡 Présentez vos actions. Plus le coureur est engagé, plus sa collecte sera importante !</div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Association : <strong>${nomAsso}</strong><br>Email envoyé automatiquement dans les 10 minutes suivant l'inscription.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}


function tplDejeuner({ prenom }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🥗 Votre panier repas<br>est confirmé !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">Votre commande de repas est <strong>validée</strong> pour le Défi Enfance d'Angers — 22 mai 2026 !</div><div class="don-box" style="text-align:left;padding:20px 26px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;text-align:center">🧺 Votre panier gourmand</div><div class="row"><span class="ic">🥙</span><div>Bagel poulet, mozzarella, pesto &amp; tomates confites</div></div><div class="row"><span class="ic">🧁</span><div>Muffin maison aux fruits rouges</div></div><div class="row"><span class="ic">🍎</span><div>Une pomme</div></div><div class="row"><span class="ic">💧</span><div>Une eau</div></div></div><div class="note magenta" style="margin-bottom:22px">🎓 <strong>Panier préparé par Agapè Anjou</strong>, une école de production angevine qui forme des jeunes de 15 à 25 ans aux métiers de la restauration.<br><br>Merci — votre commande est <strong>solidaire</strong> : les 12 € versés viennent soutenir leur parcours.</div><div class="cta-box" style="text-align:left"><p style="text-align:center">📍 <strong>Récupération de votre panier</strong></p><div style="font-size:.86rem;color:#3d1830;line-height:1.8;margin-top:8px"><div>🕛 <strong>Dès 12h</strong> — après la course</div><div>📌 <strong>Stand Agapè Anjou</strong> sur le village de la course</div><div>👤 Dites simplement <strong>votre nom</strong> à l'accueil</div></div></div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">À tout à l'heure sur le Défi Enfance !<br><strong style="color:#fb0089">— Team Défi Enfance</strong></div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}
function tplInscriptionCoureur({ prenom, nomComplet, nomAsso }) {
  const assoBlock = nomAsso
    ? `<div class="don-box" style="margin-bottom:20px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🏳️ Votre association soutenue</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089">${nomAsso}</div><div style="font-size:.78rem;color:#3d1830;margin-top:4px">Votre choix a bien été pris en compte ✅</div></div>`
    : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div>${assoBlock}<div class="intro">🚀 Vous pouvez désormais aider l'Association que vous avez choisie en invitant vos réseaux pro et perso à faire un don !</div><div class="cta-box"><p>Partagez le lien de don à vos contacts — en choisissant votre nom dans le formulaire, ils soutiennent votre collecte pour votre Association et le Plaidoyer du Défi Enfance.</p><a href="${URL_DON}" class="cta-btn">❤️ Page de don Défi Enfance</a></div><div class="note magenta">💡 Leur don est éligible à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur l'IR ou 60% sur l'IS.</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">📊 Suivez vos dons sur le <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">classement général</a> du Défi Enfance.</div>${blocCtaDonPromesse({ nomCoureur: nomComplet })}<div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Ensemble, on va soulever les énergies pour l'enfance !<br>Merci pour votre engagement.</div><div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplInscriptionSupporter({ prenom }) {
  const URL_ASSOS = 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=associations&de_event=all';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">En tant que supporter, vous avez un rôle privilégié pour soutenir les coureurs engagés pour le Défi Enfance !</div><div class="card"><h3>💪 Comment agir dès maintenant ?</h3><div class="row"><span class="ic">🏃</span><div>Découvrez <a href="${URL_ASSOS}" style="color:#fb0089;font-weight:600">la liste des associations</a></div></div><div class="row"><span class="ic">❤️</span><div>Parrainez un coureur ou une équipe par un don</div></div><div class="row"><span class="ic">📢</span><div>Partagez la <a href="${URL_DON}" style="color:#fb0089;font-weight:600">page Faire un don</a></div></div></div><div class="note magenta">💡 Dons éligibles à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur l'IR ou 60% sur l'IS.</div>${blocCtaDonPromesse({})}<div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic">Ensemble, nous allons soulever les énergies pour l'enfance !<br><strong style="color:#fb0089">— Team Défi Enfance</strong></div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

function tplBilletsEnGros({ prenomRef, nomStructure, nomEquipe, montant, date }) {
  const equipeLabel = nomEquipe || nomStructure;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🎉 Merci pour votre<br>règlement groupé !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomRef || ''} 👋</div><div style="margin-bottom:16px;text-align:center"><span class="badge">🏃 Équipe ${equipeLabel}</span></div><div class="intro">La Team Défi Enfance est <strong>fière</strong> de savoir l'équipe <strong>${equipeLabel}</strong> embarquée dans l'aventure !</div><div class="don-box"><div class="don-amount" style="font-size:2.2rem">${montant} €</div><div class="don-label">Règlement groupé reçu — 📅 ${date}</div></div><div class="note magenta">🙏 Ce règlement représente bien plus qu'un paiement — c'est le signal de départ d'une belle aventure collective !</div><div class="cta-box"><p>🚀 <strong>Faites décoller la collecte de votre équipe !</strong></p><a href="${URL_EQUIPES}" class="cta-btn">🏆 Voir la page de notre équipe</a></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Email suite au règlement groupé.<br>contact@defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
    const STATUTS_ECHEC = ['cancelled','failed','charged_back','refunded','pending_customer_approval','pending_submission','submitted'];
    const items = (json.data || []).filter(p => {
      const eventName = (p.nom_de_levent || (p.custom_fields && p.custom_fields.nom_de_levent) || '').trim();
      if (!eventName || p.payment_type_id !== 1) return false;
      // Exclure les paiements annulés, échoués ou en attente
      if (p.payment_completed === false) return false;
      if (p.payment_status && STATUTS_ECHEC.includes(p.payment_status)) return false;
      return true;
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
    html = tplMerciDonateurFidele({ prenomDonateur: prenom, montant, historiqueHtml, coureurPrenom, coureurNom, nomEquipe });

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
const ENVOI_GROUPE_DELAY_MS = 3000; // délai entre emails dans l'envoi groupé
const OHME_CONTACT_DELAY_MS  = 1000; // délai entre appels contacts dans fetchDestinataires

// ── Fetch Ohme avec retry automatique (gère 429 et 5xx)
async function fetchOhmeWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const waitMs = attempt * 2000;
        addLog(`⏳ Ohme rate limit (429) — attente ${waitMs/1000}s (tentative ${attempt}/${maxRetries})`, 'warn');
        await sleep(waitMs);
        if (attempt === maxRetries) {
          // Attente longue supplémentaire avant d'abandonner
          addLog(`⏳ Ohme rate limit persistant — attente 10s supplémentaires…`, 'warn');
          await sleep(10000);
          const retryFinal = await fetch(url, options);
          return retryFinal;
        }
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        addLog(`⏳ Ohme erreur ${res.status} — retry dans 2s (tentative ${attempt}/${maxRetries})`, 'warn');
        await sleep(2000);
        continue;
      }
      return res;
    } catch(e) {
      if (attempt < maxRetries) { await sleep(1000); continue; }
      throw e;
    }
  }
  // Ne devrait jamais arriver mais sécurité
  throw new Error('fetchOhmeWithRetry: toutes les tentatives ont échoué');
}

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
        const res = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
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
    const res = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
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
    const res = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/contacts/${contactId}`, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!res || !res.ok) return null;
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
  const key = String(contactId);

  // Stratégie 1 : index en mémoire (instantané)
  if (equipeParContactId.has(key)) {
    const equipe = equipeParContactId.get(key);
    addLog(`🔍 Équipe coureur (index) : ${equipe}`, 'info');
    return equipe;
  }

  // Stratégie 2 : le contact peut avoir un doublon dans Ohme (deux contact_id)
  // Chercher via l'email du contact dans l'index
  try {
    const contact = await fetchOhmeContactById(contactId);
    if (contact?.email) {
      const emailLower = contact.email.toLowerCase().trim();
      // Parcourir l'index pour trouver un contact avec le même email
      for (const [idxKey, equipe] of equipeParContactId.entries()) {
        const cachedContact = contactsCache.get(idxKey);
        if (cachedContact?.email?.toLowerCase().trim() === emailLower) {
          addLog(`🔍 Équipe coureur (doublon email) : ${equipe}`, 'info');
          // Ajouter l'alias dans l'index pour les prochaines fois
          equipeParContactId.set(key, equipe);
          return equipe;
        }
      }
    }
  } catch(e) {}

  addLog(`⚠️ fetchEquipeCoureur — contact ${contactId} absent de l'index`, 'warn');
  return null;
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

    // ── Détection doublon Ohme : même paiement envoyé plusieurs fois (type 1 uniquement)
    if (p.payment_type_id === 1) {
      const sig = getPaiementSignature(p);
      if (paiementsSignatures.has(sig)) {
        const cf0 = p.custom_fields || p;
        const donateur0 = [cf0.firstname||cf0.first_name||'', cf0.lastname||cf0.last_name||''].filter(Boolean).join(' ') || '?';
        addLog(`⚠️ Doublon paiement détecté (ID ${p.id}) — mis en attente`, 'warn');
        addDonEnAttente({ paiementId: String(p.id), donateur: donateur0, emailDon: cf0.email||'', montant: p.amount||'?', date: p.date||new Date().toISOString(), eventName: (p.nom_de_levent||''), typeLabel: 'Don (doublon Ohme)', modeValidation: true });
        state.processedIds.add(String(p.id));
        continue;
      }
      paiementsSignatures.add(sig);
    }

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
      const motEncouragement = (cf.mot_encouragement_sur_mur || p.mot_encouragement_sur_mur || '').trim();

      if (coureurParraine) {
        const contact      = await fetchOhmeContactByName(coureurParraine);
        const emailCoureur = contact?.email || '';
        const coureurPrenom = coureurParraine.split(' ')[0];
        // Asso soutenue : lire depuis l'index billetterie du coureur (pas du paiement don)
        const assoSoutenue  = (contact?.id ? (assoParContactId.get(String(contact.id)) || '') : '') || (cf.asso_soutenue || '').trim();
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
      const motEncouragement = (cf.mot_encouragement_sur_mur || p.mot_encouragement_sur_mur || '').trim();

      addLog(`🏅 Promesse de don détectée : ${montantKm}€/km de ${donateur}`, 'info');

      if (coureurParraine) {
        const contact      = await fetchOhmeContactByName(coureurParraine);
        const emailCoureur = contact?.email || '';
        const coureurPrenom = coureurParraine.split(' ')[0];
        // Asso soutenue : lire depuis l'index billetterie du coureur
        const assoSoutenue  = (contact?.id ? (assoParContactId.get(String(contact.id)) || '') : '') || (cf.asso_soutenue || '').trim();

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
          const histProm = await fetchHistoriqueDons(p.contact_id);
          const histPromHtml = formatHistoriqueDons(histProm);
          const htmlMerci = tplMerciPrometteurCoureur({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantParKm: montantKm, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: assoSoutenue, historiqueHtml: histPromHtml });
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
          const histPromE = await fetchHistoriqueDons(p.contact_id);
          const histPromHtmlE = formatHistoriqueDons(histPromE);
          const htmlMerci = tplMerciPrometteurEquipe({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantParKm: montantKm, nomEquipe: equipeParraine, historiqueHtml: histPromHtmlE });
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
  // Mettre à jour l'index équipes toutes les 10 polls (~1h40)
  if (!state.pollCount) state.pollCount = 0;
  state.pollCount++;
  if (state.pollCount % 10 === 0) buildEquipeIndex().catch(()=>{});
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
    groupe_angers_j1_coureurs:   { subject: '🧪 Test — 🎽 J-1 Angers — Dernières infos', html: tplGroupeJ1Angers({ prenom: 'Victor', numeroDossard: '42', urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK }) },
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

        // 3. Email au référent d'équipe du coureur
        const equipe = await fetchEquipeCoureur(contact?.id);
        if (equipe) {
          const structure  = await fetchOhmeStructureByName(equipe);
          const chefEmail  = structure?.email_referent_defi_enfance || '';
          const chefPrenom = structure?.prenom_du_referent_defi_enfance || 'Bonjour';
          const chefNom    = structure?.nom_du_referent_defi_enfance || '';
          if (chefEmail) {
            const coureurPrenom = coureurParraine.split(' ')[0];
            const coureurNom    = coureurParraine.split(' ').slice(1).join(' ');
            const promEquipe    = await fetchTotalPromessesEquipe(equipe);
            const urlPageCoureurE     = await buildUrlPageCoureur(contact?.id, eventName);
            const urlPromesseCoureurE = await buildUrlPromesseCoureur(contact?.id, eventName);
            const htmlEquipe = tplPromesseCoureurPourEquipe({ chefPrenom, chefNom, nomEquipe: equipe, donateur, montantParKm: montantKm, email_donateur: emailDon, coureurPrenom, coureurNom, motEncouragement: (cf.mot_encouragement_sur_mur || '').trim(), nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total, urlPageCoureur: urlPageCoureurE, urlPromesseCoureur: urlPromesseCoureurE });
            const okE = await sendBrevo(chefEmail, `🏅 Promesse de ${donateur} pour ${coureurPrenom} — équipe ${equipe} !`, htmlEquipe);
            if (okE) { state.stats.sent++; addLog(`✅ Promesse validée → chef équipe ${equipe}`, 'ok'); }
          } else { addLog(`⚠️ Promesse validée — email référent "${equipe}" introuvable`, 'warn'); }
        } else { addLog(`⚠️ Promesse validée — pas d'équipe trouvée pour ${coureurParraine}`, 'warn'); }

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
      if (ok) { state.stats.sent++; addLog(`✅ Don validé → ${coureurParraine}`, 'ok'); sendMerciDonateur({ email: emailDon, prenom: prenomMerciValider, montant, donateur, coureurPrenom: coureurParraine.split(' ')[0], coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: (cf.asso_soutenue || '').trim(), contactId: paiement.contact_id, isStructure: infosValider.isStructure, nomStructure: infosValider.nomStructure }); }
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
      if (ok) { state.stats.sent++; sendMerciDonateur({ email: emailDon, prenom: prenomMerciValider, montant, donateur, nomEquipe: equipeParraine, contactId: paiement.contact_id, isStructure: infosValider.isStructure, nomStructure: infosValider.nomStructure }); addLog(`✅ Don validé → équipe ${equipeParraine}`, 'ok'); }
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
  await saveDonsEnAttente();

  // ── Récupérer TOUS les IDs Ohme et les sauvegarder en Redis
  // Evite que les paiements existants soient retraités au prochain redémarrage
  addLog('🔄 Chargement de tous les IDs Ohme pour Redis…', 'info');
  try {
    let cursor = null;
    let nbIds = 0;
    while (true) {
      await sleep(OHME_DELAY_MS);
      const url = cursor
        ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&since_date=2025-01-01&cursor=${encodeURIComponent(cursor)}`
        : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&since_date=2025-01-01`;
      const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
      if (!r || !r.ok) break;
      const j = await r.json();
      const items = j.data || [];
      items.forEach(p => { if (p.id) { state.processedIds.add(String(p.id)); nbIds++; } });
      if (items.length < 250) break;
      cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
      if (!cursor) break;
    }
    addLog(`✅ ${nbIds} IDs Ohme chargés et sauvegardés en Redis`, 'ok');
  } catch(e) {
    addLog(`⚠️ Chargement IDs Ohme : ${e.message}`, 'warn');
  }

  await saveProcessedIds();
  addLog(`🗑️ ${count} don(s) ignorés — Redis mis à jour`, 'info');
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
    sujet: '🎽 Demain, c\'est le jour J ! 🎽',
    template: (prenom, nbJours, extra) => tplGroupeJ1Angers({ prenom, numeroDossard: extra?.numeroDossard || '', urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    personnalise: true,
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
  'groupe_j10_angers_coureurs':   '🎽 Dans ${j} jours, on court pour l\'enfance à Angers — tout ce qu\'il faut savoir !',
  'groupe_j2_referents_angers':   '🏃 Boostons nos collectes de dons — Défi Enfance Angers !',
  'groupe_j2_referents_joue':      null, // sujet dynamique
  'groupe_j10_joue_coureurs':      '🎽 Dans ${j} jours, on court pour l\'enfance à Joué-lès-Tours — tout ce qu\'il faut savoir !',
  'groupe_j1_angers_coureurs':    '🎽 Demain, c\'est le jour J ! 🎽',
  'groupe_j1_donateurs':          '❤️ Merci pour votre soutien — demain c\'est le grand jour !',
  'groupe_jourj_promesses':        '🏁 Vos promesses de don — le Défi Enfance a couru pour l\'enfance !',
  'groupe_merci_donateurs_angers':  null, // sujet dynamique
  'groupe_merci_donateurs_joue':    null, // sujet dynamique
  'groupe_merci_coureurs_angers':   null, // sujet dynamique par coureur
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
    'groupe_j2_referents_joue':     (prenom, nbJours, extra) => tplGroupeJ2ReferentsJoue({ prenom, nbJours, urlPromesseEquipe: extra?.urlPromesseEquipe || extra?.urlPromesseCoureur, urlPageEquipe: extra?.urlPageEquipe }),
    'groupe_j10_joue_coureurs':    (prenom, nbJours, extra) => tplGroupeJ10Joue({ prenom, nbJours, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_j10_joue_coureurs_v2':  (prenom, nbJours, extra) => tplGroupeJ10JoueV2({ prenom, nbJours, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_j1_angers_coureurs':  (prenom, nbJours, extra) => tplGroupeJ1Angers({ prenom, numeroDossard: extra?.numeroDossard, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_j1_donateurs':        (prenom, nbJours, extra) => tplGroupeJ1Donateurs({ prenom, historiqueHtml: extra?.historiqueHtml || '', urlDon: extra?.urlDon, urlProm: extra?.urlProm }),
    'groupe_jourj_promesses':     (prenom, nbJours, extra) => tplGroupeJourJPromesses({ prenom, promesses: extra?.promesses || [] }),
    'groupe_merci_donateurs_angers': (prenom, nbJours, extra) => tplGroupeMerciDonateurAngers({ prenom, historiqueHtml: extra?.historiqueHtml || '', totalDons: extra?.totalDons || 0, nbDons: extra?.nbDons || 0 }),
    'groupe_merci_donateurs_joue':   (prenom, nbJours, extra) => tplGroupeMerciDonateurJoue({ prenom, historiqueHtml: extra?.historiqueHtml || '', totalDons: extra?.totalDons || 0, nbDons: extra?.nbDons || 0 }),
    'groupe_merci_coureurs_angers': (prenom, nbJours, extra) => tplGroupeMerciCoureurAngers({ prenom, dossard: extra?.numeroDossard || 0, nomCoureur: extra?.nom || prenom, equipe: extra?.nomEquipe || '', kmsPerso: extra?.kmsPerso || 0, classementPerso: extra?.classementPerso || 0, kmsEquipe: extra?.kmsEquipe || 0, classementEquipe: extra?.classementEquipe || 0, estSolo: !extra?.nomEquipe || extra?.nomEquipe === (extra?.nom || prenom) }),
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
  'angers_coureurs':             ['Défi Enfance #Course #Angers2026'],
  'angers_coureurs_referents':   ['Défi Enfance #Course #Angers2026'],
  'promettants_angers':         ['Défi Enfance #Course #Angers2026', 'Défi Enfance #Supporters #Angers2026'],
  'donateurs_angers_global':    ['Défi Enfance #Course #Angers2026', 'Défi Enfance global'],
  'donateurs_joue':             ['Défi Enfance #Course #Joué-lès-Tours2026'],
  'joue_coureurs':          ['Défi Enfance #Course #Joué-lès-Tours2026'],
  'joue_coureurs_equipe':   ['Défi Enfance #Course #Joué-lès-Tours2026'],
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
    if (['angers_coureurs','joue_coureurs','joue_coureurs_equipe','global_coureurs',
         'angers_supporters','joue_supporters','global_supporters','dejeuner'].includes(typeDestinataire)) {

      // Pré-charger contacts puis structures en bulk séquentiel (~6 appels, ménage Ohme)
      if (['angers_coureurs','angers_coureurs_referents','joue_coureurs','joue_coureurs_equipe'].includes(typeDestinataire)) {
        await chargerContactsBulk();
        await chargerStructuresBulk();
      }

      const eventsAttendus = EVENTS_MAP[typeDestinataire] || [];
      let cursor = null;

      while (true) {
        await sleep(OHME_DELAY_MS);
        const useTypeFilter = !['joue_coureurs','joue_coureurs_equipe'].includes(typeDestinataire);
        const typeParam = useTypeFilter ? 'payment_type_id=3&' : '';
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&${typeParam}since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&${typeParam}since_date=2026-01-01`;

        const res = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!res.ok) { addLog(`⚠️ Ohme HTTP ${res.status} (fetchDestinataires billetterie)`, 'warn'); break; }
        const json = await res.json();
        const items = json.data || [];

        for (const p of items) {
          const cf = p.custom_fields || p;
          const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').trim();

          // Filtre event — normalisation accents + casse
          const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (!eventsAttendus.some(e => {
            const tag = normalize(e).replace('defi enfance ', '');
            return normalize(eventNom).includes(tag);
          })) continue;

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
          const isCoureurAngers = ['angers_coureurs','angers_coureurs_referents'].includes(typeDestinataire);
          const isCoureurJoue   = ['joue_coureurs','joue_coureurs_equipe'].includes(typeDestinataire);
          // Pour les coureurs Angers : utiliser le cache bulk (chargé en ~3 appels)
          let contact = contactsCache.get(String(p.contact_id));
          if (!contact) {
            await sleep(OHME_CONTACT_DELAY_MS);
            contact = await fetchOhmeContactById(p.contact_id);
            if (contact) contactsCache.set(String(p.contact_id), contact);
          }
          if (!contact || !contact.email) continue;

          const cfContact = contact.custom_fields || contact;
          const isAngers = eventNom.toUpperCase().includes('ANGERS');
          const dossardRaw = isAngers
            ? (cfContact.numero_dossard_angers_2026 ?? contact.numero_dossard_angers_2026 ?? '')
            : (cfContact.numero_de_dossard_joue2026 ?? contact.numero_de_dossard_joue2026 ?? '');
          const numeroDossard = (dossardRaw !== null && dossardRaw !== undefined && dossardRaw !== '' && dossardRaw !== 0 && dossardRaw !== '0')
            ? String(dossardRaw)
            : '';
          const cfContact2 = cfContact;
          const dossardNum = parseInt(numeroDossard || 0);
          // Filtre dossard officiel pour les coureurs Angers
          if (isCoureurAngers && (!dossardNum || !DOSSARDS_ANGERS_2026.has(dossardNum))) continue;
          // Déduplication email (désactivée pour les coureurs)
          const dedupeEmail = !isCoureurAngers && !isCoureurJoue;
          if (dedupeEmail && emailsVus.has(contact.email)) continue;
          emailsVus.add(contact.email);

          const prenom = contact.firstname || contact.first_name || '';
          const nom    = contact.lastname  || contact.last_name  || '';
          const kmsPerso        = parseFloat(cfContact2.km_parcourus_angers2026 || contact.km_parcourus_angers2026 || 0);
          const classementPerso = parseInt(cfContact2.classement_angers2026    || contact.classement_angers2026    || 0);

          const nomEquipe = (cf.equipe || '').trim();

          // Filtre équipe non vide pour joue_coureurs_equipe
          if (typeDestinataire === 'joue_coureurs_equipe' && !nomEquipe) continue;

          // Lire classement équipe depuis la structure Ohme via le nom d'équipe du paiement
          let kmsEquipe = 0;
          let classementEquipe = 0;
          if (nomEquipe) {
            // Priorité 1 : index codé en dur (instantané, pas d'appel API)
            if (CLASSEMENT_EQUIPES[nomEquipe]) {
              kmsEquipe        = CLASSEMENT_EQUIPES[nomEquipe].kms;
              classementEquipe = CLASSEMENT_EQUIPES[nomEquipe].classement;
            }
            // Priorité 2 : champs Ohme sur la structure (cache bulk — 0 appel API)
            const structure = structuresParNom.get(nomEquipe)
              || structuresParNom.get(nomEquipe.toLowerCase())
              || null; // pas d'appel API — tout est en cache
            if (structure) {
              const cfStr = structure.custom_fields || structure;
              const kmsOhme  = parseFloat(cfStr.km_parcourus_equipe_angers_2026 || 0);
              const classOhme = parseInt(cfStr.classement_angers20261 || 0);
              if (kmsOhme > 0)   kmsEquipe        = kmsOhme;
              if (classOhme > 0) classementEquipe = classOhme;
            }
          }

          destinataires.push({
            prenom:          prenom || 'Participant',
            nom,
            email:           contact.email,
            contactId:       contact.id,
            nomAsso:         (cf.asso_soutenue || '').trim(),
            nomEquipe,  // déjà défini ci-dessus
            eventName:       eventNom,
            datePaiement:    p.created_at || p.date,
            numeroDossard,
            kmsPerso,
            classementPerso,
            kmsEquipe,
            classementEquipe,
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
        const res = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
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
        const res = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
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
          await sleep(OHME_CONTACT_DELAY_MS);
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
        const res = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
        if (!res.ok) { addLog(`⚠️ Ohme HTTP ${res.status} (fetchDestinataires donateurs)`, 'warn'); break; }
        const json = await res.json();
        const items = json.data || [];
        for (const p of items) {
          if (dateFiltre) {
            const datePmt = new Date(p.created_at || p.date || 0);
            if (datePmt <= dateFiltre) continue;
          }
          if (!p.contact_id) continue;
          await sleep(OHME_CONTACT_DELAY_MS);
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


  // ── Pour le type référents équipe, ajouter les référents en plus des coureurs
  if (typeDestinataire === 'angers_coureurs_referents') {
    addLog("🏆 Ajout des référents d'équipe…", 'info');
    let cursorStr = null;
    while (true) {
      await sleep(OHME_DELAY_MS);
      const urlStr = cursorStr
        ? `${CONFIG.ohmeBase}/api/v1/structures?limit=250&cursor=${encodeURIComponent(cursorStr)}`
        : `${CONFIG.ohmeBase}/api/v1/structures?limit=250`;
      const rStr = await fetchOhmeWithRetry(urlStr, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
      if (!rStr || !rStr.ok) break;
      const jStr = await rStr.json();
      const structs = jStr.data || [];
      for (const s of structs) {
        const cf = s.custom_fields || s;
        const emailRef = (cf.email_referent_defi_enfance || '').trim();
        const estEquipe = cf.equipe_defi_enfance === true || cf.equipe_defi_enfance === 'true';
        if (!emailRef || !estEquipe) continue;
        const prenomRef = cf.prenom_du_referent_defi_enfance || '';
        const nomRef    = cf.nom_du_referent_defi_enfance || '';
        const nomEquipe = s.name || '';
        const kmsEquipe        = parseFloat(cf.km_parcourus_equipe_angers_2026 || 0) || (CLASSEMENT_EQUIPES[nomEquipe]?.kms || 0);
        const classementEquipe = parseInt(cf.classement_angers20261 || 0) || (CLASSEMENT_EQUIPES[nomEquipe]?.classement || 0);
        destinataires.push({
          prenom: prenomRef || nomRef, nom: nomRef, email: emailRef,
          contactId: `ref_${s.id}`, nomEquipe, nomAsso: '',
          eventName: 'Défi Enfance #Course #Angers2026',
          numeroDossard: '', kmsPerso: 0, classementPerso: 0,
          kmsEquipe, classementEquipe, estReferent: true,
        });
      }
      if (structs.length < 250) break;
      cursorStr = jStr.cursor || (structs.length > 0 ? String(structs[structs.length - 1].id) : null);
      if (!cursorStr) break;
    }
    addLog(`✅ Référents équipe ajoutés — total: ${destinataires.length}`, 'ok');
  }

  return destinataires;
}

// ── Cache bulk des structures par nom (chargé en une seule pagination)
const structuresParNom = new Map(); // nomStructure → structure

async function chargerStructuresBulk() {
  if (structuresParNom.size > 0) return;
  addLog('📋 Chargement bulk structures…', 'info');
  let cursor = null;
  let nb = 0;
  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/structures?limit=250&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/structures?limit=250`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r || !r.ok) break;
    const j = await r.json();
    const items = j.data || [];
    for (const s of items) {
      if (s.name) {
        structuresParNom.set(s.name.trim(), s); // clé exacte
        structuresParNom.set(s.name.trim().toLowerCase(), s); // clé normalisée
        nb++;
      }
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }
  addLog(`✅ ${nb} structures chargées en cache`, 'ok');
}

// ── Cache global des contacts par dossard (chargé en bulk, ~3 appels API seulement)
const contactsParDossard = new Map(); // dossard → contact
const contactsParId      = new Map(); // contactId → contact

async function chargerContactsBulk() {
  if (contactsParDossard.size > 0) return; // déjà chargé
  addLog('📋 Chargement bulk tous les contacts Ohme…', 'info');
  let cursor = null;
  let nbTotal = 0;
  let nbCoureurs = 0;
  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/contacts?limit=250&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/contacts?limit=250`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r || !r.ok) { addLog(`⚠️ Chargement bulk contacts HTTP ${r?.status}`, 'warn'); break; }
    const j = await r.json();
    const items = j.data || [];
    for (const c of items) {
      nbTotal++;
      const cf = c.custom_fields || c;
      // Indexer par ID pour le cache général
      if (c.id) contactsParId.set(String(c.id), c);
      // Indexer par dossard pour les coureurs Angers
      const dossard = parseInt(cf.numero_dossard_angers_2026 || c.numero_dossard_angers_2026 || 0);
      if (dossard && DOSSARDS_ANGERS_2026.has(dossard)) {
        contactsParDossard.set(dossard, c);
        // Aussi dans contactsCache pour fetchOhmeContactById
        if (c.id) contactsCache.set(String(c.id), c);
        nbCoureurs++;
      }
    }
    addLog(`📦 Bulk contacts : ${nbTotal} chargés (dont ${nbCoureurs} coureurs Angers indexés)…`, 'info');
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }
  addLog(`✅ Bulk contacts terminé — ${nbTotal} contacts chargés (${nbCoureurs} coureurs Angers indexés)`, 'ok');
}

// ── Récupérer les donateurs avec historique de leurs dons
async function fetchDestinatairesAvecDons(typeDestinataire) {
  const isAngers = typeDestinataire === 'donateurs_angers_global';
  const isJoue   = typeDestinataire === 'donateurs_joue';

  // Charger le cache bulk contacts + structures pour les classements
  await chargerContactsBulk();
  await chargerStructuresBulk();

  const donateursMap = new Map(); // email → { prenom, nom, email, contactId, dons[], totalDons }
  let cursor = null;

  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r || !r.ok) break;
    const j = await r.json();
    const items = j.data || [];

    for (const p of items) {
      const cf = p.custom_fields || p;
      const montant = parseFloat(p.amount || 0);
      if (montant <= 0) continue;
      // Exclure les dons "don attendu" (non encore reçus)
      const qualite = (cf.qualite_du_participant || '').toLowerCase().trim();
      if (qualite === 'don attendu') continue;
      const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Filtre event selon le type (eventNom déjà normalisé lowercase sans accents)
      if (isAngers && !(eventNom.includes('angers2026') || eventNom.includes('global') || eventNom.includes('defi enfance global'))) continue;
      if (isJoue   && !eventNom.includes('joue')) continue;
      // Récupérer le contact (ou le référent de la structure si pas de contact_id)
      let email, prenom, nom, contactId;
      if (p.contact_id) {
        let contact = contactsCache.get(String(p.contact_id));
        if (!contact) {
          await sleep(OHME_CONTACT_DELAY_MS);
          contact = await fetchOhmeContactById(p.contact_id);
          if (contact) contactsCache.set(String(p.contact_id), contact);
        }
        if (!contact?.email) continue;
        email     = contact.email.toLowerCase().trim();
        prenom    = contact.firstname || contact.first_name || '';
        nom       = contact.lastname  || contact.last_name  || '';
        contactId = contact.id;
      } else if (p.structure_id) {
        // Paiement lié à une structure → utiliser le référent
        const structure = structuresParNom.get(p.structure_name || '')
          || [...structuresParNom.values()].find(s => String(s.id) === String(p.structure_id));
        if (!structure) continue;
        const cfS = structure.custom_fields || structure;
        const emailRef = (cfS.email_referent_defi_enfance || '').trim();
        if (!emailRef) continue;
        email     = emailRef.toLowerCase();
        prenom    = cfS.prenom_du_referent_defi_enfance || structure.name || '';
        nom       = cfS.nom_du_referent_defi_enfance || '';
        contactId = `struct_${p.structure_id}`;
      } else {
        continue;
      }

      if (!donateursMap.has(email)) {
        donateursMap.set(email, { prenom, nom, email, contactId, dons: [], totalDons: 0 });
      }

      const coureurParraine = (cf.coureur_parraine || '').trim();
      const equipeParraine  = (cf.equipe_parraine  || '').trim();
      const dateStr = (p.date || p.created_at) ? new Date(p.date || p.created_at).toLocaleDateString('fr-FR') : '';

      // Classement et kms depuis les champs personnalisés Ohme du coureur/équipe parrainé(e)
      let classementInfo = '';
      let kmsParraine = 0;
      let classParraine = 0;
      let equipeParraine2 = '';

      if (coureurParraine) {
        // Chercher le contact du coureur parrainé via le cache bulk
        const contactCoureur = contactsParId.get(String(p.beneficiary_contact_id || ''))
          || [...contactsCache.values()].find(c => {
              const n = `${c.lastname||c.last_name||''} ${c.firstname||c.first_name||''}`.trim();
              const n2 = `${c.firstname||c.first_name||''} ${c.lastname||c.last_name||''}`.trim();
              return n === coureurParraine || n2 === coureurParraine;
            });
        if (contactCoureur) {
          const cfC = contactCoureur.custom_fields || contactCoureur;
          kmsParraine   = parseFloat(cfC.km_parcourus_angers2026   || 0);
          classParraine = parseInt(cfC.classement_angers2026        || 0);
          equipeParraine2 = cfC.lequipe_defi_enfance_dont_je_suis_le_referent || '';
        }
        // Fallback index codé en dur
        if (!kmsParraine) {
          const ci = Object.values(CLASSEMENT_INDIVIDUEL).find(c => c.nom === coureurParraine);
          if (ci) { kmsParraine = ci.kms; classParraine = ci.classement; equipeParraine2 = ci.equipe; }
        }
        if (kmsParraine || classParraine) {
          classementInfo = `${classParraine ? ` — ${classParraine}e / ${NB_COUREURS_ANGERS} coureurs` : ''}${kmsParraine ? ` — ${kmsParraine} km parcourus` : ''}${equipeParraine2 ? ` — ${equipeParraine2}` : ''}`;
        }
      } else if (equipeParraine) {
        // Chercher la structure via le cache bulk
        const structure = structuresParNom.get(equipeParraine) || structuresParNom.get(equipeParraine.toLowerCase());
        if (structure) {
          const cfS = structure.custom_fields || structure;
          kmsParraine   = parseFloat(cfS.km_parcourus_equipe_angers_2026 || 0);
          classParraine = parseInt(cfS.classement_angers20261              || 0);
        }
        // Fallback index codé en dur
        if (!kmsParraine && CLASSEMENT_EQUIPES[equipeParraine]) {
          kmsParraine   = CLASSEMENT_EQUIPES[equipeParraine].kms;
          classParraine = CLASSEMENT_EQUIPES[equipeParraine].classement;
        }
        if (kmsParraine || classParraine) {
          classementInfo = `${classParraine ? ` — ${classParraine}e / ${NB_EQUIPES_ANGERS} équipes` : ''}${kmsParraine ? ` — ${kmsParraine} km parcourus` : ''}`;
        }
      }

      const don = { montant, dateStr, coureurParraine, equipeParraine, classementInfo };
      donateursMap.get(email).dons.push(don);
      donateursMap.get(email).totalDons += montant;
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }

  // Construire l'historique HTML pour chaque donateur
  const result = [];
  for (const [, d] of donateursMap) {
    const historiqueHtml = d.dons.map(don => {
      const parrainage = don.coureurParraine
        ? `<span style="color:#7c3aed;font-weight:600">🏃 ${don.coureurParraine}</span>${don.classementInfo ? `<br><span style="font-size:.75rem;color:#888">${don.classementInfo.trim()}</span>` : ''}`
        : don.equipeParraine
        ? `<span style="color:#ef6135;font-weight:600">🏆 ${don.equipeParraine}</span>${don.classementInfo ? `<br><span style="font-size:.75rem;color:#888">${don.classementInfo.trim()}</span>` : ''}`
        : '<span style="color:#888">Don général</span>';
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f5dced;font-size:.82rem;color:#3d1830"><div><span style="color:#888;font-size:.75rem">${don.dateStr}</span><br>${parrainage}</div><div style="font-weight:700;color:#fb0089;white-space:nowrap;padding-left:8px">${don.montant.toFixed(2)} €</div></div>`;
    }).join('');
    result.push({ ...d, historiqueHtml });
  }

  addLog(`✅ ${result.length} donateur(s) trouvés`, 'ok');
  return result;
}

// ── Récupérer les promettants avec leurs promesses pour Jour J
async function fetchPromettantsAvecPromesses() {
  const promettantsMap = new Map(); // email → { prenom, nom, email, contactId, promesses[] }
  let cursor = null;
  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r || !r.ok) break;
    const j = await r.json();
    const items = j.data || [];
    for (const p of items) {
      const cf = p.custom_fields || p;
      const montantKm = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (!montantKm || montantKm <= 0) continue;
      const eventName = (p.nom_de_levent || cf.nom_de_levent || '').toUpperCase();
      if (!eventName.includes('ANGERS')) continue;
      const coureurParraine = (cf.coureur_parraine || '').trim();
      const equipeParraine  = (cf.equipe_parraine || '').trim();
      if (!coureurParraine && !equipeParraine) continue;
      await sleep(OHME_CONTACT_DELAY_MS);
      let contact = await fetchOhmeContactById(p.contact_id);
      // Fallback : si pas de contact (paiement d'entreprise), chercher via la structure
      if (!contact?.email && p.structure_id) {
        await sleep(OHME_CONTACT_DELAY_MS);
        const rStr = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/structures/${p.structure_id}`, {
          headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
        });
        if (rStr?.ok) {
          const jStr = await rStr.json();
          const structure = jStr.data || jStr;
          const cfStr = structure.custom_fields || structure;
          const emailRef = (cfStr.email_referent_defi_enfance || '').trim();
          if (emailRef) {
            contact = {
              id: `struct_${p.structure_id}`,
              email: emailRef,
              firstname: cfStr.prenom_du_referent_defi_enfance || structure.name || '',
              lastname:  cfStr.nom_du_referent_defi_enfance || '',
            };
            addLog(`🔍 Promettant (structure) : ${structure.name}`, 'info');
          }
        }
      }
      if (!contact?.email) continue;
      const email  = contact.email.toLowerCase().trim();
      const prenom = contact.firstname || contact.first_name || '';
      const nom    = contact.lastname  || contact.last_name  || '';
      if (!promettantsMap.has(email)) {
        promettantsMap.set(email, { prenom, nom, email, contactId: contact.id, promesses: [] });
      }
      let kmParcourus = 0;
      if (coureurParraine) {
        const contactCoureur = await fetchOhmeContactByName(coureurParraine);
        if (contactCoureur?.id) {
          const cfC = contactCoureur.custom_fields || contactCoureur;
          kmParcourus = parseFloat(cfC.km_parcourus_angers2026 || contactCoureur.km_parcourus_angers2026 || 0);
        }
        const montantDu = kmParcourus > 0 ? Math.round(kmParcourus * montantKm * 100) / 100 : 0;
        promettantsMap.get(email).promesses.push({ type: 'coureur', nom: coureurParraine, montantKm, kmParcourus, montantDu, urlDon: 'https://defienfance.fr/faire-un-don/' });
      } else if (equipeParraine) {
        // Chercher les kms de l'équipe via la structure
        let kmsEquipe = CLASSEMENT_EQUIPES[equipeParraine]?.kms || 0;
        if (!kmsEquipe) {
          const structure = await fetchOhmeStructureByName(equipeParraine);
          if (structure) {
            const cfStr = structure.custom_fields || structure;
            kmsEquipe = parseFloat(cfStr.km_parcourus_equipe_angers_2026 || structure.km_parcourus_equipe_angers_2026 || 0);
          }
        }
        const montantDuEquipe = kmsEquipe > 0 ? Math.round(kmsEquipe * montantKm * 100) / 100 : 0;
        promettantsMap.get(email).promesses.push({ type: 'equipe', nom: equipeParraine, montantKm, kmParcourus: kmsEquipe, montantDu: montantDuEquipe, urlDon: 'https://defienfance.fr/faire-un-don/' });
      }
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }
  addLog(`✅ ${promettantsMap.size} promettant(s) trouvés`, 'ok');
  return [...promettantsMap.values()];
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
    const tous = typeDestinataire === 'promettants_angers'
      ? (await fetchPromettantsAvecPromesses()).map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_promesses: p.promesses }))
      : ['donateurs_angers_global','donateurs_joue'].includes(typeDestinataire)
      ? (await fetchDestinatairesAvecDons(typeDestinataire)).map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_historique: p.historiqueHtml, extra_total: p.totalDons, extra_nb: p.dons.length }))
      : await fetchDestinataires({ typeDestinataire, filtreEquipe, depuisFrance, nbJours });
    const dejaEnvoyes = await getContactsDejaEnvoyes(`custom_${typeDestinataire}_${template}`);
    const nouveaux = tous.filter(p => !dejaEnvoyes.has(String(p.contactId)));

    // ── Détection des doublons (100% locale, sans appel API Ohme)
    // Pour certains templates (merci coureurs), on envoie à tous même si même email
    const templateSansDedup = ['groupe_merci_coureurs_angers'].includes(template);
    const parEmail = {};
    for (const p of nouveaux) {
      const cle = templateSansDedup ? String(p.contactId || p.email + '_' + Math.random()) : p.email;
      if (!parEmail[cle]) parEmail[cle] = [];
      parEmail[cle].push(p);
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

      // Récupérer tous les destinataires selon le type
      const fetchTousStart = async () => {
        if (typeDestinataire === 'promettants_angers') {
          const promettants = await fetchPromettantsAvecPromesses();
          return promettants.map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_promesses: p.promesses }));
        }
        if (['donateurs_angers_global','donateurs_joue'].includes(typeDestinataire)) {
          const donateurs = await fetchDestinatairesAvecDons(typeDestinataire);
          return donateurs.map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_historique: p.historiqueHtml, extra_total: p.totalDons, extra_nb: p.dons.length }));
        }
        return fetchDestinataires({ typeDestinataire, filtreEquipe, depuisFrance, nbJours });
      };

      if (contactIdsFinals && contactIdsFinals.length > 0) {
        envoiGroupeLog(`✅ Liste validée reçue — ${contactIdsFinals.length} destinataire(s)`, 'ok');
        const tous = await fetchTousStart();
        const idsSet = new Set(contactIdsFinals.map(String));
        participants = tous.filter(p => idsSet.has(String(p.contactId)));
      } else {
        const tous = await fetchTousStart();
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
            // Historique dons pour les templates donateurs
            historiqueHtml:      formatHistoriqueDons(await fetchHistoriqueDons(p.contactId)),
            urlDon:              await buildUrlPageCoureur(p.contactId, p.eventName),
            urlProm:             await buildUrlPromesseCoureur(p.contactId, p.eventName),
            promesses:           p.extra_promesses || [],
            historiqueHtml:      p.extra_historique || '',
            totalDons:           p.extra_total || 0,
            nbDons:              p.extra_nb || 0,
            // Classements depuis Ohme (contacts + structures)
            kmsPerso:            p.kmsPerso            || 0,
            classementPerso:     p.classementPerso     || 0,
            kmsEquipe:           p.kmsEquipe           || 0,
            classementEquipe:    p.classementEquipe    || 0,
          });
          const campagne = CAMPAGNES[campagneId] || { sujet: template };
          let sujetBase = TEMPLATES_SUJETS[template] || template;
          // Sujet dynamique selon template
          let sujetFinal;
          if (template === 'groupe_merci_coureurs_angers') {
            const nomComplet = `${p.prenom || ''} ${p.nom || ''}`.trim();
            const equipeLabel = p.nomEquipe && p.nomEquipe !== nomComplet ? ` — ${p.nomEquipe}` : '';
            sujetFinal = `🏁 Bravo ${p.prenom || nomComplet}${equipeLabel} — votre bilan Défi Enfance Angers 2026 !`;
          } else if (['groupe_j10_joue_coureurs','groupe_j10_joue_coureurs_v2'].includes(template)) {
            sujetFinal = `🏁 ${p.prenom || 'Coureur'}, dans ${nbJours || 10} jours c'est votre tour — Défi Enfance Joué 2026 !`;
          } else if (template === 'groupe_merci_donateurs_angers') {
            sujetFinal = `❤️ Merci ${p.prenom || ''} — vous êtes les pionniers du Défi Enfance Angers 2026 !`;
          } else if (template === 'groupe_merci_donateurs_joue') {
            sujetFinal = `🏁 ${p.prenom || ''}, Angers a couru — Joué-lès-Tours entre en scène !`;
          } else if (template === 'groupe_j2_referents_joue') {
            sujetFinal = `🏃 ${p.prenom || ''} — Boost collecte Joué ! Dans ${nbJours || 7} jours, c'est votre tour !`;
          } else {
            if (nbJours) sujetBase = sujetBase ? sujetBase.replace(/\$\{j\}/g, nbJours).replace(/\d+ jours?/gi, `${nbJours} jours`) : template;
            sujetFinal = sujetBase ? sujetBase.replace(/\$\{prenom\}/g, p.prenom || 'Participant') : template;
          }
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

// ── POST /api/envoi-groupe/test-contact — envoyer à un email de choix avant l'envoi général
app.post('/api/envoi-groupe/test-contact', async (req, res) => {
  const { template, typeDestinataire, filtreEquipe, depuisFrance, nbJours, emailTest } = req.body;
  if (!template || !emailTest) return res.json({ success: false, error: 'template et emailTest requis' });

  try {
    envoiGroupeLog(`🧪 Envoi test contact : ${emailTest}…`, 'info');

    // Récupérer la liste des destinataires
    let tous;
    if (typeDestinataire === 'promettants_angers') {
      const promettants = await fetchPromettantsAvecPromesses();
      tous = promettants.map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_promesses: p.promesses }));
    } else if (['donateurs_angers_global','donateurs_joue'].includes(typeDestinataire)) {
      const donateurs = await fetchDestinatairesAvecDons(typeDestinataire);
      tous = donateurs.map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_historique: p.historiqueHtml, extra_total: p.totalDons, extra_nb: p.dons.length }));
    } else {
      tous = await fetchDestinataires({ typeDestinataire, filtreEquipe, depuisFrance, nbJours });
    }

    if (!tous.length) return res.json({ success: false, error: 'Aucun destinataire trouvé' });

    const tplFn = getTemplateFunction(template);
    if (!tplFn) return res.json({ success: false, error: `Template "${template}" introuvable` });

    // Envoyer les 2 premiers destinataires à l'email de test
    const modeles = tous.slice(0, 2);
    const nomModeles = [];
    for (const modele of modeles) {
      const sujet = `🧪 [TEST ${modeles.indexOf(modele)+1}/2] ${template} — données de ${modele.prenom || 'Participant'} ${modele.nom || ''}`.trim();
      const extra = {
        nomAsso: modele.nomAsso || '', nomEquipe: modele.nomEquipe || '',
        urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK,
        urlPageEquipe: URL_EQUIPES, numeroDossard: modele.numeroDossard || '',
        promesses: modele.extra_promesses || [],
        historiqueHtml: modele.extra_historique || '',
        totalDons: modele.extra_total || 0, nbDons: modele.extra_nb || 0,
        kmsPerso: modele.kmsPerso || 0, classementPerso: modele.classementPerso || 0,
        kmsEquipe: modele.kmsEquipe || 0, classementEquipe: modele.classementEquipe || 0,
      };
      const html = tplFn(modele.prenom || 'Participant', nbJours, extra);
      await sendBrevo(emailTest, sujet, html);
      await sleep(2000);
      nomModeles.push(`${modele.prenom || ''} ${modele.nom || ''}`.trim());
    }
    envoiGroupeLog(`✅ 2 emails test envoyés à ${emailTest} (${nomModeles.join(' + ')})`, 'ok');
    res.json({ success: true, emailTest, modele: nomModeles.join(' + ') });
  } catch(e) {
    envoiGroupeLog(`❌ Erreur envoi test contact : ${e.message}`, 'error');
    res.json({ success: false, error: e.message });
  }
});

// ── POST /api/envoi-groupe/test — envoyer à Victor uniquement
app.post('/api/envoi-groupe/test', async (req, res) => {
  const { template, nbJours } = req.body;
  const tplFn = getTemplateFunction(template);
  if (!tplFn) return res.json({ error: `Template "${template}" introuvable` });
  try {
    const nbJ = nbJours ? parseInt(nbJours) : null;
    const html = tplFn('Victor', nbJ, { nomAsso: 'Association Test', nomEquipe: 'Équipe Test', urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK, urlPageEquipe: URL_EQUIPES, numeroDossard: '42', historiqueHtml: '', urlDon: URL_COUREURS, urlProm: URL_PROMESSE_FALLBACK });
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
      numeroDossard: '42',
      historiqueHtml: '',
      urlDon: URL_COUREURS,
      urlProm: URL_PROMESSE_FALLBACK,
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
  paiementsSignatures.clear();
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
// Construire l'index équipes après init Redis (délai pour laisser Redis se connecter)
setTimeout(() => buildEquipeIndex().catch(e => addLog(`⚠️ buildEquipeIndex erreur : ${e.message}`, 'warn')), 5000);
