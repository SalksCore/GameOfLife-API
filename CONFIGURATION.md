# GameOfLife — tout ce qu'il faut configurer pour la mise en ligne

Trois projets :

| Projet | Rôle | Où l'héberger |
|---|---|---|
| `gameoflife-phone` | Application des joueurs (téléphones) | **Cloudflare Pages** |
| `gameoflife-admin` | Panneau admin, écran projeté, gestion | **Cloudflare Pages** |
| `gameoflife-api` | Serveur (Node.js + Socket.IO + Postgres) | **Pas Cloudflare Pages** (voir §1) |

> ⚠️ Cloudflare Pages n'héberge que des sites statiques. L'API est un serveur Node.js
> permanent (temps réel par WebSocket) : elle doit tourner sur Render, Railway, Fly.io ou un VPS.

---

## 1. Base de données et API

### 1.1 Base Postgres (obligatoire en production)
- [ ] Créer une base Postgres : **Neon**, **Supabase**, **Railway** ou celle de l'hébergeur.
- [ ] Récupérer l'URL de connexion `postgres://utilisateur:motdepasse@hote:5432/base`.
- Les tables sont créées automatiquement au démarrage (migrations).

### 1.2 Hébergement de l'API (Render, Railway ou Fly.io)
- [ ] Nouveau service web depuis le dépôt GitHub `GameOfLife-API`.
- [ ] Version de Node : **22** ou plus.
- [ ] Commande de build : `npm ci && npm run build`
- [ ] Commande de démarrage : `npm start`
- [ ] Vérifier que l'hébergeur accepte les **WebSockets** (oui pour Render, Railway, Fly.io).
- [ ] Vérification : `https://<api>/api/health` doit répondre.

### 1.3 Variables d'environnement de l'API

| Variable | Valeur | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `HOST` | `0.0.0.0` | |
| `PORT` | fourni par l'hébergeur (souvent automatique) | |
| `DATABASE_URL` | URL Postgres du §1.1 | **obligatoire** |
| `JWT_SECRET` | 48 caractères aléatoires | générer : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` — ne jamais la partager |
| `CORS_ORIGINS` | `https://jeu.exemple.fr,https://admin.exemple.fr` | adresses exactes des 2 sites Pages, séparées par des virgules, sans `/` final |
| `TRUST_PROXY` | `true` | l'API est derrière le proxy de l'hébergeur |
| `COOKIE_SAMESITE` | `strict` ou `none` | voir §3 |

### 1.4 Premier compte admin
- [ ] Depuis la console de l'hébergeur (ou en local avec la même `DATABASE_URL`) :
  `npm run admin:create -- <pseudo> <motdepasse de 12 caractères minimum>`

---

## 2. Les deux sites sur Cloudflare Pages

Pour **chacun** des deux dépôts (`GameOfLife-PHONE` et `GameOfLife-ADMIN`) :

- [ ] Cloudflare → Workers & Pages → Créer → Pages → Connecter à Git → choisir le dépôt.
- [ ] Préréglage de framework : **Vite** (ou aucun).
- [ ] Commande de build : `npm run build`
- [ ] Répertoire de sortie : `dist`
- [ ] Variable `NODE_VERSION` = `22`
- [ ] Variables d'environnement (à mettre **avant** le build, elles sont intégrées au site) :

| Site | Variable | Valeur |
|---|---|---|
| PHONE | `VITE_API_URL` | `https://api.exemple.fr` (adresse de l'API, sans `/` final) |
| ADMIN | `VITE_API_URL` | `https://api.exemple.fr` |
| ADMIN | `VITE_PHONE_URL` | `https://jeu.exemple.fr` (adresse du site PHONE : affichée à l'écran et dans le QR code) |

- Déjà inclus dans les dépôts : `public/_redirects` (routage des pages, ex. `/regie/…`, `/ecran/…`)
  et `public/_headers` (en-têtes de sécurité, cache).
- [ ] Après avoir changé une variable : **relancer un déploiement** (elles sont lues au build).

---

## 3. Domaines et cookie de session (important)

La connexion repose sur un cookie sécurisé posé par l'API. Deux cas :

**A. Recommandé : un seul nom de domaine**
- `jeu.exemple.fr` → Pages PHONE · `admin.exemple.fr` → Pages ADMIN · `api.exemple.fr` → API
- [ ] Ajouter les domaines personnalisés dans Cloudflare Pages et chez l'hébergeur de l'API.
- [ ] `COOKIE_SAMESITE=strict`

**B. Sans domaine (adresses par défaut `*.pages.dev` et `*.onrender.com`…)**
- Les sites et l'API sont sur des domaines différents.
- [ ] `COOKIE_SAMESITE=none` (HTTPS obligatoire, déjà le cas sur ces plateformes).
- Limite : certains navigateurs (Safari avec la protection anti-pistage) bloquent ces cookies
  entre domaines → la session peut ne pas se restaurer après rechargement. **Préférer le cas A.**

---

## 4. Vérifications après mise en ligne

- [ ] `https://<api>/api/health` répond.
- [ ] Le site ADMIN s'ouvre, connexion avec le compte du §1.4.
- [ ] « Temps réel actif » en bas à gauche de l'admin (sinon : vérifier `CORS_ORIGINS` et `VITE_API_URL`).
- [ ] Créer des joueurs (Joueurs → Ajouter) et noter les identifiants générés.
- [ ] Créer une partie → la Gestion s'ouvre ; « Ouvrir l'écran » → le QR code pointe vers le site PHONE.
- [ ] Sur un téléphone : se connecter, rejoindre avec le code.
- [ ] Recharger la page du téléphone : on doit rester connecté (sinon voir §3).

## 5. Le jour de l'exposé

- [ ] Ouvrir l'admin sur le PC relié au vidéoprojecteur : Parties → Nouvelle partie.
- [ ] « Ouvrir l'écran (projecteur) » → glisser la fenêtre sur le projecteur → F11.
- [ ] Garder la Gestion sur l'écran du PC.
- [ ] Distribuer les identifiants (ou les imprimer depuis la liste des joueurs).
- [ ] Prévoir une connexion internet fiable (les téléphones passent par le réseau mobile ou le Wi-Fi).
- Une partie en cours est gardée en mémoire : **ne pas redémarrer l'API pendant une partie**.

## 6. Notes

- `gameoflife-api/.env.example` liste les mêmes variables pour le développement local.
- En local sans `DATABASE_URL`, l'API utilise une base embarquée (`.data/`) : jamais en production.
- Les mots de passe des joueurs sont générés par l'admin ; il n'y a pas d'inscription publique.
