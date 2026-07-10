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
  pollInterval:     parseInt(process.env.POLL_INTERVAL_MS || '900000'), // 15 min par défaut
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
const contactsParDossardJoue = new Map(); // dossard Joué → contact
const supportersAngers     = new Map(); // contactId → contact (supporters Angers)
const supportersJoue       = new Map(); // contactId → contact (supporters Joué)
const donateursCache       = new Map(); // contactId → contact (donateurs)
const promettantsCache     = new Map(); // contactId → contact (promettants)

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

// ── Index coureurs Joué 2026 (556 coureurs, indexés par dossard)
const DOSSARDS_JOUE_2026 = {
  556: { id: 3333, equipe: 'je cours solo', asso: 'Défi Enfance', prenom: 'Jean-Baptiste', nom: 'Bouzard', email: 'jb.bouzard@gmail.com', runner: null },
  541: { id: 3331, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Zewa', nom: 'AL ZUHAÏRI', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  540: { id: 3330, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Ymane', nom: 'EL HADI', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  539: { id: 3329, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Véronique', nom: 'LECOMTE', email: 'veronique.lecomte@unionpourlenfance.com', runner: null },
  538: { id: 3328, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Valentin', nom: 'BILLY', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  537: { id: 3327, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Tyler', nom: 'VINCENT', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  534: { id: 3326, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Stephane', nom: 'DEGROOTE', email: 'stephane.degroote@unionpourlenfance.com', runner: null },
  531: { id: 3325, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Savhanna', nom: 'VIVIER', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  530: { id: 3324, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Sarah', nom: 'BOISSELIER', email: 'sarah.boisselier@unionpourlenfance.com', runner: null },
  528: { id: 3323, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Romane', nom: 'GIRARD', email: 'romane.girard@unionpourlenfance.com', runner: null },
  527: { id: 3322, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Rachel', nom: 'FIEGEL', email: 'rachel.fiegel@unionpourlenfance.com', runner: null },
  525: { id: 3321, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Pablo', nom: 'LANG', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  524: { id: 3320, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Nathanaelle', nom: 'GIROUX', email: 'nathanaelle.giroux@unionpourlenfance.com', runner: null },
  523: { id: 3319, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Nathan', nom: 'DOUADY', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  522: { id: 3318, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'NATHALIE', nom: 'PEDRE', email: 'nathalie.pedre@unionpourlenfance.com', runner: null },
  518: { id: 3317, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Mickael', nom: 'SAMSON', email: 'mickael.samson@unionpourlenfance.com', runner: null },
  517: { id: 3316, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Melissa', nom: 'GARDETTE', email: 'melissa.gardette@unionpourlenfance.com', runner: null },
  516: { id: 3315, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Mélanie', nom: 'MAINSON', email: 'melanie.mainson@unionpourlenfance.com', runner: null },
  515: { id: 3314, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'MARTIN', nom: 'DE BLANQUET DU CHAYLA', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  513: { id: 3313, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Marie', nom: 'MAROLEAU', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  511: { id: 3312, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Manon', nom: 'USCLADE', email: 'manon.usclade@unionpourlenfance.com', runner: null },
  510: { id: 3311, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Maelle', nom: 'TOUGERON', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  509: { id: 3310, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'LUNA', nom: 'BARON OUVRARD', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  506: { id: 3309, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Louna', nom: 'OUTADLI', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  505: { id: 3308, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Louis-Joseph', nom: 'CLAUDE', email: 'louis-joseph.claude@unionpourlenfance.com', runner: null },
  504: { id: 3307, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'LOU-ANNE', nom: 'LAMBERT', email: 'louanne.lambert@unionpourlenfance.com', runner: null },
  502: { id: 3306, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Louane', nom: 'DUBREUIL', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  500: { id: 3305, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Lindsay', nom: 'TOUGERON', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  497: { id: 3304, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Laetitia', nom: 'BENOIT', email: 'laetitia.benoit@unionpourlenfance.com', runner: null },
  496: { id: 3303, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Kimya', nom: 'DOUMA BILENDO', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  493: { id: 3302, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Katia', nom: 'CHAUFFOUR', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  491: { id: 3301, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Juliette', nom: 'SOUCHARD', email: 'juliette.souchard@unionpourlenfance.com', runner: null },
  490: { id: 3300, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Jessica', nom: 'RAVENEL', email: 'jessica.ravenel@unionpourlenfance.com', runner: null },
  489: { id: 3299, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Ismaël', nom: 'FERKLA', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  488: { id: 3298, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'ISABELLE', nom: 'SIONNEAU', email: 'isabelle.sionneau@unionpourlenfance.com', runner: null },
  487: { id: 3297, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Isabelle', nom: 'ROBLES', email: 'isabelle.robles@unionpourlenfance.com', runner: null },
  486: { id: 3296, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'iLONA', nom: 'BARON OUVRAD', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  485: { id: 3295, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Hiaklef', nom: 'HADJ ABDELKADER', email: 'hiaklef.hadjabdelkader@unionpourlenfance.com', runner: null },
  484: { id: 3294, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Guenael', nom: 'BOURDILLEAU', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  482: { id: 3293, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Florian', nom: 'LASSOIE', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  478: { id: 3292, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Erwan', nom: 'BOURDILLEAU', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  477: { id: 3291, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Emilie', nom: 'JOUBERT', email: 'emilie.joubert@unionpourlenfance.com', runner: null },
  476: { id: 3290, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Emilie', nom: 'AUFFRET', email: 'emilie.auffret@unionpourlenfance.com', runner: null },
  474: { id: 3289, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Elona', nom: 'HODEMON', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  473: { id: 3288, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Dovan', nom: 'CRENN', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  471: { id: 3287, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Davy', nom: 'SAOZANET', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  470: { id: 3286, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Corinne', nom: 'GOLDMANN', email: 'corinne.goldmann@unionpourlenfance.com', runner: null },
  469: { id: 3285, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Clément', nom: 'MOISAN', email: 'clement.moisan@unionpourlenfance.com', runner: null },
  468: { id: 3284, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Clara', nom: 'DELACOTE', email: 'clara.delacote@unionpourlenfance.com', runner: null },
  467: { id: 3283, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Chloé', nom: 'DELORME', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  466: { id: 3282, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Chakib', nom: 'MEDJEDOUB', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  463: { id: 3281, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Bérengère', nom: 'AUBIER', email: 'berengere.aubier@unionpourlenfance.com', runner: null },
  462: { id: 3280, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Benjamin', nom: 'MARTIN VILLEPOU', email: 'benjamin.martinvillepou@unionpourlenfance.com', runner: null },
  460: { id: 3279, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Bacem', nom: 'M HAMDI', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  456: { id: 3278, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Anne', nom: 'LORIOT', email: 'anne.loriot@unionpourlenfance.com', runner: null },
  455: { id: 3277, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Anissa', nom: 'HAMAMMI', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  452: { id: 3276, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Anass', nom: 'IZOUAR RAMOS', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  450: { id: 3275, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Amaury', nom: 'MAY', email: 'amaury.may@unionpourlenfance.com', runner: null },
  446: { id: 3274, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alexandre', nom: 'MORENO', email: 'alexandre.moreno@unionpourlenfance.com', runner: null },
  444: { id: 3273, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alexandra', nom: 'FOUSSARD', email: 'alexandra.foussard@unionpourlenfance.com', runner: null },
  443: { id: 3272, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Adil', nom: 'BOUKILI MAKHOUKHI', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  442: { id: 3271, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Abdourahamane', nom: 'CAMARA', email: 'virginie.hauchecorne@unionpourlenfance.com', runner: null },
  441: { id: 3270, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Sylviane', nom: 'DEVILLERS', email: 's.devillers@unionpourlenfance.com', runner: null },
  440: { id: 3269, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Manon', nom: 'PLUMEL', email: 's.fouret@unionpourlenfance.com', runner: null },
  439: { id: 3268, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Claude', nom: 'PHILIPPE', email: 's.fouret@unionpourlenfance.com', runner: null },
  438: { id: 3267, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Christophe', nom: 'PHILIPPE', email: 's.fouret@unionpourlenfance.com', runner: null },
  437: { id: 3266, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'YASMINA', nom: 'ZATOUT', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  436: { id: 3265, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'VALDUT', nom: 'ZABAN', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  435: { id: 3264, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'SANASSY', nom: 'DIANE', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  434: { id: 3263, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'SALIMA', nom: 'AMARI', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  433: { id: 3262, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'PAULA', nom: 'MATIAS', email: 'p.matias@unionpourlenfance.com', runner: null },
  432: { id: 3261, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'NELLY', nom: 'HERSENT', email: 'n.hersent@unionpourlenfance.com', runner: null },
  431: { id: 3260, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'NATALI', nom: 'BERIANIDZE', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  430: { id: 3259, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'NADIA', nom: 'GAZIJERNITI', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  429: { id: 3258, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'Mathias', nom: 'DASYLVA', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  428: { id: 3257, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'MARIE-AMELIE', nom: 'DUVAL', email: 'marieamelie.duval@unionpourlenfance.com', runner: null },
  427: { id: 3256, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'MARIAM', nom: 'KANSOU', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  426: { id: 3255, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'MARC', nom: 'YANG', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  425: { id: 3254, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'Manon', nom: 'EUDE', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  424: { id: 3253, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'LAKHDAR', nom: 'KHIRI', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  423: { id: 3252, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'KENZO', nom: 'JOVANOVIC', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  422: { id: 3251, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'KENDALL', nom: 'GARCON', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  421: { id: 3250, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'Joud', nom: 'BOUFRA', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  420: { id: 3249, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'JADE', nom: 'DAVID', email: 'j.david@unionpourlenfance.com', runner: null },
  419: { id: 3248, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'Fatiha', nom: 'RYAD', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  418: { id: 3247, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'Daniela', nom: 'KAKASHYNSKAYA', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  417: { id: 3246, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'CHLOE', nom: 'PERPERE', email: 'chloe.perpere@unionpourlenfance.com', runner: null },
  416: { id: 3245, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'CELINE', nom: 'YANG', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  415: { id: 3244, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'Bouchra', nom: 'KISSI', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  414: { id: 3243, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'Anès', nom: 'BOUFRA', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  413: { id: 3242, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'ANATOLIE', nom: 'VACARU', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  412: { id: 3241, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'ANANO', nom: 'BERIANIDZE', email: 'lakhdar.khiri@unionpourlenfance.com', runner: null },
  411: { id: 3240, equipe: 'SAF Île-de-France - UPE', asso: 'SAF Île-de-France - UPE', prenom: 'ANAÏS', nom: 'MARTINS', email: 'a.martins@unionpourlenfance.com', runner: null },
  410: { id: 3239, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Zoran', nom: 'LEFEUVE', email: 'n.prunier@unionpourlenfance.com', runner: null },
  408: { id: 3238, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Victoria', nom: 'JARZYNKA', email: 'n.prunier@unionpourlenfance.com', runner: null },
  407: { id: 3237, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Tony', nom: 'DIDIER', email: 't.didier@unionpourlenfance.com', runner: null },
  406: { id: 3236, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Timéo', nom: 'CHARTREZ BENOIT', email: 'n.prunier@unionpourlenfance.com', runner: null },
  405: { id: 3235, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Thibault', nom: 'MAZATEAU', email: 'n.prunier@unionpourlenfance.com', runner: null },
  404: { id: 3234, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Sébastien', nom: 'LONGEAU', email: 's.longeau@unionpourlenfance.com', runner: null },
  403: { id: 3233, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Samir', nom: 'KISSIA', email: 'samir.kissia@unionpourlenfance.com', runner: null },
  402: { id: 3232, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Rose', nom: 'LAMOUREUX RITA', email: 'n.prunier@unionpourlenfance.com', runner: null },
  400: { id: 3231, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Noémie', nom: 'TETREAU', email: 'n.prunier@unionpourlenfance.com', runner: null },
  399: { id: 3230, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Nadia', nom: 'GRIFFAULT', email: 'n.griffault@unionpourlenfance.com', runner: null },
  398: { id: 3229, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Mélinda', nom: 'BOIS', email: 'n.prunier@unionpourlenfance.com', runner: null },
  397: { id: 3228, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Melek', nom: 'BOUKRAIA', email: 'n.prunier@unionpourlenfance.com', runner: null },
  396: { id: 3227, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Mélanie', nom: 'DESQUIRET', email: 'm.desquiret@unionpourlenfance.com', runner: null },
  395: { id: 3226, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Marie-Lénaïc', nom: 'GEOFFROY', email: 'n.prunier@unionpourlenfance.com', runner: null },
  394: { id: 3225, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Manon', nom: 'CORNIC', email: 'manon.cornic@unionpourlenfance.com', runner: null },
  393: { id: 3224, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Malhon', nom: 'NABO HAMEL', email: 'n.prunier@unionpourlenfance.com', runner: null },
  392: { id: 3223, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Lyndsay', nom: 'BLANCAHRD', email: 'n.prunier@unionpourlenfance.com', runner: null },
  391: { id: 3222, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Lyana', nom: 'PETORIN', email: 'n.prunier@unionpourlenfance.com', runner: null },
  390: { id: 3221, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Luna', nom: 'REIS', email: 'n.prunier@unionpourlenfance.com', runner: null },
  389: { id: 3220, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Ludivine', nom: 'PITAUD', email: 'l.pitaud@unionpourlenfance.com', runner: null },
  388: { id: 3219, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Lucie', nom: 'FRAPPIER', email: 'n.prunier@unionpourlenfance.com', runner: null },
  387: { id: 3218, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Lucas', nom: 'BISMUTH', email: 'n.prunier@unionpourlenfance.com', runner: null },
  386: { id: 3217, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Lorenzo', nom: 'DEBLOIS BON', email: 'n.prunier@unionpourlenfance.com', runner: null },
  385: { id: 3216, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Loïs', nom: 'CHENE', email: 'n.prunier@unionpourlenfance.com', runner: null },
  384: { id: 3215, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Laetitia', nom: 'POTREAU', email: 'l.potreau@unionpourlenfance.com', runner: null },
  383: { id: 3214, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Kévin', nom: 'LELOUP', email: 'n.prunier@unionpourlenfance.com', runner: null },
  382: { id: 3213, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Kévin', nom: 'AVESQUE', email: 'k.avesque@unionpourlenfance.com', runner: null },
  381: { id: 3212, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Judicaël', nom: 'CHEVALIER', email: 'j.chevalier@unionpourlenfance.com', runner: null },
  380: { id: 3211, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Jean-Charles', nom: 'GALLOT', email: 'j.gallot@unionpourlenfance.com', runner: null },
  379: { id: 3210, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Istan', nom: 'FARES', email: 'n.prunier@unionpourlenfance.com', runner: null },
  378: { id: 3209, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Hugo', nom: 'RANGIN', email: 'n.prunier@unionpourlenfance.com', runner: null },
  377: { id: 3208, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Geoffrey', nom: 'BLANCHIN', email: 'geoffrey.blanchin@unionpourlenfance.com', runner: null },
  376: { id: 3207, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Fabrice', nom: 'AUNEAU', email: 'f.auneau@unionpourlenfance.com', runner: null },
  375: { id: 3206, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Fabien', nom: 'NAULET', email: 'f.naulet@unionpourlenfance.com', runner: null },
  374: { id: 3205, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Enzo', nom: 'TETRAU', email: 'n.prunier@unionpourlenfance.com', runner: null },
  373: { id: 3204, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Doriane', nom: 'JEGOU BONNEAU', email: 'n.prunier@unionpourlenfance.com', runner: null },
  372: { id: 3203, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Coralie', nom: 'METCHE', email: 'c.metche@unionpourlenfance.com', runner: null },
  371: { id: 3202, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Cléa', nom: 'HUCAULT', email: 'n.prunier@unionpourlenfance.com', runner: null },
  370: { id: 3201, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Camille', nom: 'MAURY', email: 'c.maury@unionpourlenfance.com', runner: null },
  369: { id: 3200, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Bryan', nom: 'BILLERIT', email: 'n.prunier@unionpourlenfance.com', runner: null },
  368: { id: 3199, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Aurélien', nom: 'LALOGE', email: 'a.laloge@unionpourlenfance.com', runner: null },
  367: { id: 3198, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Aurélie', nom: 'JARRY', email: 'aurelie.jarry@unionpourlenfance.com', runner: null },
  366: { id: 3197, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Ali', nom: 'MOUHAMADI', email: 'n.prunier@unionpourlenfance.com', runner: null },
  365: { id: 3196, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Alexis', nom: 'GAU', email: 'alexis.gau@unionpourlenfance.com', runner: null },
  364: { id: 3195, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Alexandre', nom: 'GRAUX', email: 'n.prunier@unionpourlenfance.com', runner: null },
  363: { id: 3194, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Yacouba', nom: 'SYLLA', email: 'n.kohen@unionpourlenfance.com', runner: null },
  362: { id: 3193, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Soledad', nom: 'RIGUET', email: 'soledad.riguet@unionpourlenfance.com', runner: null },
  361: { id: 3192, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Sissako (Demba)', nom: 'GASSAMA', email: 'n.kohen@unionpourlenfance.com', runner: null },
  360: { id: 3191, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Salifou', nom: 'SYLLA', email: 'n.kohen@unionpourlenfance.com', runner: null },
  357: { id: 3190, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Mariam', nom: 'SYLLA', email: 'n.kohen@unionpourlenfance.com', runner: null },
  356: { id: 3189, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Marcelle (embauche le 4/05)', nom: 'LAMA', email: 'marcelle.lama@unionpourlenfance.com', runner: null },
  355: { id: 3188, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Leslie', nom: 'LAMAIRE', email: 'leslie.lamaire@unionpourlenfance.com', runner: null },
  354: { id: 3187, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Keyden', nom: 'TCHINDA NGAHANE', email: 'n.kohen@unionpourlenfance.com', runner: null },
  353: { id: 3186, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Grace', nom: 'LOGNON', email: 'n.kohen@unionpourlenfance.com', runner: null },
  352: { id: 3185, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Djaka', nom: 'TOURE', email: 'n.kohen@unionpourlenfance.com', runner: null },
  351: { id: 3184, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Camille', nom: 'RODRIGUES', email: 'camille.rodrigues@unionpourlenfance.com', runner: null },
  350: { id: 3183, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Awa', nom: 'SYLLA', email: 'n.kohen@unionpourlenfance.com', runner: null },
  349: { id: 3182, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Amir', nom: 'AZAIZA', email: 'amir.azaiza@unionpourlenfance.com', runner: null },
  348: { id: 3181, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Aminata', nom: 'BAMBA', email: 'n.kohen@unionpourlenfance.com', runner: null },
  347: { id: 3180, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Affoussiata', nom: 'BAMBA', email: 'n.kohen@unionpourlenfance.com', runner: null },
  346: { id: 3179, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Youssouf junior', nom: 'DOUMBIA', email: 'daby.keita@unionpourlenfance.com', runner: null },
  345: { id: 3178, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'VAHISSA', nom: 'TAMME', email: 'vahissa.tamme@unionpourlenfance.com', runner: null },
  343: { id: 3177, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Tidiane', nom: 'KIDJERA', email: 'daby.keita@unionpourlenfance.com', runner: null },
  341: { id: 3176, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'SONIA', nom: 'LOHMANN', email: 'sonia.lohmann@unionpourlenfance.com', runner: null },
  340: { id: 3175, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'SAFIA', nom: 'KALI', email: 'safia.kali@unionpourlenfance.com', runner: null },
  339: { id: 3174, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Prince Samba', nom: 'TOURE', email: 'daby.keita@unionpourlenfance.com', runner: null },
  338: { id: 3173, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'OCEANE', nom: 'LE TALLEC', email: 'daby.keita@unionpourlenfance.com', runner: null },
  337: { id: 3172, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'MUSTAPHA', nom: 'TALBI', email: 'mustapha.talbi@unionpourlenfance.com', runner: null },
  336: { id: 3171, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Mohamed', nom: 'BIKLAN', email: 'daby.keita@unionpourlenfance.com', runner: null },
  335: { id: 3170, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'MARIE ANGE', nom: 'LAFITAU', email: 'ma.lafitau@unionpourlenfance.com', runner: null },
  334: { id: 3169, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'MAGALI', nom: 'MARTINS', email: 'magali.martins@unionpourlenfance.com', runner: null },
  333: { id: 3168, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'LEA', nom: 'NZUZI', email: 'lea.nzuzi@unionpourlenfance.com', runner: null },
  331: { id: 3167, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'KEREN', nom: 'LOMAYA', email: 'daby.keita@unionpourlenfance.com', runner: null },
  330: { id: 3166, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Ibrahim', nom: 'TURAY', email: 'daby.keita@unionpourlenfance.com', runner: null },
  329: { id: 3165, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Hanafiou', nom: 'BAH', email: 'daby.keita@unionpourlenfance.com', runner: null },
  328: { id: 3164, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Fatoumata', nom: 'COULIBALY', email: 'daby.keita@unionpourlenfance.com', runner: null },
  327: { id: 3163, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Fatoumata', nom: 'BANGOURA', email: 'daby.keita@unionpourlenfance.com', runner: null },
  326: { id: 3162, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'EVA', nom: 'GABRIEL', email: 'daby.keita@unionpourlenfance.com', runner: null },
  325: { id: 3161, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'DRISSA', nom: 'COULIBALY', email: 'daby.keita@unionpourlenfance.com', runner: null },
  322: { id: 3160, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'AYOUB', nom: 'DIOMANDE', email: 'daby.keita@unionpourlenfance.com', runner: null },
  321: { id: 3159, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'ALPHA OUMAR', nom: 'SOW', email: 'daby.keita@unionpourlenfance.com', runner: null },
  320: { id: 3158, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Ahmed', nom: 'SAKHO', email: 'daby.keita@unionpourlenfance.com', runner: null },
  319: { id: 3157, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Thierry', nom: 'DUHAMEL', email: 'thierry.duhamel@unionpourlenfance.com', runner: null },
  318: { id: 3156, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Sonia', nom: 'FORT BIET', email: 'sonia.fortbiet@unionpourlenfance.com', runner: null },
  317: { id: 3155, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Perrine', nom: 'BLACHON', email: 'perrine.blachon@unionpourlenfance.com', runner: null },
  316: { id: 3154, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Pauline', nom: 'GUESDON', email: 'pauline.guesdon@unionpourlenfance.com', runner: null },
  315: { id: 3153, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Mélina', nom: 'DESBOIS MARIE', email: 'pauline.guesdon@unionpourlenfance.com', runner: null },
  314: { id: 3152, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Mathys', nom: 'REGNIER', email: 'pauline.guesdon@unionpourlenfance.com', runner: null },
  313: { id: 3151, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Lény', nom: 'DEMOULIN', email: 'pauline.guesdon@unionpourlenfance.com', runner: null },
  312: { id: 3150, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Killian', nom: 'RAOUL', email: 'killian.raoul@unionpourlenfance.com', runner: null },
  311: { id: 3149, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Karine', nom: 'LE GOUAS', email: 'karine.legouas@unionpourlenfance.com', runner: null },
  310: { id: 3148, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Gabriel', nom: 'SEBILEAU', email: 'gabriel.sebileau@unionpourlenfance.com', runner: null },
  309: { id: 3147, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Estelle', nom: 'PALSON', email: 'pauline.guesdon@unionpourlenfance.com', runner: null },
  308: { id: 3146, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Christiano', nom: 'MANARI', email: 'pauline.guesdon@unionpourlenfance.com', runner: null },
  307: { id: 3145, equipe: 'LVA Canihuel - Enfants du Compas', asso: 'LVA Canihuel - Enfants du Compas', prenom: 'Carole', nom: 'FLEURETTE', email: 'carole.fleurette@unionpourlenfance.com', runner: null },
  306: { id: 3144, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Tyméo', nom: 'BILLON VALABLE', email: 's.brault@unionpourlenfance.com', runner: null },
  305: { id: 3143, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Sylvie', nom: 'RONGERE', email: 'sylvie.rongere@unionpourlenfance.com', runner: null },
  304: { id: 3142, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Sitti-Yuna', nom: 'SOUMAILA', email: 's.brault@unionpourlenfance.com', runner: null },
  303: { id: 3141, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Samuel', nom: 'BRAULT', email: 's.brault@unionpourlenfance.com', runner: null },
  302: { id: 3140, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Ryan', nom: 'BRUNEAU', email: 's.brault@unionpourlenfance.com', runner: null },
  301: { id: 3139, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Natasa', nom: 'KACANYOVA', email: 's.brault@unionpourlenfance.com', runner: null },
  299: { id: 3138, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Lana', nom: 'BILLON VALABLE', email: 's.brault@unionpourlenfance.com', runner: null },
  298: { id: 3137, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Julie', nom: 'PETIT', email: 'j.petit@unionpourlenfance.com', runner: null },
  297: { id: 3136, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Erwan', nom: 'ROBCIS', email: 'erwan.robcis@unionpourlenfance.com', runner: null },
  296: { id: 3135, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Clément', nom: 'IBRI', email: 's.brault@unionpourlenfance.com', runner: null },
  295: { id: 3134, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Charlotte', nom: 'DELANGLE', email: 'c.delangle@unionpourlenfance.com', runner: null },
  294: { id: 3133, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Zahyn', nom: 'DIABATE', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  293: { id: 3132, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Pénéloppe', nom: 'RENAUD CHAUVEL', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  292: { id: 3131, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Nolan', nom: 'LAFAIX', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  291: { id: 3130, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Noé', nom: 'GOURLEZ', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  290: { id: 3129, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Mayronn', nom: 'SURIN', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  289: { id: 3128, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Léna', nom: 'OUSMANI', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  288: { id: 3127, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Inaya', nom: 'LEROI HUET', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  287: { id: 3126, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Faustine', nom: 'VOLTIER', email: 'faustine.voltier@unionpourlenfance.com', runner: null },
  286: { id: 3125, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Emma', nom: 'GERMOND', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  285: { id: 3124, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Cécile', nom: 'FERRIERE', email: 'cecile.ferriere@unionpourlenfance.com', runner: null },
  284: { id: 3123, equipe: 'La Morinière - Enfants du Compas', asso: 'La Morinière - Enfants du Compas', prenom: 'Alexandra', nom: 'CLERGEAU', email: 'alexandra.clergeau@unionpourlenfance.com', runner: null },
  283: { id: 3122, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Zakaria', nom: 'BELLILI', email: 'e.pierard@unionpourlenfance.com', runner: null },
  282: { id: 3121, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Yasmine', nom: 'JEDDI', email: 'e.pierard@unionpourlenfance.com', runner: null },
  281: { id: 3120, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Wideed', nom: 'BELLILI', email: 'e.pierard@unionpourlenfance.com', runner: null },
  280: { id: 3119, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Véronique', nom: 'AMRAM', email: 'v.amram@unionpourlenfance.com', runner: null },
  279: { id: 3118, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Tiphaine', nom: 'SOUMARE', email: 'e.pierard@unionpourlenfance.com', runner: null },
  278: { id: 3117, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Samia', nom: 'LEROUL', email: 's.leroul@unionpourlenfance.com', runner: null },
  277: { id: 3116, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Salomon', nom: 'LETORD', email: 'e.pierard@unionpourlenfance.com', runner: null },
  276: { id: 3115, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Salomé', nom: 'LETORD', email: 'e.pierard@unionpourlenfance.com', runner: null },
  275: { id: 3114, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Nour', nom: 'LEGENDRE', email: 'e.pierard@unionpourlenfance.com', runner: null },
  274: { id: 3113, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Noor', nom: 'BELLILI', email: 'e.pierard@unionpourlenfance.com', runner: null },
  273: { id: 3112, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Nancie', nom: 'MORIN', email: 'nancie.morin@unionpourlenfance.com', runner: null },
  272: { id: 3111, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Naela', nom: 'EL MOKADEM', email: 'e.pierard@unionpourlenfance.com', runner: null },
  270: { id: 3110, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Michel', nom: 'MENDY', email: 'e.pierard@unionpourlenfance.com', runner: null },
  269: { id: 3109, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Michael', nom: 'ROSSAT', email: 'e.pierard@unionpourlenfance.com', runner: null },
  268: { id: 3108, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Mathis', nom: 'MBUYIKANA', email: 'e.pierard@unionpourlenfance.com', runner: null },
  267: { id: 3107, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Massiami', nom: 'KONE', email: 'massiami.kone@unionpourlenfance.com', runner: null },
  265: { id: 3106, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Marie', nom: 'MELLET', email: 'm.mellet@unionpourlenfance.com', runner: null },
  263: { id: 3105, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Manon', nom: 'FOIGNIER', email: 'manon.foignier@unionpourlenfance.com', runner: null },
  262: { id: 3104, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Mael', nom: 'MBUYIKANA', email: 'e.pierard@unionpourlenfance.com', runner: null },
  261: { id: 3103, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Luna', nom: 'EL MOKADEM', email: 'e.pierard@unionpourlenfance.com', runner: null },
  260: { id: 3102, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Ludivic', nom: 'MEYER', email: 'e.pierard@unionpourlenfance.com', runner: null },
  259: { id: 3101, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Kaïs', nom: 'EL MOKADEM', email: 'e.pierard@unionpourlenfance.com', runner: null },
  258: { id: 3100, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Julia', nom: 'AZEROU', email: 'j.azerou@unionpourlenfance.com', runner: null },
  257: { id: 3099, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Joyce', nom: 'TSHIMANGUA', email: 'e.pierard@unionpourlenfance.com', runner: null },
  256: { id: 3098, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Jamila', nom: 'ANEOUAR', email: 'j.aneouar@unionpourlenfance.com', runner: null },
  255: { id: 3097, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Inayah', nom: 'EFAQUI', email: 'e.pierard@unionpourlenfance.com', runner: null },
  254: { id: 3096, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Idriss', nom: 'SIBY', email: 'idriss.siby@unionpourlenfance.com', runner: null },
  253: { id: 3095, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Icham', nom: 'JEDDI', email: 'e.pierard@unionpourlenfance.com', runner: null },
  252: { id: 3094, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Henry-Martin', nom: 'ROSSAT', email: 'e.pierard@unionpourlenfance.com', runner: null },
  250: { id: 3093, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Emmanuel', nom: 'ROSSAT', email: 'e.pierard@unionpourlenfance.com', runner: null },
  247: { id: 3092, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Elyjah', nom: 'SANANES', email: 'e.pierard@unionpourlenfance.com', runner: null },
  246: { id: 3091, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Eloise', nom: 'ERNATUS', email: 'e.pierard@unionpourlenfance.com', runner: null },
  245: { id: 3090, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Drahamane', nom: 'SIBY', email: 'siby.drahamane@unionpourlenfance.com', runner: null },
  243: { id: 3089, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Dina', nom: 'LEGENDRE', email: 'e.pierard@unionpourlenfance.com', runner: null },
  242: { id: 3088, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Dayan', nom: 'DOUCOURE', email: 'dayan.doucoure@unionpourlenfance.com', runner: null },
  239: { id: 3087, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Claudia', nom: 'TAVARES', email: 'claudia.tavares@unionpourlenfance.com', runner: null },
  238: { id: 3086, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Charlène', nom: 'MENDY', email: 'e.pierard@unionpourlenfance.com', runner: null },
  236: { id: 3085, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Baudoin', nom: 'MENDY', email: 'baudoi.mendy@unionpourlenfance.com', runner: null },
  235: { id: 3084, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Badiarra', nom: 'DEMBELE', email: 'b.dembele@unionpourlenfance.com', runner: null },
  233: { id: 3083, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Andréa', nom: 'FERNANDES', email: 'a.fernandes@unionpourlenfance.com', runner: null },
  231: { id: 3082, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Amina', nom: 'STEPHANY', email: 'a.stephany@unionpourlenfance.com', runner: null },
  229: { id: 3081, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Abdoul', nom: 'BALDE', email: 'abdoul.balde@unionpourlenfance.com', runner: null },
  228: { id: 3080, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Ibrahim', nom: 'SIBY', email: 'e.pierard@unionpourlenfance.com', runner: null },
  227: { id: 3079, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Djibril', nom: 'SIBY', email: 'e.pierard@unionpourlenfance.com', runner: null },
  226: { id: 3078, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Victor', nom: 'MAILLARD', email: 'victor.maillard@unionpourlenfance.com', runner: null },
  224: { id: 3077, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Samy', nom: 'BELAACHET', email: 's.belaachet@unionpourlenfance.com', runner: null },
  223: { id: 3076, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Mustapha', nom: 'ACHBANI', email: 'm.achbani@unionpourlenfance.com', runner: null },
  222: { id: 3075, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Mohamed', nom: 'DIALLO', email: 'laura.germon@unionpourlenfance.com', runner: null },
  220: { id: 3074, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Lassana', nom: 'SAMBAKE', email: 'laura.germon@unionpourlenfance.com', runner: null },
  219: { id: 3073, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Flora', nom: 'COURRILLAUD', email: 'f.courrillaud@unionpourlenfance.com', runner: null },
  218: { id: 3072, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Enzo', nom: 'TONT-NERAUD', email: 'laura.germon@unionpourlenfance.com', runner: null },
  216: { id: 3071, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Ahmed', nom: 'ELZEFTAWY', email: 'laura.germon@unionpourlenfance.com', runner: null },
  214: { id: 3070, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Noa', nom: 'CHARRIER', email: 'f.iseni@unionpourlenfance.com', runner: null },
  212: { id: 3069, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Manon', nom: 'RAFFOUX', email: 'f.iseni@unionpourlenfance.com', runner: null },
  211: { id: 3068, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Luis', nom: 'ROMAIN', email: 'f.iseni@unionpourlenfance.com', runner: null },
  210: { id: 3067, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Léana', nom: 'COLLARD', email: 'f.iseni@unionpourlenfance.com', runner: null },
  209: { id: 3066, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'James', nom: 'GERARD', email: 'f.iseni@unionpourlenfance.com', runner: null },
  208: { id: 3065, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Hicham', nom: 'OMARI', email: 'hicham.omari@unionpourlenfance.com', runner: null },
  207: { id: 3064, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Fadil', nom: 'ISENI', email: 'f.iseni@unionpourlenfance.com', runner: null },
  204: { id: 3063, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Broock', nom: 'CHAMARET', email: 'f.iseni@unionpourlenfance.com', runner: null },
  203: { id: 3062, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Brandon', nom: 'BOUCHERON', email: 'f.iseni@unionpourlenfance.com', runner: null },
  198: { id: 3061, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance', prenom: 'Yéléna', nom: 'ROUSSEL', email: 'yelena.roussel@unionpourlenfance.com', runner: null },
  197: { id: 3060, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Virginie', nom: 'GRAVIT', email: 'virginie.gravit@unionpourlenfance.com', runner: null },
  194: { id: 3059, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Romane', nom: 'CUVILLIER', email: 'romane.cuvillier@unionpourlenfance.com', runner: null },
  193: { id: 3058, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Pierre', nom: 'RODRIGUES', email: 'pierre.rodrigues@unionpourlenfance.com', runner: null },
  192: { id: 3057, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Philippine', nom: 'MARTIN', email: 'philippine.martin@unionpourlenfance.com', runner: null },
  188: { id: 3056, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Hyacinthe', nom: 'WATUZOLA', email: 'h.watuzola@unionpourlenfance.com', runner: null },
  187: { id: 3055, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Hamza', nom: 'HADOUCH', email: 'hamza.hadouch@unionpourlenfance.com', runner: null },
  186: { id: 3054, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Hadhemi', nom: 'JOUINI', email: 'hadhemi.jouini@unionpourlenfance.com', runner: null },
  184: { id: 3053, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Fabien', nom: 'FEUILLADE', email: 'f.feuillade@unionpourlenfance.com', runner: null },
  183: { id: 3052, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Emmanuella', nom: 'DIOP', email: 'emmanuella.diop@unionpourlenfance.com', runner: null },
  181: { id: 3051, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Caroline', nom: 'GUILLEY', email: 'c.guilley@unionpourlenfance.com', runner: null },
  177: { id: 3050, equipe: 'Eclats d\'Union', asso: 'Eclats d\'Union', prenom: 'Amandine', nom: 'LAGARDE', email: 'amandine.lagarde@unionpourlenfance.com', runner: null },
  176: { id: 3049, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alexandra', nom: 'NGOBA', email: 'alexandra.ngoba@unionpourlenfance.com', runner: null },
  543: { id: 3044, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Thierry', nom: 'Brangier', email: 'thierry.brangier@ag2rlamondiale.fr', runner: null },
  544: { id: 3043, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Nathalie', nom: 'Rocca', email: 'nathalie.rocca@ag2rlamondiale.fr', runner: null },
  545: { id: 3042, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Amandine', nom: 'Audoux', email: 'amandine.audoux@ag2rlamondiale.fr', runner: null },
  546: { id: 3041, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Anaëlle', nom: 'Hambacher', email: 'anaelle.hambacher@ag2rlamondiale.fr', runner: null },
  547: { id: 3040, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Sergio', nom: 'De Abreu Pinheiro', email: 'sergio.deabreupinheiro@ag2rlamondiale.fr', runner: null },
  548: { id: 3039, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Arnaud', nom: 'Signollet', email: 'arnaud.signollet@ag2rlamondiale.fr', runner: null },
  549: { id: 3038, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Stéphanie', nom: 'Bianconi', email: 'stephanie.bianconi@ag2rlamondiale.fr', runner: null },
  550: { id: 3037, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Slimane', nom: 'Fourmaux', email: 'slimane.fourmaux@ag2rlamondiale.fr', runner: null },
  551: { id: 3036, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Sylvain', nom: 'Landes', email: 'sylvain.landes@ag2rlamondiale.fr', runner: null },
  552: { id: 3035, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Franck', nom: 'Chalouas', email: 'franck.chalouas@ag2rlamondiale.fr', runner: null },
  553: { id: 3034, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Antoine', nom: 'VIGNON', email: 'antoine.vignon@ag2rlamondiale.fr', runner: null },
  554: { id: 3033, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Bruno', nom: 'Luciani', email: 'bruno.luciani@ag2rlamondiale.fr', runner: null },
  555: { id: 3032, equipe: 'AG2R LA MONDIALE', asso: 'Union pour l\'Enfance', prenom: 'Claire', nom: 'Millot-Moreno', email: 'claire.millot-moreno@ag2rlamondiale.fr', runner: null },
  492: { id: 3030, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Karine', nom: 'Soulier', email: 'karine.soulier@unionpourlenfance.com', runner: null },
  529: { id: 3029, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Sara', nom: 'Mery', email: 'sara.mery@unionpourlenfance.com', runner: null },
  457: { id: 3023, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Défi Enfance', prenom: 'Aura', nom: 'Popitu', email: 'bp.dma.foyer@unionpourlenfance.com', runner: null },
  65: { id: 3022, equipe: 'je cours solo', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'karine', nom: 'ASKAR', email: 'karine.askar@orange.fr', runner: null },
  458: { id: 3021, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Défi Enfance', prenom: 'Aura', nom: 'POPITU', email: 'aura.popitu@unionpourlenfance.com', runner: null },
  342: { id: 3020, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'TESSA', nom: 'GUENOUN', email: 'educateurmpv03@unionpourlenfance.com', runner: null },
  78: { id: 3019, equipe: 'Réseau Entreprendre Loire Vallée', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Antonin', nom: 'LE ROY', email: 'aleroy@reseau-entreprendre.org', runner: null },
  77: { id: 3018, equipe: 'Réseau Entreprendre Loire Vallée', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Agathe', nom: 'DE BRITO', email: 'adebrito@reseau-entreprendre.org', runner: null },
  76: { id: 3017, equipe: 'Réseau Entreprendre Loire Vallée', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Adele', nom: 'HACOT', email: 'ahacot@reseau-entreprendre.org', runner: null },
  237: { id: 3013, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Catherine', nom: 'Wangao', email: 'c.wangao@unionpourlenfance.com', runner: null },
  74: { id: 3012, equipe: 'Les Cahutes de Louise', asso: 'Les Cahutes de Louise', prenom: 'Patricia', nom: 'D\'HERIN', email: 'dherin.patricia@laposte.net', runner: null },
  68: { id: 3011, equipe: 'je cours solo', asso: 'Les Cahutes de Louise', prenom: 'Marie Luce', nom: 'Bierlaire', email: 'mlbibikirt@gmail.com', runner: null },
  73: { id: 3010, equipe: 'Les Cahutes de Louise', asso: 'Les Cahutes de Louise', prenom: 'Nadia', nom: 'GUILLON', email: 'guillon.nadia@gmail.com', runner: null },
  240: { id: 3009, equipe: 'La Montgolfière - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Claudia', nom: 'Tavares nobre', email: 'tavaresnobreclaudia@gmail.com', runner: null },
  11: { id: 3008, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Delphine', nom: 'Dellobelle', email: 'viescolaire.entrecote@unionpourlenfance.com', runner: null },
  18: { id: 3007, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Marie-Bénédicte', nom: 'Crépin', email: 'viescolaire.tablee@unionpourlenfance.com', runner: null },
  25: { id: 3006, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Rosalie', nom: 'Chatenoud', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  21: { id: 3005, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Nathanael', nom: 'Godard', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  12: { id: 3004, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Ebenezer', nom: 'Arthur', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  6: { id: 3003, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Arouna', nom: 'Njoya Ngoueme', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  22: { id: 3002, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Noa', nom: 'Motteau', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  10: { id: 3001, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Bogdan', nom: 'Vituk', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  27: { id: 3000, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Zacharia', nom: 'Mohamed Aden', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  23: { id: 2999, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Nouah', nom: 'Takez', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  17: { id: 2998, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Macka', nom: 'Abdelkhader Izzo', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  16: { id: 2997, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Hoda', nom: 'Bennouk Bouabidi', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  26: { id: 2996, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Thomas', nom: 'De La Villeon', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  8: { id: 2995, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Baya', nom: 'Friaa', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  19: { id: 2994, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Mehdi', nom: 'Seghaier', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  15: { id: 2993, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Ethan', nom: 'Deletang', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  20: { id: 2992, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Moussa', nom: 'Konaté', email: 'viescolaire.agape@unionpourlenfance.com', runner: null },
  332: { id: 2984, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'LA PENNA', nom: 'Alice', email: 'a.lapenna@unionpourlenfance.com', runner: null },
  323: { id: 2983, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'BRUTEL', nom: 'Christopher', email: 'christopher.brutel@unionpourlenfance.com', runner: null },
  465: { id: 2979, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'candice', nom: 'Evans', email: 'candicemma@gmail.com', runner: null },
  445: { id: 2974, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alexandre', nom: 'Edeline', email: 'alexandreedeline@laposte.net', runner: null },
  null: { id: 2964, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Laura', nom: 'GERMON', email: 'laura.germon@unionpourlenfance.com', runner: 559 },
  null: { id: 2956, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Elvina', nom: 'Jacquet', email: 'viescolaire.entrecote@unionpourlenfance.com', runner: 254 },
  null: { id: 2886, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Antonin', nom: 'TREDAN', email: 'laura.germon@unionpourlenfance.com', runner: null },
  null: { id: 2883, equipe: 'La Maison commune - UPE', asso: 'La Maison commune - UPE', prenom: 'Théo', nom: 'Keller', email: 'laura.germon@unionpourlenfance.com', runner: 534 },
  264: { id: 2854, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'marie', nom: 'louzon', email: 'm.louzon@unionpourlenfance.com', runner: null },
  234: { id: 2840, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Aziza', nom: 'N\'gadi', email: 'aziza.ngadi@unionpourlenfance.com', runner: null },
  244: { id: 2837, equipe: 'La Montgolfière - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'diogo', nom: 'martins', email: 'diogo.martins@unionpourlenfance.com', runner: null },
  230: { id: 2836, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Alicia', nom: 'Kouassi', email: 'a.kouassi@unionpourlenfance.com', runner: null },
  232: { id: 2825, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Anais', nom: 'Oumhamdi', email: 'anais.oumhamdi@unionpourlenfance.com', runner: null },
  251: { id: 2822, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Fatou', nom: 'dembele', email: 'f.dembele@unionpourlenfance.com', runner: null },
  60: { id: 2818, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Défi Enfance', prenom: 'Nicolas', nom: 'Marsande', email: 'n.marsande@gmail.com', runner: null },
  202: { id: 2799, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'AUBIN', nom: 'ROMBOUT', email: 'aubin.rombout@unionpourlenfance.com', runner: null },
  66: { id: 2773, equipe: 'je cours solo', asso: 'Esperancia', prenom: 'lou', nom: 'savary', email: 'lousavary@hotmail.com', runner: null },
  401: { id: 2769, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Olivier', nom: 'Crépon', email: 'o.crepon@unionpourlenfance.com', runner: null },
  344: { id: 2766, equipe: 'Maison Paul Valéry - UPE', asso: 'Défi Enfance', prenom: 'Vahissa', nom: 'CELESTE', email: 'vahissa.tamme@unionpourlenfance.com', runner: null },
  324: { id: 2763, equipe: 'Maison Paul Valéry - UPE', asso: 'Maison Paul Valéry - UPE', prenom: 'Daby', nom: 'KEITA', email: 'daby.keita@unionpourlenfance.com', runner: null },
  41: { id: 2755, equipe: 'Fondation Rabelais', asso: 'Fondation Rabelais', prenom: 'Blanche', nom: 'Dorrière', email: 'blanchedorriere@yahoo.com', runner: null },
  31: { id: 2753, equipe: 'CGI France', asso: 'Union pour l\'Enfance', prenom: 'Quentin', nom: 'COMBEMOREL', email: 'quentin.combemorel@cgi.com', runner: null },
  5: { id: 2744, equipe: 'ACTION ENFANCE', asso: 'Défi Enfance', prenom: 'Océane', nom: 'SEEDORF', email: 'seedorf.oceane@gmail.com', runner: null },
  28: { id: 2742, equipe: 'CGI France', asso: 'Défi Enfance', prenom: 'Luc', nom: 'PORTENSEIGNE', email: 'luc.portenseigne@cgi.com', runner: null },
  32: { id: 2738, equipe: 'CGI France', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Sébastien', nom: 'ALLONCLE', email: 'sebastien.alloncle@cgi.com', runner: null },
  520: { id: 2667, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'nabil', nom: 'Bouab', email: 'nabilbouab2@gmail.com', runner: null },
  542: { id: 2666, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Zoé', nom: 'christians', email: 'christianszoe@gmail.com', runner: null },
  43: { id: 2664, equipe: 'Inserm 1253 iBraiN', asso: 'Fondation Rabelais', prenom: 'Anthony', nom: 'LOUIS', email: 'anthony.louis@univ-tours.fr', runner: null },
  175: { id: 2649, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance', prenom: 'Aleksandar', nom: 'Seferovic', email: 'a.seferovic@unionpourlenfance.com', runner: null },
  514: { id: 2639, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Marlene', nom: 'PERROTIN', email: 'marlene.perrotin@unionpourlenfance.com', runner: null },
  508: { id: 2638, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Lucie', nom: 'Gasse', email: 'lucieshaina16@gmail.com', runner: null },
  83: { id: 2624, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Amaëlle', nom: 'Souchet', email: 'a.souchet@unionpourlenfance.com', runner: null },
  29: { id: 2622, equipe: 'CGI France', asso: 'Défi Enfance', prenom: 'Lucie', nom: 'Pessereau', email: 'lucie.pessereau@cgi.com', runner: null },
  30: { id: 2621, equipe: 'CGI France', asso: 'Colibri', prenom: 'Nicolas', nom: 'MONANGE', email: 'nicolas.monange@cgi.com', runner: null },
  33: { id: 2599, equipe: 'CGI France', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'stephane', nom: 'sevingue', email: 'stephane.sevingue@cgi.com', runner: null },
  459: { id: 2579, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Aziz', nom: 'MEROUAL', email: 'abdelazizlfakir79@gmail.com', runner: null },
  451: { id: 2578, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Ambre', nom: 'Lirola', email: 'metamorphosebeaute37@gmail.com', runner: null },
  448: { id: 2575, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alice', nom: 'Rosenstiehl', email: 'alice.rosenstiehl@gmail.com', runner: null },
  449: { id: 2567, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alicia', nom: 'HELIE', email: 'halicia1@hotmail.fr', runner: null },
  447: { id: 2566, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alexis', nom: 'Fouchereau', email: 'alexis.fouchereau@gmail.com', runner: null },
  172: { id: 2564, equipe: 'WORKNETT', asso: 'Apprentis d\'Auteuil', prenom: 'Christelle', nom: 'LE FLOCH', email: 'clf.worknett@orange.fr', runner: null },
  173: { id: 2563, equipe: 'WORKNETT', asso: 'Apprentis d\'Auteuil', prenom: 'Daniel', nom: 'RICHARD', email: 'worknett@orange.fr', runner: null },
  174: { id: 2562, equipe: 'WORKNETT', asso: 'Apprentis d\'Auteuil', prenom: 'Saidou', nom: 'NACANABO', email: 'saidounakanabo@gmail.com', runner: null },
  512: { id: 2493, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Margot', nom: 'Gounot', email: 'margotgo36@gmail.com', runner: null },
  536: { id: 2436, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Thyméo', nom: 'Backes Dessaint', email: 'simlucnin@hotmail.fr', runner: null },
  535: { id: 2434, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Stéphane', nom: 'Philippart', email: 's.philippart@gmail.com', runner: null },
  62: { id: 2432, equipe: 'je cours solo', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Fanny', nom: 'Klauk', email: 'klaukf@gmail.com', runner: null },
  4: { id: 2424, equipe: 'ACTION ENFANCE', asso: 'ACTION ENFANCE', prenom: 'Marie', nom: 'MECHIN', email: 'marie.mechin@ac-orleans-tours.fr', runner: null },
  2: { id: 2420, equipe: 'ACTION ENFANCE', asso: 'ACTION ENFANCE', prenom: 'Fabien', nom: 'Teste', email: 'fabien.teste@ac-orleans-tours.fr', runner: null },
  169: { id: 2418, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Thomas', nom: 'GEDEON', email: 'tgedeon@departement-touraine.fr', runner: null },
  168: { id: 2417, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Sébastien', nom: 'FOURASTE', email: 'sfouraste@departement-touraine.fr', runner: null },
  153: { id: 2416, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Julien', nom: 'DUPORTAL', email: 'jduportal@departement-touraine.fr', runner: null },
  145: { id: 2415, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Franck', nom: 'DHONT', email: 'fdhont@departement-touraine.fr', runner: null },
  146: { id: 2414, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'François', nom: 'CHARTIER', email: 'fchartier@departement-touraine.fr', runner: null },
  151: { id: 2413, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Joël', nom: 'BATARD', email: 'jbatard@departement-touraine.fr', runner: null },
  171: { id: 2412, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Virginie', nom: 'WINIARZ', email: 'vwiniarz@departement-touraine.fr', runner: null },
  159: { id: 2411, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Marie', nom: 'ROUSSE', email: 'mrousse@departement-touraine.fr', runner: null },
  158: { id: 2410, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Marianne', nom: 'RENAUD', email: 'mrenaud@departement-touraine.fr', runner: null },
  167: { id: 2409, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Sandrine', nom: 'PEREIRINHA', email: 'spereirinha@departement-touraine.fr', runner: null },
  160: { id: 2408, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Marjolaine', nom: 'PASQUIER', email: 'mpasquier@departement-touraine.fr', runner: null },
  170: { id: 2407, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Valérie', nom: 'PASCOA', email: 'vpascoa@departement-touraine.fr', runner: null },
  140: { id: 2406, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Aurélie', nom: 'NIETO', email: 'anieto@departement-touraine.fr', runner: null },
  156: { id: 2405, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Louise', nom: 'NAUDON', email: 'lnaudon@departement-touraine.fr', runner: null },
  137: { id: 2404, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Anne-Lise', nom: 'MALINGE', email: 'almalinge@departement-touraine.fr', runner: null },
  161: { id: 2403, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Mélissa', nom: 'LOUSSOUARN', email: 'mloussouarn@departement-touraine.fr', runner: null },
  143: { id: 2402, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Emilie', nom: 'GOURRE', email: 'egourre@departement-touraine.fr', runner: null },
  163: { id: 2401, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Myriam', nom: 'GANDAIS', email: 'mgandais@departement-touraine.fr', runner: null },
  157: { id: 2400, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Maëlle', nom: 'FORT', email: 'maellefort@departement-touraine.fr', runner: null },
  149: { id: 2399, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Gwenola', nom: 'FETU', email: 'gfetu@departement-touraine.fr', runner: null },
  144: { id: 2398, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Florence', nom: 'FARAJ', email: 'ffaraj@departement-touraine.fr', runner: null },
  166: { id: 2397, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Sabine', nom: 'ESSEUL', email: 'sesseul@departement-touraine.fr', runner: null },
  142: { id: 2396, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Cécile', nom: 'DARMENDRAIL', email: 'cdarmendrail@departement-touraine.fr', runner: null },
  147: { id: 2395, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Françoise', nom: 'CHENE', email: 'fchene@departement-touraine.fr', runner: null },
  152: { id: 2394, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Julie', nom: 'CHAMAILLARD', email: 'jchamaillard@departement-touraine.fr', runner: null },
  139: { id: 2393, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Aurélie', nom: 'CARLOSEMA', email: 'acarlosema@departement-touraine.fr', runner: null },
  162: { id: 2392, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Morgane', nom: 'BRECHELIERE', email: 'mbrecheliere@departement-touraine.fr', runner: null },
  155: { id: 2391, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Laure', nom: 'BONRAISIN', email: 'lbonraisin@departement-touraine.fr', runner: null },
  148: { id: 2390, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Gaëlle', nom: 'BODIOU', email: 'gbodiou@departement-touraine.fr', runner: null },
  154: { id: 2389, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Laure', nom: 'BERNEZ', email: 'lbernez@departement-touraine.fr', runner: null },
  138: { id: 2388, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Aurélie', nom: 'BATAILLE', email: 'abataille@departement-touraine.fr', runner: null },
  164: { id: 2387, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Nadia', nom: 'ARCHAMBAULT', email: 'narchambault@departement-touraine.fr', runner: null },
  141: { id: 2386, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Camille', nom: 'ANTIGNY', email: 'cantigny@departement-touraine.fr', runner: null },
  150: { id: 2385, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Hanane', nom: 'AKID', email: 'hakid@departement-touraine.fr', runner: null },
  72: { id: 2384, equipe: 'Les Cahutes de Louise', asso: 'Les Cahutes de Louise', prenom: 'camille', nom: 'Verduzier', email: 'clenoble@hotmail.com', runner: null },
  79: { id: 2383, equipe: 'Réseau Entreprendre Loire Vallée', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Karine', nom: 'FARNAULT', email: 'loirevallee@reseau-entreprendre.org', runner: null },
  3: { id: 2382, equipe: 'ACTION ENFANCE', asso: 'ACTION ENFANCE', prenom: 'Lucille', nom: 'DUPONT', email: 'lucille.dupont@ac-orleans-tours.fr', runner: null },
  44: { id: 2377, equipe: 'Inserm 1253 iBraiN', asso: 'Fondation Rabelais', prenom: 'Karen', nom: 'Ea', email: 'karen.ea@univ-tours.fr', runner: null },
  75: { id: 2374, equipe: 'Les Cahutes de Louise', asso: 'Les Cahutes de Louise', prenom: 'Stephanie', nom: 'Jean-Baptiste', email: 'svjb@cegetel.net', runner: null },
  70: { id: 2304, equipe: 'je cours solo', asso: 'Défi Enfance', prenom: 'Virginie', nom: 'Garnier', email: 'virginie.garnier.29@gmail.com', runner: null },
  52: { id: 2300, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Mahamat', nom: 'Moussa Youssouf', email: 'idef_ecureuilu@trdepartement-touraine.fr', runner: null },
  53: { id: 2299, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Nadège', nom: 'Lorieux', email: 'nlorieux@departement-touraine.fr', runner: null },
  48: { id: 2298, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Florine', nom: 'Julien', email: 'fjulien@departement-touraine.fr', runner: null },
  165: { id: 2290, equipe: 'Touraine le Département', asso: 'Défi Enfance', prenom: 'Nathalie', nom: 'Gouin', email: 'ngouin@departement-touraine.fr', runner: null },
  120: { id: 2286, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Salimatou', nom: 'TANDIAN', email: 's.fouret@unionpourlenfance.com', runner: null },
  87: { id: 2285, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Camille', nom: 'BOSSELET', email: 's.fouret@unionpourlenfance.com', runner: null },
  126: { id: 2284, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Sonia', nom: 'CHAMPROUX', email: 's.fouret@unionpourlenfance.com', runner: null },
  115: { id: 2283, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Monica', nom: 'FOSSI', email: 's.fouret@unionpourlenfance.com', runner: null },
  84: { id: 2282, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Amina', nom: 'DI MARIO', email: 's.fouret@unionpourlenfance.com', runner: null },
  121: { id: 2281, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Salma', nom: 'DI MARIO', email: 's.fouret@unionpourlenfance.com', runner: null },
  90: { id: 2280, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Darlene', nom: 'REMILUS', email: 's.fouret@unionpourlenfance.com', runner: null },
  117: { id: 2279, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Océane', nom: 'LANGER DELALOT', email: 's.fouret@unionpourlenfance.com', runner: null },
  81: { id: 2278, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Aïcha', nom: 'FARES', email: 's.fouret@unionpourlenfance.com', runner: null },
  99: { id: 2277, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Inès', nom: 'RMICHE', email: 's.fouret@unionpourlenfance.com', runner: null },
  102: { id: 2276, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Joudya', nom: 'EL RHAFFOULI', email: 's.fouret@unionpourlenfance.com', runner: null },
  122: { id: 2275, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Sarrazin', nom: 'GOWNE', email: 's.fouret@unionpourlenfance.com', runner: null },
  100: { id: 2274, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Jaysy', nom: 'MARLOT GUINET', email: 's.fouret@unionpourlenfance.com', runner: null },
  119: { id: 2273, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Praise', nom: 'OMOBUDE', email: 's.fouret@unionpourlenfance.com', runner: null },
  116: { id: 2272, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Muhammad-Antaba', nom: 'MAZOUZI', email: 's.fouret@unionpourlenfance.com', runner: null },
  136: { id: 2271, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Yazan', nom: 'EL RHAFFOULI', email: 's.fouret@unionpourlenfance.com', runner: null },
  109: { id: 2270, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Loïc', nom: 'LANGER DELALOT', email: 's.fouret@unionpourlenfance.com', runner: null },
  133: { id: 2269, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Tom', nom: 'MARCEL', email: 's.fouret@unionpourlenfance.com', runner: null },
  80: { id: 2268, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Ahmed', nom: 'MARIN', email: 's.fouret@unionpourlenfance.com', runner: null },
  93: { id: 2267, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Elys', nom: 'DELRUE', email: 's.fouret@unionpourlenfance.com', runner: null },
  134: { id: 2266, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Tony', nom: 'MENNOCH', email: 's.fouret@unionpourlenfance.com', runner: null },
  101: { id: 2265, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Jérémy', nom: 'BRAULT', email: 's.fouret@unionpourlenfance.com', runner: null },
  125: { id: 2264, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Sofiane', nom: 'SEMACHE', email: 's.fouret@unionpourlenfance.com', runner: null },
  105: { id: 2263, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Kengi', nom: 'MARY', email: 's.fouret@unionpourlenfance.com', runner: null },
  135: { id: 2262, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Yan', nom: 'DEVILLERS', email: 's.fouret@unionpourlenfance.com', runner: null },
  94: { id: 2261, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Erwan', nom: 'LANGER DELALOT', email: 's.fouret@unionpourlenfance.com', runner: null },
  54: { id: 2260, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'nelly', nom: 'GALLERNE', email: 'ngallernedordoigne@departement-touraine.fr', runner: null },
  47: { id: 2257, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Défi Enfance', prenom: 'Emma', nom: 'TINNIERE', email: 'emma.tinniere@gmail.com', runner: null },
  58: { id: 2216, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Défi Enfance', prenom: 'Vincent', nom: 'TREMBLIER', email: 'vin100fola@yahoo.fr', runner: null },
  57: { id: 2215, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Colibri', prenom: 'Thomas', nom: 'Dussiaux', email: 'tdussiaux@departement-touraine.fr', runner: null },
  71: { id: 2212, equipe: 'Les Cahutes de Louise', asso: 'Les Cahutes de Louise', prenom: 'Bertrand', nom: 'Verduzier', email: 'contact@lescahutesdelouise.org', runner: null },
  9: { id: 2206, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Bénédicte', nom: 'BUGUET', email: 'b.buguet@unionpourlenfance.com', runner: null },
  521: { id: 2201, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'naim', nom: 'necib', email: 'clara.delacote@unionpourlenfance.com', runner: null },
  499: { id: 2200, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'lilou', nom: 'lelarge', email: 'sophie.lecureuil@unionpourlenfance.com', runner: null },
  501: { id: 2199, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'llyam', nom: 'rousselet-sapint', email: 'nabil.bouab@unionpourlenfance.com', runner: null },
  453: { id: 2198, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'ange', nom: 'delaunay', email: 'isabelle.sionneau@unionpourlenfance.com', runner: null },
  454: { id: 2197, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'angelina', nom: 'malinvoskaya', email: 'lou-anne.lambert@unionpourlenfance.com', runner: null },
  472: { id: 2196, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'diana', nom: 'malinvoskaya', email: 'zoe.christians@unionpourlenfance.com', runner: null },
  98: { id: 2191, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Hélène', nom: 'MAILLARD', email: 'h.maillard@unionpourlenfance.com', runner: null },
  51: { id: 2190, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Katy-anna', nom: 'GRANGES', email: 'katiana49@hotmail.fr', runner: null },
  123: { id: 2189, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Sébastien', nom: 'BRIAND', email: 's.briand@unionpourlenfance.com', runner: null },
  104: { id: 2188, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Karine', nom: 'BRIAND', email: 'k.briand@unionpourlenfance.com', runner: null },
  35: { id: 2187, equipe: 'Compose - cantine sur mesure', asso: 'Défi Enfance', prenom: 'Gabriel', nom: 'Bailly', email: 'gabriel@compose-paris.fr', runner: null },
  132: { id: 2186, equipe: 'SAF Normandie - UPE', asso: 'Union pour l\'Enfance', prenom: 'Tiphaine', nom: 'Locquet', email: 't.locquet@unionpourlenfance.com', runner: null },
  113: { id: 2185, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Margaux', nom: 'MICHEL', email: 'margaux61@orange.fr', runner: null },
  108: { id: 2184, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Linda', nom: 'LELIEVRE-POIRIER', email: 'l.lelievrepoirier@unionpourlenfance.com', runner: null },
  112: { id: 2183, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Lydie', nom: 'SEBERT', email: 'l.sebert@unionpourlenfance.com', runner: null },
  92: { id: 2182, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Elodie', nom: 'ROCHE', email: 'e.roche@unionpourlenfance.com', runner: null },
  124: { id: 2181, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Séverine', nom: 'REBINDAINE', email: 's.rebindaine@unionpourlenfance.com', runner: null },
  96: { id: 2180, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Florence', nom: 'NORTIER', email: 'f.nortier@unionpourlenfance.com', runner: null },
  127: { id: 2179, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Sophie', nom: 'MARY', email: 's.mary@unionpourlenfance.com', runner: null },
  86: { id: 2178, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Aurélie', nom: 'LE GALL', email: 'aurelie.legall@unionpourlenfance.com', runner: null },
  129: { id: 2177, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Sylvie', nom: 'Fouret', email: 's.fouret@unionpourlenfance.com', runner: null },
  88: { id: 2176, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Catherine', nom: 'LAMBERT', email: 'cathdidierlea.lambert@orange.fr', runner: null },
  114: { id: 2175, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Marie', nom: 'JULLIEN', email: 'marie.jullien@unionpourlenfance.com', runner: null },
  106: { id: 2174, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Laëtitia', nom: 'FROGER', email: 'l.froger@unionpourlenfance.com', runner: null },
  91: { id: 2173, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Devillers', nom: 'DEVILLERS', email: 's.devillers@unionpourlenfance.com', runner: null },
  128: { id: 2172, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Stéphane', nom: 'DEVILLERS', email: 'stephane.devillers@unionpourlenfance.com', runner: null },
  95: { id: 2171, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Estelle', nom: 'DAGONEAU', email: 'estelle.dagoneau@unionpourlenfance.com', runner: null },
  130: { id: 2170, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Tailey', nom: 'VALLUET', email: 'safnormandie@unionpourlenfance.com', runner: null },
  266: { id: 2169, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Marie Micheline', nom: 'Mahotiere', email: 'michoumaho90@gmail.com', runner: null },
  50: { id: 2168, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'julie', nom: 'fournier', email: 'jfournier@departement-touraine.fr', runner: null },
  46: { id: 2158, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Didienne', nom: 'MACAIA', email: 'idef_tempo@departement-touraine.fr', runner: null },
  59: { id: 2155, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Ziriap', nom: 'Peter Ucin Cinda', email: 'jragueneau@departement-touraine.fr', runner: null },
  45: { id: 2154, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Antony', nom: 'Tellier', email: 'atellier@departement-touraine.fr', runner: null },
  42: { id: 2151, equipe: 'Fondation Rabelais', asso: 'Fondation Rabelais', prenom: 'Marion', nom: 'Chemineau', email: 'marion.chemineau@univ-tours.fr', runner: null },
  55: { id: 2149, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Sabrina', nom: 'BAUGE', email: 'sbauge@departement-touraine.fr', runner: null },
  56: { id: 2148, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'stephanie', nom: 'MORINIERE', email: 'smoriniere@departement-touraine.fr', runner: null },
  49: { id: 2147, equipe: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', asso: 'Esperancia', prenom: 'Guillaume', nom: 'RUAUT', email: 'gruaut@departement-touraine.fr', runner: null },
  526: { id: 2145, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Pauline', nom: 'Babot', email: 'soidiki.mouendhoimou@unionpourlenfance.com', runner: null },
  532: { id: 2144, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Shanna', nom: 'Rabineau', email: 'linda.sadeg@unionpourlenfance.com', runner: null },
  498: { id: 2143, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Léandro', nom: 'Masson Artaud', email: 'tinle.meneau@unionpourlenfance.com', runner: null },
  464: { id: 2142, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Bogdan', nom: 'Boiteux Riboux', email: 'hecham.elhadraoui@unionpourlenfance.com', runner: null },
  495: { id: 2141, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Kevin', nom: 'Etavard', email: 'orianne.auvray@unionpourlenfance.com', runner: null },
  507: { id: 2140, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Lucas', nom: 'Groult', email: 'ld.upe37.ueislangeais@unionpourlenfance.com', runner: null },
  475: { id: 2139, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Institut départemental de l\'Enfance et de la Famille (IDEF 37)', prenom: 'Emile', nom: 'Duputié', email: 'emile.duputie@unionpourlenfance.com', runner: null },
  533: { id: 2136, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Sophie', nom: 'THOMAS', email: 'simlucnin@hotmail.fr', runner: null },
  503: { id: 2131, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Louane', nom: 'GOUZY AUDET', email: 'manon.richard@unionpourlenfance.com', runner: null },
  481: { id: 2130, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Ethan', nom: 'VINCENT', email: 'lucie.gasse@unionpourlenfance.com', runner: null },
  494: { id: 2129, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'kendji', nom: 'Thomas', email: 'candice.evans@unionpourlenfance.com', runner: null },
  479: { id: 2128, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Esteban', nom: 'BRARD', email: 'nathalie.pedre@unionpourlenfance.com', runner: null },
  519: { id: 2127, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Morgane', nom: 'Portier', email: 'emilie.joubert@unionpourlenfance.com', runner: null },
  241: { id: 2125, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Cyrielle', nom: 'Dumont', email: 'c.dumont@unionpourlenfance.com', runner: null },
  85: { id: 2123, equipe: 'SAF Normandie - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Annaïk', nom: 'LANNUZEL', email: 'a.lannuzel@unionpourlenfance.com', runner: null },
  480: { id: 2118, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'ethan', nom: 'delanlssays', email: 'bp.uaf.sonzay@unionpourlenfance.com', runner: null },
  249: { id: 2115, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Emilie Rose', nom: 'Vieira', email: 'e.vieira@unionpourlenfance.com', runner: null },
  271: { id: 2114, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Morgane', nom: 'Mackowiak', email: 'm.mackowiak@unionpourlenfance.com', runner: null },
  34: { id: 2105, equipe: 'Compose - cantine sur mesure', asso: 'Défi Enfance', prenom: 'Antoine', nom: 'Guerin', email: 'antoine@compose-paris.fr', runner: null },
  461: { id: 2101, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Défi Enfance', prenom: 'Beatrice', nom: 'Taveau', email: 'emp189@unionpourlenfance.com', runner: null },
  483: { id: 2086, equipe: 'Union pour l\'Enfance 37 - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Franck', nom: 'SEMARD', email: 'franck.semard@unionpourlenfance.com', runner: null },
  358: { id: 2083, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Nora', nom: 'KOHEN', email: 'n.kohen@unionpourlenfance.com', runner: null },
  64: { id: 2082, equipe: 'je cours solo', asso: 'ACTION ENFANCE', prenom: 'Jérémy', nom: 'Brossier', email: 'jejebond07@gmail.com', runner: null },
  39: { id: 2073, equipe: 'EGERIA - SAINT-CRICQ et Associés', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Yves', nom: 'MOTTO', email: 'yvesmotto@yahoo.fr', runner: null },
  37: { id: 2072, equipe: 'EGERIA - SAINT-CRICQ et Associés', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Séverine', nom: 'PAYOT', email: 'severinepayot@yahoo.fr', runner: null },
  38: { id: 2071, equipe: 'EGERIA - SAINT-CRICQ et Associés', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Stanislas', nom: 'de LA RUFFIE', email: 'contact@egeriaavocats.fr', runner: null },
  213: { id: 2069, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'Maxence', nom: 'MAUDUIT', email: 'm21771444@gmail.com', runner: null },
  205: { id: 2068, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'DENIS', nom: 'JEREMY', email: 'd.jeremy@unionpourlenfance.com', runner: null },
  201: { id: 2067, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'ANDREA', nom: 'LECALVE', email: 'a.lecalve@unionpourlenfance.com', runner: null },
  206: { id: 2066, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'ELODIE', nom: 'PHILIPPONNEAU', email: 'elodie.philipponneau@unionpourlenfance.com', runner: null },
  200: { id: 2065, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'ALAIN', nom: 'GUILLON', email: 'a.guillon@unionpourlenfance.com', runner: null },
  89: { id: 2063, equipe: 'SAF Normandie - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Célia', nom: 'PEREIRA', email: 'c.pereira@unionpourlenfance.com', runner: null },
  111: { id: 2060, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Lou', nom: 'Voltier', email: 'l.voltier@unionpourlenfance.com', runner: null },
  131: { id: 2059, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'TEA', nom: 'ANDREO', email: 't.andreo@unionpourlenfance.com', runner: null },
  182: { id: 2056, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Damien', nom: 'Schouteden', email: 'damien.schouteden@gmail.com', runner: null },
  118: { id: 2055, equipe: 'SAF Normandie - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Ozanne', nom: 'Johana', email: 'j.ozanne@unionpourlenfance.com', runner: null },
  82: { id: 2054, equipe: 'SAF Normandie - UPE', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Alice', nom: 'Lecourt', email: 'a.lecourt@unionpourlenfance.com', runner: null },
  24: { id: 2052, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'patrick', nom: 'MUTZIG', email: 'patrick.mutzig@unionpourlenfance.com', runner: null },
  61: { id: 2048, equipe: 'je cours solo', asso: 'Défi Enfance', prenom: 'Anais', nom: 'Oubella', email: 'anais.oubella@gmail.com', runner: null },
  107: { id: 2047, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Linda', nom: 'Anthierens', email: 'l.anthierens@unionpourlenfance.com', runner: null },
  110: { id: 2046, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Lorène', nom: 'SAUVAGET', email: 'l.sauvaget@unionpourlenfance.com', runner: null },
  103: { id: 2045, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Julie', nom: 'POTICO', email: 'j.potico@unionpourlenfance.com', runner: null },
  248: { id: 2044, equipe: 'La Montgolfière - UPE', asso: 'La Montgolfière - UPE', prenom: 'Emilie', nom: 'PIERARD', email: 'e.pierard@unionpourlenfance.com', runner: null },
  97: { id: 2043, equipe: 'SAF Normandie - UPE', asso: 'SAF Normandie - UPE', prenom: 'Franck', nom: 'Esteban', email: 'f.esteban@unionpourlenfance.com', runner: null },
  69: { id: 2042, equipe: 'je cours solo', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Romain', nom: 'Alexandre', email: 'romain.alexandre37510@gmail.com', runner: null },
  7: { id: 2041, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Aurélien', nom: 'Le Foll', email: 'agape49@unionpourlenfance.com', runner: null },
  1: { id: 1964, equipe: 'ACTION ENFANCE', asso: 'ACTION ENFANCE', prenom: 'Angélique', nom: 'Navet', email: 'angelique.navet@actionenfance.org', runner: null },
  63: { id: 1962, equipe: 'je cours solo', asso: 'Union pour l\'Enfance', prenom: 'Hanane', nom: 'Aguidi', email: 'hanane.aguidi@live.fr', runner: null },
  36: { id: 1961, equipe: 'Compose - cantine sur mesure', asso: 'Défi Enfance', prenom: 'Yann', nom: 'TANGUY', email: 'ytanguy@compose-paris.fr', runner: null },
  67: { id: 1957, equipe: 'je cours solo', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Manon', nom: 'Salvadori', email: 'mansal37@hotmail.fr', runner: null },
  190: { id: 1956, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance', prenom: 'Lola', nom: 'Jaballah', email: 'lola.jaballah@unionpourlenfance.com', runner: null },
  40: { id: 1953, equipe: 'Esperancia', asso: 'Esperancia', prenom: 'JP', nom: 'Béchu', email: 'genomes-moka.2w@icloud.com', runner: null },
  null: { id: 1947, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance', prenom: 'Victor', nom: 'Vieilfault', email: 'v.vieilfault@unionpourlenfance.com', runner: 196 },
  178: { id: 1681, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance', prenom: 'Brice', nom: 'Bouvier', email: 'b.bouvier@unionpourlenfance.com', runner: null },
  180: { id: 1680, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Camille', nom: 'PINGET', email: 'c.pinget@unionpourlenfance.com', runner: null },
  185: { id: 1679, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Flore', nom: 'MARTIN', email: 'f.martin@unionpourlenfance.com', runner: null },
  189: { id: 1678, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Kenzy', nom: 'NGOBA', email: 'k.ngoba@unionpourlenfance.com', runner: null },
  300: { id: 1677, equipe: 'Les Crins Verts - Enfants du Compas', asso: 'Les Crins Verts - Enfants du Compas', prenom: 'Mathilde', nom: 'FERRARI', email: 'm.ferrari@unionpourlenfance.com', runner: null },
  359: { id: 1675, equipe: 'Maison Pauline Kergomard - UPE', asso: 'Maison Pauline Kergomard - UPE', prenom: 'Pascale', nom: 'VERON', email: 'p.veron@unionpourlenfance.com', runner: null },
  409: { id: 1673, equipe: 'Maisons Hugues Renaudin - UPE', asso: 'Maisons Hugues Renaudin - UPE', prenom: 'Vincent', nom: 'BICHOT', email: 'v.bichot@unionpourlenfance.com', runner: null },
  215: { id: 1671, equipe: 'La Chacunière - UPE', asso: 'La Chacunière - UPE', prenom: 'YANNICK', nom: 'LEPROUST', email: 'y.leproust@unionpourlenfance.com', runner: null },
  14: { id: 1665, equipe: 'Agapè Anjou', asso: 'Agapè Anjou', prenom: 'Emmanuelle', nom: 'POITOU', email: 'restaurant.agape@unionpourlenfance.com', runner: null },
  199: { id: 1472, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'ZAKIA', nom: 'MOKASS', email: 'zakia.ol@laposte.net', runner: null },
  195: { id: 1171, equipe: 'Eclats d\'Union', asso: 'Union pour l\'Enfance 37 - UPE', prenom: 'Thierry', nom: 'ROMBOUT', email: 't.rombout@unionpourlenfance.com', runner: null },
  191: { id: 1039, equipe: 'Eclats d\'Union', asso: 'Eclats d\'Union', prenom: 'Mehdi', nom: 'ZERROUKI', email: 'mehdi.zerrouki2005@gmail.com', runner: null },
  179: { id: 851, equipe: 'Eclats d\'Union', asso: 'Eclats d\'Union', prenom: 'Cameron', nom: 'REKIAN', email: 'cameronrekian9@gmail.com', runner: null },
};

// ── Classement individuel Joué 2026 (indexé par dossard)
const CLASSEMENT_JOUE_2026 = {
  1: { cl_total: 191, cl_reel: 83, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  2: { cl_total: 148, cl_reel: 46, km_total: 9.0, km_reel: 9.0, km_bonus: 0.0 },
  3: { cl_total: 61, cl_reel: 12, km_total: 12.75, km_reel: 12.75, km_bonus: 0.0 },
  4: { cl_total: 48, cl_reel: 109, km_total: 13.5, km_reel: 6.75, km_bonus: 6.75 },
  5: { cl_total: 62, cl_reel: 13, km_total: 12.75, km_reel: 12.75, km_bonus: 0.0 },
  6: { cl_total: 125, cl_reel: 190, km_total: 9.75, km_reel: 4.5, km_bonus: 5.25 },
  7: { cl_total: 41, cl_reel: 60, km_total: 13.5, km_reel: 8.25, km_bonus: 5.25 },
  8: { cl_total: 144, cl_reel: 47, km_total: 9.0, km_reel: 9.0, km_bonus: 0.0 },
  9: { cl_total: 240, cl_reel: 157, km_total: 6.0, km_reel: 5.25, km_bonus: 0.75 },
  11: { cl_total: 325, cl_reel: 284, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  12: { cl_total: 32, cl_reel: 84, km_total: 15.0, km_reel: 7.5, km_bonus: 7.5 },
  13: { cl_total: 13, cl_reel: 48, km_total: 16.5, km_reel: 9.0, km_bonus: 7.5 },
  14: { cl_total: 182, cl_reel: 85, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  15: { cl_total: 423, cl_reel: 385, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  17: { cl_total: 390, cl_reel: 351, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  18: { cl_total: 298, cl_reel: 285, km_total: 3.75, km_reel: 3.0, km_bonus: 0.75 },
  19: { cl_total: 208, cl_reel: 158, km_total: 6.75, km_reel: 5.25, km_bonus: 1.5 },
  20: { cl_total: 53, cl_reel: 26, km_total: 12.75, km_reel: 11.25, km_bonus: 1.5 },
  21: { cl_total: 50, cl_reel: 159, km_total: 12.75, km_reel: 5.25, km_bonus: 7.5 },
  22: { cl_total: 372, cl_reel: 352, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  23: { cl_total: 18, cl_reel: 61, km_total: 15.75, km_reel: 8.25, km_bonus: 7.5 },
  24: { cl_total: 408, cl_reel: 386, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  25: { cl_total: 324, cl_reel: 286, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  26: { cl_total: 316, cl_reel: 239, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  27: { cl_total: 179, cl_reel: 110, km_total: 7.5, km_reel: 6.75, km_bonus: 0.75 },
  28: { cl_total: 31, cl_reel: 4, km_total: 15.0, km_reel: 15.0, km_bonus: 0.0 },
  29: { cl_total: 99, cl_reel: 86, km_total: 10.5, km_reel: 7.5, km_bonus: 3.0 },
  30: { cl_total: 60, cl_reel: 14, km_total: 12.75, km_reel: 12.75, km_bonus: 0.0 },
  31: { cl_total: 14, cl_reel: 15, km_total: 16.5, km_reel: 12.75, km_bonus: 3.75 },
  32: { cl_total: 2, cl_reel: 3, km_total: 19.5, km_reel: 15.75, km_bonus: 3.75 },
  33: { cl_total: 12, cl_reel: 2, km_total: 16.5, km_reel: 16.5, km_bonus: 0.0 },
  37: { cl_total: 93, cl_reel: 27, km_total: 11.25, km_reel: 11.25, km_bonus: 0.0 },
  38: { cl_total: 38, cl_reel: 18, km_total: 14.25, km_reel: 12.0, km_bonus: 2.25 },
  39: { cl_total: 101, cl_reel: 32, km_total: 10.5, km_reel: 10.5, km_bonus: 0.0 },
  42: { cl_total: 143, cl_reel: 353, km_total: 9.0, km_reel: 1.5, km_bonus: 7.5 },
  43: { cl_total: 7, cl_reel: 191, km_total: 17.25, km_reel: 4.5, km_bonus: 12.75 },
  44: { cl_total: 19, cl_reel: 240, km_total: 15.75, km_reel: 3.75, km_bonus: 12.0 },
  45: { cl_total: 63, cl_reel: 49, km_total: 12.75, km_reel: 9.0, km_bonus: 3.75 },
  46: { cl_total: 165, cl_reel: 192, km_total: 8.25, km_reel: 4.5, km_bonus: 3.75 },
  48: { cl_total: 121, cl_reel: 160, km_total: 9.75, km_reel: 5.25, km_bonus: 4.5 },
  49: { cl_total: 23, cl_reel: 111, km_total: 15.75, km_reel: 6.75, km_bonus: 9.0 },
  51: { cl_total: 69, cl_reel: 40, km_total: 12.0, km_reel: 9.75, km_bonus: 2.25 },
  52: { cl_total: 163, cl_reel: 161, km_total: 8.25, km_reel: 5.25, km_bonus: 3.0 },
  53: { cl_total: 120, cl_reel: 162, km_total: 9.75, km_reel: 5.25, km_bonus: 4.5 },
  54: { cl_total: 76, cl_reel: 87, km_total: 12.0, km_reel: 7.5, km_bonus: 4.5 },
  55: { cl_total: 40, cl_reel: 112, km_total: 13.5, km_reel: 6.75, km_bonus: 6.75 },
  57: { cl_total: 189, cl_reel: 241, km_total: 7.5, km_reel: 3.75, km_bonus: 3.75 },
  58: { cl_total: 46, cl_reel: 7, km_total: 13.5, km_reel: 13.5, km_bonus: 0.0 },
  59: { cl_total: 151, cl_reel: 113, km_total: 8.25, km_reel: 6.75, km_bonus: 1.5 },
  60: { cl_total: 34, cl_reel: 41, km_total: 15.0, km_reel: 9.75, km_bonus: 5.25 },
  61: { cl_total: 55, cl_reel: 62, km_total: 12.75, km_reel: 8.25, km_bonus: 4.5 },
  62: { cl_total: 73, cl_reel: 63, km_total: 12.0, km_reel: 8.25, km_bonus: 3.75 },
  63: { cl_total: 36, cl_reel: 114, km_total: 15.0, km_reel: 6.75, km_bonus: 8.25 },
  64: { cl_total: 9, cl_reel: 8, km_total: 17.25, km_reel: 13.5, km_bonus: 3.75 },
  65: { cl_total: 103, cl_reel: 88, km_total: 10.5, km_reel: 7.5, km_bonus: 3.0 },
  67: { cl_total: 11, cl_reel: 115, km_total: 17.25, km_reel: 6.75, km_bonus: 10.5 },
  68: { cl_total: 1, cl_reel: 9, km_total: 21.75, km_reel: 13.5, km_bonus: 8.25 },
  69: { cl_total: 29, cl_reel: 5, km_total: 15.0, km_reel: 15.0, km_bonus: 0.0 },
  70: { cl_total: 115, cl_reel: 133, km_total: 9.75, km_reel: 6.0, km_bonus: 3.75 },
  71: { cl_total: 149, cl_reel: 50, km_total: 9.0, km_reel: 9.0, km_bonus: 0.0 },
  72: { cl_total: 92, cl_reel: 42, km_total: 11.25, km_reel: 9.75, km_bonus: 1.5 },
  73: { cl_total: 26, cl_reel: 64, km_total: 15.75, km_reel: 8.25, km_bonus: 7.5 },
  74: { cl_total: 27, cl_reel: 89, km_total: 15.75, km_reel: 7.5, km_bonus: 8.25 },
  75: { cl_total: 15, cl_reel: 65, km_total: 16.5, km_reel: 8.25, km_bonus: 8.25 },
  76: { cl_total: 146, cl_reel: 116, km_total: 9.0, km_reel: 6.75, km_bonus: 2.25 },
  77: { cl_total: 117, cl_reel: 43, km_total: 9.75, km_reel: 9.75, km_bonus: 0.0 },
  78: { cl_total: 37, cl_reel: 19, km_total: 14.25, km_reel: 12.0, km_bonus: 2.25 },
  79: { cl_total: 106, cl_reel: 33, km_total: 10.5, km_reel: 10.5, km_bonus: 0.0 },
  80: { cl_total: 319, cl_reel: 287, km_total: 3.75, km_reel: 3.0, km_bonus: 0.75 },
  82: { cl_total: 54, cl_reel: 134, km_total: 12.75, km_reel: 6.0, km_bonus: 6.75 },
  83: { cl_total: 237, cl_reel: 135, km_total: 6.0, km_reel: 6.0, km_bonus: 0.0 },
  84: { cl_total: 291, cl_reel: 288, km_total: 4.5, km_reel: 3.0, km_bonus: 1.5 },
  85: { cl_total: 124, cl_reel: 66, km_total: 9.75, km_reel: 8.25, km_bonus: 1.5 },
  86: { cl_total: 231, cl_reel: 426, km_total: 6.0, km_reel: 0.0, km_bonus: 6.0 },
  87: { cl_total: 153, cl_reel: 193, km_total: 8.25, km_reel: 4.5, km_bonus: 3.75 },
  89: { cl_total: 391, cl_reel: 354, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  90: { cl_total: 129, cl_reel: 163, km_total: 9.75, km_reel: 5.25, km_bonus: 4.5 },
  92: { cl_total: 100, cl_reel: 164, km_total: 10.5, km_reel: 5.25, km_bonus: 5.25 },
  93: { cl_total: 302, cl_reel: 242, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  95: { cl_total: 326, cl_reel: 321, km_total: 3.0, km_reel: 2.25, km_bonus: 0.75 },
  96: { cl_total: 248, cl_reel: 165, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  97: { cl_total: 293, cl_reel: 421, km_total: 3.75, km_reel: 0.0, km_bonus: 6.75 },
  98: { cl_total: 388, cl_reel: 355, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  99: { cl_total: 184, cl_reel: 90, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  100: { cl_total: 426, cl_reel: 387, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  102: { cl_total: 229, cl_reel: 194, km_total: 6.0, km_reel: 4.5, km_bonus: 1.5 },
  103: { cl_total: 270, cl_reel: 195, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  105: { cl_total: 239, cl_reel: 196, km_total: 6.0, km_reel: 4.5, km_bonus: 1.5 },
  107: { cl_total: 282, cl_reel: 243, km_total: 4.5, km_reel: 3.75, km_bonus: 0.75 },
  108: { cl_total: 235, cl_reel: 136, km_total: 6.0, km_reel: 6.0, km_bonus: 0.0 },
  110: { cl_total: 387, cl_reel: 356, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  111: { cl_total: 226, cl_reel: 289, km_total: 6.0, km_reel: 3.0, km_bonus: 3.0 },
  112: { cl_total: 152, cl_reel: 166, km_total: 8.25, km_reel: 5.25, km_bonus: 3.0 },
  113: { cl_total: 214, cl_reel: 167, km_total: 6.75, km_reel: 5.25, km_bonus: 1.5 },
  114: { cl_total: 130, cl_reel: 290, km_total: 9.0, km_reel: 3.0, km_bonus: 6.0 },
  116: { cl_total: 234, cl_reel: 137, km_total: 6.0, km_reel: 6.0, km_bonus: 0.0 },
  117: { cl_total: 308, cl_reel: 388, km_total: 3.75, km_reel: 0.75, km_bonus: 3.0 },
  118: { cl_total: 185, cl_reel: 117, km_total: 7.5, km_reel: 6.75, km_bonus: 0.75 },
  119: { cl_total: 172, cl_reel: 322, km_total: 7.5, km_reel: 2.25, km_bonus: 5.25 },
  120: { cl_total: 110, cl_reel: 197, km_total: 9.75, km_reel: 4.5, km_bonus: 5.25 },
  121: { cl_total: 276, cl_reel: 198, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  122: { cl_total: 359, cl_reel: 323, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  123: { cl_total: 109, cl_reel: 199, km_total: 9.75, km_reel: 4.5, km_bonus: 5.25 },
  124: { cl_total: 205, cl_reel: 244, km_total: 6.75, km_reel: 3.75, km_bonus: 3.0 },
  125: { cl_total: 262, cl_reel: 168, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  126: { cl_total: 285, cl_reel: 291, km_total: 4.5, km_reel: 3.0, km_bonus: 1.5 },
  128: { cl_total: 398, cl_reel: 389, km_total: 1.5, km_reel: 0.75, km_bonus: 0.75 },
  130: { cl_total: 72, cl_reel: 20, km_total: 12.0, km_reel: 12.0, km_bonus: 0.0 },
  131: { cl_total: 386, cl_reel: 357, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  132: { cl_total: 183, cl_reel: 245, km_total: 7.5, km_reel: 3.75, km_bonus: 3.75 },
  133: { cl_total: 134, cl_reel: 246, km_total: 9.0, km_reel: 3.75, km_bonus: 5.25 },
  134: { cl_total: 274, cl_reel: 200, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  135: { cl_total: 194, cl_reel: 324, km_total: 6.75, km_reel: 2.25, km_bonus: 4.5 },
  136: { cl_total: 136, cl_reel: 247, km_total: 9.0, km_reel: 3.75, km_bonus: 5.25 },
  137: { cl_total: 6, cl_reel: 138, km_total: 17.25, km_reel: 6.0, km_bonus: 11.25 },
  138: { cl_total: 82, cl_reel: 292, km_total: 11.25, km_reel: 3.0, km_bonus: 8.25 },
  139: { cl_total: 107, cl_reel: 201, km_total: 10.5, km_reel: 4.5, km_bonus: 6.0 },
  141: { cl_total: 4, cl_reel: 51, km_total: 18.75, km_reel: 9.0, km_bonus: 9.75 },
  143: { cl_total: 188, cl_reel: 202, km_total: 7.5, km_reel: 4.5, km_bonus: 3.0 },
  146: { cl_total: 51, cl_reel: 16, km_total: 12.75, km_reel: 12.75, km_bonus: 0.0 },
  147: { cl_total: 22, cl_reel: 203, km_total: 15.75, km_reel: 4.5, km_bonus: 11.25 },
  148: { cl_total: 140, cl_reel: 52, km_total: 9.0, km_reel: 9.0, km_bonus: 0.0 },
  149: { cl_total: 24, cl_reel: 139, km_total: 15.75, km_reel: 6.0, km_bonus: 9.75 },
  150: { cl_total: 197, cl_reel: 248, km_total: 6.75, km_reel: 3.75, km_bonus: 3.0 },
  152: { cl_total: 128, cl_reel: 140, km_total: 9.75, km_reel: 6.0, km_bonus: 3.75 },
  153: { cl_total: 17, cl_reel: 34, km_total: 16.5, km_reel: 10.5, km_bonus: 6.0 },
  154: { cl_total: 3, cl_reel: 91, km_total: 19.5, km_reel: 7.5, km_bonus: 12.0 },
  155: { cl_total: 58, cl_reel: 17, km_total: 12.75, km_reel: 12.75, km_bonus: 0.0 },
  156: { cl_total: 5, cl_reel: 35, km_total: 18.0, km_reel: 10.5, km_bonus: 7.5 },
  157: { cl_total: 222, cl_reel: 169, km_total: 6.0, km_reel: 5.25, km_bonus: 0.75 },
  158: { cl_total: 85, cl_reel: 141, km_total: 11.25, km_reel: 6.0, km_bonus: 5.25 },
  159: { cl_total: 123, cl_reel: 44, km_total: 9.75, km_reel: 9.75, km_bonus: 0.0 },
  161: { cl_total: 16, cl_reel: 53, km_total: 16.5, km_reel: 9.0, km_bonus: 7.5 },
  163: { cl_total: 21, cl_reel: 204, km_total: 15.75, km_reel: 4.5, km_bonus: 11.25 },
  164: { cl_total: 169, cl_reel: 205, km_total: 8.25, km_reel: 4.5, km_bonus: 3.75 },
  165: { cl_total: 43, cl_reel: 92, km_total: 13.5, km_reel: 7.5, km_bonus: 6.0 },
  166: { cl_total: 243, cl_reel: 249, km_total: 5.25, km_reel: 3.75, km_bonus: 1.5 },
  167: { cl_total: 84, cl_reel: 93, km_total: 11.25, km_reel: 7.5, km_bonus: 3.75 },
  168: { cl_total: 39, cl_reel: 21, km_total: 13.5, km_reel: 12.0, km_bonus: 1.5 },
  169: { cl_total: 20, cl_reel: 206, km_total: 15.75, km_reel: 4.5, km_bonus: 11.25 },
  170: { cl_total: 132, cl_reel: 170, km_total: 9.0, km_reel: 5.25, km_bonus: 3.75 },
  171: { cl_total: 89, cl_reel: 28, km_total: 11.25, km_reel: 11.25, km_bonus: 0.0 },
  175: { cl_total: 56, cl_reel: 67, km_total: 12.75, km_reel: 8.25, km_bonus: 4.5 },
  178: { cl_total: 374, cl_reel: 358, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  179: { cl_total: 198, cl_reel: 118, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  181: { cl_total: 230, cl_reel: 359, km_total: 6.0, km_reel: 1.5, km_bonus: 4.5 },
  183: { cl_total: 322, cl_reel: 390, km_total: 3.0, km_reel: 0.75, km_bonus: 2.25 },
  193: { cl_total: 375, cl_reel: 360, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  200: { cl_total: 300, cl_reel: 423, km_total: 3.75, km_reel: 0.0, km_bonus: 5.25 },
  202: { cl_total: 81, cl_reel: 29, km_total: 11.25, km_reel: 11.25, km_bonus: 0.0 },
  203: { cl_total: 401, cl_reel: 361, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  205: { cl_total: 299, cl_reel: 250, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  206: { cl_total: 354, cl_reel: 325, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  207: { cl_total: 133, cl_reel: 171, km_total: 9.0, km_reel: 5.25, km_bonus: 3.75 },
  208: { cl_total: 362, cl_reel: 326, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  209: { cl_total: 251, cl_reel: 293, km_total: 5.25, km_reel: 3.0, km_bonus: 2.25 },
  211: { cl_total: 301, cl_reel: 327, km_total: 3.75, km_reel: 2.25, km_bonus: 1.5 },
  212: { cl_total: 309, cl_reel: 251, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  213: { cl_total: 389, cl_reel: 362, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  214: { cl_total: 404, cl_reel: 391, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  215: { cl_total: 150, cl_reel: 207, km_total: 8.25, km_reel: 4.5, km_bonus: 3.75 },
  216: { cl_total: 395, cl_reel: 363, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  217: { cl_total: 394, cl_reel: 364, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  218: { cl_total: 97, cl_reel: 36, km_total: 10.5, km_reel: 10.5, km_bonus: 0.0 },
  219: { cl_total: 176, cl_reel: 142, km_total: 7.5, km_reel: 6.0, km_bonus: 1.5 },
  220: { cl_total: 178, cl_reel: 94, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  222: { cl_total: 265, cl_reel: 208, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  223: { cl_total: 364, cl_reel: 328, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  226: { cl_total: 366, cl_reel: 329, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  229: { cl_total: 154, cl_reel: 172, km_total: 8.25, km_reel: 5.25, km_bonus: 3.0 },
  230: { cl_total: 405, cl_reel: 392, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  231: { cl_total: 358, cl_reel: 330, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  232: { cl_total: 407, cl_reel: 393, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  233: { cl_total: 400, cl_reel: 365, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  235: { cl_total: 409, cl_reel: 394, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  236: { cl_total: 96, cl_reel: 209, km_total: 10.5, km_reel: 4.5, km_bonus: 6.0 },
  237: { cl_total: 421, cl_reel: 395, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  238: { cl_total: 339, cl_reel: 294, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  239: { cl_total: 417, cl_reel: 396, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  241: { cl_total: 206, cl_reel: 295, km_total: 6.75, km_reel: 3.0, km_bonus: 3.75 },
  242: { cl_total: 91, cl_reel: 30, km_total: 11.25, km_reel: 11.25, km_bonus: 0.0 },
  243: { cl_total: 383, cl_reel: 366, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  244: { cl_total: 195, cl_reel: 252, km_total: 6.75, km_reel: 3.75, km_bonus: 3.0 },
  245: { cl_total: 420, cl_reel: 397, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  246: { cl_total: 313, cl_reel: 253, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  247: { cl_total: 200, cl_reel: 296, km_total: 6.75, km_reel: 3.0, km_bonus: 3.75 },
  248: { cl_total: 157, cl_reel: 297, km_total: 8.25, km_reel: 3.0, km_bonus: 5.25 },
  250: { cl_total: 317, cl_reel: 254, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  252: { cl_total: 427, cl_reel: 398, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  253: { cl_total: 233, cl_reel: 255, km_total: 6.0, km_reel: 3.75, km_bonus: 2.25 },
  254: { cl_total: 181, cl_reel: 95, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  255: { cl_total: 410, cl_reel: 399, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  256: { cl_total: 254, cl_reel: 331, km_total: 5.25, km_reel: 2.25, km_bonus: 3.0 },
  257: { cl_total: 418, cl_reel: 400, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  258: { cl_total: 343, cl_reel: 298, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  259: { cl_total: 350, cl_reel: 332, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  260: { cl_total: 342, cl_reel: 299, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  261: { cl_total: 344, cl_reel: 333, km_total: 3.0, km_reel: 2.25, km_bonus: 0.75 },
  262: { cl_total: 307, cl_reel: 256, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  263: { cl_total: 268, cl_reel: 300, km_total: 4.5, km_reel: 3.0, km_bonus: 1.5 },
  264: { cl_total: 341, cl_reel: 424, km_total: 3.0, km_reel: 0.0, km_bonus: 3.75 },
  265: { cl_total: 365, cl_reel: 427, km_total: 2.25, km_reel: 0.0, km_bonus: 2.25 },
  266: { cl_total: 156, cl_reel: 367, km_total: 8.25, km_reel: 1.5, km_bonus: 6.75 },
  267: { cl_total: 415, cl_reel: 401, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  268: { cl_total: 79, cl_reel: 173, km_total: 11.25, km_reel: 5.25, km_bonus: 6.0 },
  269: { cl_total: 95, cl_reel: 68, km_total: 10.5, km_reel: 8.25, km_bonus: 2.25 },
  270: { cl_total: 137, cl_reel: 174, km_total: 9.0, km_reel: 5.25, km_bonus: 3.75 },
  271: { cl_total: 334, cl_reel: 301, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  272: { cl_total: 399, cl_reel: 368, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  273: { cl_total: 416, cl_reel: 402, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  274: { cl_total: 419, cl_reel: 403, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  275: { cl_total: 277, cl_reel: 210, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  276: { cl_total: 167, cl_reel: 69, km_total: 8.25, km_reel: 8.25, km_bonus: 0.0 },
  277: { cl_total: 312, cl_reel: 257, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  279: { cl_total: 377, cl_reel: 369, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  280: { cl_total: 335, cl_reel: 302, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  281: { cl_total: 385, cl_reel: 370, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  282: { cl_total: 227, cl_reel: 371, km_total: 6.0, km_reel: 1.5, km_bonus: 4.5 },
  283: { cl_total: 367, cl_reel: 334, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  284: { cl_total: 283, cl_reel: 211, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  286: { cl_total: 337, cl_reel: 303, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  288: { cl_total: 318, cl_reel: 258, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  289: { cl_total: 253, cl_reel: 212, km_total: 5.25, km_reel: 4.5, km_bonus: 0.75 },
  290: { cl_total: 190, cl_reel: 96, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  291: { cl_total: 348, cl_reel: 425, km_total: 2.25, km_reel: 0.0, km_bonus: 3.0 },
  292: { cl_total: 171, cl_reel: 119, km_total: 8.25, km_reel: 6.75, km_bonus: 1.5 },
  293: { cl_total: 321, cl_reel: 404, km_total: 3.0, km_reel: 0.75, km_bonus: 2.25 },
  294: { cl_total: 280, cl_reel: 213, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  295: { cl_total: 159, cl_reel: 372, km_total: 8.25, km_reel: 1.5, km_bonus: 6.75 },
  296: { cl_total: 246, cl_reel: 304, km_total: 5.25, km_reel: 3.0, km_bonus: 2.25 },
  297: { cl_total: 207, cl_reel: 120, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  298: { cl_total: 315, cl_reel: 259, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  299: { cl_total: 158, cl_reel: 260, km_total: 8.25, km_reel: 3.75, km_bonus: 4.5 },
  300: { cl_total: 139, cl_reel: 335, km_total: 9.0, km_reel: 2.25, km_bonus: 6.75 },
  301: { cl_total: 331, cl_reel: 336, km_total: 3.0, km_reel: 2.25, km_bonus: 0.75 },
  302: { cl_total: 314, cl_reel: 261, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  303: { cl_total: 266, cl_reel: 214, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  304: { cl_total: 247, cl_reel: 215, km_total: 5.25, km_reel: 4.5, km_bonus: 0.75 },
  305: { cl_total: 281, cl_reel: 262, km_total: 4.5, km_reel: 3.75, km_bonus: 0.75 },
  306: { cl_total: 232, cl_reel: 175, km_total: 6.0, km_reel: 5.25, km_bonus: 0.75 },
  308: { cl_total: 180, cl_reel: 97, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  309: { cl_total: 258, cl_reel: 176, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  310: { cl_total: 287, cl_reel: 216, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  311: { cl_total: 333, cl_reel: 305, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  312: { cl_total: 131, cl_reel: 121, km_total: 9.0, km_reel: 6.75, km_bonus: 2.25 },
  313: { cl_total: 241, cl_reel: 177, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  314: { cl_total: 320, cl_reel: 405, km_total: 3.0, km_reel: 0.75, km_bonus: 2.25 },
  315: { cl_total: 224, cl_reel: 217, km_total: 6.0, km_reel: 4.5, km_bonus: 1.5 },
  316: { cl_total: 211, cl_reel: 122, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  317: { cl_total: 65, cl_reel: 70, km_total: 12.0, km_reel: 8.25, km_bonus: 3.75 },
  318: { cl_total: 332, cl_reel: 306, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  322: { cl_total: 10, cl_reel: 71, km_total: 17.25, km_reel: 8.25, km_bonus: 9.0 },
  323: { cl_total: 86, cl_reel: 263, km_total: 11.25, km_reel: 3.75, km_bonus: 7.5 },
  324: { cl_total: 213, cl_reel: 264, km_total: 6.75, km_reel: 3.75, km_bonus: 3.0 },
  325: { cl_total: 105, cl_reel: 37, km_total: 10.5, km_reel: 10.5, km_bonus: 0.0 },
  328: { cl_total: 174, cl_reel: 98, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  331: { cl_total: 170, cl_reel: 143, km_total: 8.25, km_reel: 6.0, km_bonus: 2.25 },
  332: { cl_total: 340, cl_reel: 307, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  334: { cl_total: 345, cl_reel: 308, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  336: { cl_total: 25, cl_reel: 72, km_total: 15.75, km_reel: 8.25, km_bonus: 7.5 },
  337: { cl_total: 196, cl_reel: 265, km_total: 6.75, km_reel: 3.75, km_bonus: 3.0 },
  338: { cl_total: 102, cl_reel: 73, km_total: 10.5, km_reel: 8.25, km_bonus: 2.25 },
  339: { cl_total: 263, cl_reel: 178, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  340: { cl_total: 329, cl_reel: 309, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  341: { cl_total: 393, cl_reel: 373, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  342: { cl_total: 59, cl_reel: 179, km_total: 12.75, km_reel: 5.25, km_bonus: 7.5 },
  343: { cl_total: 30, cl_reel: 22, km_total: 15.0, km_reel: 12.0, km_bonus: 3.0 },
  344: { cl_total: 71, cl_reel: 23, km_total: 12.0, km_reel: 12.0, km_bonus: 0.0 },
  346: { cl_total: 173, cl_reel: 99, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  349: { cl_total: 168, cl_reel: 74, km_total: 8.25, km_reel: 8.25, km_bonus: 0.0 },
  355: { cl_total: 259, cl_reel: 180, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  356: { cl_total: 303, cl_reel: 266, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  358: { cl_total: 33, cl_reel: 100, km_total: 15.0, km_reel: 7.5, km_bonus: 7.5 },
  359: { cl_total: 430, cl_reel: 406, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  360: { cl_total: 64, cl_reel: 181, km_total: 12.0, km_reel: 5.25, km_bonus: 6.75 },
  361: { cl_total: 218, cl_reel: 123, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  365: { cl_total: 80, cl_reel: 31, km_total: 11.25, km_reel: 11.25, km_bonus: 0.0 },
  366: { cl_total: 98, cl_reel: 38, km_total: 10.5, km_reel: 10.5, km_bonus: 0.0 },
  367: { cl_total: 255, cl_reel: 267, km_total: 5.25, km_reel: 3.75, km_bonus: 1.5 },
  368: { cl_total: 242, cl_reel: 310, km_total: 5.25, km_reel: 3.0, km_bonus: 2.25 },
  369: { cl_total: 351, cl_reel: 337, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  370: { cl_total: 269, cl_reel: 218, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  371: { cl_total: 126, cl_reel: 219, km_total: 9.75, km_reel: 4.5, km_bonus: 5.25 },
  373: { cl_total: 422, cl_reel: 407, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  374: { cl_total: 429, cl_reel: 408, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  375: { cl_total: 67, cl_reel: 24, km_total: 12.0, km_reel: 12.0, km_bonus: 0.0 },
  376: { cl_total: 425, cl_reel: 409, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  377: { cl_total: 327, cl_reel: 311, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  378: { cl_total: 186, cl_reel: 144, km_total: 7.5, km_reel: 6.0, km_bonus: 1.5 },
  379: { cl_total: 94, cl_reel: 54, km_total: 11.25, km_reel: 9.0, km_bonus: 2.25 },
  382: { cl_total: 160, cl_reel: 75, km_total: 8.25, km_reel: 8.25, km_bonus: 0.0 },
  383: { cl_total: 90, cl_reel: 45, km_total: 11.25, km_reel: 9.75, km_bonus: 1.5 },
  385: { cl_total: 352, cl_reel: 338, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  386: { cl_total: 267, cl_reel: 312, km_total: 4.5, km_reel: 3.0, km_bonus: 1.5 },
  388: { cl_total: 289, cl_reel: 220, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  389: { cl_total: 223, cl_reel: 221, km_total: 6.0, km_reel: 4.5, km_bonus: 1.5 },
  390: { cl_total: 323, cl_reel: 410, km_total: 3.0, km_reel: 0.75, km_bonus: 2.25 },
  391: { cl_total: 328, cl_reel: 313, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  394: { cl_total: 275, cl_reel: 314, km_total: 4.5, km_reel: 3.0, km_bonus: 1.5 },
  395: { cl_total: 406, cl_reel: 411, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  397: { cl_total: 193, cl_reel: 222, km_total: 7.5, km_reel: 4.5, km_bonus: 3.0 },
  398: { cl_total: 217, cl_reel: 223, km_total: 6.75, km_reel: 4.5, km_bonus: 2.25 },
  399: { cl_total: 360, cl_reel: 339, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  400: { cl_total: 311, cl_reel: 268, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  402: { cl_total: 424, cl_reel: 412, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  403: { cl_total: 384, cl_reel: 374, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  406: { cl_total: 210, cl_reel: 269, km_total: 6.75, km_reel: 3.75, km_bonus: 3.0 },
  408: { cl_total: 368, cl_reel: 340, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  409: { cl_total: 294, cl_reel: 270, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  410: { cl_total: 310, cl_reel: 341, km_total: 3.75, km_reel: 2.25, km_bonus: 1.5 },
  413: { cl_total: 78, cl_reel: 182, km_total: 11.25, km_reel: 5.25, km_bonus: 6.0 },
  415: { cl_total: 114, cl_reel: 124, km_total: 9.75, km_reel: 6.75, km_bonus: 3.0 },
  416: { cl_total: 295, cl_reel: 271, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  418: { cl_total: 380, cl_reel: 375, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  421: { cl_total: 373, cl_reel: 376, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  422: { cl_total: 412, cl_reel: 413, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  423: { cl_total: 381, cl_reel: 377, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  424: { cl_total: 411, cl_reel: 414, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  425: { cl_total: 199, cl_reel: 125, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  426: { cl_total: 403, cl_reel: 415, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  429: { cl_total: 376, cl_reel: 378, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  434: { cl_total: 371, cl_reel: 379, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  435: { cl_total: 57, cl_reel: 101, km_total: 12.75, km_reel: 7.5, km_bonus: 5.25 },
  438: { cl_total: 228, cl_reel: 145, km_total: 6.0, km_reel: 6.0, km_bonus: 0.0 },
  440: { cl_total: 236, cl_reel: 183, km_total: 6.0, km_reel: 5.25, km_bonus: 0.75 },
  441: { cl_total: 201, cl_reel: 224, km_total: 6.75, km_reel: 4.5, km_bonus: 2.25 },
  445: { cl_total: 44, cl_reel: 55, km_total: 13.5, km_reel: 9.0, km_bonus: 4.5 },
  447: { cl_total: 35, cl_reel: 6, km_total: 15.0, km_reel: 15.0, km_bonus: 0.0 },
  448: { cl_total: 414, cl_reel: 416, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  449: { cl_total: 346, cl_reel: 315, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  451: { cl_total: 245, cl_reel: 225, km_total: 5.25, km_reel: 4.5, km_bonus: 0.75 },
  453: { cl_total: 250, cl_reel: 226, km_total: 5.25, km_reel: 4.5, km_bonus: 0.75 },
  454: { cl_total: 127, cl_reel: 102, km_total: 9.75, km_reel: 7.5, km_bonus: 2.25 },
  455: { cl_total: 238, cl_reel: 227, km_total: 6.0, km_reel: 4.5, km_bonus: 1.5 },
  456: { cl_total: 175, cl_reel: 316, km_total: 7.5, km_reel: 3.0, km_bonus: 4.5 },
  459: { cl_total: 402, cl_reel: 428, km_total: 1.5, km_reel: 0.0, km_bonus: 1.5 },
  465: { cl_total: 104, cl_reel: 228, km_total: 10.5, km_reel: 4.5, km_bonus: 6.0 },
  472: { cl_total: 264, cl_reel: 229, km_total: 5.25, km_reel: 4.5, km_bonus: 0.75 },
  474: { cl_total: 392, cl_reel: 380, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  479: { cl_total: 212, cl_reel: 126, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  480: { cl_total: 220, cl_reel: 146, km_total: 6.75, km_reel: 6.0, km_bonus: 0.75 },
  481: { cl_total: 378, cl_reel: 381, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  483: { cl_total: 147, cl_reel: 56, km_total: 9.0, km_reel: 9.0, km_bonus: 0.0 },
  484: { cl_total: 379, cl_reel: 422, km_total: 1.5, km_reel: 0.0, km_bonus: 4.5 },
  487: { cl_total: 297, cl_reel: 272, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  489: { cl_total: 304, cl_reel: 273, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  492: { cl_total: 261, cl_reel: 184, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  494: { cl_total: 260, cl_reel: 185, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  496: { cl_total: 370, cl_reel: 342, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  497: { cl_total: 273, cl_reel: 274, km_total: 4.5, km_reel: 3.75, km_bonus: 0.75 },
  498: { cl_total: 256, cl_reel: 186, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  499: { cl_total: 286, cl_reel: 275, km_total: 4.5, km_reel: 3.75, km_bonus: 0.75 },
  500: { cl_total: 349, cl_reel: 382, km_total: 2.25, km_reel: 1.5, km_bonus: 0.75 },
  501: { cl_total: 244, cl_reel: 276, km_total: 5.25, km_reel: 3.75, km_bonus: 1.5 },
  502: { cl_total: 279, cl_reel: 230, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  503: { cl_total: 221, cl_reel: 317, km_total: 6.0, km_reel: 3.0, km_bonus: 3.0 },
  504: { cl_total: 278, cl_reel: 231, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  506: { cl_total: 306, cl_reel: 277, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  507: { cl_total: 272, cl_reel: 232, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  508: { cl_total: 177, cl_reel: 278, km_total: 7.5, km_reel: 3.75, km_bonus: 3.75 },
  509: { cl_total: 347, cl_reel: 318, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  510: { cl_total: 336, cl_reel: 343, km_total: 3.0, km_reel: 2.25, km_bonus: 0.75 },
  511: { cl_total: 52, cl_reel: 233, km_total: 12.75, km_reel: 4.5, km_bonus: 8.25 },
  512: { cl_total: 209, cl_reel: 147, km_total: 6.75, km_reel: 6.0, km_bonus: 0.75 },
  513: { cl_total: 355, cl_reel: 344, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  514: { cl_total: 116, cl_reel: 148, km_total: 9.75, km_reel: 6.0, km_bonus: 3.75 },
  519: { cl_total: 292, cl_reel: 417, km_total: 3.75, km_reel: 0.75, km_bonus: 3.0 },
  520: { cl_total: 284, cl_reel: 279, km_total: 4.5, km_reel: 3.75, km_bonus: 0.75 },
  521: { cl_total: 353, cl_reel: 418, km_total: 2.25, km_reel: 0.75, km_bonus: 1.5 },
  523: { cl_total: 138, cl_reel: 103, km_total: 9.0, km_reel: 7.5, km_bonus: 1.5 },
  526: { cl_total: 428, cl_reel: 429, km_total: 0.75, km_reel: 0.0, km_bonus: 0.75 },
  528: { cl_total: 397, cl_reel: 383, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  529: { cl_total: 356, cl_reel: 345, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  530: { cl_total: 338, cl_reel: 346, km_total: 3.0, km_reel: 2.25, km_bonus: 0.75 },
  532: { cl_total: 357, cl_reel: 347, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  533: { cl_total: 142, cl_reel: 234, km_total: 9.0, km_reel: 4.5, km_bonus: 4.5 },
  535: { cl_total: 74, cl_reel: 76, km_total: 12.0, km_reel: 8.25, km_bonus: 3.75 },
  536: { cl_total: 141, cl_reel: 149, km_total: 9.0, km_reel: 6.0, km_bonus: 3.0 },
  538: { cl_total: 305, cl_reel: 280, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  540: { cl_total: 216, cl_reel: 150, km_total: 6.75, km_reel: 6.0, km_bonus: 0.75 },
  541: { cl_total: 83, cl_reel: 77, km_total: 11.25, km_reel: 8.25, km_bonus: 3.0 },
  542: { cl_total: 257, cl_reel: 187, km_total: 5.25, km_reel: 5.25, km_bonus: 0.0 },
  543: { cl_total: 155, cl_reel: 151, km_total: 8.25, km_reel: 6.0, km_bonus: 2.25 },
  544: { cl_total: 119, cl_reel: 127, km_total: 9.75, km_reel: 6.75, km_bonus: 3.0 },
  545: { cl_total: 118, cl_reel: 128, km_total: 9.75, km_reel: 6.75, km_bonus: 3.0 },
  546: { cl_total: 113, cl_reel: 152, km_total: 9.75, km_reel: 6.0, km_bonus: 3.75 },
  547: { cl_total: 204, cl_reel: 129, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  548: { cl_total: 112, cl_reel: 104, km_total: 9.75, km_reel: 7.5, km_bonus: 2.25 },
  549: { cl_total: 161, cl_reel: 78, km_total: 8.25, km_reel: 8.25, km_bonus: 0.0 },
  550: { cl_total: 111, cl_reel: 79, km_total: 9.75, km_reel: 8.25, km_bonus: 1.5 },
  551: { cl_total: 88, cl_reel: 80, km_total: 11.25, km_reel: 8.25, km_bonus: 3.0 },
  552: { cl_total: 68, cl_reel: 39, km_total: 12.0, km_reel: 10.5, km_bonus: 1.5 },
  553: { cl_total: 145, cl_reel: 57, km_total: 9.0, km_reel: 9.0, km_bonus: 0.0 },
  554: { cl_total: 164, cl_reel: 81, km_total: 8.25, km_reel: 8.25, km_bonus: 0.0 },
  555: { cl_total: 162, cl_reel: 130, km_total: 8.25, km_reel: 6.75, km_bonus: 1.5 },
  556: { cl_total: 8, cl_reel: 1, km_total: 17.25, km_reel: 17.25, km_bonus: 0.0 },
  557: { cl_total: 45, cl_reel: 10, km_total: 13.5, km_reel: 13.5, km_bonus: 0.0 },
  558: { cl_total: 203, cl_reel: 235, km_total: 6.75, km_reel: 4.5, km_bonus: 2.25 },
  559: { cl_total: 215, cl_reel: 188, km_total: 6.75, km_reel: 5.25, km_bonus: 1.5 },
  560: { cl_total: 166, cl_reel: 189, km_total: 8.25, km_reel: 5.25, km_bonus: 3.0 },
  561: { cl_total: 202, cl_reel: 281, km_total: 6.75, km_reel: 3.75, km_bonus: 3.0 },
  562: { cl_total: 288, cl_reel: 236, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  563: { cl_total: 192, cl_reel: 105, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  564: { cl_total: 87, cl_reel: 131, km_total: 11.25, km_reel: 6.75, km_bonus: 4.5 },
  565: { cl_total: 70, cl_reel: 153, km_total: 12.0, km_reel: 6.0, km_bonus: 6.0 },
  566: { cl_total: 75, cl_reel: 154, km_total: 12.0, km_reel: 6.0, km_bonus: 6.0 },
  567: { cl_total: 42, cl_reel: 82, km_total: 13.5, km_reel: 8.25, km_bonus: 5.25 },
  568: { cl_total: 77, cl_reel: 155, km_total: 12.0, km_reel: 6.0, km_bonus: 6.0 },
  569: { cl_total: 290, cl_reel: 319, km_total: 4.5, km_reel: 3.0, km_bonus: 1.5 },
  570: { cl_total: 413, cl_reel: 419, km_total: 0.75, km_reel: 0.75, km_bonus: 0.0 },
  572: { cl_total: 296, cl_reel: 282, km_total: 3.75, km_reel: 3.75, km_bonus: 0.0 },
  574: { cl_total: 271, cl_reel: 237, km_total: 4.5, km_reel: 4.5, km_bonus: 0.0 },
  575: { cl_total: 49, cl_reel: 58, km_total: 13.5, km_reel: 9.0, km_bonus: 4.5 },
  577: { cl_total: 225, cl_reel: 283, km_total: 6.0, km_reel: 3.75, km_bonus: 2.25 },
  578: { cl_total: 66, cl_reel: 25, km_total: 12.0, km_reel: 12.0, km_bonus: 0.0 },
  579: { cl_total: 28, cl_reel: 106, km_total: 15.75, km_reel: 7.5, km_bonus: 8.25 },
  581: { cl_total: 47, cl_reel: 11, km_total: 13.5, km_reel: 13.5, km_bonus: 0.0 },
  582: { cl_total: 108, cl_reel: 107, km_total: 10.5, km_reel: 7.5, km_bonus: 3.0 },
  590: { cl_total: 135, cl_reel: 59, km_total: 9.0, km_reel: 9.0, km_bonus: 0.0 },
  591: { cl_total: 361, cl_reel: 348, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  592: { cl_total: 249, cl_reel: 420, km_total: 5.25, km_reel: 0.75, km_bonus: 4.5 },
  593: { cl_total: 382, cl_reel: 384, km_total: 1.5, km_reel: 1.5, km_bonus: 0.0 },
  594: { cl_total: 330, cl_reel: 320, km_total: 3.0, km_reel: 3.0, km_bonus: 0.0 },
  595: { cl_total: 363, cl_reel: 349, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  596: { cl_total: 369, cl_reel: 350, km_total: 2.25, km_reel: 2.25, km_bonus: 0.0 },
  597: { cl_total: 252, cl_reel: 238, km_total: 5.25, km_reel: 4.5, km_bonus: 0.75 },
  598: { cl_total: 187, cl_reel: 108, km_total: 7.5, km_reel: 7.5, km_bonus: 0.0 },
  599: { cl_total: 219, cl_reel: 132, km_total: 6.75, km_reel: 6.75, km_bonus: 0.0 },
  600: { cl_total: 122, cl_reel: 156, km_total: 9.75, km_reel: 6.0, km_bonus: 3.75 },
  1388: { cl_total: 396, cl_reel: 430, km_total: 1.5, km_reel: 0.0, km_bonus: 1.5 },
};

// ── Classement équipes Joué 2026
const CLASSEMENT_EQUIPES_JOUE = {
  'Union pour l\'Enfance 37 - UPE': { cl_total: 2, cl_reel: 1, km_total: 320.3, km_reel: 243.8, km_bonus: 76.5 },
  'Touraine le Département': { cl_total: 1, cl_reel: 2, km_total: 358.5, km_reel: 207.0, km_bonus: 151.5 },
  'SAF Normandie - UPE': { cl_total: 3, cl_reel: 3, km_total: 294.8, km_reel: 193.55, km_bonus: 101.25 },
  'Maisons Hugues Renaudin - UPE': { cl_total: 6, cl_reel: 4, km_total: 171.8, km_reel: 141.05, km_bonus: 30.75 },
  'La Montgolfière - UPE': { cl_total: 4, cl_reel: 5, km_total: 201.0, km_reel: 139.5, km_bonus: 61.5 },
  'Institut départemental de l\'Enfance et de la Famille (IDEF 37)': { cl_total: 5, cl_reel: 6, km_total: 186.0, km_reel: 117.75, km_bonus: 68.25 },
  'Maison Paul Valéry - UPE': { cl_total: 7, cl_reel: 7, km_total: 157.5, km_reel: 112.5, km_bonus: 45.0 },
  'Agapè Anjou': { cl_total: 8, cl_reel: 8, km_total: 150.8, km_reel: 105.05, km_bonus: 45.75 },
  'AG2R LA MONDIALE': { cl_total: 9, cl_reel: 9, km_total: 120.8, km_reel: 99.05, km_bonus: 21.75 },
  'CGI France': { cl_total: 11, cl_reel: 10, km_total: 90.8, km_reel: 80.3, km_bonus: 10.5 },
  'ACTION ENFANCE': { cl_total: 10, cl_reel: 11, km_total: 96.0, km_reel: 79.5, km_bonus: 16.5 },
  'Les Cahutes de Louise': { cl_total: 12, cl_reel: 12, km_total: 86.3, km_reel: 58.55, km_bonus: 27.75 },
  'LVA Canihuel - Enfants du Compas': { cl_total: 13, cl_reel: 14, km_total: 65.3, km_reel: 55.55, km_bonus: 9.75 },
  'Les Crins Verts - Enfants du Compas': { cl_total: 14, cl_reel: 13, km_total: 68.3, km_reel: 45.05, km_bonus: 23.25 },
  'La Chacunière - UPE': { cl_total: 15, cl_reel: 15, km_total: 57.0, km_reel: 40.5, km_bonus: 16.5 },
  'SAF Île-de-France - UPE': { cl_total: 16, cl_reel: 16, km_total: 54.0, km_reel: 39.75, km_bonus: 14.25 },
  'Réseau Entreprendre Loire Vallée': { cl_total: 19, cl_reel: 17, km_total: 43.5, km_reel: 39.0, km_bonus: 4.5 },
  'Maison Pauline Kergomard - UPE': { cl_total: 17, cl_reel: 18, km_total: 51.8, km_reel: 37.55, km_bonus: 14.25 },
  'La Maison commune - UPE': { cl_total: 21, cl_reel: 19, km_total: 37.5, km_reel: 36.0, km_bonus: 1.5 },
  'La Morinière - Enfants du Compas': { cl_total: 20, cl_reel: 20, km_total: 42.0, km_reel: 34.5, km_bonus: 7.5 },
  'EGERIA - SAINT-CRICQ et Associés': { cl_total: 22, cl_reel: 21, km_total: 36.0, km_reel: 33.75, km_bonus: 2.25 },
  'Twinon': { cl_total: 18, cl_reel: 22, km_total: 49.5, km_reel: 26.25, km_bonus: 23.25 },
  'Eclats d\'Union': { cl_total: 23, cl_reel: 24, km_total: 31.5, km_reel: 20.25, km_bonus: 11.25 },
  'Fondation Rabelais': { cl_total: 24, cl_reel: 25, km_total: 20.3, km_reel: 8.3, km_bonus: 12.0 },
  'Inserm 1253 iBraiN': { cl_total: 25, cl_reel: 23, km_total: 33.0, km_reel: 8.25, km_bonus: 24.75 },
};

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

// ── Projection pour une équipe : base 10km/coureur en 2h, avec note si plus
function blocProjectionEquipe(montantParKm, nbCoureurs) {
  const m = parseFloat(montantParKm) || 0;
  const n = parseInt(nbCoureurs) || 0;
  if (!m || !n) return '';
  const kmBase   = n * 10;
  const donBase  = m * kmBase;
  const kmMieux  = n * 15;
  const donMieux = m * kmMieux;
  const kmTop    = n * 20;
  const donTop   = m * kmTop;
  return `<div class="promesse-scenario">
    <div style="font-size:.78rem;font-weight:700;color:#7c3aed;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">💡 Projection — base 10 km/coureur en 2h</div>
    <div style="font-size:.75rem;color:#888;margin-bottom:10px">Équipe de <strong>${n} coureur${n > 1 ? 's' : ''}</strong> inscrits</div>
    <div class="sc-line"><span>Base (${n} × 10 km = ${kmBase} km)</span><span><strong>${donBase.toFixed(0)} €</strong></span></div>
    <div class="sc-line"><span>Si 15 km/coureur (${kmMieux} km)</span><span><strong>${donMieux.toFixed(0)} €</strong></span></div>
    <div class="sc-line"><span>Si 20 km/coureur (${kmTop} km)</span><span><strong>${donTop.toFixed(0)} €</strong></span></div>
    <div style="font-size:.75rem;color:#ef6135;margin-top:8px;font-style:italic">😉 Il est possible que l'équipe court plus de 10 km/coureur en moyenne. Dans ce cas, <strong>tenez-vous prêt à donner plus !</strong></div>
    <div style="font-size:.75rem;color:#7c3aed;margin-top:6px">📩 Si un nouveau coureur s'inscrit dans l'équipe, vous recevrez automatiquement un email de mise à jour de cette projection.</div>
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

function tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe, donateur, montantParKm, email_donateur, motEncouragement, nbPromessesEquipe, totalKmParEquipe, urlPromesseEquipe, urlPageEquipe, nbCoureurs }) {
  const motLine  = motEncouragement ? `<div class="note violet" style="margin-top:16px">💬 <strong>Message de ${donateur} :</strong><br><em>"${motEncouragement}"</em></div>` : '';
  const recap    = blocRecapPromesses({ nbPromessesCoureur: 0, totalKmParCoureur: 0, nbPromessesEquipe, totalKmParEquipe, isCoureur: false });
  const scenarios = nbCoureurs ? blocProjectionEquipe(montantParKm, nbCoureurs) : blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🏅 Promesse de don<br>pour votre équipe !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${chefPrenom} 👋</div><div style="margin-bottom:16px"><span class="badge violet">🏃 Équipe ${nomEquipe}</span></div><div class="intro">Excellente nouvelle ! <strong>${donateur}</strong> s'engage à faire un don pour votre équipe — <strong>le soir même de la course</strong> — proportionnellement aux kilomètres cumulés par vos coureurs !</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">promis par km couru — pour l'équipe ${nomEquipe}</div></div>${scenarios}${motLine}<div class="note violet">🚀 <strong>Chaque km couru par chacun de vos coureurs compte !</strong><br>Plus votre équipe performe collectivement, plus ${donateur} donnera pour l'enfance le soir même.</div>${recap}<div class="card violet"><h3 class="violet">📋 Coordonnées du supporter</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${donateur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_donateur}" style="color:#7c3aed">${email_donateur}</a></div></div></div><div class="note magenta">💌 <strong>Transmettez cette promesse à vos coureurs</strong> pour les motiver encore davantage — chaque foulée supplémentaire a un prix pour l'enfance !</div><div class="cta-box violet"><p>✨ <strong>Mobilisez l'équipe !</strong><br>Partagez cette promesse de don avec tous vos coureurs pour décupler leur motivation le jour J.</p><a href="${urlPromesseEquipe || URL_PROMESSE_FALLBACK}" class="cta-btn violet">🏅 Promettre un don au km</a></div><div style="text-align:center;margin-top:10px"><a href="${urlPageEquipe || URL_EQUIPES}" style="display:inline-block;background:linear-gradient(135deg,#ef6135,#ff8533);color:#fff!important;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.82rem">🏆 Voir la page de l'équipe</a></div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Promesse enregistrée automatiquement. Le don sera effectif après la course.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → coureur
 */

function tplMerciConcretisationPromesse({ prenomDonateur, montantDon, montantParKm, nomCible, typeCible, kmsParcourus, montantCalcule, urlPage, motEncouragement, recapHtml }) {
  const valorisation = kmsParcourus > 0 ? (montantDon / kmsParcourus).toFixed(2) : null;
  const isCoureur = typeCible === 'coureur';
  const couleur = isCoureur ? '#7c3aed' : '#ef6135';
  const emoji   = isCoureur ? '🏃' : '🏆';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${couleur}" style="background-color:${couleur};padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 6px">🙏 Merci d'avoir concrétisé<br>votre promesse de don !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 2026</p></td></tr></table>
<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px">Bonjour ${prenomDonateur} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px">Vous aviez promis <strong>${montantParKm} €/km</strong> pour ${emoji} <strong>${nomCible}</strong>. Aujourd'hui, vous avez décidé de concrétiser cet engagement avec un don de <strong style="color:${couleur}">${montantDon} €</strong>. Merci du fond du cœur.</div>

<div style="background-color:#f9f7ff;border:2px solid ${couleur};border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:center">
  <div style="font-size:.72rem;font-weight:700;color:${couleur};text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px">${emoji} Récapitulatif de votre engagement</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Promesse initiale</td>
      <td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;font-weight:700;color:${couleur};text-align:right">${montantParKm} €/km</td>
    </tr>
    ${kmsParcourus > 0 ? `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Km parcourus ${isCoureur ? 'par ' + nomCible : 'par l\'équipe'}</td>
      <td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;font-weight:700;color:#3d1830;text-align:right">${kmsParcourus} km</td>
    </tr>` : ''}
    ${montantCalcule > 0 ? `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Don calculé selon les km</td>
      <td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:right">${montantCalcule.toFixed(2)} €</td>
    </tr>` : ''}
    <tr>
      <td style="padding:10px 0;font-size:.9rem;font-weight:700;color:#3d1830;text-align:left">Votre don réalisé</td>
      <td style="padding:10px 0;font-size:1.1rem;font-weight:700;color:${couleur};text-align:right">${montantDon} €</td>
    </tr>
    ${valorisation ? `<tr>
      <td colspan="2" style="padding:6px 0;font-size:.75rem;color:#888;font-style:italic;text-align:center">Soit une valorisation de <strong>${valorisation} €/km parcouru</strong></td>
    </tr>` : ''}
  </table>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px">Votre geste dépasse un simple don — c'est la preuve qu'<strong>une promesse tenue change la vie d'enfants vulnérables</strong>. Vous faites partie de l'aventure Défi Enfance et nous en sommes immensément reconnaissants.</div>

${urlPage ? `<div style="text-align:center;margin-bottom:20px"><a href="${urlPage}" style="display:inline-block;background-color:${couleur};color:#fff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">${emoji} Voir la page de ${isCoureur ? nomCible : 'l\'équipe'}</a></div>` : ''}

${motEncouragement ? `<div style="background-color:#fff0f8;border-left:3px solid #fb0089;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;font-size:.84rem;color:#3d1830;font-style:italic">💬 <strong>Votre message d'encouragement :</strong><br>${motEncouragement}</div>` : ''}
${recapHtml || ''}
${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">Merci d'avoir tenu votre promesse. On continue ensemble. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}


// ── Notification au coureur/référent quand une promesse est concrétisée
function tplNotifConcretisationCoureur({ prenomCible, donateur, montantDon, montantParKm, kmsParcourus, urlPage, motEncouragement, recapHtml }) {
  const couleur = '#7c3aed';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${couleur}" style="background-color:${couleur};padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 6px">🎉 Une promesse de don<br>vient d'être concrétisée !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 2026</p></td></tr></table>
<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px">Bonjour ${prenomCible} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px"><strong>${donateur}</strong> avait promis <strong>${montantParKm} €/km</strong> — et vient de tenir sa promesse avec un don de <strong style="color:${couleur}">${montantDon} €</strong>. Merci à eux, et bravo à vous pour votre performance !</div>

<div style="background-color:#f9f7ff;border:2px solid ${couleur};border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Promesse initiale</td><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;font-weight:700;color:${couleur};text-align:right">${montantParKm} €/km</td></tr>
    ${kmsParcourus > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Tes km parcourus</td><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;font-weight:700;color:#3d1830;text-align:right">${kmsParcourus} km</td></tr>` : ''}
    ${kmsParcourus > 0 && montantParKm > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Don calculé selon tes km</td><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:right">${(kmsParcourus * montantParKm).toFixed(2)} €</td></tr>` : ''}
    <tr><td style="padding:10px 0;border-bottom:1px solid #ede8ff;font-size:.9rem;font-weight:700;color:#3d1830;text-align:left">Don réellement réalisé</td><td style="padding:10px 0;border-bottom:1px solid #ede8ff;font-size:1.1rem;font-weight:700;color:${couleur};text-align:right">${montantDon} €</td></tr>
    ${kmsParcourus > 0 ? `<tr><td colspan="2" style="padding:6px 0;font-size:.75rem;color:#888;font-style:italic;text-align:center">Soit ${(montantDon / kmsParcourus).toFixed(2)} €/km parcouru</td></tr>` : ''}
  </table>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px">Chaque promesse tenue renforce l'élan du Défi Enfance. <strong>N'hésitez pas à remercier ${donateur.split(' ')[0]} personnellement</strong> — un message sincère fait toujours la différence !</div>

${urlPage ? `<div style="text-align:center;margin-bottom:20px"><a href="${urlPage}" style="display:inline-block;background-color:${couleur};color:#fff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🏃 Voir ma page de collecte</a></div>` : ''}

${motEncouragement ? `<div style="background-color:#fff0f8;border-left:3px solid #fb0089;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;font-size:.84rem;color:#3d1830;font-style:italic">💬 <strong>Message d'encouragement :</strong><br>${motEncouragement}</div>` : ''}
${recapHtml || ''}
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">Merci pour votre engagement. On continue ensemble. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}


// ── Notification au référent d'équipe quand une promesse sur un de ses coureurs est concrétisée
function tplNotifConcretisationReferent({ chefPrenom, nomEquipe, coureurPrenom, coureurNom, donateur, montantDon, montantParKm, kmsParcourus, urlPageEquipe, motEncouragement, recapHtml }) {
  const couleur = '#ef6135';
  const nomCoureur = `${coureurPrenom} ${coureurNom || ''}`.trim();
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${couleur}" style="background-color:${couleur};padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 6px">🎉 Une promesse de don vient<br>d'être concrétisée pour votre équipe !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 2026</p></td></tr></table>
<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px">Bonjour ${chefPrenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px">Excellente nouvelle pour l'équipe <strong>${nomEquipe}</strong> ! <strong>${donateur}</strong> avait promis <strong>${montantParKm} €/km</strong> pour <strong>${nomCoureur}</strong>, l'un de vos coureurs — et vient de tenir sa promesse avec un don de <strong style="color:${couleur}">${montantDon} €</strong>. Ce beau geste rejaillit directement sur la collecte de votre équipe !</div>

<div style="background-color:#fff5ef;border:2px solid ${couleur};border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:${couleur};text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">🏃 ${nomCoureur} — Détail de la concrétisation</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#3d1830;text-align:left">Donateur</td><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;font-weight:700;color:#3d1830;text-align:right">${donateur}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#3d1830;text-align:left">Promesse initiale</td><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;font-weight:700;color:${couleur};text-align:right">${montantParKm} €/km</td></tr>
    ${kmsParcourus > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#3d1830;text-align:left">Km parcourus par ${coureurPrenom}</td><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;font-weight:700;color:#3d1830;text-align:right">${kmsParcourus} km</td></tr>` : ''}
    ${kmsParcourus > 0 && montantParKm > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#3d1830;text-align:left">Don calculé selon les km</td><td style="padding:8px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#3d1830;text-align:right">${(kmsParcourus * montantParKm).toFixed(2)} €</td></tr>` : ''}
    <tr><td style="padding:10px 0;border-bottom:1px solid #fde8d8;font-size:.9rem;font-weight:700;color:#3d1830;text-align:left">Don réellement réalisé</td><td style="padding:10px 0;border-bottom:1px solid #fde8d8;font-size:1.1rem;font-weight:700;color:${couleur};text-align:right">${montantDon} €</td></tr>
    ${kmsParcourus > 0 ? `<tr><td colspan="2" style="padding:6px 0;font-size:.75rem;color:#888;font-style:italic;text-align:center">Soit ${(montantDon / kmsParcourus).toFixed(2)} €/km parcouru par ${coureurPrenom}</td></tr>` : ''}
  </table>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px">Chaque promesse tenue renforce l'élan de votre équipe pour l'enfance. <strong>N'hésitez pas à partager cette bonne nouvelle avec vos coureurs</strong> — c'est une belle motivation collective !</div>

${urlPageEquipe ? `<div style="text-align:center;margin-bottom:20px"><a href="${urlPageEquipe}" style="display:inline-block;background-color:${couleur};color:#fff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🏆 Voir la page de mon équipe</a></div>` : ''}

${motEncouragement ? `<div style="background-color:#fff5ef;border-left:3px solid #ef6135;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;font-size:.84rem;color:#3d1830;font-style:italic">💬 <strong>Message de ${donateur.split(' ')[0]} pour ${coureurPrenom} :</strong><br>${motEncouragement}</div>` : ''}
${recapHtml || ''}
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">Merci pour votre engagement. On continue ensemble. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}


function tplRelancePromesse({ prenomDonateur, montantKm, nomCible, typeCible, kmsParcourus, montantDu, urlDon }) {
  const couleur = typeCible === 'coureur' ? '#7c3aed' : '#ef6135';
  const emoji   = typeCible === 'coureur' ? '🏃' : '🏆';
  const hasDu = montantDu > 0;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${couleur}" style="background-color:${couleur};padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 6px">🏅 Votre promesse de don<br>attend d'être concrétisée !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 2026</p></td></tr></table>
<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px">Bonjour ${prenomDonateur} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px">Vous avez promis <strong>${montantKm} €/km</strong> pour ${emoji} <strong>${nomCible}</strong> lors du Défi Enfance. La course est terminée — il est maintenant temps de concrétiser votre engagement ! 💪</div>

<div style="background-color:#f9f7ff;border:2px solid ${couleur};border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:${couleur};text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">${emoji} Récapitulatif de votre promesse</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Votre promesse</td><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;font-weight:700;color:${couleur};text-align:right">${montantKm} €/km</td></tr>
    ${kmsParcourus > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;color:#3d1830;text-align:left">Km parcourus</td><td style="padding:8px 0;border-bottom:1px solid #ede8ff;font-size:.84rem;font-weight:700;color:#3d1830;text-align:right">${kmsParcourus} km</td></tr>` : ''}
    ${hasDu ? `<tr><td style="padding:10px 0;font-size:.9rem;font-weight:700;color:#3d1830;text-align:left">Montant à donner</td><td style="padding:10px 0;font-size:1.2rem;font-weight:700;color:${couleur};text-align:right">${montantDu.toFixed(2)} €</td></tr>` : ''}
  </table>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px">Votre don, même symbolique, fait une vraie différence pour les enfants vulnérables soutenus par le Défi Enfance. <strong>Chaque promesse tenue renforce la confiance et l'élan collectif.</strong></div>

<div style="text-align:center;margin-bottom:20px">
  <a href="${urlDon}" style="display:inline-block;background-color:${couleur};color:#fff;text-decoration:none;padding:14px 32px;border-radius:99px;font-weight:700;font-size:.9rem;font-family:Arial,sans-serif">❤️ Je concrétise ma promesse${hasDu ? ' — ' + montantDu.toFixed(2) + ' €' : ''}</a>
</div>

${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">Merci pour votre engagement. On continue ensemble. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}

function tplMerciPrometteurCoureur({ prenomDonateur, montantParKm, coureurPrenom, coureurNom, association, historiqueHtml, nbCoureurs }) {
  const scenarios = blocScenariosKm(montantParKm);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header violet"><h1>🙏 Merci pour votre<br>promesse de don !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomDonateur} 👋</div><div class="intro">Votre promesse de <strong>${montantParKm} € par km</strong> pour <strong>${coureurPrenom} ${coureurNom || ''}</strong>${association ? ` et l'Association <strong>${association}</strong>` : ''} est enregistrée. Elle sera transformée en don réel — <strong>le soir même de la course</strong> — selon les kilomètres courus.</div><div class="promesse-box"><div class="promesse-km">${montantParKm} €</div><div class="promesse-label">par km couru par ${coureurPrenom}</div></div>${scenarios}<div class="note violet">💡 <strong>Comment ça fonctionne ?</strong><br>Le soir de la course, vous recevrez un email récapitulatif avec le résultat de ${coureurPrenom}. Il vous suffira alors de cliquer sur le lien de don et de saisir le montant correspondant aux km courus.</div><div style="text-align:center;background:linear-gradient(135deg,#f5f0ff,#fdf0f8);border-radius:14px;padding:22px;margin-bottom:24px"><div style="margin-bottom:12px;font-size:.78rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em">L'impact de votre engagement</div><div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap"><div class="impact-stat"><span class="num" style="color:#7c3aed">+20 000</span><span class="lbl">enfants accompagnés</span></div><div class="impact-stat"><span class="num" style="color:#7c3aed">+40</span><span class="lbl">associations soutenues</span></div></div></div>${BLOC_TEMOIGNAGES}${BLOC_SOCIAUX}<div class="cta-box violet"><p>✨ <strong>Envie d'aller encore plus loin ?</strong><br>Partagez cette initiative autour de vous — vos proches peuvent aussi promettre un don par km !</p><a href="${URL_DON}" class="cta-btn violet">❤️ Page de don Défi Enfance</a></div><div class="divider"></div>${historiqueHtml || ""}<div style="font-size:.75rem;color:#888;text-align:center">Promesse de don enregistrée — le don sera réalisé après la course.<br>contact@defienfance.fr — defienfance.fr</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}

/**
 * Merci au prometteur (donateur) après sa promesse → équipe
 */
function tplMerciPrometteurEquipe({ prenomDonateur, montantParKm, nomEquipe, historiqueHtml, nbCoureurs }) {
  const scenarios = nbCoureurs ? blocProjectionEquipe(montantParKm, nbCoureurs) : blocScenariosKm(montantParKm);
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
  const urlDon  = urlPageCoureur     || 'https://defienfance.fr/faire-un-don/';
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
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
const NB_COUREURS_JOUE = Object.keys(DOSSARDS_JOUE_2026).length; // 556 coureurs Joué
const DOSSARDS_JOUE_2026_SET = new Set(Object.keys(DOSSARDS_JOUE_2026).map(Number));
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
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🎥 Mini-webinaire référents — mardi 26 mai 12h-12h30</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:12px">Rejoignez-nous <strong>mardi 26 mai de 12h à 12h30</strong> pour un mini-webinaire de 30 minutes dédié aux référents d'équipe. Vous aurez accès à toutes les infos pratiques sur la course et saurez exactement comment booster votre collecte de dons d'ici le 29 mai !</div>
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
<div style="font-size:.86rem;color:#3d1830;text-align:left;margin-bottom:8px">Si vous avez la moindre question, n'hésitez pas à m'appeler directement au <strong><a href="tel:0603021945" style="color:#fb0089">06 03 02 19 45</a></strong>.</div>
<div style="font-size:.84rem;color:#3d1830;font-style:italic;margin-bottom:8px;text-align:left">Merci pour votre incroyable engagement — rendez-vous vendredi sur la ligne de départ pour une magnifique course. <strong>Record à battre : 6 000 km parcourus par les coureurs d'Angers vendredi dernier et un peu plus de 35 000 € collectés</strong> (en intégrant les promesses de dons restants à valider) !</div>
<div style="font-size:.84rem;color:#fb0089;font-weight:700;margin-bottom:4px;text-align:left">Haut les cœurs,</div>
<div style="font-size:.82rem;color:#3d1830;text-align:left">Victor Vieilfault<br>Responsable du Défi Enfance · <a href="tel:0603021945" style="color:#fb0089">06 03 02 19 45</a></div>

</div><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></td></tr></table></div></td></tr></table></body></html>`;
}

// ── Template Merci Donateurs Joué 2026 (post-course)
function tplGroupeMerciDonateursJouePostCourse({ prenom, historiqueHtml, totalDons, nbDons }) {
  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07100.jpg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07318.jpg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/910b6a4cc1d78625a79201e5d4a46bc5c750adb6/enfanteau.jpg';
  const URL_CLASSEMENT = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const URL_DON        = 'https://defienfance.fr/faire-un-don/';
  const URL_IFI        = 'https://www.fondation-enfance.org/creer-ma-fondation/fondations-et-fonds-abrites/fondation-unis-pour-lenfance/';

  const blocHistorique = historiqueHtml
    ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">'
      + '<tr><td bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px">'
      + '<div style="font-size:10px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-family:Arial,sans-serif">&#10084;&#65039; Votre soutien au Défi Enfance de Joué</div>'
      + historiqueHtml
      + '<div style="font-size:14px;color:#3d1830;margin-top:12px;font-weight:600;font-family:Arial,sans-serif">Total : <span style="color:#fb0089">' + (totalDons > 0 ? totalDons.toFixed(2) + ' €' : 'voir ci-dessus') + '</span> — ' + nbDons + ' don(s)</div>'
      + '</td></tr></table>'
    : '';

  const blocIFI = '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">'
    + '<tr><td style="background:linear-gradient(135deg,#f0f7ff,#f5f0ff);border:2px solid #1a56db;border-radius:14px;padding:18px 24px;text-align:center">'
    + '<div style="font-size:10px;font-weight:700;color:#1a56db;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-family:Arial,sans-serif">&#127963;&#65039; Don IFI — soutenir le Défi Enfance avec votre IFI ?</div>'
    + '<p style="font-size:14px;color:#1a0a12;line-height:1.7;margin:0 0 14px;font-family:Arial,sans-serif">C\'est possible via la <strong>Fondation Unis pour l\'Enfance</strong>, sous égide de la Fondation pour l\'Enfance reconnue d\'utilité publique. Trois leviers&nbsp;: le Défi Enfance &middot; les lieux de vie aimants &middot; l\'insertion des jeunes majeurs.</p>'
    + '<a href="' + URL_IFI + '" style="display:inline-block;background:linear-gradient(135deg,#1a56db,#7c3aed);color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#127963;&#65039; Faire un don IFI</a>'
    + '</td></tr></table>';

  return '<!DOCTYPE html>'
    + '<html lang="fr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
    + '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="X-UA-Compatible" content="IE=edge">'
    + '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->'
    + '<style>body,table,td{font-family:Arial,sans-serif}a{color:#fb0089}</style>'
    + '</head>'
    + '<body style="margin:0;padding:0;background-color:#f5f0f5">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f0f5">'
    + '<tr><td align="center" style="padding:20px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">'

    // HEADER
    + '<tr><td align="center" valign="top" bgcolor="#fb0089" style="background-color:#fb0089;border-radius:16px 16px 0 0;padding:28px 32px">'
    + '<div style="font-size:11px;font-weight:700;color:#ffd6ec;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;font-family:Arial,sans-serif">&#127881; Défi Enfance &middot; Joué-lès-Tours 2026 &middot; 1ère édition</div>'
    + '<div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:8px;font-family:Arial,sans-serif">&#10084;&#65039; Merci ' + prenom + ' —<br>vous avez rendu cela possible !</div>'
    + '<div style="font-size:13px;color:#ffd6ec;font-family:Arial,sans-serif">29 mai 2026 &middot; Parc des Bretonnières &middot; Joué-lès-Tours</div>'
    + '</td></tr>'

    // INTRO
    + '<tr><td style="background-color:#ffffff;padding:24px 24px 8px">'
    + '<p style="font-size:15px;font-weight:700;color:#3d1830;margin:0 0 6px;font-family:Arial,sans-serif">Bonjour ' + prenom + ',</p>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 20px;font-family:Arial,sans-serif">'
    + 'La 1ère édition du Défi Enfance à Joué-lès-Tours est un <strong>succès</strong>. 3000 km parcourus, des dizaines d\'équipes, des pionniers qui ont tout donné sous 35°C. '
    + 'Et derrière chaque km couru, il y avait des personnes comme vous — <strong>artisans discrets mais essentiels de cette première en Touraine</strong>. Merci du fond du cœur.'
    + '</p></td></tr>'

    // PHOTOS
    + '<tr><td style="padding:0 24px 16px">'
    + '<img src="' + IMG1 + '" alt="Défi Enfance Joué 2026" width="552" style="width:100%;max-width:552px;display:block;border-radius:12px 12px 0 0;border:0">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="49%"><img src="' + IMG2 + '" alt="" width="272" style="width:100%;display:block;border-radius:0 0 0 12px;margin-top:4px;border:0"></td>'
    + '<td width="2%"></td>'
    + '<td width="49%"><img src="' + IMG3 + '" alt="" width="272" style="width:100%;display:block;border-radius:0 0 12px 0;margin-top:4px;border:0"></td>'
    + '</tr></table></td></tr>'

    // CHIFFRES CLÉS
    + '<tr><td style="padding:0 24px 16px">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px">'
    + '<tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:18px 20px;border-radius:14px">'
    + '<div style="font-size:10px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;text-align:center;font-family:Arial,sans-serif">&#127942; La 1ère édition en chiffres</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="33%" style="text-align:center">'
    + '<div style="font-size:30px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">3000</div>'
    + '<div style="font-size:11px;color:#ffd6ec;font-family:Arial,sans-serif">km parcourus</div>'
    + '</td>'
    + '<td width="33%" style="text-align:center">'
    + '<div style="font-size:30px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">430</div>'
    + '<div style="font-size:11px;color:#ffd6ec;font-family:Arial,sans-serif">coureurs classés</div>'
    + '</td>'
    + '<td width="33%" style="text-align:center">'
    + '<div style="font-size:30px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">25</div>'
    + '<div style="font-size:11px;color:#ffd6ec;font-family:Arial,sans-serif">équipes au classement</div>'
    + '</td>'
    + '</tr></table>'
    + '</td></tr></table></td></tr>'

    // CLASSEMENT
    + '<tr><td style="padding:0 24px 16px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<a href="' + URL_CLASSEMENT + '" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#127942; Voir le classement général Joué &amp; Angers</a>'
    + '</td></tr></table></td></tr>'

    // HISTORIQUE DONS
    + (blocHistorique ? '<tr><td style="padding:0 24px">' + blocHistorique + '</td></tr>' : '')

    // REDONNER
    + '<tr><td style="padding:0 24px 16px">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px">'
    + '<tr><td bgcolor="#f0fff8" style="background-color:#f0fff8;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px">'
    + '<div style="font-size:10px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-family:Arial,sans-serif">&#128640; La collecte continue jusqu\'au 15 juin !</div>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 14px;font-family:Arial,sans-serif">'
    + 'La course est terminée mais la collecte reste ouverte jusqu\'au <strong>15 juin</strong>. Si vous souhaitez redonner ou faire découvrir le Défi Enfance à vos proches, chaque don supplémentaire compte directement pour les enfants accompagnés par nos associations partenaires.'
    + '</p>'
    + '<a href="' + URL_DON + '" style="display:inline-block;background-color:#16a34a;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#10084; Faire un don supplémentaire</a>'
    + '</td></tr></table></td></tr>'

    // IFI
    + '<tr><td style="padding:0 24px">' + blocIFI + '</td></tr>'

    // MESSAGE FINAL
    + '<tr><td style="padding:0 24px 20px">'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 16px;font-family:Arial,sans-serif">'
    + 'Vous faites partie de ceux qui ont cru en ce projet avant tout le monde. Ensemble, nous avons posé les bases du Défi Enfance en Touraine au service de tout le secteur de l\'aide à l\'enfance. <strong>Tout commence !</strong> À très vite.'
    + '</p>'
    + '<div style="border-top:1px solid #f5dced;margin:16px 0"></div>'
    + '<p style="font-size:13px;color:#fb0089;font-weight:700;text-align:center;margin:0;font-family:Arial,sans-serif">&mdash; L\'équipe d\'organisation Défi Enfance</p>'
    + '</td></tr>'

    // FOOTER
    + '<tr><td align="center" bgcolor="#3d1830" style="background-color:#3d1830;padding:14px;border-radius:0 0 16px 16px">'
    + '<div style="font-size:13px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">DÉFI ENFANCE</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,.5);font-family:Arial,sans-serif">Générateur de victoires pour l\'enfance &middot; contact@defienfance.fr</div>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';
}


// ── Template Merci Supporters Joué 2026 (post-course)
function tplGroupeMerciSupportersJoue({ prenom }) {
  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07100.jpg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07318.jpg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/910b6a4cc1d78625a79201e5d4a46bc5c750adb6/enfanteau.jpg';
  const URL_CLASSEMENT = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const URL_DON        = 'https://defienfance.fr/faire-un-don/';

  return '<!DOCTYPE html>'
    + '<html lang="fr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
    + '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="X-UA-Compatible" content="IE=edge">'
    + '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->'
    + '<style>body,table,td{font-family:Arial,sans-serif}a{color:#fb0089}</style>'
    + '</head>'
    + '<body style="margin:0;padding:0;background-color:#f5f0f5">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f0f5">'
    + '<tr><td align="center" style="padding:20px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">'

    // HEADER
    + '<tr><td align="center" valign="top" bgcolor="#fb0089" style="background-color:#fb0089;border-radius:16px 16px 0 0;padding:28px 32px">'
    + '<div style="font-size:11px;font-weight:700;color:#ffd6ec;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;font-family:Arial,sans-serif">&#127881; Défi Enfance &middot; Joué-lès-Tours 2026 &middot; 1ère édition</div>'
    + '<div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:8px;font-family:Arial,sans-serif">&#127881; ' + prenom + ', vous étiez là —<br>c\'est pour ça que ça marche !</div>'
    + '<div style="font-size:13px;color:#ffd6ec;font-family:Arial,sans-serif">29 mai 2026 &middot; Parc des Bretonnières &middot; Joué-lès-Tours</div>'
    + '</td></tr>'

    // INTRO
    + '<tr><td style="background-color:#ffffff;padding:24px 24px 8px">'
    + '<p style="font-size:15px;font-weight:700;color:#3d1830;margin:0 0 6px;font-family:Arial,sans-serif">Bonjour ' + prenom + ',</p>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 20px;font-family:Arial,sans-serif">'
    + 'Vous avez été là. Dans les tribunes, le long des pistes, à encourager, à applaudir, à vibrer. <strong>Votre présence a compté</strong> — pas juste symboliquement, vraiment. '
    + 'Les coureurs vous ont vu, vous ont entendu. Cette 1ère édition du Défi Enfance à Joué-lès-Tours est un succès, et vous en êtes une pièce essentielle.'
    + '</p></td></tr>'

    // PHOTOS
    + '<tr><td style="padding:0 24px 16px">'
    + '<img src="' + IMG1 + '" alt="Défi Enfance Joué 2026" width="552" style="width:100%;max-width:552px;display:block;border-radius:12px 12px 0 0;border:0">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="49%"><img src="' + IMG2 + '" alt="" width="272" style="width:100%;display:block;border-radius:0 0 0 12px;margin-top:4px;border:0"></td>'
    + '<td width="2%"></td>'
    + '<td width="49%"><img src="' + IMG3 + '" alt="" width="272" style="width:100%;display:block;border-radius:0 0 12px 0;margin-top:4px;border:0"></td>'
    + '</tr></table></td></tr>'

    // CE QU'ON A FAIT ENSEMBLE
    + '<tr><td style="padding:0 24px 16px">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px">'
    + '<tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:18px 20px;border-radius:14px">'
    + '<div style="font-size:10px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;text-align:center;font-family:Arial,sans-serif">&#127942; Ce qu\'on a accompli ensemble</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="33%" style="text-align:center">'
    + '<div style="font-size:30px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">3000</div>'
    + '<div style="font-size:11px;color:#ffd6ec;font-family:Arial,sans-serif">km pour l\'enfance</div>'
    + '</td>'
    + '<td width="33%" style="text-align:center">'
    + '<div style="font-size:30px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">25</div>'
    + '<div style="font-size:11px;color:#ffd6ec;font-family:Arial,sans-serif">équipes en course</div>'
    + '</td>'
    + '<td width="33%" style="text-align:center">'
    + '<div style="font-size:30px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">1ère</div>'
    + '<div style="font-size:11px;color:#ffd6ec;font-family:Arial,sans-serif">édition en Touraine</div>'
    + '</td>'
    + '</tr></table>'
    + '</td></tr></table></td></tr>'

    // CLASSEMENT
    + '<tr><td style="padding:0 24px 16px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<a href="' + URL_CLASSEMENT + '" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#127942; Voir le classement général Joué &amp; Angers</a>'
    + '</td></tr></table></td></tr>'

    // INVITER À DONNER
    + '<tr><td style="padding:0 24px 16px">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px">'
    + '<tr><td bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 20px">'
    + '<div style="font-size:10px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-family:Arial,sans-serif">&#10084;&#65039; Transformez votre présence en soutien concret</div>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 8px;font-family:Arial,sans-serif">'
    + 'Vous avez soutenu les coureurs de vive voix. Vous pouvez maintenant <strong>prolonger ce soutien par un don</strong> — direct, en ligne, en quelques clics. '
    + 'La collecte est ouverte jusqu\'au <strong>15 juin</strong> et chaque euro compte pour les enfants accompagnés par nos associations partenaires.'
    + '</p>'
    + '<p style="font-size:13px;color:#888;margin:0 0 14px;font-family:Arial,sans-serif">Dans le module de don : <strong style="color:#fb0089">Défi Enfance Joué-lès-Tours</strong> &rsaquo; choisissez un coureur ou une équipe &rsaquo; ajoutez un mot si vous le souhaitez.</p>'
    + '<a href="' + URL_DON + '" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 26px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#10084; Faire un don pour l\'enfance</a>'
    + '</td></tr></table></td></tr>'

    // MESSAGE FINAL
    + '<tr><td style="padding:0 24px 20px">'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 16px;font-family:Arial,sans-serif">'
    + 'Avec Baptiste Bech, le responsable des bénévoles, et toute l\'équipe d\'organisation, nous vous remercions chaleureusement de votre présence et de votre enthousiasme. '
    + 'Ensemble, nous avons posé les bases du Défi Enfance en Touraine. <strong>Tout commence !</strong> À très vite.'
    + '</p>'
    + '<div style="border-top:1px solid #f5dced;margin:16px 0"></div>'
    + '<p style="font-size:13px;color:#fb0089;font-weight:700;text-align:center;margin:0;font-family:Arial,sans-serif">&mdash; L\'équipe d\'organisation Défi Enfance</p>'
    + '</td></tr>'

    // FOOTER
    + '<tr><td align="center" bgcolor="#3d1830" style="background-color:#3d1830;padding:14px;border-radius:0 0 16px 16px">'
    + '<div style="font-size:13px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">DÉFI ENFANCE</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,.5);font-family:Arial,sans-serif">Générateur de victoires pour l\'enfance &middot; contact@defienfance.fr</div>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';
}


// ── Template Merci Promettants Joué 2026
function tplGroupeMerciPromettantsJoue({ prenom, promesses }) {
  // promesses = [{ type: 'coureur'|'equipe', nom, montantKm, kmParcourus, kmReel, clTotal, clReel, montantDu, urlDon }]
  const totalDu = promesses.reduce((s, p) => s + (p.montantDu || 0), 0);

  const IMG1 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07100.jpg';
  const IMG2 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07318.jpg';
  const IMG3 = 'https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/910b6a4cc1d78625a79201e5d4a46bc5c750adb6/enfanteau.jpg';
  const URL_CLASSEMENT = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';

  let blocPromesses = '';
  promesses.forEach(function(p) {
    const isCoureur = p.type === 'coureur';
    const label = isCoureur ? p.nom : ('l\'équipe ' + p.nom);
    const emoji = isCoureur ? '🏃' : '🏆';
    const typeLabel = isCoureur ? 'Coureur parrainé' : 'Équipe parrainée';

    const montantAffiche = p.montantDu > 0
      ? '<strong style="color:#fb0089;font-size:18px;font-family:Arial,sans-serif">' + p.montantDu.toFixed(2) + ' €</strong>'
      : '<span style="color:#888;font-size:13px;font-family:Arial,sans-serif">km non encore saisis</span>';

    const clBlock = (isCoureur && p.clTotal > 0)
      ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 10px"><tr>'
        + '<td width="48%" style="text-align:center;background:#fff0f8;border-radius:8px;padding:8px 4px">'
        + '<div style="font-size:22px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">#' + p.clTotal + '</div>'
        + '<div style="font-size:10px;color:#fb0089;font-family:Arial,sans-serif">Classement km totaux</div>'
        + '<div style="font-size:12px;font-weight:700;color:#3d1830;font-family:Arial,sans-serif">' + p.kmParcourus + ' km</div>'
        + '</td><td width="4%"></td>'
        + '<td width="48%" style="text-align:center;background:#f0fff8;border-radius:8px;padding:8px 4px">'
        + '<div style="font-size:22px;font-weight:700;color:#0d9488;font-family:Arial,sans-serif">#' + p.clReel + '</div>'
        + '<div style="font-size:10px;color:#0d9488;font-family:Arial,sans-serif">Classement km r&eacute;els</div>'
        + '<div style="font-size:12px;font-weight:700;color:#3d1830;font-family:Arial,sans-serif">' + p.kmReel + ' km</div>'
        + '</td></tr></table>'
      : (p.kmParcourus > 0
          ? '<div style="font-size:13px;color:#3d1830;margin:8px 0 10px;font-family:Arial,sans-serif">&#127939; <strong>' + p.kmParcourus + ' km</strong> parcourus</div>'
          : '');

    blocPromesses += '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">'
      + '<tr><td style="background:#ffffff;border:2px solid rgba(251,0,137,0.25);border-radius:12px;padding:16px 18px">'
      + '<div style="font-size:10px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-family:Arial,sans-serif">' + emoji + ' ' + typeLabel + '</div>'
      + '<div style="font-size:15px;font-weight:700;color:#3d1830;margin-bottom:4px;font-family:Arial,sans-serif">' + p.nom + '</div>'
      + '<div style="font-size:13px;color:#3d1830;margin-bottom:2px;font-family:Arial,sans-serif">&#127881; <strong>' + p.montantKm + ' €/km</strong> promis</div>'
      + clBlock
      + '<div style="font-size:13px;color:#3d1830;margin-bottom:12px;font-family:Arial,sans-serif">&#128176; Don calcul&eacute; : ' + montantAffiche + '</div>'
      + '<a href="' + p.urlDon + '" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#10084;&#65039; Je concr&eacute;tise ma promesse pour ' + label + '</a>'
      + '</td></tr></table>';
  });

  const totalBlock = '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">'
    + '<tr><td align="center" bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px">'
    + '<div style="font-size:10px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;font-family:Arial,sans-serif">&#128176; Total de vos promesses</div>'
    + '<div style="font-size:40px;font-weight:700;color:#fb0089;line-height:1.2;font-family:Arial,sans-serif">'
    + (totalDu > 0 ? totalDu.toFixed(2) + ' &euro;' : '&Agrave; calculer')
    + '</div>'
    + '<div style="font-size:12px;color:#3d1830;margin-top:6px;font-family:Arial,sans-serif">Selon les km r&eacute;ellement parcourus</div>'
    + '</td></tr></table>';

  return '<!DOCTYPE html>'
    + '<html lang="fr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
    + '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="X-UA-Compatible" content="IE=edge">'
    + '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->'
    + '<style>body,table,td{font-family:Arial,sans-serif}a{color:#fb0089}</style>'
    + '</head>'
    + '<body style="margin:0;padding:0;background-color:#f5f0f5">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f0f5">'
    + '<tr><td align="center" style="padding:20px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">'

    // HEADER
    + '<tr><td align="center" valign="top" bgcolor="#fb0089" style="background-color:#fb0089;border-radius:16px 16px 0 0;padding:28px 32px">'
    + '<div style="font-size:11px;font-weight:700;color:#ffd6ec;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;font-family:Arial,sans-serif">&#127881; D&eacute;fi Enfance &middot; Jou&eacute;-l&egrave;s-Tours 2026 &middot; 1ère &eacute;dition</div>'
    + '<div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:8px;font-family:Arial,sans-serif">&#127937; 3000 km pour l\'enfance &mdash;<br>concrétisez votre promesse !</div>'
    + '<div style="font-size:13px;color:#ffd6ec;font-family:Arial,sans-serif">29 mai 2026 &middot; Parc des Bretonnières &middot; Joué-lès-Tours</div>'
    + '</td></tr>'

    // INTRO
    + '<tr><td style="background-color:#ffffff;padding:24px 24px 8px">'
    + '<p style="font-size:15px;font-weight:700;color:#3d1830;margin:0 0 6px;font-family:Arial,sans-serif">Bonjour ' + prenom + ',</p>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 16px;font-family:Arial,sans-serif">'
    + 'La 1ère édition du Défi Enfance à Joué-lès-Tours est un <strong>succès</strong> — 3000 km parcourus pour l\'enfance, des dizaines d\'équipes, des pionniers qui ont osé ! '
    + 'Vous avez promis un don au kilomètre pour soutenir nos coureurs. <strong>Il est temps de concrétiser cette belle promesse.</strong>'
    + '</p></td></tr>'

    // PHOTOS
    + '<tr><td style="padding:0 24px 16px">'
    + '<img src="' + IMG1 + '" alt="Défi Enfance Joué 2026" width="552" style="width:100%;max-width:552px;display:block;border-radius:12px 12px 0 0;border:0">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="49%"><img src="' + IMG2 + '" alt="" width="272" style="width:100%;display:block;border-radius:0 0 0 12px;margin-top:4px;border:0"></td>'
    + '<td width="2%"></td>'
    + '<td width="49%"><img src="' + IMG3 + '" alt="" width="272" style="width:100%;display:block;border-radius:0 0 12px 0;margin-top:4px;border:0"></td>'
    + '</tr></table></td></tr>'

    // TOTAL
    + '<tr><td style="padding:0 24px">' + totalBlock + '</td></tr>'

    // PROMESSES
    + '<tr><td style="padding:0 24px">'
    + '<div style="font-size:14px;font-weight:700;color:#3d1830;margin-bottom:12px;font-family:Arial,sans-serif">&#127941; Vos promesses &mdash; concrétisez-les maintenant !</div>'
    + blocPromesses
    + '</td></tr>'

    // CLASSEMENT
    + '<tr><td style="padding:0 24px 16px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<a href="' + URL_CLASSEMENT + '" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#127942; Voir le classement général Joué &amp; Angers</a>'
    + '</td></tr></table></td></tr>'

    // COLLECTE
    + '<tr><td style="padding:0 24px 16px">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px">'
    + '<tr><td bgcolor="#f0fff8" style="background-color:#f0fff8;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px">'
    + '<div style="font-size:10px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-family:Arial,sans-serif">&#128640; La collecte continue jusqu\'au 15 juin !</div>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 10px;font-family:Arial,sans-serif">'
    + 'Votre don compte directement pour les enfants soutenus par <strong>les associations parrainées</strong> par nos coureurs. La collecte reste ouverte jusqu\'au 15 juin — vos proches et réseaux peuvent encore donner !'
    + '</p>'
    + '<a href="https://defienfance.fr/faire-un-don/" style="display:inline-block;background-color:#16a34a;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#10084; Faire un don supplémentaire</a>'
    + '</td></tr></table></td></tr>'

    // DON SUPPLÉMENTAIRE
    + '<tr><td style="padding:0 24px 16px">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px">'
    + '<tr><td bgcolor="#fff5ef" style="background-color:#fff5ef;border:1px solid rgba(239,97,53,.3);border-radius:12px;padding:16px 20px">'
    + '<div style="font-size:10px;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-family:Arial,sans-serif">&#10024; Envie d\'aller encore plus loin ?</div>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 12px;font-family:Arial,sans-serif">'
    + 'Si l\'énergie de cette journée vous a touché, vous pouvez donner <strong>au-delà de votre promesse</strong> directement pour le coureur ou l\'équipe que vous parrainez. Chaque euro supplémentaire fait une vraie différence pour les enfants.'
    + '</p>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 14px;font-family:Arial,sans-serif">'
    + 'Dans le module de don, sélectionnez :<br>'
    + '<strong style="color:#ef6135">Défi Enfance Joué-lès-Tours</strong>'
    + ' &rsaquo; <strong style="color:#ef6135">votre coureur ou équipe</strong>'
    + ' &rsaquo; ajoutez si vous le souhaitez un <em>mot d\'encouragement</em>.'
    + '</p>'
    + '<a href="https://defienfance.fr/faire-un-don/" style="display:inline-block;background-color:#ef6135;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#128150; Faire un don pour mon coureur / mon &eacute;quipe</a>'
    + '</td></tr></table></td></tr>'

    // MESSAGE FINAL
    + '<tr><td style="padding:0 24px 20px">'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 16px;font-family:Arial,sans-serif">'
    + 'Un immense <strong>merci pour votre confiance et votre générosité</strong>. Votre promesse a donné de l\'élan à nos coureurs tout au long de la journée. Ensemble, nous posons les bases du Défi Enfance en Touraine. <strong>Tout commence !</strong>'
    + '</p>'
    + '<div style="border-top:1px solid #f5dced;margin:16px 0"></div>'
    + '<p style="font-size:13px;color:#fb0089;font-weight:700;text-align:center;margin:0;font-family:Arial,sans-serif">&mdash; L\'équipe d\'organisation Défi Enfance</p>'
    + '</td></tr>'

    // FOOTER
    + '<tr><td align="center" bgcolor="#3d1830" style="background-color:#3d1830;padding:14px;border-radius:0 0 16px 16px">'
    + '<div style="font-size:13px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">DÉFI ENFANCE</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,.5);font-family:Arial,sans-serif">Générateur de victoires pour l\'enfance &middot; contact@defienfance.fr</div>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';
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


function tplGroupeJ1JoueCoureurs({ prenom, nbJours, numeroDossard, urlPageCoureur, urlPromesseCoureur }) {
  const j = nbJours || 1;
  const jourLabel = j === 1 ? 'Demain' : `Dans ${j} jours`;
  const jourCourt = j === 1 ? 'demain' : `dans ${j} jours`;
  const urlDon  = urlPageCoureur     || 'https://defienfance.fr/faire-un-don/';
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const URL_DOSSARD = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const blocDossard = numeroDossard
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:16px 22px"><div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Votre numéro de dossard</div><div style="font-family:Arial,sans-serif;font-size:48px;color:#fb0089;font-weight:700;line-height:1.2">${numeroDossard}</div><div style="font-size:.75rem;color:#3d1830;margin-top:6px">À récupérer sur place dès 13h00</div><div style="margin-top:14px"><a href="${URL_DOSSARD}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🎽 Je retrouve mon dossard</a></div></td></tr></table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" style="padding:8px 0"><a href="${URL_DOSSARD}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🎽 Je retrouve mon dossard</a></td></tr></table>`

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .checklist-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830;text-align:left}
    .checklist-item:last-child{border-bottom:none}
    .rappel-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f5dced;font-size:.83rem;color:#3d1830;text-align:left}
    .rappel-item:last-child{border-bottom:none}
    .ep-inner{background:#fff;border-radius:10px;padding:20px 22px}
    .ep-objet-label{font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
    .ep-objet-val{font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:16px;border-bottom:1px solid #f5dced;padding-bottom:12px}
    .ep-body{font-size:.82rem;color:#3d1830;line-height:1.8;text-align:left}
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#fb0089" style="background-color:#fb0089;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#ffffff;margin:0 0 6px">🎽 ${jourLabel}, Joué court<br>pour l'enfance !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · Joué-lès-Tours · 29 mai 2026</p></td></tr></table>

<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">J-${j} avant le grand jour — avec les fortes chaleurs on vous a concocté une course gamifiée qui garde tout son piment mais qui va apporter beaucoup de fraîcheur ! <strong>On est fiers de vous avoir parmi nous.</strong> Vendredi, vous allez courir — mais aussi <strong>jouer, rire et peut-être même gagner des km sans transpirer !</strong> 🌊</div>
${blocDossard}

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td bgcolor="#e0f2fe" style="background-color:#e0f2fe;border:2px solid #0284c7;border-radius:14px;padding:18px 22px">
  <div style="font-size:.75rem;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;text-align:left">🌡️ 35°C prévu vendredi — on s'adapte !</div>
  <div style="font-size:.85rem;color:#1e3a5f;line-height:1.7;margin-bottom:14px;text-align:left">Il va faire <strong>très chaud vendredi</strong> (35°C+). Pas question d'annuler — on a tout réorganisé pour que vous courriez <strong>frais, en sécurité et en s'amusant</strong> :</div>
    🌳 <strong>100% sous les arbres</strong> — le village et le tracé ont été déplacés au cœur du Parc des Bretonnières, entièrement à l'ombre<br>
    ⏱️ <strong>1h30 de course</strong> au lieu de 2h — on préserve votre énergie<br>
    💦 <strong>Une tonne d'eau</strong> pour arroser les participants — vous serez trempés, rafraîchis, heureux<br>
    🚑 <strong>Poste de secours</strong> assuré par les secouristes de la <strong>Croix Blanche 37</strong><br>
    📍 <strong>RDV côté Espace Malraux</strong> — entre le lac et l'Espace Malraux, au niveau de la passerelle qui traverse le lac (entre l'accrobranche GADAWI PARK et les toilettes publiques)
  </div>
</td></tr></table>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">🎮 La course gamifiée — gagner des km sans se griller !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">On comptabilise toujours vos km en live — mais on ajoute des <strong>épreuves bonus</strong> pour gagner des km même quand il fait trop chaud pour sprinter :</div>
  <div style="font-size:.83rem;color:#3d1830;line-height:1.9;text-align:left">
    🤜 <strong>Le Dos à Dos</strong> — 400m dos à dos, bras entrelacés → <strong>+2,5 km 🥇</strong><br>
    🧠 <strong>Le Tour Aveugle</strong> — 400m yeux bandés, guidé par un coéquipier → <strong>+2 km</strong><br>
    👣 <strong>Les Siamois des chevilles</strong> — 400m chevilles attachées → <strong>+1,5 km</strong><br>
    🎯 <strong>Le Sniper du Radar</strong> — viser une vitesse au radar à ±0,2 km/h → <strong>+1 km</strong><br>
    🦀 <strong>Le Tour du Crabe</strong> — 400m de côté → <strong>+1 km</strong><br>
    🪣 <strong>Le Relais Éponge</strong> — remplir un seau à 75% en 4 A/R (et se faire arroser !) → <strong>+0,75 km</strong><br>
    🧊 <strong>Le Défi Glace</strong> — 200m marche avec un glaçon en main → <strong>+0,5 km</strong><br>
    <span style="font-size:.78rem;color:#888;font-style:italic">...et 6 autres épreuves le jour J !</span>
  </div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,0.25);border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">📌 Programme du vendredi 29 mai</div>
  <div class="rappel-item"><span>📍</span><div>Parc des Bretonnières — côté Espace Malraux, au niveau de la passerelle (entre GADAWI PARK et les toilettes)</div></div>
  <div class="rappel-item"><span>🕐</span><div><strong>13h00</strong> — Ouverture du village &amp; récupération des dossards</div></div>
  <div class="rappel-item"><span>🎤</span><div><strong>13h45</strong> — Discours officiels</div></div>
  <div class="rappel-item"><span>🏁</span><div><strong>14h30</strong> — Départ de la course (1h30 !)</div></div>
  <div class="rappel-item"><span>🍰</span><div><strong>16h00</strong> — Goûter offert à tous</div></div>
  <div class="rappel-item"><span>🏆</span><div><strong>16h30</strong> — Remise des prix</div></div>
  <div class="rappel-item"><span>📊</span><div><strong>Lundi 1er juin, 18h max</strong> — Résultats disponibles en ligne</div></div>
</div>

<div class="card" style="margin-bottom:20px;text-align:left">
  <h3>✅ Votre check-list chaleur</h3>
  <div class="checklist-item"><span>👕</span><div>Tenue légère + T-Shirt de votre organisation</div></div>
  <div class="checklist-item"><span>🕶️</span><div>Lunettes de soleil &amp; casquette</div></div>
  <div class="checklist-item"><span>🧴</span><div>Crème solaire (il y aura du soleil entre les arbres !)</div></div>
  <div class="checklist-item"><span>💧</span><div>Bouteille d'eau — et préparez-vous à être arrosés 💦</div></div>
  <div class="checklist-item"><span>👟</span><div>Chaussures de running (le terrain est stable)</div></div>
  <div class="checklist-item"><span>📱</span><div>Tél/CB pour faire des dons en live</div></div>
</div>

<div style="background:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.78rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">🎉 Embarquez votre entourage !</div>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7">Venez avec vos <strong>mascottes</strong>, les <strong>T-Shirts de vos organisations</strong> — vos proches peuvent s'inscrire comme supporters ! Plus on est nombreux sous les arbres, plus c'est festif. 🌳🎊</div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fdf5ff);border:1.5px solid rgba(251,0,137,0.15);border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💬 Un dernier élan ce soir ?</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Partagez votre page de collecte ce soir — voici un message prêt à copier-coller :</div>
  <div class="ep-inner">
    <div class="ep-objet-label">Objet</div>
    <div class="ep-objet-val">Je cours ${jourCourt} pour l'enfance à Joué — et ça va être rafraîchissant ! 🌊🏃</div>
    <div class="ep-body">
      <p>Bonjour [Prénom],</p>
      <p>${jourLabel} je cours pour le <strong>Défi Enfance à Joué-lès-Tours</strong> sous les arbres du Parc des Bretonnières ! Une course gamifiée avec des épreuves rafraîchissantes, une tonne d'eau pour nous arroser, et 1h30 de dépassement de soi pour l'enfance.</p>
      <p>Le Défi Enfance est une <strong>caisse de résonance</strong> pour faire retentir haut et fort que <strong>l'enfance est une priorité nationale.</strong></p>
      <p>Tu peux soutenir mon élan :<br>👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don</a><br>👉 <a href="${urlProm}" style="color:#7c3aed;font-weight:600">Promettre un don au km</a></p>
      <div style="background-color:#fff0f8;border-left:3px solid #fb0089;padding:10px 14px;border-radius:0 8px 8px 0;margin:12px 0;font-size:.8rem">💡 <strong>Ton don est défiscalisé à hauteur de 66%.</strong> Un don de 50€ ne te coûte réellement que <strong>17€</strong> après réduction d'impôt.</div>
    </div>
  </div>
</div>

${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">À vendredi sous les arbres — et sous l'eau ! 💦🏃</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}


// ── Template Jour J Joué — Coureurs
function tplGroupeJourJJoueCoureurs({ prenom, numeroDossard, urlPageCoureur, urlPromesseCoureur }) {
  const URL_DOSSARD = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const urlDon  = urlPageCoureur     || 'https://defienfance.fr/faire-un-don/';
  const urlProm = urlPromesseCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const blocDossard = numeroDossard
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:16px 22px"><div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Votre numéro de dossard</div><div style="font-family:Arial,sans-serif;font-size:56px;color:#fb0089;font-weight:700;line-height:1.1">${numeroDossard}</div><div style="font-size:.75rem;color:#3d1830;margin-top:6px">À récupérer sur place dès 13h00</div><div style="margin-top:14px"><a href="${URL_DOSSARD}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🎽 Je retrouve mon dossard</a></div></td></tr></table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" style="padding:8px 0"><a href="${URL_DOSSARD}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🎽 Je retrouve mon dossard</a></td></tr></table>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS_COMMUN}</style></head><body style="margin:0;padding:0;background:#f5f0f5">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table width="100%" style="max-width:600px;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(61,24,48,.12)">

<!-- HEADER -->
<tr><td style="background:linear-gradient(135deg,#fb0089,#ef6135);padding:28px 32px;text-align:center">
  <div style="font-size:.72rem;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px">🎽 Défi Enfance · Joué-lès-Tours · 29 mai 2026</div>
  <h1 style="font-family:Arial,sans-serif;font-size:1.4rem;font-weight:700;color:#fff;margin:0 0 6px">🏁 C'est aujourd'hui !<br>On vous attend avec impatience !</h1>
  <p style="font-size:.78rem;color:rgba(255,255,255,.8);margin:0">Parc des Bretonnières · Côté Espace Malraux · 13h00</p>
</td></tr>

<!-- BODY -->
<tr><td style="background:#fff;padding:24px 28px">

  <div style="font-size:.9rem;font-weight:600;color:#3d1830;margin-bottom:10px;text-align:left">Bonjour ${prenom} 👋</div>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left"><strong>C'est le grand jour !</strong> Toute l'équipe du Défi Enfance vous attend avec beaucoup d'enthousiasme. Vous allez courir, jouer, rire — et faire quelque chose de grand pour l'enfance. 🌟</div>

  ${blocDossard}

  <!-- Chaleur -->
  <div style="background:#e0f2fe;border:2px solid #0284c7;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🌡️ 35°C aujourd'hui — on a tout prévu !</div>
    <div style="font-size:.83rem;color:#1e3a5f;line-height:1.9">
      🌳 <strong>100% sous les arbres</strong> — Parc des Bretonnières<br>
      ⏱️ <strong>1h30 de course</strong> — départ 14h30<br>
      💦 <strong>Une tonne d'eau</strong> pour vous arroser tout au long de la course<br>
      🚑 <strong>Poste de secours</strong> Croix Blanche 37 sur place<br>
      📍 <strong>RDV côté Espace Malraux</strong> dès 13h00
    </div>
  </div>

  <!-- Gamification -->
  <div style="background:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🎮 13 épreuves pour gagner des km autrement !</div>
    <div style="font-size:.83rem;color:#3d1830;line-height:1.9">
      🤜 <strong>Le Dos à Dos</strong> — 400m dos à dos → <strong style="color:#fb0089">+2,5 km 🥇</strong><br>
      🧠 <strong>Le Tour Aveugle</strong> — yeux bandés, guidé → <strong style="color:#fb0089">+2 km</strong><br>
      👣 <strong>Les Siamois des chevilles</strong> → <strong style="color:#fb0089">+1,5 km</strong><br>
      🎯 <strong>Le Sniper du Radar</strong> → <strong style="color:#fb0089">+1 km</strong><br>
      🦀 <strong>Le Tour du Crabe</strong> → <strong style="color:#fb0089">+1 km</strong><br>
      🪣 <strong>Le Relais Éponge</strong> → <strong style="color:#fb0089">+0,75 km</strong> 💦<br>
      🧊 <strong>Le Défi Glace</strong> → <strong style="color:#fb0089">+0,5 km</strong><br>
      <span style="font-size:.78rem;color:#888;font-style:italic">...et 6 autres surprises sur place !</span>
    </div>
  </div>

  <!-- Programme -->
  <div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,.2);border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">📌 Programme du jour</div>
    <div style="font-size:.83rem;color:#3d1830;line-height:2">
      🕐 <strong>13h00</strong> — Ouverture du village &amp; récupération des dossards<br>
      🎤 <strong>13h45</strong> — Discours officiels<br>
      🏁 <strong>14h30</strong> — Départ de la course !<br>
      🍰 <strong>16h00</strong> — Goûter offert à tous<br>
      🏆 <strong>16h30</strong> — Remise des prix
    </div>
  </div>

  <!-- Venez accompagnés -->
  <div style="background:#f0fff5;border:1.5px solid rgba(22,163,74,.3);border-radius:14px;padding:16px 20px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🎉 Venez accompagnés !</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.7">Amenez vos <strong>supporters, famille, collègues</strong> — plus on est nombreux sous les arbres, plus c'est festif ! Vos proches peuvent s'inscrire comme supporters sur place. Et s'ils veulent soutenir votre collecte :<br><br>
    <a href="${urlDon}" style="display:inline-block;background-color:#fb0089;color:#fff;text-decoration:none;padding:8px 18px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif;margin-right:6px">❤️ Faire un don</a>
    <a href="${urlProm}" style="display:inline-block;background-color:#7c3aed;color:#fff;text-decoration:none;padding:8px 18px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🏅 Promettre au km</a>
    </div>
  </div>

  <!-- Checklist -->
  <div style="background:#f9f7ff;border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
    <div style="font-size:.75rem;font-weight:700;color:#3d1830;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">✅ Checklist du jour</div>
    <div style="font-size:.83rem;color:#3d1830;line-height:1.9">
      👕 Tenue légère + T-shirt de votre organisation<br>
      🕶️ Lunettes de soleil &amp; casquette<br>
      🧴 Crème solaire<br>
      💧 Bouteille d'eau — et préparez-vous à être arrosés !<br>
      📱 Téléphone chargé pour partager les moments<br>
      🎉 Beaucoup d'énergie et le sourire !
    </div>
  </div>

  <div style="border-top:1px solid #f5dced;margin:16px 0"></div>
  <div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">À tout à l'heure sous les arbres — et sous l'eau ! 💦🏃🌳</div>
  <div style="font-size:.8rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>

</td></tr>
<tr><td style="background:#3d1830;padding:14px;text-align:center;border-radius:0 0 16px 16px">
  <div style="font-size:.8rem;font-weight:700;color:#fb0089">DÉFI ENFANCE</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div>
</td></tr>
</table></td></tr></table>
</body></html>`;
}


// ── Template Merci Coureurs Joué 2026
function tplGroupeMerciCoureurJoue({ prenom, nomComplet, nomEquipe, nomAsso, numeroDossard, clTotal, clReel, kmTotal, kmReel, kmBonus, clEquipeTotal, clEquipeReel, kmEquipeTotal, kmEquipeReel, urlPageCoureur, urlDon }) {
  urlPageCoureur = urlPageCoureur || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/';
  urlDon = urlDon || 'https://defienfance.fr/faire-un-don/';
  const urlClassement = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const hasBonus = kmBonus > 0;
  const hasEquipe = nomEquipe && nomEquipe !== 'je cours solo' && clEquipeTotal;
  const hasCl = clTotal > 0;
  const medal = clTotal === 1 ? '🥇' : clTotal === 2 ? '🥈' : clTotal === 3 ? '🥉' : clTotal <= 10 ? '🏅' : '🎽';

  let blocEquipe = '';
  if (hasEquipe) {
    blocEquipe = '<tr><td style="padding:0 24px 16px">'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fff5;border:1px solid #bbf7d0;border-radius:12px">'
      + '<tr><td style="padding:14px 18px">'
      + '<div style="font-size:11px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-family:Arial,sans-serif">🏳️ Classement équipe &mdash; ' + nomEquipe + '</div>'
      + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
      + '<td width="50%" style="text-align:center;background:#ffffff;border-radius:8px;padding:10px 6px">'
      + '<div style="font-size:28px;font-weight:700;color:#16a34a;font-family:Arial,sans-serif">#' + clEquipeTotal + '</div>'
      + '<div style="font-size:11px;color:#16a34a;font-weight:600;font-family:Arial,sans-serif">Classement km totaux</div>'
      + '<div style="font-size:13px;font-weight:700;color:#1a3a1a;margin-top:4px;font-family:Arial,sans-serif">' + kmEquipeTotal + ' km</div>'
      + '</td><td width="4"></td>'
      + '<td width="50%" style="text-align:center;background:#ffffff;border-radius:8px;padding:10px 6px">'
      + '<div style="font-size:28px;font-weight:700;color:#0d9488;font-family:Arial,sans-serif">#' + clEquipeReel + '</div>'
      + '<div style="font-size:11px;color:#0d9488;font-weight:600;font-family:Arial,sans-serif">Classement km r&eacute;els</div>'
      + '<div style="font-size:13px;font-weight:700;color:#1a3a1a;margin-top:4px;font-family:Arial,sans-serif">' + kmEquipeReel + ' km r&eacute;els</div>'
      + '</td></tr></table>'
      + '</td></tr></table></td></tr>';
  }

  let blocBonus = '';
  if (hasBonus) {
    blocBonus = '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>'
      + '<td style="background:#fff5ef;border-radius:8px;padding:8px 12px;text-align:center;font-size:12px;color:#3d1830;font-family:Arial,sans-serif">'
      + '&#127918; &Eacute;preuves gamifi&eacute;es : <strong style="color:#ef6135">+' + kmBonus + ' km bonus</strong> gagnés !</td></tr></table>';
  }

  let bonusDetail = '';
  if (hasBonus) {
    bonusDetail = '<div style="font-size:11px;color:#888;font-family:Arial,sans-serif">' + kmReel + ' r&eacute;els + ' + kmBonus + ' bonus &#127918;</div>';
  }

  let blocClassement = '';
  if (hasCl) {
    blocClassement = '<tr><td style="padding:0 24px 16px">'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff0f8;border:2px solid #fb0089;border-radius:14px">'
      + '<tr><td style="padding:18px 20px">'
      + '<div style="font-size:11px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-family:Arial,sans-serif">🏅 Votre classement individuel &mdash; Dossard ' + numeroDossard + '</div>'
      + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
      + '<td width="50%" style="text-align:center;background:#ffffff;border-radius:10px;padding:12px 6px">'
      + '<div style="font-size:36px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">#' + clTotal + '</div>'
      + '<div style="font-size:11px;color:#fb0089;font-weight:600;font-family:Arial,sans-serif">Classement km totaux</div>'
      + '<div style="font-size:14px;font-weight:700;color:#3d1830;margin-top:4px;font-family:Arial,sans-serif">' + kmTotal + ' km</div>'
      + bonusDetail
      + '</td><td width="4"></td>'
      + '<td width="50%" style="text-align:center;background:#ffffff;border-radius:10px;padding:12px 6px">'
      + '<div style="font-size:36px;font-weight:700;color:#0d9488;font-family:Arial,sans-serif">#' + clReel + '</div>'
      + '<div style="font-size:11px;color:#0d9488;font-weight:600;font-family:Arial,sans-serif">Classement km r&eacute;els</div>'
      + '<div style="font-size:14px;font-weight:700;color:#3d1830;margin-top:4px;font-family:Arial,sans-serif">' + kmReel + ' km</div>'
      + '</td></tr></table>'
      + blocBonus
      + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr><td align="center">'
      + '<a href="' + urlClassement + '" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:12px;font-family:Arial,sans-serif">&#127942; Voir le classement général Joué &amp; Angers</a>'
      + '</td></tr></table>'
      + '</td></tr></table></td></tr>';
  }

  const html = '<!DOCTYPE html>'
    + '<html lang="fr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
    + '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="X-UA-Compatible" content="IE=edge">'
    + '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->'
    + '<style>body,table,td{font-family:Arial,sans-serif}a{color:#fb0089}</style>'
    + '</head>'
    + '<body style="margin:0;padding:0;background-color:#f5f0f5">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f0f5">'
    + '<tr><td align="center" style="padding:20px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">'

    // HEADER - fond solide pour Outlook
    + '<tr><td align="center" valign="top" bgcolor="#fb0089" style="background-color:#fb0089;border-radius:16px 16px 0 0;padding:28px 32px">'
    + '<div style="font-size:11px;font-weight:700;color:#ffd6ec;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;font-family:Arial,sans-serif">&#127881; D&eacute;fi Enfance &middot; Joué-lès-Tours 2026 &middot; 1ère édition</div>'
    + '<div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:8px;font-family:Arial,sans-serif">' + medal + ' Merci ' + prenom + ' &mdash;<br>vous avez &eacute;t&eacute; incroyable !</div>'
    + '<div style="font-size:13px;color:#ffd6ec;font-family:Arial,sans-serif">29 mai 2026 &middot; Parc des Bretonnières &middot; Joué-lès-Tours</div>'
    + '</td></tr>'

    // INTRO
    + '<tr><td style="background-color:#ffffff;padding:24px 24px 8px">'
    + '<p style="font-size:15px;font-weight:700;color:#3d1830;margin:0 0 6px;font-family:Arial,sans-serif">Bonjour ' + prenom + ',</p>'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 20px;font-family:Arial,sans-serif">'
    + 'La 1ère édition du Défi Enfance à Joué-lès-Tours est un <strong>succès</strong> — et vous en êtes l\'un des artisans. En choisissant de courir, vous avez rejoint les <strong>pionniers du Défi Enfance à Joué-lès-Tours</strong>. Merci du fond du cœur.'
    + '</p></td></tr>'

    // PHOTOS
    + '<tr><td style="padding:0 24px 16px">'
    + '<img src="https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07100.jpg" alt="Défi Enfance Joué 2026" width="552" style="width:100%;max-width:552px;display:block;border-radius:12px 12px 0 0;border:0">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="49%"><img src="https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/main/DSC07318.jpg" alt="" width="272" style="width:100%;display:block;border-radius:0 0 0 12px;margin-top:4px;border:0"></td>'
    + '<td width="2%"></td>'
    + '<td width="49%"><img src="https://raw.githubusercontent.com/upe-bot/defi-enfance-notifications/910b6a4cc1d78625a79201e5d4a46bc5c750adb6/enfanteau.jpg" alt="" width="272" style="width:100%;display:block;border-radius:0 0 12px 0;margin-top:4px;border:0"></td>'
    + '</tr></table></td></tr>'

    // CLASSEMENT INDIVIDUEL
    + blocClassement

    // CLASSEMENT EQUIPE
    + blocEquipe

    // COLLECTE
    + '<tr><td style="padding:0 24px 16px">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px">'
    + '<tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:18px 20px;border-radius:14px">'
    + '<div style="font-size:11px;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-family:Arial,sans-serif">&#10084;&#65039; La collecte de dons continue jusqu\'au 15 juin !</div>'
    + (nomAsso ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px"><tr>'
      + '<td width="48%" style="background-color:rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;text-align:center">'
      + '<div style="font-size:11px;color:rgba(255,255,255,.6);font-family:Arial,sans-serif;margin-bottom:4px">50% pour</div>'
      + '<div style="font-size:13px;font-weight:700;color:#ffd6ec;font-family:Arial,sans-serif">' + nomAsso + '</div>'
      + '<div style="font-size:11px;color:rgba(255,255,255,.6);font-family:Arial,sans-serif;margin-top:2px">l\'association que vous avez choisie</div>'
      + '</td><td width="4%"></td>'
      + '<td width="48%" style="background-color:rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;text-align:center">'
      + '<div style="font-size:11px;color:rgba(255,255,255,.6);font-family:Arial,sans-serif;margin-bottom:4px">50% pour</div>'
      + '<div style="font-size:13px;font-weight:700;color:#ffd6ec;font-family:Arial,sans-serif">le Plaidoyer Défi Enfance</div>'
      + '<div style="font-size:11px;color:rgba(255,255,255,.6);font-family:Arial,sans-serif;margin-top:2px">financement du mouvement national</div>'
      + '</td></tr></table>' : '')
    + '<p style="font-size:14px;color:#ffffff;line-height:1.75;margin:0 0 6px;font-family:Arial,sans-serif">'
    + 'La course est terminée mais <strong style="color:#fb0089">la collecte est ouverte jusqu\'au 15 juin</strong>. C\'est uniquement grâce aux dons de vos proches et de vos réseaux professionnels que vous pouvez soutenir concrètement <strong style="color:#ffd6ec">l\'association que vous avez choisie de parrainer</strong> lors de votre inscription.'
    + '</p>'
    + '<p style="font-size:14px;color:#ffffff;line-height:1.75;margin:0 0 14px;font-family:Arial,sans-serif">'
    + 'Partagez votre page de collecte, relancez vos contacts — chaque don compte directement pour votre asso !'
    + '</p>'
    + '<table cellpadding="0" cellspacing="0"><tr>'
    + '<td style="padding-right:8px"><a href="' + urlPageCoureur + '" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#127939; Ma page de collecte</a></td>'
    + '<td><a href="' + urlDon + '" style="display:inline-block;background-color:#ffffff;color:#3d1830;text-decoration:none;padding:10px 20px;border-radius:99px;font-weight:700;font-size:13px;font-family:Arial,sans-serif">&#10084; Faire un don</a></td>'
    + '</tr></table>'
    + '</td></tr></table></td></tr>'

    // MESSAGE FINAL
    + '<tr><td style="padding:0 24px 20px">'
    + '<p style="font-size:14px;color:#3d1830;line-height:1.75;margin:0 0 16px;font-family:Arial,sans-serif">'
    + 'Vous faites partie de ceux qui ont osé courir pour l\'enfance avec enthousiasme, joie et simplicité. Avec Baptiste Bech, le responsable des bénévoles et toute l\'équipe d\'organisation, nous vous remercions infiniment pour votre participation. Ensemble, nous avons posé les bases du Défi Enfance en Touraine au service de tout le secteur de l\'aide à l\'enfance. <strong>Tout commence !</strong> À très vite.'
    + '</p>'
    + '<div style="border-top:1px solid #f5dced;margin:16px 0"></div>'
    + '<p style="font-size:13px;color:#fb0089;font-weight:700;text-align:center;margin:0;font-family:Arial,sans-serif">&mdash; L\'équipe d\'organisation Défi Enfance</p>'
    + '</td></tr>'

    // FOOTER
    + '<tr><td align="center" bgcolor="#3d1830" style="background-color:#3d1830;padding:14px;border-radius:0 0 16px 16px">'
    + '<div style="font-size:13px;font-weight:700;color:#fb0089;font-family:Arial,sans-serif">DÉFI ENFANCE</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,.5);font-family:Arial,sans-serif">Générateur de victoires pour l\'enfance &middot; contact@defienfance.fr</div>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';

  return html;
}


function tplGroupeJ1JoueReferents({ prenom, nomEquipe, urlPromesseEquipe, urlPageEquipe }) {
  const urlProm = urlPromesseEquipe || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  const urlPage = urlPageEquipe    || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=teams&de_event=all';
  const URL_DOSSARD = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}
    .rappel-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f5dced;font-size:.83rem;color:#3d1830;text-align:left}
    .rappel-item:last-child{border-bottom:none}
    .action-item{display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830;text-align:left}
    .action-item:last-child{border-bottom:none}
    .action-num{width:26px;height:26px;border-radius:50%;background-color:#fb0089;color:#fff;font-weight:700;font-size:.76rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  </style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">

<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#fb0089" style="background-color:#fb0089;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#ffffff;margin:0 0 6px">🏆 Référents, demain<br>votre équipe entre en scène !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · Joué-lès-Tours · 29 mai 2026</p></td></tr></table>

<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Chers référents d'équipe, demain c'est le grand jour pour <strong>${nomEquipe || 'votre équipe'}</strong> ! Voici tout ce qu'il faut savoir pour mobiliser vos coureurs et arriver prêts.</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td bgcolor="#e0f2fe" style="background-color:#e0f2fe;border:2px solid #0284c7;border-radius:14px;padding:18px 22px">
  <div style="font-size:.75rem;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;text-align:left">🌡️ 35°C — on a tout adapté !</div>
  <div style="font-size:.85rem;color:#1e3a5f;line-height:1.7;text-align:left">
    🌳 <strong>100% sous les arbres</strong> — village et tracé déplacés au cœur du parc<br>
    ⏱️ <strong>1h30 de course</strong> au lieu de 2h<br>
    💦 <strong>Une tonne d'eau</strong> pour arroser tout le monde<br>
    🚑 <strong>Poste de secours Croix Blanche 37</strong> sur place<br>
    📍 <strong>RDV côté Espace Malraux</strong> — passerelle entre GADAWI PARK et les toilettes
  </div>
</td></tr></table>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">🎮 La course gamifiée — expliquez-le à vos coureurs !</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:12px">Les km s'accumulent toujours en live — mais des <strong>épreuves bonus</strong> permettent d'en gagner sans s'épuiser :</div>
  <div style="font-size:.83rem;color:#3d1830;line-height:1.9">
    🤜 <strong>Le Dos à Dos</strong> — dos à dos, bras entrelacés → <strong>+2,5 km 🥇</strong><br>
    🧠 <strong>Le Tour Aveugle</strong> — yeux bandés, guidé → <strong>+2 km</strong><br>
    👣 <strong>Les Siamois des chevilles</strong> → <strong>+1,5 km</strong><br>
    🎯 <strong>Le Sniper du Radar</strong> → <strong>+1 km</strong><br>
    🦀 <strong>Le Tour du Crabe</strong> → <strong>+1 km</strong><br>
    🪣 <strong>Le Relais Éponge</strong> → <strong>+0,75 km</strong> 💦<br>
    🧊 <strong>Le Défi Glace</strong> → <strong>+0,5 km</strong>
  </div>
  <div style="font-size:.78rem;color:#888;font-style:italic;margin-top:8px">Stratégie d'équipe : combinez épreuves et tours classiques pour maximiser vos km collectifs !</div>
</div>

<div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,0.25);border-radius:14px;padding:18px 22px;margin-bottom:20px">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">📌 Programme du vendredi 29 mai</div>
  <div class="rappel-item"><span>📍</span><div>Parc des Bretonnières — côté Espace Malraux, passerelle sur le lac (entre GADAWI PARK et les toilettes)</div></div>
  <div class="rappel-item"><span>🕐</span><div><strong>13h00</strong> — Ouverture du village &amp; récupération des dossards</div></div>
  <div class="rappel-item"><span>🎤</span><div><strong>13h45</strong> — Discours officiels</div></div>
  <div class="rappel-item"><span>🏁</span><div><strong>14h30</strong> — Départ de la course (1h30)</div></div>
  <div class="rappel-item"><span>🍰</span><div><strong>16h00</strong> — Goûter offert à tous</div></div>
  <div class="rappel-item"><span>🏆</span><div><strong>16h30</strong> — Remise des prix</div></div>
  <div class="rappel-item"><span>📊</span><div><strong>Lundi 1er juin, 18h max</strong> — Résultats en ligne</div></div>
</div>

<div class="card" style="margin-bottom:20px">
  <h3 style="text-align:left">🚀 Vos 3 actions de référent ce soir</h3>
  <div class="action-item">
    <div class="action-num">1</div>
    <div><strong>Partagez les dossards</strong> à vos coureurs<br><a href="${URL_DOSSARD}" style="color:#fb0089;font-size:.78rem">Retrouver les dossards de votre équipe →</a></div>
  </div>
  <div class="action-item">
    <div class="action-num">2</div>
    <div><strong>Expliquez la course gamifiée</strong> — briefez vos coureurs sur les épreuves bonus pour maximiser les km de l'équipe</div>
  </div>
  <div class="action-item">
    <div class="action-num">3</div>
    <div><strong>Relancez les promesses de don</strong> — dernier soir pour déclencher des engagements avant la course<br><a href="${urlProm}" style="color:#7c3aed;font-size:.78rem">Page promesse de don de votre équipe →</a></div>
  </div>
</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
  <td align="center" style="padding:4px"><a href="${URL_DOSSARD}" style="display:inline-block;background-color:#3d1830;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">🎽 Dossards de mon équipe</a></td>
  <td align="center" style="padding:4px"><a href="${urlPage}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">🏆 Page de mon équipe</a></td>
</tr></table>

<div style="font-size:.85rem;color:#3d1830;text-align:left;margin-bottom:20px">Questions ? Contactez Victor directement au <strong><a href="tel:0603021945" style="color:#fb0089">06 03 02 19 45</a></strong>.</div>

${BLOC_RECUS_FISCAUX}${BLOC_IFI}
<div class="divider"></div>
<div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">À demain sous les arbres — et sous l'eau ! 💦🏆</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}

// ── Template J-1 Joué — Donateurs & Promettants
function tplGroupeJ1JoueDonateurs({ prenom, urlDon, urlProm }) {
  urlDon  = urlDon  || 'https://defienfance.fr/faire-un-don/';
  urlProm = urlProm || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS_COMMUN}</style></head><body style="margin:0;padding:0;background:#f5f0f5">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table width="100%" style="max-width:600px;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(61,24,48,.12)">

<!-- HEADER -->
<tr><td style="background:linear-gradient(135deg,#fb0089,#ef6135);padding:28px 32px;text-align:center">
  <div style="font-size:.72rem;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px">🤝 Défi Enfance · Joué-lès-Tours 2026</div>
  <h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#fff;margin:0 0 6px">❤️ Vendredi, votre soutien<br>court avec eux !</h1>
  <p style="font-size:.78rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 29 mai 2026 · Parc des Bretonnières</p>
</td></tr>

<!-- BODY -->
<tr><td style="background:#fff;padding:24px 28px">

  <div style="font-size:.9rem;font-weight:600;color:#3d1830;margin-bottom:10px;text-align:left">Bonjour ${prenom} 👋</div>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Vendredi, des coureurs s'élancent pour l'enfance — et vous êtes là avec eux. <strong>Votre soutien fait partie de l'élan.</strong> Sans vous, la course n'aurait pas le même sens.</div>

  <!-- Bloc chaleur -->
  <div style="background:#e0f2fe;border:2px solid #0284c7;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🌡️ 35°C prévu vendredi — on s'adapte !</div>
    <div style="font-size:.85rem;color:#1e3a5f;line-height:1.7;margin-bottom:12px">Il va faire très chaud. Pas question d'annuler — comme dans l'accompagnement des enfants, <strong>on s'adapte en permanence</strong> pour que tout se passe bien :</div>
    <div style="font-size:.83rem;color:#1e3a5f;line-height:1.9">
      🌳 <strong>100% sous les arbres</strong> — Parc des Bretonnières<br>
      ⏱️ <strong>1h30 de course</strong> au lieu de 2h<br>
      🎮 <strong>Course gamifiée</strong> — 13 épreuves bonus pour gagner des km autrement<br>
      💦 <strong>Une tonne d'eau</strong> pour arroser les participants<br>
      🚑 <strong>Poste de secours</strong> Croix Blanche 37
    </div>
  </div>

  <!-- Parallèle enfance -->
  <div style="background:linear-gradient(135deg,#fff0f8,#fff5ef);border:1.5px solid rgba(251,0,137,.2);border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💡 Pourquoi c'est fort</div>
    <div style="font-size:.85rem;color:#3d1830;line-height:1.8">Comme le Défi Enfance s'adapte à la chaleur pour que la course ait lieu coûte que coûte, <strong>éduquer et accompagner les enfants vulnérables demande de s'adapter en permanence</strong> — à leurs besoins fondamentaux, à leur rythme, à leurs fragilités. C'est exactement ce que font chaque jour les équipes que vous soutenez.</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.8;margin-top:10px">Le Défi Enfance est une <strong>caisse de résonance</strong> : faire retentir haut et fort que <strong>l'enfance est une priorité nationale</strong>. Grâce à vous, ce message porte plus loin.</div>
  </div>

  <!-- Remerciements -->
  <div style="background:linear-gradient(135deg,#3d1830,#1a0a12);border-radius:14px;padding:20px 24px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🙏 Merci, du fond du cœur</div>
    <div style="font-size:.85rem;color:#fff;line-height:1.8;margin-bottom:10px"><strong style="color:#fb0089">Vous faites le Défi Enfance.</strong> Sans les donateurs et les promettants, les coureurs courent pour rien. Votre engagement donne du sens à chaque foulée, à chaque épreuve gamifiée, à chaque km parcouru vendredi sous les arbres.</div>
    <div style="font-size:.84rem;color:rgba(255,255,255,.8);line-height:1.7">Vous pouvez en être fiers — les enfants accompagnés par nos structures en bénéficient directement.</div>
  </div>

  <!-- Résultats -->
  <div style="background:#f0fff5;border:1.5px solid rgba(34,197,94,.3);border-radius:14px;padding:16px 20px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">📊 Et après ?</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.7">Vous recevrez les <strong>résultats de la course par email lundi 1er juin avant 18h</strong> — kms parcourus, classements, total des dons collectés. Tout ce que votre soutien a rendu possible.</div>
  </div>

  <!-- Autre don -->
  <div style="background:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">💪 Encore un élan ?</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">Si le cœur vous en dit, il est encore temps de faire un don supplémentaire ou de promettre un montant par km. <strong>On a besoin de vous jusqu'au bout.</strong></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a href="${urlDon}" style="display:inline-block;background-color:#fb0089;color:#fff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">❤️ Faire un don</a>
      <a href="${urlProm}" style="display:inline-block;background-color:#7c3aed;color:#fff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">🏅 Promettre un don au km</a>
    </div>
    <div style="font-size:.75rem;color:#888;margin-top:10px">💡 <strong>Don défiscalisé à 66%.</strong> 50€ de don = seulement 17€ après réduction d'impôt.</div>
  </div>

  <!-- Email à partager -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr><td style="background:linear-gradient(135deg,#1a0a12,#2d1020);border-radius:14px;padding:18px 22px">
    <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">💬 Partagez votre engagement !</div>
    <div style="font-size:.78rem;color:#aaa;margin-bottom:14px">Message prêt à copier-coller pour vos proches :</div>
    <div style="background:#fff;border-radius:10px;padding:16px 18px">
      <div style="font-size:.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Objet</div>
      <div style="font-size:.84rem;font-weight:700;color:#3d1830;margin-bottom:12px;border-bottom:1px solid #f5dced;padding-bottom:10px">J'ai soutenu le Défi Enfance — et vendredi ça court sous 35°C ! 🌊</div>
      <div style="font-size:.82rem;color:#3d1830;line-height:1.8">
        <p style="margin:0 0 10px">Bonjour [Prénom],</p>
        <p style="margin:0 0 10px">J'ai soutenu le <strong>Défi Enfance à Joué-lès-Tours</strong> — et vendredi des coureurs s'élancent sous 35°C pour l'enfance !</p>
        <p style="margin:0 0 10px">L'organisation a tout adapté : course sous les arbres, gamification des épreuves pour éviter les efforts trop intenses, une tonne d'eau pour rafraîchir tout le monde. Comme dans l'accompagnement des enfants vulnérables — <strong>on s'adapte en permanence pour répondre à leurs besoins fondamentaux.</strong></p>
        <p style="margin:0 0 10px">Tu peux encore les soutenir :<br>
        👉 <a href="${urlDon}" style="color:#fb0089;font-weight:600">Faire un don</a><br>
        👉 <a href="${urlProm}" style="color:#7c3aed;font-weight:600">Promettre un don au km</a></p>
        <p style="margin:0">Merci ! À très vite,<br><strong>${prenom}</strong></p>
      </div>
    </div>
  </td></tr></table>

  <div style="border-top:1px solid #f5dced;margin:16px 0"></div>
  <div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">À vendredi — merci d'être là. 💦❤️</div>
  <div style="font-size:.78rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>

</td></tr>
<tr><td style="background:#3d1830;padding:14px;text-align:center;border-radius:0 0 16px 16px">
  <div style="font-size:.8rem;font-weight:700;color:#fb0089">DÉFI ENFANCE</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div>
</td></tr>
</table></td></tr></table>
</body></html>`;
}


// ── Template J-1 Joué — Supporters
function tplGroupeJ1JoueSupporters({ prenom, urlDon, urlProm }) {
  urlDon  = urlDon  || 'https://defienfance.fr/faire-un-don/';
  urlProm = urlProm || 'https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_promise=1';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS_COMMUN}</style></head><body style="margin:0;padding:0;background:#f5f0f5">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table width="100%" style="max-width:600px;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(61,24,48,.12)">

<!-- HEADER -->
<tr><td style="background:linear-gradient(135deg,#16a34a,#0d9488);padding:28px 32px;text-align:center">
  <div style="font-size:.72rem;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px">🤝 Défi Enfance · Joué-lès-Tours 2026</div>
  <h1 style="font-family:Arial,sans-serif;font-size:1.3rem;font-weight:700;color:#fff;margin:0 0 6px">🎉 Vendredi, votre présence<br>fait toute la différence !</h1>
  <p style="font-size:.78rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 29 mai 2026 · Parc des Bretonnières</p>
</td></tr>

<!-- BODY -->
<tr><td style="background:#fff;padding:24px 28px">

  <div style="font-size:.9rem;font-weight:600;color:#3d1830;margin-bottom:10px;text-align:left">Bonjour ${prenom} 👋</div>
  <div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Vendredi, les coureurs s'élancent pour l'enfance — et <strong>vous serez là pour les pousser jusqu'au bout.</strong> Un supporter qui crie, qui applaudit, qui agite les bras en bord de piste : c'est parfois ce qui fait la différence entre abandonner et dépasser ses limites.</div>

  <!-- Chaleur -->
  <div style="background:#e0f2fe;border:2px solid #0284c7;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🌡️ 35°C prévu vendredi — on s'adapte !</div>
    <div style="font-size:.85rem;color:#1e3a5f;line-height:1.7;margin-bottom:12px">Il va faire très chaud. Comme dans l'accompagnement des enfants, <strong>on s'adapte en permanence</strong> pour que tout le monde soit en sécurité et que la fête ait lieu :</div>
    <div style="font-size:.83rem;color:#1e3a5f;line-height:1.9">
      🌳 <strong>100% sous les arbres</strong> — Parc des Bretonnières, côté Espace Malraux<br>
      ⏱️ <strong>1h30 de course</strong> au lieu de 2h<br>
      🎮 <strong>13 épreuves gamifiées</strong> pour gagner des km autrement<br>
      💦 <strong>Une tonne d'eau</strong> — vous allez vous faire arroser aussi !<br>
      🕐 <strong>RDV dès 13h00</strong> — course à 14h30, goûter à 16h00
    </div>
  </div>

  <!-- Importance présence -->
  <div style="background:linear-gradient(135deg,#f0fff5,#f0fffe);border:1.5px solid rgba(22,163,74,.25);border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🏟️ Votre rôle est essentiel</div>
    <div style="font-size:.85rem;color:#3d1830;line-height:1.8;margin-bottom:10px">Les coureurs qui savent qu'ils ne courent pas seuls vont <strong>plus loin, plus vite, et surtout avec plus de joie.</strong> Vos encouragements sont du carburant — surtout par 35°C !</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.8">Comme dans l'éducation des enfants vulnérables, <strong>la présence bienveillante d'adultes engagés change tout</strong>. Votre présence vendredi est une forme de soutien concret, visible, qui compte.</div>
  </div>

  <!-- Don -->
  <div style="background:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:18px 22px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">❤️ Et si vous alliez encore plus loin ?</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:14px">En plus de votre présence, vous pouvez <strong>faire un don ou promettre un montant par km</strong> parcouru par vos coureurs préférés. Un double impact — physique et financier — pour l'enfance.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a href="${urlDon}" style="display:inline-block;background-color:#fb0089;color:#fff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">❤️ Faire un don</a>
      <a href="${urlProm}" style="display:inline-block;background-color:#7c3aed;color:#fff;text-decoration:none;padding:10px 22px;border-radius:99px;font-weight:700;font-size:.8rem;font-family:Arial,sans-serif">🏅 Promettre un don au km</a>
    </div>
    <div style="font-size:.75rem;color:#888;margin-top:10px">💡 <strong>Don défiscalisé à 66%.</strong> 50€ = seulement 17€ après réduction d'impôt.</div>
  </div>

  <!-- Checklist supporter -->
  <div style="background:#f9f7ff;border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
    <div style="font-size:.75rem;font-weight:700;color:#3d1830;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">✅ Checklist supporter</div>
    <div style="font-size:.83rem;color:#3d1830;line-height:1.9">
      👕 T-shirt aux couleurs de votre organisation<br>
      🧴 Crème solaire + casquette<br>
      💧 Bouteille d'eau — et préparez-vous à être arrosés !<br>
      📱 Téléphone chargé pour filmer et partager<br>
      🎉 Pancartes, sifflets, énergie — tout est bienvenu !
    </div>
  </div>

  <!-- Résultats -->
  <div style="background:#f0fff5;border:1.5px solid rgba(34,197,94,.3);border-radius:14px;padding:16px 20px;margin-bottom:20px;text-align:left">
    <div style="font-size:.72rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">📊 Les résultats</div>
    <div style="font-size:.84rem;color:#3d1830;line-height:1.7">Les résultats de la course seront disponibles <strong>lundi 1er juin avant 18h</strong> — kms, classements, total des dons. On vous envoie tout !</div>
  </div>

  <div style="border-top:1px solid #f5dced;margin:16px 0"></div>
  <div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">À vendredi sous les arbres — préparez vos poumons ! 🌳🎉</div>
  <div style="font-size:.78rem;color:#16a34a;font-weight:600;text-align:center">— Team Défi Enfance</div>

</td></tr>
<tr><td style="background:#3d1830;padding:14px;text-align:center;border-radius:0 0 16px 16px">
  <div style="font-size:.8rem;font-weight:700;color:#fb0089">DÉFI ENFANCE</div>
  <div style="font-size:.72rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div>
</td></tr>
</table></td></tr></table>
</body></html>`;
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


function tplInscriptionReferentEquipe({ chefPrenom, nomEquipe, coureur, emailCoureur, nomAsso, urlPageCoureur }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ef6135" style="background-color:#ef6135;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 6px">🏃 Nouveau coureur<br>dans votre équipe !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 2026</p></td></tr></table>
<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${chefPrenom} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Excellente nouvelle pour l'équipe <strong>${nomEquipe}</strong> ! <strong>${coureur}</strong> vient de rejoindre vos rangs pour le Défi Enfance. Votre équipe s'agrandit — et la collecte aussi !</div>

<div style="background-color:#fff5ef;border:2px solid #ef6135;border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#ef6135;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">🏃 Nouveau membre de l'équipe</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding:6px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#3d1830">Nom</td><td style="padding:6px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;font-weight:700;color:#3d1830;text-align:right">${coureur}</td></tr>
    ${emailCoureur ? `<tr><td style="padding:6px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#3d1830">Email</td><td style="padding:6px 0;border-bottom:1px solid #fde8d8;font-size:.84rem;color:#7c3aed;text-align:right"><a href="mailto:${emailCoureur}" style="color:#7c3aed">${emailCoureur}</a></td></tr>` : ''}
    ${nomAsso ? `<tr><td style="padding:6px 0;font-size:.84rem;color:#3d1830">Association soutenue</td><td style="padding:6px 0;font-size:.84rem;font-weight:700;color:#fb0089;text-align:right">${nomAsso}</td></tr>` : ''}
  </table>
</div>

<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">N'hésitez pas à <strong>contacter ${coureur.split(' ')[0]} directement</strong> pour l'inviter à mobiliser son réseau et maximiser la collecte de votre équipe. Chaque nouveau coureur est une opportunité supplémentaire de faire grimper votre compteur de solidarité !</div>

${urlPageCoureur ? `<div style="text-align:center;margin-bottom:20px"><a href="${urlPageCoureur}" style="display:inline-block;background-color:#ef6135;color:#fff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🏃 Voir la page de collecte de ${coureur.split(' ')[0]}</a></div>` : ''}

<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">Ensemble pour l'enfance. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}


function tplInscriptionReferentAsso({ prenomRef, nomAsso, coureur, emailCoureur, urlPageCoureur }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer">
<div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#fb0089" style="background-color:#fb0089;padding:24px 32px;text-align:center;border-radius:0"><h1 style="font-family:Arial,sans-serif;font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 6px">❤️ Un coureur court<br>pour votre association !</h1><p style="font-size:.8rem;color:rgba(255,255,255,.8);margin:0">Défi Enfance · 2026</p></td></tr></table>
<div class="body">
<div style="font-size:1rem;font-weight:600;color:#3d1830;margin-bottom:12px;text-align:left">Bonjour ${prenomRef} 👋</div>
<div style="font-size:.85rem;color:#3d1830;line-height:1.7;margin-bottom:20px;text-align:left">Très bonne nouvelle pour <strong>${nomAsso}</strong> ! <strong>${coureur}</strong> vient de s'inscrire au Défi Enfance et a choisi de courir pour votre association. Tous les dons et promesses de don générés sur son dossard vous soutiennent directement !</div>

<div style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">🏃 Votre coureur ambassadeur</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding:6px 0;border-bottom:1px solid #f5dced;font-size:.84rem;color:#3d1830">Nom</td><td style="padding:6px 0;border-bottom:1px solid #f5dced;font-size:.84rem;font-weight:700;color:#3d1830;text-align:right">${coureur}</td></tr>
    ${emailCoureur ? `<tr><td style="padding:6px 0;font-size:.84rem;color:#3d1830">Email</td><td style="padding:6px 0;font-size:.84rem;color:#7c3aed;text-align:right"><a href="mailto:${emailCoureur}" style="color:#7c3aed">${emailCoureur}</a></td></tr>` : ''}
  </table>
</div>

<div style="background-color:#f0fff5;border:1.5px solid rgba(34,197,94,0.3);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">💰 Comment fonctionne le fléchage des dons ?</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7;margin-bottom:8px">Tous les dons et promesses de don réalisés sur la page de collecte de <strong>${coureur.split(' ')[0]}</strong> sont fléchés à :</div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px">
    <div style="flex:1;min-width:120px;background:#fff;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:1.4rem;font-weight:700;color:#fb0089;font-family:Arial">50%</div>
      <div style="font-size:.75rem;color:#3d1830;margin-top:4px">→ <strong>${nomAsso}</strong></div>
    </div>
    <div style="flex:1;min-width:120px;background:#fff;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:1.4rem;font-weight:700;color:#3d1830;font-family:Arial">50%</div>
      <div style="font-size:.75rem;color:#3d1830;margin-top:4px">→ Plaidoyer Défi Enfance</div>
    </div>
  </div>
</div>

<div style="background-color:#fff0f8;border-left:3px solid #fb0089;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:20px;text-align:left">
  <div style="font-size:.75rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📣 Ce que vous pouvez faire maintenant</div>
  <div style="font-size:.84rem;color:#3d1830;line-height:1.7">Contactez <strong>${coureur.split(' ')[0]}</strong> directement à l'adresse <a href="mailto:${emailCoureur}" style="color:#7c3aed">${emailCoureur}</a> pour :<br>• L'inviter à partager sa page de collecte à son réseau pro et perso<br>• Lui présenter votre association et les projets financés<br>• Le remercier de courir pour vous — cela crée un lien fort !</div>
</div>

${urlPageCoureur ? `<div style="text-align:center;margin-bottom:20px"><a href="${urlPageCoureur}" style="display:inline-block;background-color:#fb0089;color:#fff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">❤️ Voir la page de collecte de ${coureur.split(' ')[0]}</a></div>` : ''}

<div class="divider"></div>
<div style="font-size:.84rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:6px">Merci de porter ce bel élan pour l'enfance. 🤝</div>
<div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3d1830" style="background-color:#3d1830;padding:16px;text-align:center;border-radius:0 0 14px 14px"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div style="font-size:.82rem;color:rgba(255,255,255,.5)">Générateur de victoires pour l'enfance · contact@defienfance.fr</div></td></tr></table>
</div></td></tr></table></body></html>`;
}

function tplInscriptionAsso({ nomAsso, coureur, email_coureur, ville, prenomReferent }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🏃 Nouveau coureur<br>pour votre cause !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenomReferent || ''} 👋</div><div class="intro">Un coureur vient de <strong>choisir votre association ${nomAsso}</strong> pour courir lors du <strong>Défi Enfance${ville ? ' de ' + ville : ''}</strong> !</div><div class="don-box"><div class="don-amount" style="font-size:1.8rem">${coureur}</div><div class="don-label">Nouveau coureur inscrit</div></div><div class="card"><h3>📋 Coordonnées du coureur</h3><div class="row"><span class="ic">👤</span><div><strong>Nom :</strong> ${coureur}</div></div><div class="row"><span class="ic">✉️</span><div><strong>Email :</strong> <a href="mailto:${email_coureur}" style="color:#fb0089">${email_coureur}</a></div></div></div><div class="note magenta">💌 <strong>Prenez contact avec ${coureur}</strong> pour le remercier et l'accueillir chaleureusement !</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">💡 Présentez vos actions. Plus le coureur est engagé, plus sa collecte sera importante !</div><div class="divider"></div><div style="font-size:.75rem;color:#888;text-align:center">Association : <strong>${nomAsso}</strong><br>Email envoyé automatiquement dans les 10 minutes suivant l'inscription.</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}


function tplDejeuner({ prenom }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🥗 Votre panier repas<br>est confirmé !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div><div class="intro">Votre commande de repas est <strong>validée</strong> pour le Défi Enfance d'Angers — 22 mai 2026 !</div><div class="don-box" style="text-align:left;padding:20px 26px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;text-align:center">🧺 Votre panier gourmand</div><div class="row"><span class="ic">🥙</span><div>Bagel poulet, mozzarella, pesto &amp; tomates confites</div></div><div class="row"><span class="ic">🧁</span><div>Muffin maison aux fruits rouges</div></div><div class="row"><span class="ic">🍎</span><div>Une pomme</div></div><div class="row"><span class="ic">💧</span><div>Une eau</div></div></div><div class="note magenta" style="margin-bottom:22px">🎓 <strong>Panier préparé par Agapè Anjou</strong>, une école de production angevine qui forme des jeunes de 15 à 25 ans aux métiers de la restauration.<br><br>Merci — votre commande est <strong>solidaire</strong> : les 12 € versés viennent soutenir leur parcours.</div><div class="cta-box" style="text-align:left"><p style="text-align:center">📍 <strong>Récupération de votre panier</strong></p><div style="font-size:.86rem;color:#3d1830;line-height:1.8;margin-top:8px"><div>🕛 <strong>Dès 12h</strong> — après la course</div><div>📌 <strong>Stand Agapè Anjou</strong> sur le village de la course</div><div>👤 Dites simplement <strong>votre nom</strong> à l'accueil</div></div></div><div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">À tout à l'heure sur le Défi Enfance !<br><strong style="color:#fb0089">— Team Défi Enfance</strong></div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
}
function tplInscriptionCoureur({ prenom, nomComplet, nomAsso, isJoue, numeroDossard }) {
  const URL_DOSSARD = 'https://upe-bot.github.io/defi-enfance-dossard/index.html';
  const assoBlock = nomAsso
    ? `<div class="don-box" style="margin-bottom:20px"><div style="font-size:.78rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">🏳️ Votre association soutenue</div><div style="font-family:'Antonio',Arial,sans-serif;font-size:1.4rem;color:#fb0089">${nomAsso}</div><div style="font-size:.78rem;color:#3d1830;margin-top:4px">Votre choix a bien été pris en compte ✅</div></div>`
    : '';
  const blocDossard = numeroDossard
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" bgcolor="#fff0f8" style="background-color:#fff0f8;border:2px solid #fb0089;border-radius:14px;padding:16px 22px"><div style="font-size:.72rem;font-weight:700;color:#fb0089;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Votre numéro de dossard</div><div style="font-family:Arial,sans-serif;font-size:48px;color:#fb0089;font-weight:700;line-height:1.2">${numeroDossard}</div><div style="font-size:.75rem;color:#3d1830;margin-top:6px">À récupérer sur place dès 13h00</div><div style="margin-top:14px"><a href="${URL_DOSSARD}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:99px;font-weight:700;font-size:.78rem;font-family:Arial,sans-serif">🎽 Je retrouve mon dossard</a></div></td></tr></table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td align="center" style="padding:8px 0"><a href="${URL_DOSSARD}" style="display:inline-block;background-color:#fb0089;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:99px;font-weight:700;font-size:.84rem;font-family:Arial,sans-serif">🎽 Je retrouve mon dossard</a><div style="font-size:.72rem;color:#888;margin-top:6px">Votre dossard sera disponible sous 24h</div></td></tr></table>`;
  const blocChaleurJoue = isJoue ? `<div style="background:#e0f2fe;border:2px solid #0284c7;border-radius:14px;padding:16px 20px;margin-bottom:20px;text-align:left"><div style="font-size:.72rem;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">🌡️ 35°C vendredi — on s'adapte !</div><div style="font-size:.83rem;color:#1e3a5f;line-height:1.8">Course déplacée <strong>sous les arbres du Parc des Bretonnières</strong> · <strong>1h30</strong> au lieu de 2h · <strong>13 épreuves gamifiées</strong> pour gagner des km autrement · <strong>Une tonne d'eau</strong> pour vous rafraîchir · RDV côté Espace Malraux dès <strong>13h00</strong>.</div></div>` : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Antonio:wght@700&display=swap" rel="stylesheet"><style>${CSS_COMMUN}</style></head><body bgcolor="#f5f0f3" style="background-color:#f5f0f3;margin:0;padding:0"><table class="bg-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><tr><td align="center" bgcolor="#f5f0f3" style="background-color:#f5f0f3"><div class="outer"><div class="logo-header"><div class="logo-text">🤝 Défi Enfance</div><div class="logo-sub">Générateur de victoires pour l'enfance</div></div><div class="header mixed"><h1>🚀 Bienvenue au<br>Défi Enfance !</h1><p>Générateur de victoires pour l'enfance</p></div><div class="body"><div class="greeting">Bonjour ${prenom} 👋</div>${assoBlock}${blocChaleurJoue}${blocDossard}<div class="intro">🚀 Vous pouvez désormais aider l'Association que vous avez choisie en invitant vos réseaux pro et perso à faire un don !</div><div class="cta-box"><p>Partagez le lien de don à vos contacts — en choisissant votre nom dans le formulaire, ils soutiennent votre collecte pour votre Association et le Plaidoyer du Défi Enfance.</p><a href="${URL_DON}" class="cta-btn">❤️ Page de don Défi Enfance</a></div><div class="note magenta">💡 Leur don est éligible à un <strong>reçu fiscal</strong> : 66% de crédit d'impôts sur l'IR ou 60% sur l'IS.</div><div class="note" style="background:#f5f0f3;border-left-color:#ff8533">📊 Suivez vos dons sur le <a href="${URL_COUREURS}" style="color:#ef6135;font-weight:600">classement général</a> du Défi Enfance.</div>${blocCtaDonPromesse({ nomCoureur: nomComplet })}<div class="divider"></div><div style="font-size:.86rem;color:#3d1830;text-align:center;font-style:italic;margin-bottom:8px">Ensemble, on va soulever les énergies pour l'enfance !<br>Merci pour votre engagement.</div><div style="font-size:.82rem;color:#fb0089;font-weight:600;text-align:center">— Team Défi Enfance</div></div>${BLOC_IFI}<div class="footer"><div style="font-family:Arial,sans-serif;font-size:1.1rem;font-weight:700;color:#fb0089;letter-spacing:.08em;margin-bottom:6px">DÉFI ENFANCE</div><div class="footer-sub">Générateur de victoires pour l'enfance<br>contact@defienfance.fr</div></div></div></td></tr></table></body></html>`;
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
const ENVOI_GROUPE_DELAY_MS = 500; // délai entre emails envoyés (Brevo n'a pas de rate limit strict)
const OHME_CONTACT_DELAY_MS  = 1500; // délai entre appels contacts dans fetchDestinataires

// ── Fetch Ohme avec retry automatique (gère 429 et 5xx)
async function fetchOhmeWithRetry(url, options = {}, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const waitMs = attempt * 5000; // 5s, 10s, 15s, 20s
        addLog(`⏳ Ohme rate limit (429) — attente ${waitMs/1000}s (tentative ${attempt}/${maxRetries})`, 'warn');
        await sleep(waitMs);
        if (attempt === maxRetries) {
          addLog(`⏳ Ohme rate limit persistant — attente 30s supplémentaires…`, 'warn');
          await sleep(30000);
          const retryFinal = await fetch(url, options);
          return retryFinal;
        }
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        addLog(`⏳ Ohme erreur ${res.status} — retry dans 3s (tentative ${attempt}/${maxRetries})`, 'warn');
        await sleep(3000);
        continue;
      }
      return res;
    } catch(e) {
      if (attempt < maxRetries) { await sleep(2000); continue; }
      throw e;
    }
  }
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
  if (!nomEquipe) return { nb: 0, total: 0, promettants: [] };
  try {
    await sleep(OHME_DELAY_MS);
    const res = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/payments?limit=100&since_date=2026-01-01`, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (!res.ok) return { nb: 0, total: 0, promettants: [] };
    const json = await res.json();
    const all = json.data || [];
    let nb = 0, total = 0;
    const promettants = [];
    for (const p of all) {
      const cf = p.custom_fields || p;
      const montantKm = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (!montantKm) continue;
      const equipeP = (cf.equipe_parraine || '').trim();
      if (equipeP.toLowerCase() !== nomEquipe.toLowerCase()) continue;
      nb++; total += montantKm;
      // Récupérer email + prénom du promettant
      if (p.contact_id) {
        let contact = contactsCache.get(String(p.contact_id));
        if (!contact) contact = await fetchOhmeContactById(p.contact_id);
        if (contact?.email) {
          promettants.push({
            email: contact.email,
            prenom: contact.firstname || contact.first_name || '',
            montantKm,
          });
        }
      }
    }
    return { nb, total, promettants };
  } catch(e) { return { nb: 0, total: 0, promettants: [] }; }
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
          // Vérifier si ce don concrétise une promesse antérieure (avant d'envoyer le merci classique)
          const concretCoureur = await verifierConcretisationPromesse(p.contact_id, emailDon, coureurParraine, null, eventName, p.date);
          if (ok) { state.stats.sent++; addLog(`✅ Don ${montant}€ → ${coureurParraine}`, 'ok'); addEvent('❤️', `Don de ${montant} €`, `${donateur} → ${coureurParraine}`, 'don'); }
          // Envoyer merci donateur classique SEULEMENT si ce n'est pas une concrétisation
          if (ok && !concretCoureur) { sendMerciDonateur({ email: emailDon, prenom: prenomMerci || donateur.split(' ')[0], montant, donateur, coureurPrenom, coureurNom: coureurParraine.split(' ').slice(1).join(' '), association: assoSoutenue, contactId: p.contact_id, isStructure, nomStructure }); }
          if (concretCoureur && emailDon) {
            const cfContact = contact?.custom_fields || contact || {};
            const kmsParcourus = parseFloat(cfContact.km_parcourus_angers2026 || cfContact.km_parcourus_joue2026 || 0);
            const montantCalcule = kmsParcourus > 0 ? concretCoureur.montantKm * kmsParcourus : 0;
            // Récupérer récap + mot d'encouragement
            const { motEncouragement: motC, recapHtml: recapC } = await buildRecapDonateurCible(p.contact_id, coureurParraine, 'coureur', eventName);
            // Email au donateur
            const htmlConcret = tplMerciConcretisationPromesse({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantDon: parseFloat(montant), montantParKm: concretCoureur.montantKm, nomCible: coureurParraine, typeCible: 'coureur', kmsParcourus, montantCalcule, urlPage: urlPageCoureur, motEncouragement: motC, recapHtml: recapC });
            const okC = await sendBrevo(emailDon, `🙏 Merci d'avoir concrétisé votre promesse pour ${coureurPrenom} !`, htmlConcret);
            if (okC) addLog(`✅ Email concrétisation promesse → ${donateur} (${coureurParraine})`, 'ok');
            // Marquer la promesse comme concrétisée dans l'état mémoire
            const promItem = promessesState.items.find(pr => !pr.concretise && String(pr.contactId) === String(p.contact_id) && pr.cible.toLowerCase() === coureurParraine.toLowerCase());
            if (promItem) { promItem.concretise = true; promItem.dateDon = p.date; promItem.montantDon = parseFloat(montant); }
            // Email au coureur parrainé
            if (emailCoureur) {
              const htmlNotifCoureur = tplNotifConcretisationCoureur({ prenomCible: coureurPrenom, donateur, montantDon: parseFloat(montant), montantParKm: concretCoureur.montantKm, kmsParcourus, urlPage: urlPageCoureur, motEncouragement: motC, recapHtml: recapC });
              const okN = await sendBrevo(emailCoureur, `🎉 ${donateur.split(' ')[0]} a concrétisé sa promesse de don pour toi !`, htmlNotifCoureur);
              if (okN) addLog(`✅ Notif concrétisation → coureur ${coureurPrenom}`, 'ok');
            }
            // Email au référent d'équipe si le coureur est en équipe
            const equipeC = await fetchEquipeCoureur(contact?.id);
            if (equipeC) {
              const structC = await fetchOhmeStructureByName(equipeC);
              const chefEmailC = structC?.email_referent_defi_enfance || '';
              const chefPrenomC = structC?.prenom_du_referent_defi_enfance || 'Bonjour';
              const urlPageEquipeC2 = await buildUrlPageEquipe(null, equipeC, eventName);
              if (chefEmailC) {
                const coureurNomC = coureurParraine.split(' ').slice(1).join(' ');
                const htmlNotifRef = tplNotifConcretisationReferent({ chefPrenom: chefPrenomC, nomEquipe: equipeC, coureurPrenom, coureurNom: coureurNomC, donateur, montantDon: parseFloat(montant), montantParKm: concretCoureur.montantKm, kmsParcourus, urlPageEquipe: urlPageEquipeC2, motEncouragement: motC, recapHtml: recapC });
                const okR = await sendBrevo(chefEmailC, `🎉 ${donateur.split(' ')[0]} a concrétisé sa promesse pour ${coureurPrenom} — équipe ${equipeC} !`, htmlNotifRef);
                if (okR) addLog(`✅ Notif concrétisation → référent équipe ${equipeC}`, 'ok');
              }
            }
          }
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
          // Vérifier si ce don concrétise une promesse antérieure sur l'équipe
          const concretEquipe = await verifierConcretisationPromesse(p.contact_id, emailDon, null, equipeParraine, eventName, p.date);
          if (ok) { state.stats.sent++; addLog(`✅ Don ${montant}€ → équipe ${equipeParraine}`, 'ok'); addEvent('🏆', `Don ${montant}€ équipe`, `${donateur} → ${equipeParraine}`, 'don'); }
          // Envoyer merci donateur classique SEULEMENT si ce n'est pas une concrétisation
          if (ok && !concretEquipe) { sendMerciDonateur({ email: emailDon, prenom: prenomMerci || donateur.split(' ')[0], montant, donateur, nomEquipe: equipeParraine, contactId: p.contact_id, isStructure, nomStructure }); }
          if (concretEquipe && emailDon) {
            const cfStruct2 = structure?.custom_fields || structure || {};
            const kmsEquipe = parseFloat(cfStruct2.km_parcourus_equipe_angers_2026 || 0);
            const montantCalcule2 = kmsEquipe > 0 ? concretEquipe.montantKm * kmsEquipe : 0;
            const urlPageEquipeC = await buildUrlPageEquipe(null, equipeParraine, eventName);
            // Récupérer récap + mot d'encouragement
            const { motEncouragement: motE, recapHtml: recapE } = await buildRecapDonateurCible(p.contact_id, equipeParraine, 'equipe', eventName);
            // Email au donateur
            const htmlConcret2 = tplMerciConcretisationPromesse({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantDon: parseFloat(montant), montantParKm: concretEquipe.montantKm, nomCible: equipeParraine, typeCible: 'equipe', kmsParcourus: kmsEquipe, montantCalcule: montantCalcule2, urlPage: urlPageEquipeC, motEncouragement: motE, recapHtml: recapE });
            const okC2 = await sendBrevo(emailDon, `🙏 Merci d'avoir concrétisé votre promesse pour l'équipe ${equipeParraine} !`, htmlConcret2);
            if (okC2) addLog(`✅ Email concrétisation promesse → ${donateur} (équipe ${equipeParraine})`, 'ok');
            // Marquer la promesse comme concrétisée dans l'état mémoire
            const promItem2 = promessesState.items.find(pr => !pr.concretise && String(pr.contactId) === String(p.contact_id) && pr.cible.toLowerCase() === equipeParraine.toLowerCase());
            if (promItem2) { promItem2.concretise = true; promItem2.dateDon = p.date; promItem2.montantDon = parseFloat(montant); }
            // Email au référent d'équipe
            if (chefEmail) {
              const htmlNotifRef2 = tplNotifConcretisationCoureur({ prenomCible: chefPrenom, donateur, montantDon: parseFloat(montant), montantParKm: concretEquipe.montantKm, kmsParcourus: kmsEquipe, urlPage: urlPageEquipeC, motEncouragement: motE, recapHtml: recapE });
              const okR2 = await sendBrevo(chefEmail, `🎉 ${donateur.split(' ')[0]} a concrétisé sa promesse de don pour l'équipe ${equipeParraine} !`, htmlNotifRef2);
              if (okR2) addLog(`✅ Notif concrétisation → référent équipe ${equipeParraine}`, 'ok');
            }
          }
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

        // Récupérer nb coureurs inscrits dans l'équipe pour la projection
        const cfStruct = structure?.custom_fields || structure || {};
        let nbCoureurs = 0;
        try {
          // Compter les contacts avec cette équipe dans leur paiement billetterie
          const nbCoureursCaches = [...contactsCache.values()].filter(c => {
            const cf2 = c.custom_fields || c;
            return equipeParContactId.get(String(c.id)) === equipeParraine;
          }).length;
          nbCoureurs = nbCoureursCaches || 0;
        } catch(e) { nbCoureurs = 0; }

        if (chefEmail) {
          // URLs personnalisées équipe
          const urlPromesseEquipe = await buildUrlPromesseEquipe(null, equipeParraine, eventName);
          const urlPageEquipe     = await buildUrlPageEquipe(null, equipeParraine, eventName);
          // 1. Email au chef d'équipe
          const html = tplPromesseEquipe({ chefPrenom, chefNom, nomEquipe: equipeParraine, donateur, montantParKm: montantKm, email_donateur: emailDon, motEncouragement, nbPromessesEquipe: promEquipe.nb, totalKmParEquipe: promEquipe.total, urlPromesseEquipe, urlPageEquipe, nbCoureurs });
          const ok = await sendBrevo(chefEmail, `🏅 Promesse de ${donateur} pour l'équipe ${equipeParraine} — ${montantKm}€/km !`, html);
          if (ok) { state.stats.sent++; addLog(`✅ Promesse ${montantKm}€/km → équipe ${equipeParraine} (${nbCoureurs} coureurs)`, 'ok'); addEvent('🏅', `Promesse ${montantKm}€/km équipe`, `${donateur} → ${equipeParraine}`, 'don'); }

          // 2. Email merci au prometteur avec projection équipe
          const histPromE = await fetchHistoriqueDons(p.contact_id);
          const histPromHtmlE = formatHistoriqueDons(histPromE);
          const htmlMerci = tplMerciPrometteurEquipe({ prenomDonateur: prenomMerci || donateur.split(' ')[0], montantParKm: montantKm, nomEquipe: equipeParraine, historiqueHtml: histPromHtmlE, nbCoureurs });
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

      if (!isSupporter && !equipeC && !nomAsso) { addLog(`⏭️ Billet ${coureur} — équipe et asso vides`, 'info'); state.processedIds.add(String(p.id)); continue; }

      if (isSupporter) {
        if (emailCoureur) { const html = tplInscriptionSupporter({ prenom: prenomC || coureur }); const ok = await sendBrevo(emailCoureur, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, html); if (ok) { state.stats.sent++; addLog(`✅ Bienvenue supporter → ${coureur}`, 'ok'); addEvent('🚀', `Bienvenue supporter`, coureur, 'bill'); } }
      } else {
        if (emailCoureur) {
            const isJouePaiement = eventName.toUpperCase().includes('JOUÉ') || eventName.toUpperCase().includes('JOUE');
            const dossardJoue = isJouePaiement ? (cf.numero_de_dossard_joue2026 || '') : '';
            const html = tplInscriptionCoureur({ prenom: prenomC || coureur, nomComplet: coureur, nomAsso, isJoue: isJouePaiement, numeroDossard: dossardJoue });
            const ok = await sendBrevo(emailCoureur, `${prenomC || coureur} : Heureux de votre inscription au Défi Enfance !`, html);
            if (ok) { state.stats.sent++; addLog(`✅ Bienvenue coureur → ${coureur}`, 'ok'); addEvent('🚀', `Bienvenue coureur`, coureur, 'bill'); }

            // Notifier les promettants de l'équipe si nouveau coureur
            if (equipeC) {
              try {
                const promessesSurEquipe = await fetchTotalPromessesEquipe(equipeC);
                if (promessesSurEquipe.nb > 0 && promessesSurEquipe.promettants?.length) {
                  const nbCoureursNouv = ([...contactsCache.values()].filter(c => equipeParContactId.get(String(c.id)) === equipeC).length) + 1;
                  for (const prom of promessesSurEquipe.promettants) {
                    const htmlNotif = tplMerciPrometteurEquipe({ prenomDonateur: prom.prenom, montantParKm: prom.montantKm, nomEquipe: equipeC, historiqueHtml: '', nbCoureurs: nbCoureursNouv });
                    await sendBrevo(prom.email, `📢 Mise à jour — ${nbCoureursNouv} coureurs dans l'équipe ${equipeC} !`, htmlNotif);
                    addLog(`📢 Notif promettant ${prom.email} — ${nbCoureursNouv} coureurs dans ${equipeC}`, 'info');
                  }
                }
              } catch(e) { addLog(`⚠️ Notif promettants équipe : ${e.message}`, 'warn'); }
            }
          }

        // ── Email au référent d'équipe
        if (equipeC) {
          const structEquipe = structuresParNom.get(equipeC) || structuresParNom.get(equipeC.toLowerCase()) || await fetchOhmeStructureByName(equipeC);
          const chefEmailE  = structEquipe?.email_referent_defi_enfance || '';
          const chefPrenomE = structEquipe?.prenom_du_referent_defi_enfance || 'Bonjour';
          if (chefEmailE) {
            const urlPageCoureurRef = await buildUrlPageCoureur(contactCoureur?.id, eventName);
            const htmlRef = tplInscriptionReferentEquipe({ chefPrenom: chefPrenomE, nomEquipe: equipeC, coureur, emailCoureur, nomAsso, urlPageCoureur: urlPageCoureurRef });
            const okRef = await sendBrevo(chefEmailE, `🏃 [live] ${prenomC || coureur} rejoint votre équipe ${equipeC} !`, htmlRef);
            if (okRef) { state.stats.sent++; addLog(`✅ Inscription ${coureur} → référent équipe ${equipeC}`, 'ok'); }
          }
        }

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
          // Chercher d'abord dans le cache puis via API
          const structure = structuresParNom.get(nomAsso)
            || structuresParNom.get(nomAsso.toLowerCase())
            || await fetchOhmeStructureByName(nomAsso);
          const cfAsso    = structure?.custom_fields || structure || {};
          const emailAsso = cfAsso.email_referent_defi_enfance || structure?.email_referent_defi_enfance || '';
          const prenomRef = cfAsso.prenom_du_referent_defi_enfance || structure?.prenom_du_referent_defi_enfance || '';
          if (emailAsso) {
          const urlPageCoureurAsso = await buildUrlPageCoureur(contactCoureur?.id, eventName);
            const html = tplInscriptionReferentAsso({ prenomRef, nomAsso, coureur, emailCoureur, urlPageCoureur: urlPageCoureurAsso });
            const ok = await sendBrevo(emailAsso, `❤️ [live] ${prenomC || coureur} court pour votre association !`, html);
            if (ok) { state.stats.sent++; addLog(`✅ Inscription ${coureur} → asso ${nomAsso}`, 'ok'); addEvent('🏃', `Inscription de ${coureur}`, `Asso : ${nomAsso}`, 'bill'); }
          } else {
            addLog(`⚠️ Inscription ${coureur} — email asso "${nomAsso}" introuvable (structure trouvée: ${structure ? 'oui' : 'non'})`, 'warn');
          }
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
  // Ne pas polluer Ohme pendant un envoi groupé ou un préchauffage
  if (envoiGroupe.running) {
    addLog('⏸️ Poll suspendu — envoi groupé en cours', 'info');
    return;
  }
  if (state.prechauffage) {
    addLog('⏸️ Poll suspendu — préchauffage cache en cours', 'info');
    return;
  }
  state.lastPoll = new Date().toISOString();
  state.nextPoll = new Date(Date.now() + CONFIG.pollInterval).toISOString();
  addLog(`🔄 Interrogation Ohme…`, 'info');
  const payments = await fetchOhmePayments();
  addLog(`📦 ${payments.length} paiement(s) récupéré(s)`, 'info');
  if (premierPoll) addLog('⚠️ Premier poll — paiements mis en attente de validation', 'warn');
  await processPayments(payments);
  if (premierPoll) { premierPoll = false; await saveProcessedIds(); addLog('✅ Mode validation manuelle terminé — surveillance automatique active', 'ok'); }
  state.lastPollEndMs = Date.now(); // timestamp fin du poll
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
    // ── ENVOIS GROUPÉS — clés alignées sur getTemplateFunction
    groupe_j10_angers_coureurs:  { subject: '🧪 Test — 🎽 J-8 Angers Coureurs',             html: tplGroupeJ10Angers({ prenom: 'Sophie' }) },
    groupe_j4_angers_coureurs:   { subject: '🧪 Test — 📢 J-4 Angers Coureurs',             html: tplGroupePlaceholder({ prenom: 'Sophie', nomTemplate: 'J-4 Coureurs Angers' }) },
    groupe_j1_angers_coureurs:   { subject: '🧪 Test — 🎽 J-1 Angers — Dernières infos',   html: tplGroupeJ1Angers({ prenom: 'Victor', numeroDossard: '42', urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK }) },
    groupe_j2_referents_angers:  { subject: '🧪 Test — 🏆 Référents Angers boost collecte', html: tplGroupeJ2Referents({ prenom: 'Sophie', urlPromesseEquipe: URL_PROMESSE_FALLBACK, urlPageEquipe: URL_EQUIPES }) },
    groupe_j1_donateurs:         { subject: '🧪 Test — ❤️ J-1 Merci donateurs',             html: tplGroupeJ1Donateurs({ prenom: 'Marie', historiqueHtml: '', urlDon: URL_COUREURS, urlProm: URL_PROMESSE_FALLBACK }) },
    groupe_jourj_promesses:      { subject: '🧪 Test — 🏁 Jour J promesses en dons',        html: tplGroupeJourJPromesses({ prenom: 'Marie', promesses: [{ type: 'coureur', nom: 'Victor Vieilfault', montantKm: 2, kmParcourus: 14.8, montantDu: 29.60, urlDon: URL_COUREURS }] }) },
    groupe_merci_coureurs_angers:{ subject: '🧪 Test — 🏆 Merci coureurs Angers bilan kms', html: tplGroupeMerciCoureurAngers({ prenom: 'Victor', dossard: 42, nomCoureur: 'Victor Vieilfault', equipe: 'FSDV', kmsPerso: 14.8, classementPerso: 81, kmsEquipe: 360.8, classementEquipe: 3, estSolo: false }) },
    groupe_merci_donateurs_angers:{ subject: '🧪 Test — ❤️ Merci donateurs Angers',         html: tplGroupeMerciDonateurAngers({ prenom: 'Marie', historiqueHtml: '', totalDons: 50, nbDons: 1 }) },
    groupe_j1_joue_coureurs:     { subject: '🧪 Test — 🌊 J-1 Joué coureurs — 35°C sous les arbres !', html: tplGroupeJ1JoueCoureurs({ prenom: 'Victor', numeroDossard: '42', urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK }) },
    groupe_j1_joue_referents:    { subject: '🧪 Test — 🏆 J-1 Joué référents',                          html: tplGroupeJ1JoueReferents({ prenom: 'Sophie', nomEquipe: 'FSDV', urlPromesseEquipe: URL_PROMESSE_FALLBACK, urlPageEquipe: URL_EQUIPES }) },
    groupe_j10_joue_coureurs_v2: { subject: '🧪 Test — 🏁 J-10 Joué coureurs',             html: tplGroupeJ10JoueV2({ prenom: 'Sophie', nbJours: 10, urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK }) },
    groupe_j2_referents_joue:    { subject: '🧪 Test — 🏃 Référents Joué boost collecte',   html: tplGroupeJ2ReferentsJoue({ prenom: 'Sophie', nbJours: 3, urlPromesseEquipe: URL_PROMESSE_FALLBACK, urlPageEquipe: URL_EQUIPES }) },
    groupe_merci_donateurs_joue: { subject: '🧪 Test — ❤️ Merci donateurs Joué',            html: tplGroupeMerciDonateurJoue({ prenom: 'Jean-Paul', historiqueHtml: '', totalDons: 40, nbDons: 1 }) },
    // Concrétisation promesse
    inscription_referent_equipe: { subject: '🧪 Test — 🏃 Nouveau coureur → référent équipe',   html: tplInscriptionReferentEquipe({ chefPrenom: 'Sophie', nomEquipe: 'FSDV', coureur: 'Victor Vieilfault', emailCoureur: 'victor@test.fr', nomAsso: 'Réseau Entreprendre', urlPageCoureur: URL_COUREURS }) },
    inscription_referent_asso:   { subject: '🧪 Test — ❤️ Nouveau coureur → référent asso',     html: tplInscriptionReferentAsso({ prenomRef: 'Marie', nomAsso: 'Réseau Entreprendre', coureur: 'Victor Vieilfault', emailCoureur: 'victor@test.fr', urlPageCoureur: URL_COUREURS }) },
    relance_promesse:              { subject: '🧪 Test — 🏅 Relance promesse de don',             html: tplRelancePromesse({ prenomDonateur: 'Marie', montantKm: 2, nomCible: 'Victor Vieilfault', typeCible: 'coureur', kmsParcourus: 14.8, montantDu: 29.60, urlDon: URL_COUREURS }) },
    notif_concretisation_coureur:  { subject: '🧪 Test — 🎉 Notif concrétisation → coureur',   html: tplNotifConcretisationCoureur({ prenomCible: 'Victor', donateur: 'Marie Dupont', montantDon: 29.60, montantParKm: 2, kmsParcourus: 14.8, urlPage: 'https://defienfance.fr' }) },
    notif_concretisation_referent: { subject: '🧪 Test — 🎉 Notif concrétisation → référent équipe', html: tplNotifConcretisationReferent({ chefPrenom: 'Sophie', nomEquipe: 'FSDV', coureurPrenom: 'Victor', coureurNom: 'Vieilfault', donateur: 'Jean-Paul Martin', montantDon: 29.60, montantParKm: 2, kmsParcourus: 14.8, urlPageEquipe: 'https://defienfance.fr' }) },
    merci_concretisation_promesse: { subject: '🧪 Test — 🙏 Concrétisation promesse coureur', html: tplMerciConcretisationPromesse({ prenomDonateur: 'Marie', montantDon: 29.60, montantParKm: 2, nomCible: 'Victor Vieilfault', typeCible: 'coureur', kmsParcourus: 14.8, montantCalcule: 29.60, urlPage: 'https://defienfance.fr' }) },
    merci_concretisation_equipe:   { subject: '🧪 Test — 🙏 Concrétisation promesse équipe', html: tplMerciConcretisationPromesse({ prenomDonateur: 'Jean-Paul', montantDon: 99.55, montantParKm: 0.1, nomCible: 'FSDV', typeCible: 'equipe', kmsParcourus: 995.5, montantCalcule: 99.55, urlPage: 'https://defienfance.fr' }) },
    groupe_jourj_promesses:        { subject: '🧪 Test — 🏁 Jour J promesses en dons',     html: tplGroupeJourJPromesses({ prenom: 'Marie', promesses: [{ type: 'coureur', nom: 'Victor Vieilfault', montantKm: 2, kmParcourus: 14.8, montantDu: 29.60, urlDon: 'https://defienfance.fr' }, { type: 'equipe', nom: 'FSDV', montantKm: 0.1, kmParcourus: 995.5, montantDu: 99.55, urlDon: 'https://defienfance.fr' }] }) },
    groupe_merci_donateurs_angers: { subject: '🧪 Test — ❤️ Merci donateurs Angers',       html: tplGroupeMerciDonateurAngers({ prenom: 'Marie', historiqueHtml: '<div style="padding:8px 0;font-size:12px;color:#3d1830;border-bottom:1px solid #f5dced"><div><span style="color:#888;font-size:11px">15/03/2026</span><br><span style="color:#7c3aed;font-weight:600">🏃 Victor Vieilfault</span><br><span style="font-size:11px;color:#888">81e / 589 — 14.8 km</span></div><div style="font-weight:700;color:#fb0089">50.00 €</div></div>', totalDons: 50, nbDons: 1 }) },
    groupe_merci_donateurs_joue:   { subject: '🧪 Test — ❤️ Merci donateurs Joué',         html: tplGroupeMerciDonateurJoue({ prenom: 'Jean-Paul', historiqueHtml: '<div style="padding:8px 0;font-size:12px;color:#3d1830"><span style="color:#888;font-size:11px">10/04/2026</span><br><span style="color:#888">Don général</span><div style="font-weight:700;color:#fb0089">40.00 €</div></div>', totalDons: 40, nbDons: 1 }) },
    groupe_j2_referents_joue:      { subject: '🧪 Test — 🏃 Référents Joué boost collecte', html: tplGroupeJ2ReferentsJoue({ prenom: 'Sophie', nbJours: 3, urlPromesseEquipe: 'https://defienfance.fr', urlPageEquipe: 'https://defienfance.fr' }) },
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
        ok = await sendBrevo(emailC, `🏅 ${donateur} promet ${montantKm}€/km pour toi — ${coureurPrenom} !`, html);
        if (ok) { state.stats.sent++; addLog(`✅ Promesse validée → coureur ${coureurParraine}`, 'ok'); }
        const htmlMerci = tplMerciPrometteurCoureur({ prenomDonateur: prenomPrometteur, montantParKm: montantKm, coureurPrenom: coureurParraine.split(' ')[0], coureurNom: coureurParraine.split(' ').slice(1).join(' ') });
        const okMerci = await sendBrevo(emailDon, `🙏 Merci pour votre promesse de ${montantKm}€/km pour ${coureurParraine} !`, htmlMerci);
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
        ok = await sendBrevo(chefEmail, `🏅 Promesse de ${donateur} pour votre équipe ${equipeParraine} !`, html);
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
      if (equipe) { const s = await fetchOhmeStructureByName(equipe); if (s?.email_referent_defi_enfance) { const htmlE = tplDonEquipe({ chefPrenom: s.prenom_du_referent_defi_enfance || 'Bonjour', chefNom: s.nom_du_referent_defi_enfance || '', nomEquipe: equipe, donateur, montant, email_donateur: emailDon, coureurPrenom: coureurParraine.split(' ')[0], coureurNom: coureurParraine.split(' ').slice(1).join(' ') }); const okE = await sendBrevo(s.email_referent_defi_enfance, `❤️ Don de ${donateur} pour ${coureurParraine} — équipe ${equipe} !`, htmlE); if (okE) { state.stats.sent++; } } }
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
  'groupe_j1_joue_coureurs':         null, // sujet dynamique
  'groupe_j1_joue_referents':        null, // sujet dynamique
  'groupe_jourj_joue_coureurs':   '🏁 C\'est aujourd\'hui — votre dossard + tout ce qu\'il faut savoir !',
  'groupe_merci_coureurs_joue':   '💖 3000 km pour cette première édition à Joué !',
  'groupe_j1_joue_donateurs':      '❤️ Vendredi, votre soutien court avec eux ! 🌊',
  'groupe_j1_joue_supporters':     '🎉 Vendredi, votre présence fait toute la différence ! 🌊',
  'groupe_j1_angers_coureurs':    '🎽 Demain, c\'est le jour J ! 🎽',
  'groupe_j1_donateurs':          '❤️ Merci pour votre soutien — demain c\'est le grand jour !',
  'groupe_jourj_promesses':        '🏁 Vos promesses de don — le Défi Enfance a couru pour l\'enfance !',
  'groupe_merci_donateurs_joue_post':  '💖 3000 km pour l\'enfance — merci d\'avoir rendu cela possible !',
  'groupe_merci_supporters_joue':       '🎉 Vous étiez là — merci pour votre présence au Défi Enfance !',
  'groupe_merci_promettants_joue':  '💖 3000 km pour l\'enfance — concrétisez votre promesse de don !',
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
    'groupe_j1_joue_coureurs':       (prenom, nbJours, extra) => tplGroupeJ1JoueCoureurs({ prenom, nbJours, numeroDossard: extra?.numeroDossard || '', urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_jourj_joue_coureurs':   (prenom, nbJours, extra) => tplGroupeJourJJoueCoureurs({ prenom, numeroDossard: extra?.numeroDossard || '', urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_merci_coureurs_joue':   (prenom, nbJours, extra) => tplGroupeMerciCoureurJoue({ prenom, nomComplet: extra?.nomComplet || prenom, nomEquipe: extra?.nomEquipe || '', nomAsso: extra?.nomAsso || '', numeroDossard: extra?.numeroDossard || '', clTotal: extra?.clTotal || 0, clReel: extra?.clReel || 0, kmTotal: extra?.kmTotal || 0, kmReel: extra?.kmReel || 0, kmBonus: extra?.kmBonus || 0, clEquipeTotal: extra?.clEquipeTotal || 0, clEquipeReel: extra?.clEquipeReel || 0, kmEquipeTotal: extra?.kmEquipeTotal || 0, kmEquipeReel: extra?.kmEquipeReel || 0, urlPageCoureur: extra?.urlPageCoureur, urlDon: extra?.urlDon }),
    'groupe_j1_joue_donateurs':      (prenom, nbJours, extra) => tplGroupeJ1JoueDonateurs({ prenom, urlDon: extra?.urlDon, urlProm: extra?.urlProm }),
    'groupe_j1_joue_supporters':    (prenom, nbJours, extra) => tplGroupeJ1JoueSupporters({ prenom, urlDon: extra?.urlDon, urlProm: extra?.urlProm }),
    'groupe_j1_joue_referents':      (prenom, nbJours, extra) => tplGroupeJ1JoueReferents({ prenom, nomEquipe: extra?.nomEquipe || '', urlPromesseEquipe: extra?.urlPromesseEquipe, urlPageEquipe: extra?.urlPageEquipe }),
    'groupe_j10_joue_coureurs_v2':  (prenom, nbJours, extra) => tplGroupeJ10JoueV2({ prenom, nbJours, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_j1_angers_coureurs':  (prenom, nbJours, extra) => tplGroupeJ1Angers({ prenom, numeroDossard: extra?.numeroDossard, urlPageCoureur: extra?.urlPageCoureur, urlPromesseCoureur: extra?.urlPromesseCoureur }),
    'groupe_j1_donateurs':        (prenom, nbJours, extra) => tplGroupeJ1Donateurs({ prenom, historiqueHtml: extra?.historiqueHtml || '', urlDon: extra?.urlDon, urlProm: extra?.urlProm }),
    'groupe_jourj_promesses':     (prenom, nbJours, extra) => tplGroupeJourJPromesses({ prenom, promesses: extra?.promesses || [] }),
    'groupe_merci_donateurs_joue_post': (prenom, nbJours, extra) => tplGroupeMerciDonateursJouePostCourse({ prenom, historiqueHtml: extra?.historiqueHtml || '', totalDons: extra?.totalDons || 0, nbDons: extra?.nbDons || 0 }),
    'groupe_merci_supporters_joue':      (prenom, nbJours, extra) => tplGroupeMerciSupportersJoue({ prenom }),
    'groupe_merci_promettants_joue': (prenom, nbJours, extra) => tplGroupeMerciPromettantsJoue({ prenom, promesses: extra?.promesses || [] }),
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
  'promettants_joue':           ['Défi Enfance #Course #Joué-lès-Tours2026', 'Défi Enfance #Supporters #Joué-lès-Tours2026'],
  'donateurs_angers_global':    ['Défi Enfance #Course #Angers2026', 'Défi Enfance global'],
  'donateurs_joue':             ['Défi Enfance #Course #Joué-lès-Tours2026'],
  'supporters_joue':             ['Défi Enfance #Supporters #Joué-lès-Tours2026'],
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
    if (['angers_coureurs','joue_coureurs','joue_coureurs_equipe','merci_coureurs_joue','global_coureurs',
         'angers_supporters','joue_supporters','global_supporters','dejeuner'].includes(typeDestinataire)) {

      // Pré-charger contacts puis structures — seulement si cache vide
      if (['angers_coureurs','angers_coureurs_referents','joue_coureurs','joue_coureurs_equipe'].includes(typeDestinataire)) {
        const cacheChaud = contactsCache.size > 100 && structuresParNom.size > 10;
        if (!cacheChaud) {
          // Attendre que Ohme récupère si le poll vient de tourner
          const msSincePoll = Date.now() - (state.lastPollEndMs || 0);
          if (msSincePoll < 60000) {
            const attente = Math.ceil((60000 - msSincePoll) / 1000);
            addLog(`⏳ Pause ${attente}s — poll récent, ménagement Ohme avant chargement bulk…`, 'info');
            await sleep(60000 - msSincePoll);
          }
          addLog('📋 Cache froid — chargement bulk contacts + structures…', 'info');
          await chargerContactsBulk();
          await sleep(3000);
          await chargerStructuresBulk();
          await sleep(2000);
        } else {
          addLog(`✅ Cache chaud (${contactsCache.size} contacts, ${structuresParNom.size} structures) — pas de rechargement`, 'info');
        }
      }

      // ── Coureurs Joué : lecture directe depuis l'index codé en dur (0 appel Ohme)
      if (['joue_coureurs', 'joue_coureurs_equipe', 'merci_coureurs_joue'].includes(typeDestinataire)) {
        for (const [dossardStr, coureur] of Object.entries(DOSSARDS_JOUE_2026)) {
          const email  = coureur.email || '';
          if (!email) continue;
          // Équipe depuis l'index (champ equipe codé en dur)
          const equipe = (coureur.equipe || '').trim();
          const asso   = (coureur.asso   || '').trim();
          // Pour joue_coureurs_equipe : exclure les coureurs sans équipe et les solos
          if (typeDestinataire === 'joue_coureurs_equipe' && (!equipe || equipe === 'je cours solo')) continue;
          const prenom = coureur.prenom || '';
          const nom    = coureur.nom    || '';
          const dossard = parseInt(dossardStr);
          const runner  = coureur.runner || dossard;
          const urlPageCoureur     = runner ? `https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_event=${EVENT_ID_JOUE}&de_runner=${runner}` : '';
          const urlPromesseCoureur = runner ? `https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_event=${EVENT_ID_JOUE}&de_runner=${runner}&de_promise=1` : '';
          // Enrichissement classement — clé string dans l'objet JS
          const cl = CLASSEMENT_JOUE_2026[dossard] || CLASSEMENT_JOUE_2026[String(dossard)] || {};
          const eqData = equipe && CLASSEMENT_EQUIPES_JOUE[equipe] ? CLASSEMENT_EQUIPES_JOUE[equipe] : {};
          destinataires.push({
            prenom, nom, email, contactId: coureur.id, nomEquipe: equipe, nomAsso: asso, numeroDossard: dossard,
            urlPageCoureur, urlPromesseCoureur,
            clTotal: cl.cl_total || 0, clReel: cl.cl_reel || 0,
            kmTotal: cl.km_total || 0, kmReel: cl.km_reel || 0, kmBonus: cl.km_bonus || 0,
            clEquipeTotal: eqData.cl_total || 0, clEquipeReel: eqData.cl_reel || 0, kmEquipeTotal: eqData.km_total || 0, kmEquipeReel: eqData.km_reel || 0,
          });
        }
        if (typeDestinataire === 'merci_coureurs_joue') {
          addLog(`📦 Merci coureurs Joué : ${destinataires.length} coureurs (dont ${destinataires.filter(d => d.kmTotal > 0).length} avec kms classés)`, 'info');
        } else {
          addLog(`📦 Coureurs Joué depuis index : ${destinataires.length} trouvés`, 'info');
        }
        return destinataires;
      }

      const eventsAttendus = EVENTS_MAP[typeDestinataire] || [];
      let cursor = null;

      while (true) {
        await sleep(2500); // délai plus long entre pages pour éviter 429
        const url = cursor
          ? `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`
          : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&payment_type_id=3&since_date=2026-01-01`;

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

    // ── CAS 1b : Supporters (Angers ou Joué)
    else if (['supporters_joue', 'supporters_angers'].includes(typeDestinataire)) {
      const eventsAttendus = EVENTS_MAP[typeDestinataire] || [];
      for (const nomEvent of eventsAttendus) {
        const parts = await fetchParticipantsEvenement(nomEvent, ['supporter'], depuisFrance ? new Date('2026-01-01') : null);
        destinataires.push(...parts);
      }
      addLog(`📦 Supporters ${typeDestinataire} : ${destinataires.length} trouvés`, 'info');
      return destinataires;
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

// ── État des promesses de don (reconstruit au démarrage)
const promessesState = {
  items: [], // { id, event, eventLabel, donateur, email, contactId, cible, typeCible, montantKm, dateProm, concretise, dateDon, montantDon }
  loaded: false,
};

async function chargerPromesses() {
  if (promessesState.loaded) return;
  addLog('📋 Chargement des promesses de don…', 'info');
  let cursor = null;
  const DATE_SEUIL_ANGERS = new Date('2026-05-22');
  const DATE_SEUIL_JOUE   = new Date('2026-05-29');

  // Charger tous les paiements type 1 avec promesse_don_par_km > 0
  const promesses = [];
  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r?.ok) break;
    const j = await r.json();
    const items = j.data || [];
    for (const p of items) {
      const cf = p.custom_fields || p;
      const montantKm = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (!montantKm) continue;
      const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const isAngers = eventNom.includes('angers2026') || eventNom.includes('global');
      const isJoue   = eventNom.includes('joue');
      if (!isAngers && !isJoue) continue;
      const cible     = (cf.coureur_parraine || cf.equipe_parraine || '').trim();
      const typeCible = cf.coureur_parraine ? 'coureur' : 'equipe';
      if (!cible) continue;
      // Récupérer infos contact
      let donateur = '', email = '', contactId = p.contact_id;
      if (p.contact_id) {
        const contact = contactsCache.get(String(p.contact_id));
        if (contact) {
          donateur = `${contact.firstname || contact.first_name || ''} ${contact.lastname || contact.last_name || ''}`.trim();
          email = contact.email || '';
        } else {
          // Contact pas en cache — chercher via API
          await sleep(300);
          const rc = await fetchOhmeContactById(p.contact_id);
          if (rc) {
            donateur = `${rc.firstname || rc.first_name || ''} ${rc.lastname || rc.last_name || ''}`.trim();
            email = rc.email || '';
            contactsCache.set(String(p.contact_id), rc);
          }
        }
      } else if (p.structure_id) {
        // Paiement d'une structure — lookup par ID (O(1))
        const struct = structuresParNom.get(`id_${p.structure_id}`);
        if (struct) {
          const cf2 = struct.custom_fields || struct;
          const prenomRef = (cf2.prenom_du_referent_defi_enfance || '').trim();
          const nomRef    = (cf2.nom_du_referent_defi_enfance    || '').trim();
          donateur = prenomRef || nomRef ? `${prenomRef} ${nomRef}`.trim() : (struct.name || '');
          email    = (cf2.email_referent_defi_enfance || '').trim();
          contactId = `struct_${p.structure_id}`;
        } else {
          // Structure pas encore en cache → appel API direct
          await sleep(300);
          const rs = await fetchOhmeWithRetry(
            `${CONFIG.ohmeBase}/api/v1/structures/${p.structure_id}`,
            { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } }
          );
          if (rs?.ok) {
            const js2 = await rs.json();
            const struct2 = js2.data || js2;
            const cf2 = struct2.custom_fields || struct2;
            const prenomRef = (cf2.prenom_du_referent_defi_enfance || '').trim();
            const nomRef    = (cf2.nom_du_referent_defi_enfance    || '').trim();
            donateur = prenomRef || nomRef ? `${prenomRef} ${nomRef}`.trim() : (struct2.name || '');
            email    = (cf2.email_referent_defi_enfance || '').trim();
            contactId = `struct_${p.structure_id}`;
            // Mettre en cache
            if (struct2.name) {
              structuresParNom.set(struct2.name.trim(), struct2);
              structuresParNom.set(`id_${p.structure_id}`, struct2);
            }
          }
        }
      }
      promesses.push({
        id: p.id, event: isAngers ? 'angers' : 'joue',
        eventLabel: isAngers ? 'Angers' : 'Joué',
        donateur, email, contactId,
        cible, typeCible, montantKm,
        dateProm: p.date || p.created_at,
        concretise: false, dateDon: null, montantDon: null,
      });
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }

  // Vérifier les concrétisations — chercher un don (type 1 sans montant_promesse_don_par_km)
  // du même contact sur la même cible après la date seuil
  await sleep(OHME_DELAY_MS);
  const rDons = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2026-05-22`, {
    headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
  });
  if (rDons?.ok) {
    const jDons = await rDons.json();
    const dons = (jDons.data || []).filter(d => !parseFloat((d.custom_fields || d).montant_promesse_don_par_km || 0));
    for (const prom of promesses) {
      const seuil = prom.event === 'angers' ? DATE_SEUIL_ANGERS : DATE_SEUIL_JOUE;
      const don = dons.find(d => {
        const cf = d.custom_fields || d;
        const dateDon = new Date(d.date || d.created_at || 0);
        if (dateDon < seuil) return false;
        if (String(d.contact_id) !== String(prom.contactId)) return false;
        const cibleDon = (cf.coureur_parraine || cf.equipe_parraine || '').trim().toLowerCase();
        return cibleDon === prom.cible.toLowerCase();
      });
      if (don) {
        prom.concretise = true;
        prom.dateDon = don.date || don.created_at;
        prom.montantDon = parseFloat(don.amount || 0);
      }
    }
  }

  promessesState.items = promesses;
  promessesState.loaded = true;
  const nb = promesses.length;
  const nbC = promesses.filter(p => p.concretise).length;
  addLog(`✅ ${nb} promesse(s) chargée(s) — ${nbC} concrétisée(s)`, 'ok');
}

// ── Indexer supporters, donateurs et promettants depuis les paiements
async function indexerProfilsDepuisPaiements() {
  addLog('📋 Indexation supporters / donateurs / promettants...', 'info');
  let nbSup = 0, nbDon = 0, nbProm = 0;

  // ── Supporters : paiements type 3 avec qualite_du_participant = supporter
  let cursor = null;
  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=3&limit=250&since_date=2025-01-01&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=3&limit=250&since_date=2025-01-01`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r?.ok) break;
    const j = await r.json();
    const items = j.data || [];
    for (const p of items) {
      const cf = p.custom_fields || p;
      const contactId = String(p.contact_id || '');
      if (!contactId) continue;
      const contact = contactsCache.get(contactId);
      if (!contact) continue;
      const qualite = (cf.qualite_du_participant || '').toLowerCase();
      if (!qualite.includes('support')) continue;
      const eventNom = (p.nom_de_levent || cf.nom_de_levent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (eventNom.includes('angers')) { supportersAngers.set(contactId, contact); nbSup++; }
      if (eventNom.includes('joue'))   { supportersJoue.set(contactId, contact);   nbSup++; }
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }

  // ── Dons et promesses : paiements type 1
  cursor = null;
  while (true) {
    await sleep(OHME_DELAY_MS);
    const url = cursor
      ? `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01&cursor=${encodeURIComponent(cursor)}`
      : `${CONFIG.ohmeBase}/api/v1/payments?payment_type_id=1&limit=250&since_date=2025-01-01`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r?.ok) break;
    const j = await r.json();
    const items = j.data || [];
    for (const p of items) {
      const cf = p.custom_fields || p;
      const contactId = String(p.contact_id || '');
      if (!contactId) continue;
      const contact = contactsCache.get(contactId);
      if (!contact) continue;
      const montantKm = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (montantKm > 0) {
        promettantsCache.set(contactId, contact);
        nbProm++;
      } else if (parseFloat(p.amount || 0) > 0) {
        donateursCache.set(contactId, contact);
        nbDon++;
      }
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }

  addLog(`✅ Indexés — ${nbSup} supporters, ${nbDon} donateurs, ${nbProm} promettants`, 'ok');
}

// ── Cache bulk des structures par nom (chargé en une seule pagination)
const structuresParNom = new Map(); // nomStructure → structure

async function chargerStructuresBulk() {
  if (structuresParNom.size > 0) return;
  addLog('📋 Chargement bulk structures…', 'info');
  let cursor = null;
  let nb = 0;
  const equipesDefi = [];

  // Étape 1 : liste complète
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
        structuresParNom.set(s.name.trim(), s);
        structuresParNom.set(s.name.trim().toLowerCase(), s);
        if (s.id) structuresParNom.set(`id_${s.id}`, s);
        nb++;
        const cf = s.custom_fields || s;
        if (cf.equipe_defi_enfance === true || cf.equipe_defi_enfance === 'true') {
          equipesDefi.push(s.id);
        }
      }
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }
  addLog(`✅ ${nb} structures en cache — chargement détail pour ${equipesDefi.length} équipes Défi…`, 'ok');

  // Étape 2 : détail complet (custom_fields avec kms + classement) pour chaque équipe Défi
  let nbDetail = 0;
  for (const id of equipesDefi) {
    await sleep(OHME_DELAY_MS);
    // Pause supplémentaire toutes les 10 équipes pour ménager Ohme
    if (nbDetail > 0 && nbDetail % 10 === 0) {
      addLog(`📋 Pause 5s — ${nbDetail}/${equipesDefi.length} équipes chargées…`, 'info');
      await sleep(5000);
    }
    const rd = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/structures/${id}`, {
      headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
    });
    if (!rd?.ok) continue;
    const jd = await rd.json();
    const detail = jd.data || jd;
    if (detail.name) {
      structuresParNom.set(detail.name.trim(), detail);
      structuresParNom.set(detail.name.trim().toLowerCase(), detail);
      structuresParNom.set(`id_${id}`, detail);
      nbDetail++;
    }
  }
  addLog(`✅ ${nbDetail} équipes Défi chargées en détail (kms, classement)`, 'ok');
}


// ── Cache global des contacts par dossard (chargé en bulk, ~3 appels API seulement)
const contactsParDossard = new Map(); // dossard → contact
const contactsParId      = new Map(); // contactId → contact

async function chargerContactsBulk() {
  if (contactsCache.size > 100) return; // déjà chargé (>100 contacts en cache)
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
      // Indexer par dossard Joué
      const dossardJoue = parseInt(cf.numero_de_dossard_joue2026 || c.numero_de_dossard_joue2026 || 0);
      if (dossardJoue) contactsParDossardJoue.set(dossardJoue, c);
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

  // Charger le cache bulk contacts + structures — seulement si nécessaire
  if (contactsCache.size <= 100) await chargerContactsBulk();
  if (structuresParNom.size <= 10) await chargerStructuresBulk();

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
          kmsParraine   = parseFloat(cfC.km_parcourus_angers2026 || 0);
          classParraine = parseInt(cfC.classement_angers2026     || 0);
          // Trouver l'équipe via equipeParContactId (paiements billetterie)
          equipeParraine2 = equipeParContactId.get(String(contactCoureur.id)) || '';
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

// ── Vérifier si un don concrétise une promesse antérieure du même donateur

// ── Construire le récap dons + promesses d'un donateur pour les emails de concrétisation
async function buildRecapDonateurCible(contactId, cible, typeCible, eventName) {
  try {
    await sleep(OHME_DELAY_MS);
    const url = `${CONFIG.ohmeBase}/api/v1/payments?contact_id=${contactId}&payment_type_id=1&limit=50&since_date=2025-01-01`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r?.ok) return { motEncouragement: '', recapHtml: '' };
    const j = await r.json();
    const paiements = j.data || [];

    const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isAngers = normalize(eventName).includes('angers');
    const DATE_SEUIL = isAngers ? new Date('2026-05-22') : new Date('2026-05-29');

    let motEncouragement = '';
    const lignes = [];

    for (const p of paiements) {
      const cf = p.custom_fields || p;
      const montantKm = parseFloat(cf.montant_promesse_don_par_km || 0);
      const montant   = parseFloat(p.amount || 0);
      const cibleP    = (cf.coureur_parraine || cf.equipe_parraine || '').trim();
      const dateP     = new Date(p.date || p.created_at || 0);
      const dateStr   = dateP.toLocaleDateString('fr-FR');

      // Mot d'encouragement sur le paiement concerné
      if (!motEncouragement && cf.mot_encouragement_sur_mur && cibleP.toLowerCase() === cible.toLowerCase()) {
        motEncouragement = cf.mot_encouragement_sur_mur;
      }

      if (montantKm > 0 && cibleP) {
        // C'est une promesse
        const estConcretisee = dateP >= DATE_SEUIL && cibleP.toLowerCase() === cible.toLowerCase() ? false : false;
        // Vérifier concrétisation dans promessesState
        const promState = promessesState.items.find(pr => String(pr.contactId) === String(contactId) && pr.cible.toLowerCase() === cibleP.toLowerCase());
        const check = promState?.concretise ? '✅' : '⏳';
        lignes.push(`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede8ff;font-size:.8rem;color:#3d1830">
          <div><span style="font-size:.72rem;color:#888">${dateStr}</span><br>${typeCible === 'coureur' ? '🏃' : '🏆'} <strong>${cibleP}</strong> — Promesse <span style="color:#7c3aed;font-weight:700">${montantKm} €/km</span> ${check}</div>
        </div>`);
      } else if (montant > 0 && cibleP) {
        // C'est un don direct
        const emoji = typeCible === 'coureur' ? '🏃' : '🏆';
        lignes.push(`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede8ff;font-size:.8rem;color:#3d1830">
          <div><span style="font-size:.72rem;color:#888">${dateStr}</span><br>${emoji} <strong>${cibleP}</strong> — Don</div>
          <div style="font-weight:700;color:#fb0089;white-space:nowrap;padding-left:8px">${montant.toFixed(2)} €</div>
        </div>`);
      }
    }

    const recapHtml = lignes.length ? `
<div style="background-color:#f9f7ff;border:1.5px solid rgba(124,58,237,0.2);border-radius:10px;padding:14px 18px;margin-bottom:16px">
  <div style="font-size:.72rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">📋 Vos dons & promesses au Défi Enfance</div>
  ${lignes.join('')}
</div>` : '';

    return { motEncouragement, recapHtml };
  } catch(e) { return { motEncouragement: '', recapHtml: '' }; }
}

async function verifierConcretisationPromesse(contactId, emailDon, coureurParraine, equipeParraine, eventName, dateDon) {
  if (!contactId && !emailDon) return null;
  try {
    // Dates seuil selon l'événement
    const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const eventN = normalize(eventName);
    const isAngers = eventN.includes('angers');
    const isJoue   = eventN.includes('joue');
    const dateSeuil = isAngers ? new Date('2026-05-22') : isJoue ? new Date('2026-05-29') : null;
    if (!dateSeuil) return null;
    const dateD = new Date(dateDon || Date.now());
    if (dateD < dateSeuil) return null;

    // Chercher les promesses du même contact sur le même coureur/équipe
    await sleep(OHME_DELAY_MS);
    const url = contactId
      ? `${CONFIG.ohmeBase}/api/v1/payments?contact_id=${contactId}&limit=50&since_date=2025-01-01`
      : `${CONFIG.ohmeBase}/api/v1/payments?limit=250&since_date=2025-01-01`;
    const r = await fetchOhmeWithRetry(url, { headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret } });
    if (!r?.ok) return null;
    const j = await r.json();
    const paiements = j.data || [];

    for (const pmt of paiements) {
      const cf = pmt.custom_fields || pmt;
      const montantKm = parseFloat(cf.montant_promesse_don_par_km || 0);
      if (!montantKm) continue;
      const coureurProm = (cf.coureur_parraine || '').trim();
      const equipeProm  = (cf.equipe_parraine  || '').trim();
      // Correspondance coureur ou équipe
      if (coureurParraine && coureurProm && coureurProm.toLowerCase() === coureurParraine.toLowerCase()) return { montantKm, typeCible: 'coureur', nomCible: coureurParraine };
      if (equipeParraine  && equipeProm  && equipeProm.toLowerCase()  === equipeParraine.toLowerCase())  return { montantKm, typeCible: 'equipe',  nomCible: equipeParraine };
    }
    return null;
  } catch(e) { return null; }
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

// ── Promettants Joué 2026 — enrichis avec classement CLASSEMENT_JOUE_2026
async function fetchPromettantsJoueAvecPromesses() {
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
      // Filtrer sur Joué
      if (!eventName.includes('JOUE') && !eventName.includes('JOUÉ') && !eventName.includes('TOURS')) continue;
      const coureurParraine = (cf.coureur_parraine || '').trim();
      const equipeParraine  = (cf.equipe_parraine  || '').trim();
      if (!coureurParraine && !equipeParraine) continue;
      await sleep(OHME_CONTACT_DELAY_MS);
      let contact = await fetchOhmeContactById(p.contact_id);
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
      if (coureurParraine) {
        // Chercher le dossard du coureur via DOSSARDS_JOUE_2026 (recherche par nom)
        let clCoureur = null;
        const nomNorm = coureurParraine.toLowerCase().trim();
        for (const [dos, c] of Object.entries(DOSSARDS_JOUE_2026)) {
          const nomComplet = ((c.prenom || '') + ' ' + (c.nom || '')).toLowerCase().trim();
          const nomInverse = ((c.nom || '') + ' ' + (c.prenom || '')).toLowerCase().trim();
          if (nomNorm === nomComplet || nomNorm === nomInverse || nomNorm === (c.nom || '').toLowerCase()) {
            clCoureur = CLASSEMENT_JOUE_2026[parseInt(dos)];
            break;
          }
        }
        const kmParcourus = clCoureur?.km_total || 0;
        const kmReel      = clCoureur?.km_reel  || 0;
        const clTotal     = clCoureur?.cl_total || 0;
        const clReel      = clCoureur?.cl_reel  || 0;
        const montantDu   = kmParcourus > 0 ? Math.round(kmParcourus * montantKm * 100) / 100 : 0;
        promettantsMap.get(email).promesses.push({ type: 'coureur', nom: coureurParraine, montantKm, kmParcourus, kmReel, clTotal, clReel, montantDu, urlDon: 'https://defienfance.fr/faire-un-don/' });
      } else if (equipeParraine) {
        const eqData = CLASSEMENT_EQUIPES_JOUE[equipeParraine] || {};
        const kmParcourus = eqData.km_total || 0;
        const kmReel      = eqData.km_reel  || 0;
        const clTotal     = eqData.cl_total || 0;
        const clReel      = eqData.cl_reel  || 0;
        const montantDu   = kmParcourus > 0 ? Math.round(kmParcourus * montantKm * 100) / 100 : 0;
        promettantsMap.get(email).promesses.push({ type: 'equipe', nom: equipeParraine, montantKm, kmParcourus, kmReel, clTotal, clReel, montantDu, urlDon: 'https://defienfance.fr/faire-un-don/' });
      }
    }
    if (items.length < 250) break;
    cursor = j.cursor || (items.length > 0 ? String(items[items.length - 1].id) : null);
    if (!cursor) break;
  }
  addLog(`✅ ${promettantsMap.size} promettant(s) Joué trouvés`, 'ok');
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
  if (envoiGroupe.previewing) return res.json({ error: 'Un comptage est déjà en cours, veuillez patienter…' });
  envoiGroupe.previewing = true;
  const { typeDestinataire, filtreEquipe, depuisFrance, nbJours, template, choixDoublons } = req.body;
  if (!typeDestinataire) { envoiGroupe.previewing = false; return res.json({ error: 'typeDestinataire requis' }); }
  if (!template) { envoiGroupe.previewing = false; return res.json({ error: 'template requis' }); }

  try {
    envoiGroupeLog(`🔍 Comptage : ${typeDestinataire}…`, 'info');
    const tous = typeDestinataire === 'promettants_angers'
      ? (await fetchPromettantsAvecPromesses()).map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_promesses: p.promesses }))
      : typeDestinataire === 'promettants_joue'
      ? (await fetchPromettantsJoueAvecPromesses()).map(p => ({ prenom: p.prenom, nom: p.nom, email: p.email, contactId: p.contactId, extra_promesses: p.promesses }))
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
    envoiGroupe.previewing = false;
    res.json({ error: e.message });
  } finally {
    envoiGroupe.previewing = false;
  }
});
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
        if (typeDestinataire === 'promettants_joue') {
          const promettants = await fetchPromettantsJoueAvecPromesses();
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
            historiqueHtml:      formatHistoriqueDons(await fetchHistoriqueDons(p.contactId)),
            urlDon:              await buildUrlPageCoureur(p.contactId, p.eventName),
            urlProm:             await buildUrlPromesseCoureur(p.contactId, p.eventName),
            promesses:           p.extra_promesses || [],
            historiqueHtml:      p.extra_historique || '',
            totalDons:           p.extra_total || 0,
            nbDons:              p.extra_nb || 0,
            kmsPerso:            p.kmsPerso            || 0,
            classementPerso:     p.classementPerso     || 0,
            kmsEquipe:           p.kmsEquipe           || 0,
            classementEquipe:    p.classementEquipe    || 0,
            // Classements Joué
            clTotal:             p.clTotal             || 0,
            clReel:              p.clReel              || 0,
            kmTotal:             p.kmTotal             || 0,
            kmReel:              p.kmReel              || 0,
            kmBonus:             p.kmBonus             || 0,
            clEquipeTotal:       p.clEquipeTotal       || 0,
            clEquipeReel:        p.clEquipeReel        || 0,
            kmEquipeTotal:       p.kmEquipeTotal       || 0,
            nomComplet:          (p.prenom + ' ' + (p.nom || '')).trim(),
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
          } else if (template === 'groupe_j1_joue_coureurs') {
            sujetFinal = `🌊 ${p.prenom || 'Coureur'}, ${nbJours === 1 ? 'demain' : 'dans ' + nbJours + ' jours'} — Joué court pour l'enfance sous 35°C et sous les arbres !`;
          } else if (template === 'groupe_j1_joue_referents') {
            sujetFinal = `🏆 ${p.prenom || 'Référent'}, votre équipe ${p.nomEquipe || ''} entre en scène demain — tout ce qu'il faut savoir !`;
          } else if (template === 'groupe_merci_donateurs_angers') {
            sujetFinal = `❤️ Merci ${p.prenom || ''} — vous êtes les pionniers du Défi Enfance Angers 2026 !`;
          } else if (template === 'groupe_merci_donateurs_joue') {
            sujetFinal = `🏁 ${p.prenom || ''}, Angers a couru — Joué-lès-Tours entre en scène !`;
          } else if (template === 'groupe_j2_referents_joue') {
            sujetFinal = `🏃 ${p.prenom || ''} — Boost collecte Joué ! Dans ${nbJours || 7} jours, c'est votre tour !`;
          } else if (template === 'groupe_jourj_joue_coureurs') {
            sujetFinal = `🏁 ${p.prenom || 'Coureur'}, c'est aujourd'hui — votre dossard + tout ce qu'il faut savoir !`;
          } else if (template === 'groupe_merci_coureurs_joue') {
            sujetFinal = `💖 3000 km pour cette première édition à Joué !`;
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

// ── POST /api/promesses/:idx/relancer — envoyer email de relance à un promettant
app.post('/api/promesses/:idx/relancer', async (req, res) => {
  const idx = parseInt(req.params.idx);
  const prom = promessesState.items[idx];
  if (!prom) return res.json({ success: false, error: 'Promesse introuvable' });
  if (prom.concretise) return res.json({ success: false, error: 'Déjà concrétisée' });
  if (!prom.email) return res.json({ success: false, error: 'Email donateur manquant' });

  try {
    // Récupérer les kms et montant calculé
    let kmsParcourus = 0, urlDon = URL_COUREURS;
    if (prom.typeCible === 'coureur') {
      const contact = [...contactsCache.values()].find(c => {
        const n = `${c.firstname||''} ${c.lastname||''}`.trim();
        return n.toLowerCase() === prom.cible.toLowerCase();
      });
      if (contact) {
        const cf = contact.custom_fields || contact;
        kmsParcourus = prom.event === 'angers'
          ? parseFloat(cf.km_parcourus_angers2026 || 0)
          : parseFloat(cf.km_parcourus_joue2026   || 0);
        // Fallback sur l'index codé en dur via le dossard
        if (!kmsParcourus) {
          const cfDossard = parseInt(cf.numero_dossard_angers_2026 || cf.numero_de_dossard_joue2026 || 0);
          if (cfDossard && CLASSEMENT_INDIVIDUEL[cfDossard]) {
            kmsParcourus = CLASSEMENT_INDIVIDUEL[cfDossard].kms || 0;
          }
        }
        urlDon = await buildUrlPageCoureur(contact.id, prom.event === 'angers' ? 'Défi Enfance #Course #Angers2026' : 'DÉFI ENFANCE #COURSE #JOUÉ-LÈS-TOURS2026');
      }
    } else {
      const structure = structuresParNom.get(prom.cible) || structuresParNom.get(prom.cible.toLowerCase());
      if (structure) {
        const cfS = structure.custom_fields || structure;
        kmsParcourus = parseFloat(cfS.km_parcourus_equipe_angers_2026 || 0);
        // Fallback sur l'index codé en dur si le champ Ohme est vide
        if (!kmsParcourus && CLASSEMENT_EQUIPES[prom.cible]) {
          kmsParcourus = CLASSEMENT_EQUIPES[prom.cible].kms || 0;
        }
        urlDon = await buildUrlPageEquipe(null, prom.cible, prom.event === 'angers' ? 'Défi Enfance #Course #Angers2026' : 'DÉFI ENFANCE #COURSE #JOUÉ-LÈS-TOURS2026');
      } else if (CLASSEMENT_EQUIPES[prom.cible]) {
        // Structure pas en cache mais dans l'index
        kmsParcourus = CLASSEMENT_EQUIPES[prom.cible].kms || 0;
        urlDon = await buildUrlPageEquipe(null, prom.cible, prom.event === 'angers' ? 'Défi Enfance #Course #Angers2026' : 'DÉFI ENFANCE #COURSE #JOUÉ-LÈS-TOURS2026');
      }
    }
    const montantDu = kmsParcourus > 0 ? Math.round(kmsParcourus * prom.montantKm * 100) / 100 : 0;

    const html = tplRelancePromesse({ prenomDonateur: prom.donateur.split(' ')[0] || 'Cher donateur', montantKm: prom.montantKm, nomCible: prom.cible, typeCible: prom.typeCible, kmsParcourus, montantDu, urlDon: urlDon || URL_COUREURS });
    const sujet = `🏅 ${prom.donateur.split(' ')[0]}, votre promesse de ${prom.montantKm}€/km pour ${prom.cible} attend d'être concrétisée !`;
    const ok = await sendBrevo(prom.email, sujet, html);
    if (ok) {
      addLog(`✅ Relance promesse envoyée à ${prom.email} (${prom.cible})`, 'ok');
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Erreur envoi Brevo' });
    }
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ── POST /api/promesses/:idx/concretiser — marquer manuellement comme concrétisée
app.post('/api/promesses/:idx/concretiser', async (req, res) => {
  const idx = parseInt(req.params.idx);
  const prom = promessesState.items[idx];
  if (!prom) return res.json({ success: false, error: 'Promesse introuvable' });
  const { montantDon } = req.body;
  prom.concretise = true;
  prom.dateDon = new Date().toISOString();
  prom.montantDon = parseFloat(montantDon) || null;
  addLog(`✅ Promesse marquée manuellement concrétisée : ${prom.donateur} → ${prom.cible}${montantDon ? ' (' + montantDon + ' €)' : ''}`, 'ok');
  res.json({ success: true });
});


// ── POST /api/envoi-cible — envoi ciblé par contact IDs
app.post('/api/envoi-cible', async (req, res) => {
  const { contactIds, template, nbJours, testEmail } = req.body;
  if (!contactIds?.length) return res.json({ success: false, error: 'contactIds requis' });
  if (!template) return res.json({ success: false, error: 'template requis' });
  if (envoiGroupe.running) return res.json({ success: false, error: 'Un envoi groupé est déjà en cours' });

  addLog(`🎯 Envoi ciblé — ${contactIds.length} contact(s) → template: ${template}`, 'info');
  let sent = 0, errors = 0;

  for (const contactId of contactIds) {
    try {
      await sleep(OHME_DELAY_MS);
      // Récupérer le contact depuis le cache ou Ohme
      let contact = contactsCache.get(String(contactId));
      if (!contact) {
        const r = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/contacts/${contactId}`, {
          headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
        });
        if (!r?.ok) { errors++; addLog(`⚠️ Contact ${contactId} introuvable`, 'warn'); continue; }
        const j = await r.json(); contact = j.data || j;
        if (contact?.id) contactsCache.set(String(contact.id), contact);
      }
      const cf = contact.custom_fields || contact;
      const prenom = (cf.first_name || contact.first_name || '').split(' ')[0] || 'Participant';
      const nom    = cf.last_name  || contact.last_name  || '';
      const email  = cf.email      || contact.email      || '';
      if (!email) { errors++; addLog(`⚠️ Pas d'email pour contact ${contactId}`, 'warn'); continue; }

      // Chercher le dossard Joué
      const dossardJoue = cf.numero_de_dossard_joue2026 || '';
      // URL page coureur Joué
      const runnerJoue = cf.numero_runner_joue2026 || dossardJoue || '';
      const urlPageCoureur = runnerJoue ? `https://defienfance.fr/suivre-la-collecte-defi-enfance/?de_view=runners&de_event=${EVENT_ID_JOUE}&de_runner=${runnerJoue}` : '';
      const urlPromesseCoureur = urlPageCoureur ? urlPageCoureur + '&de_promise=1' : '';
      const nomEquipe = cf.equipe_defi_enfance_coureur || '';

      const tplFn = TEMPLATES_GROUPES[template];
      if (!tplFn) { errors++; addLog(`⚠️ Template inconnu: ${template}`, 'warn'); continue; }

      const html = tplFn(prenom, nbJours || 1, {
        numeroDossard: dossardJoue,
        urlPageCoureur, urlPromesseCoureur,
        nomEquipe, nomComplet: `${prenom} ${nom}`.trim()
      });

      // Sujet
      let sujetFinal = TEMPLATES_SUJETS[template] || template;
      if (template === 'groupe_jourj_joue_coureurs') sujetFinal = `🏁 ${prenom}, c'est aujourd'hui — votre dossard + tout ce qu'il faut savoir !`;
      else if (template === 'groupe_j1_joue_coureurs') sujetFinal = `🌊 ${prenom}, Joué court pour l'enfance sous 35°C — tout ce qu'il faut savoir !`;
      else sujetFinal = sujetFinal.replace(/\${prenom}/g, prenom);

      const destinEmail = testEmail || email;
      if (testEmail) addLog(`🧪 Mode test — envoi vers ${testEmail} au lieu de ${email}`, 'info');
      const ok = await sendBrevo(destinEmail, sujetFinal, html);
      if (ok) { sent++; addLog(`✅ Ciblé → ${prenom} ${nom} (${destinEmail})`, 'ok'); }
      else     { errors++; addLog(`❌ Échec → ${destinEmail}`, 'error'); }
    } catch(e) {
      errors++;
      addLog(`❌ Exception contact ${contactId} : ${e.message}`, 'error');
    }
  }

  addLog(`🎯 Envoi ciblé terminé — ${sent} envoyé(s), ${errors} erreur(s)`, 'ok');
  res.json({ success: true, sent, errors });
});

// ── POST /api/cache/prechauffer — préchauffer le cache contacts + structures
app.post('/api/cache/prechauffer', async (req, res) => {
  try {
    const deja = contactsCache.size > 100 && structuresParNom.size > 10;
    if (deja) return res.json({ success: true, message: `Cache déjà chaud — ${contactsCache.size} contacts, ${structuresParNom.size} structures`, chaud: true });
    // Forcer reset pour recharger même si partiellement chaud
    contactsCache.clear();
    structuresParNom.clear();
    state.prechauffage = true; // suspend le poll
    addLog('🔥 Préchauffage manuel du cache…', 'info');
    await chargerContactsBulk();
    await sleep(3000);
    await chargerStructuresBulk();
    await sleep(2000);
    // Indexer supporters, donateurs et promettants depuis les paiements
    await indexerProfilsDepuisPaiements();
    state.prechauffage = false;
    const resume = `${contactsCache.size} contacts (${contactsParDossard.size} coureurs Angers, ${contactsParDossardJoue.size} coureurs Joué), ${structuresParNom.size / 3 | 0} structures, ${donateursCache.size} donateurs, ${promettantsCache.size} promettants`;
    addLog(`✅ Cache préchauffé — ${resume}`, 'ok');
    res.json({ success: true, message: `Cache préchauffé — ${resume}`, chaud: false });
  } catch(e) {
    state.prechauffage = false;
    res.json({ success: false, error: e.message });
  }
});

// ── GET /api/cache/status — état du cache
app.get('/api/cache/status', (req, res) => {
  res.json({
    contacts: contactsCache.size,
    courseursAngers: contactsParDossard.size,
    courseursJoue: contactsParDossardJoue.size,
    structures: Math.round(structuresParNom.size / 3),
    donateurs: donateursCache.size,
    promettants: promettantsCache.size,
    chaud: contactsCache.size > 100 && structuresParNom.size > 10,
  });
});

// ── GET /api/promesses — liste des promesses avec statut
app.get('/api/promesses', async (req, res) => {
  if (!promessesState.loaded) {
    await chargerContactsBulk();
    await chargerPromesses();
  }
  res.json({ success: true, items: promessesState.items, total: promessesState.items.length, concretises: promessesState.items.filter(p => p.concretise).length });
});

// ── Recharger les kms depuis Ohme pour les cibles des promesses actives
async function rechargerKmsCibles() {
  const promessesActives = promessesState.items.filter(p => !p.concretise);
  addLog(`🔄 Rechargement kms pour ${promessesActives.length} promesse(s) active(s)…`, 'info');

  for (const prom of promessesActives) {
    try {
      if (prom.typeCible === 'coureur') {
        // Chercher le contact par nom dans le cache
        const contact = [...contactsCache.values()].find(c => {
          const n = `${c.firstname||c.first_name||''} ${c.lastname||c.last_name||''}`.trim();
          return n.toLowerCase() === prom.cible.toLowerCase();
        });
        if (contact?.id) {
          await sleep(OHME_DELAY_MS);
          const rd = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/contacts/${contact.id}`, {
            headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
          });
          if (rd?.ok) {
            const jd = await rd.json();
            const detail = jd.data || jd;
            contactsCache.set(String(contact.id), detail);
            const cf = detail.custom_fields || detail;
            const kms = prom.event === 'angers'
              ? parseFloat(cf.km_parcourus_angers2026 || 0)
              : parseFloat(cf.km_parcourus_joue2026   || 0);
            if (kms > 0) addLog(`✅ Kms chargés pour ${prom.cible} : ${kms} km`, 'info');
          }
        }
      } else {
        // Équipe — déjà chargée en détail dans chargerStructuresBulk
        // Forcer le rechargement si besoin
        const struct = structuresParNom.get(prom.cible) || structuresParNom.get(prom.cible.toLowerCase());
        if (struct?.id) {
          await sleep(OHME_DELAY_MS);
          const rd = await fetchOhmeWithRetry(`${CONFIG.ohmeBase}/api/v1/structures/${struct.id}`, {
            headers: { 'Accept': 'application/json', 'client-name': CONFIG.ohmeClientName, 'client-secret': CONFIG.ohmeClientSecret }
          });
          if (rd?.ok) {
            const jd = await rd.json();
            const detail = jd.data || jd;
            structuresParNom.set(prom.cible, detail);
            structuresParNom.set(prom.cible.toLowerCase(), detail);
            structuresParNom.set(`id_${struct.id}`, detail);
            const cf = detail.custom_fields || detail;
            const kms = parseFloat(cf.km_parcourus_equipe_angers_2026 || 0);
            if (kms > 0) addLog(`✅ Kms équipe chargés pour ${prom.cible} : ${kms} km`, 'info');
          }
        }
      }
    } catch(e) { addLog(`⚠️ Erreur rechargement kms ${prom.cible} : ${e.message}`, 'warn'); }
  }
  addLog('✅ Rechargement kms terminé', 'ok');
}

// ── POST /api/promesses/reload — recharger depuis Ohme
app.post('/api/promesses/reload', async (req, res) => {
  promessesState.loaded = false;
  promessesState.items = [];
  await chargerContactsBulk();
  await chargerPromesses();
  await rechargerKmsCibles(); // recharger les kms depuis Ohme pour les cibles actives
  res.json({ success: true, total: promessesState.items.length, concretises: promessesState.items.filter(p => p.concretise).length });
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
    } else if (typeDestinataire === 'promettants_joue') {
      const promettants = await fetchPromettantsJoueAvecPromesses();
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
      const sujetBase = TEMPLATES_SUJETS[template] || template;
      const sujet = `🧪 [TEST ${modeles.indexOf(modele)+1}/2] ${sujetBase}`.trim();
      const extra = {
        nomAsso: modele.nomAsso || '', nomEquipe: modele.nomEquipe || '',
        urlPageCoureur: URL_COUREURS, urlPromesseCoureur: URL_PROMESSE_FALLBACK,
        urlPageEquipe: URL_EQUIPES, numeroDossard: modele.numeroDossard || '',
        promesses: modele.extra_promesses || [],
        historiqueHtml: modele.extra_historique || '',
        totalDons: modele.extra_total || 0, nbDons: modele.extra_nb || 0,
        kmsPerso: modele.kmsPerso || 0, classementPerso: modele.classementPerso || 0,
        kmsEquipe: modele.kmsEquipe || 0, classementEquipe: modele.classementEquipe || 0,
        // Classements Joué
        clTotal: modele.clTotal || 0, clReel: modele.clReel || 0,
        kmTotal: modele.kmTotal || 0, kmReel: modele.kmReel || 0, kmBonus: modele.kmBonus || 0,
        clEquipeTotal: modele.clEquipeTotal || 0, clEquipeReel: modele.clEquipeReel || 0,
        kmEquipeTotal: modele.kmEquipeTotal || 0,
        kmEquipeReel: modele.kmEquipeReel || 0,
        nomComplet: (modele.prenom + ' ' + (modele.nom || '')).trim(),
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
//  EMAILING PERSONNALISÉ (Excel + HTML avec {{variables}})
// ══════════════════════════════════════════════════════

// État de l'envoi emailing perso
const emailingPerso = {
  running: false, total: 0, done: 0, sent: 0, errors: 0, skipped: 0,
  startedAt: null, finishedAt: null, log: [],
};
function emailingPersoLog(msg, type = 'info') {
  emailingPerso.log.unshift({ time: new Date().toISOString(), msg, type });
  if (emailingPerso.log.length > 300) emailingPerso.log.pop();
  addLog(msg, type);
}

// Remplace {{variable}} par la valeur de la ligne (insensible à la casse et aux espaces)
function appliquerVariables(template, ligne) {
  if (!template) return '';
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key) => {
    const keyNorm = key.toLowerCase().trim();
    // Chercher la colonne correspondante (insensible casse/espaces/accents partiels)
    for (const col of Object.keys(ligne)) {
      if (col.toLowerCase().trim() === keyNorm) {
        return (ligne[col] != null ? String(ligne[col]) : '');
      }
    }
    return match; // si pas trouvé, laisser le {{...}} visible pour repérage
  });
}

// Trouver la colonne email dans une ligne (heuristique)
function trouverEmail(ligne) {
  for (const col of Object.keys(ligne)) {
    const c = col.toLowerCase().trim();
    if (c === 'email' || c === 'e-mail' || c === 'mail' || c === 'courriel' || c === 'adresse email' || c === 'adresse e-mail') {
      const v = (ligne[col] || '').toString().trim();
      if (v.includes('@')) return v;
    }
  }
  // Fallback : n'importe quelle colonne contenant un @
  for (const col of Object.keys(ligne)) {
    const v = (ligne[col] || '').toString().trim();
    if (v.includes('@') && v.includes('.')) return v;
  }
  return null;
}

// TEST : envoie les N premiers emails à une adresse de test
app.post('/api/emailing-perso/test', async (req, res) => {
  if (emailingPerso.running) return res.json({ error: 'Un envoi est déjà en cours' });
  const { lignes, htmlTemplate, sujetTemplate, emailTest, nbTest } = req.body || {};
  if (!Array.isArray(lignes) || lignes.length === 0) return res.json({ error: 'Aucun destinataire (Excel vide ou non chargé)' });
  if (!htmlTemplate || !htmlTemplate.trim()) return res.json({ error: 'HTML d\'emailing manquant' });
  if (!sujetTemplate || !sujetTemplate.trim()) return res.json({ error: 'Objet (sujet) manquant' });
  if (!emailTest || !emailTest.includes('@')) return res.json({ error: 'Email de test invalide' });

  const n = Math.min(parseInt(nbTest) || 3, lignes.length, 10);
  const resultats = [];
  try {
    for (let i = 0; i < n; i++) {
      const ligne = lignes[i];
      const html = appliquerVariables(htmlTemplate, ligne);
      const sujetPerso = appliquerVariables(sujetTemplate, ligne);
      const sujet = `🧪 [TEST ${i+1}/${n}] ${sujetPerso}`;
      const ok = await sendBrevo(emailTest, sujet, html);
      const emailReel = trouverEmail(ligne);
      resultats.push({ index: i+1, emailReel: emailReel || '(email introuvable dans cette ligne)', ok });
      emailingPersoLog(`🧪 Test ${i+1}/${n} → ${emailTest} (données de ${emailReel || '?'}) : ${ok ? 'OK' : 'ÉCHEC'}`, ok ? 'ok' : 'error');
      await sleep(2000);
    }
    res.json({ success: true, envoyes: resultats.filter(r => r.ok).length, resultats, emailTest });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ENVOI RÉEL : envoie à tous les destinataires de l'Excel
app.post('/api/emailing-perso/start', async (req, res) => {
  if (emailingPerso.running) return res.json({ error: 'Un envoi est déjà en cours' });
  const { lignes, htmlTemplate, sujetTemplate } = req.body || {};
  if (!Array.isArray(lignes) || lignes.length === 0) return res.json({ error: 'Aucun destinataire' });
  if (!htmlTemplate || !htmlTemplate.trim()) return res.json({ error: 'HTML manquant' });
  if (!sujetTemplate || !sujetTemplate.trim()) return res.json({ error: 'Objet manquant' });

  // Répondre immédiatement, envoi en arrière-plan
  emailingPerso.running = true;
  emailingPerso.total = lignes.length;
  emailingPerso.done = 0; emailingPerso.sent = 0; emailingPerso.errors = 0; emailingPerso.skipped = 0;
  emailingPerso.startedAt = new Date().toISOString();
  emailingPerso.finishedAt = null;
  emailingPerso.log = [];
  res.json({ success: true, total: lignes.length });

  (async () => {
    emailingPersoLog(`📨 Démarrage emailing personnalisé — ${lignes.length} destinataire(s)`, 'info');
    const emailsVus = new Set();
    for (const ligne of lignes) {
      const email = trouverEmail(ligne);
      if (!email) {
        emailingPerso.skipped++; emailingPerso.done++;
        emailingPersoLog(`⏭️ Ligne sans email valide — ignorée`, 'warn');
        continue;
      }
      const emailNorm = email.toLowerCase().trim();
      if (emailsVus.has(emailNorm)) {
        emailingPerso.skipped++; emailingPerso.done++;
        emailingPersoLog(`⏭️ Doublon ${email} — ignoré`, 'warn');
        continue;
      }
      emailsVus.add(emailNorm);
      const html = appliquerVariables(htmlTemplate, ligne);
      const sujet = appliquerVariables(sujetTemplate, ligne);
      const ok = await sendBrevo(email, sujet, html);
      if (ok) { emailingPerso.sent++; emailingPersoLog(`✅ ${email}`, 'ok'); }
      else    { emailingPerso.errors++; emailingPersoLog(`❌ ${email}`, 'error'); }
      emailingPerso.done++;
      await sleep(1500);
    }
    emailingPerso.running = false;
    emailingPerso.finishedAt = new Date().toISOString();
    emailingPersoLog(`🏁 Terminé — ${emailingPerso.sent} envoyé(s), ${emailingPerso.errors} erreur(s), ${emailingPerso.skipped} ignoré(s)`, 'ok');
  })().catch(e => {
    emailingPerso.running = false;
    emailingPerso.finishedAt = new Date().toISOString();
    emailingPersoLog(`💥 Erreur fatale : ${e.message}`, 'error');
  });
});

app.get('/api/emailing-perso/status', (req, res) => {
  res.json({
    running: emailingPerso.running,
    total: emailingPerso.total, done: emailingPerso.done,
    sent: emailingPerso.sent, errors: emailingPerso.errors, skipped: emailingPerso.skipped,
    startedAt: emailingPerso.startedAt, finishedAt: emailingPerso.finishedAt,
    log: emailingPerso.log.slice(0, 200),
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
// Charger les promesses au démarrage (silencieux, après 10s)
// Le bulk contacts/structures n'est PAS chargé auto — utiliser le bouton "Préchauffer le cache"
setTimeout(async () => {
  try {
    await chargerPromesses(); // charge seulement les promesses (léger)
  } catch(e) { addLog(`⚠️ Chargement promesses : ${e.message}`, 'warn'); }
}, 10000);
// Construire l'index équipes après init Redis (délai pour laisser Redis se connecter)
setTimeout(() => buildEquipeIndex().catch(e => addLog(`⚠️ buildEquipeIndex erreur : ${e.message}`, 'warn')), 5000);
