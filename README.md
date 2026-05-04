# 🤝 Défi Enfance — Notifications Automatiques

Système de notifications email automatiques déclenché par les dons et inscriptions détectés dans Ohme, envoyés via Brevo.

---

## 🚀 Déploiement sur Render (étape par étape)

### 1. Pousser le code sur GitHub

```bash
# Dans le dossier du projet :
git init
git add .
git commit -m "Initial commit — Défi Enfance Notifications"
git branch -M main
git remote add origin https://github.com/VOTRE_USERNAME/defi-enfance-notifications.git
git push -u origin main
```

### 2. Créer le service sur Render

1. Aller sur **render.com** → Se connecter avec GitHub
2. Cliquer **"New +"** → **"Web Service"**
3. Sélectionner votre dépôt `defi-enfance-notifications`
4. Render détecte automatiquement la config grâce au `render.yaml`
5. Cliquer **"Create Web Service"**

### 3. Ajouter les variables d'environnement

Dans le Dashboard Render → votre service → **"Environment"** :

| Variable           | Valeur                                      |
|--------------------|---------------------------------------------|
| `OHME_API_KEY`     | Votre clé API Ohme                          |
| `OHME_BASE_URL`    | https://votre-instance.ohme-app.com         |
| `BREVO_API_KEY`    | xkeysib-votre_cle_brevo                     |
| `SENDER_EMAIL`     | contact@defienfance.fr                      |
| `SENDER_NAME`      | Défi Enfance                                |
| `POLL_INTERVAL_MS` | 600000 (= 10 minutes)                       |

⚠️ **Ne jamais mettre les clés dans le code ou dans GitHub.**

### 4. Déployer

Render lance le build automatiquement. En ~2 minutes, votre URL est disponible.

---

## 🔁 Logique de fonctionnement

### Paiements surveillés dans Ohme

| Type             | Condition                                      | Action                            |
|------------------|------------------------------------------------|-----------------------------------|
| `don`            | `event_name` contient "DÉFI"                  | Email → coureur ou chef d'équipe  |
| `Billetterie`    | `event_name` contient "DÉFI"                  | Email → association soutenue      |

### Champs Ohme utilisés

**Pour un don vers un coureur :**
- `sponsored_contact_email` — email du coureur parrainé
- `sponsored_contact_name`  — nom du coureur parrainé

**Pour un don vers une équipe :**
- `sponsored_structure_name`         — nom de l'équipe
- `sponsored_structure_chef_email`   — email du référent d'équipe
- `sponsored_structure_chef_prenom`  — prénom du référent

**Pour une inscription billetterie :**
- `association_name`  — nom de l'association choisie
- `association_email` — email de l'association

> ⚙️ **Adapter ces noms de champs** aux noms exacts de vos champs personnalisés Ohme si nécessaire (dans `server.js`, fonction `processPayments`).

---

## 📧 Templates emails

| Template             | Destinataire       | Objet                                          |
|----------------------|--------------------|------------------------------------------------|
| Don → Coureur        | Coureur parrainé   | ❤️ Nouveau don pour ton Défi Enfance !         |
| Don → Équipe         | Chef d'équipe      | ❤️ Nouveau don pour votre équipe au Défi Enfance ! |
| Inscription → Asso   | Association        | 🏃 Nouveau coureur pour votre cause — Défi Enfance ! |

---

## 🛠️ Développement local

```bash
npm install
cp .env.example .env
# Remplir .env avec vos vraies clés
node server.js
```

Ouvrir http://localhost:3000

---

## 📊 Dashboard

Le tableau de bord est accessible à l'URL Render de votre service.
Il affiche en temps réel :
- Statistiques (emails envoyés, dons, inscriptions)
- Journal d'activité du serveur
- Derniers événements détectés
- Bouton "Poll maintenant" pour forcer une interrogation Ohme
- Bouton d'envoi d'email de test
