# GameOfLife API

Serveur du jeu : API HTTP (auth, administration) + temps réel WebSocket (Socket.IO).
L'état des parties vit en mémoire (latence minimale). La base PostgreSQL stocke les comptes, les sessions, l'historique et le journal.

**Stack** : Node 22 · TypeScript · Fastify 5 · Socket.IO 4 · Drizzle ORM · PostgreSQL · Zod · Argon2id · JWT (jose)

## Fonctionnement

1. Un **admin** crée les comptes joueurs dans ADMIN. L'identifiant et le mot de passe sont **générés** :
   - identifiant = 1re lettre du **nom** + **prénom** complet, en minuscules et sans accents (Jean Dupont → `djean`, puis `djean2` en cas de doublon) ;
   - mot de passe aléatoire lisible (`Tigre-Lune-Cactus-4821`), **affiché une seule fois** à l'admin et stocké haché. L'admin peut en générer un nouveau.
2. L'admin **crée une partie** et obtient un **code à 6 caractères** (sans 0/O, 1/I/L).
3. Le joueur **se connecte** dans PHONE, puis saisit le code.
4. L'admin **lance**, **termine** (sauvegarde en base) ou **ferme** la partie, et peut retirer un joueur.

Il n'y a pas d'inscription publique, et un joueur ne peut pas créer de partie.

### Paramètres et maintenance

- **Paramètres généraux** (table `settings`, gardés en mémoire) : nom du jeu, message d'accueil, joueurs max par défaut, nombre max de parties ouvertes, fermeture auto des parties inactives, chat activé ou non.
- **Maintenance** :
  - les connexions joueurs sont refusées (HTTP 503, WebSocket `maintenance`) ;
  - les joueurs connectés reçoivent `server:maintenance` puis sont déconnectés ;
  - les parties **en cours** restent ouvertes et les joueurs les retrouvent à la reprise ; en salle d'attente, un joueur absent plus de 15 s perd sa place ;
  - l'admin reste accessible.
- `GET /api/status` (public) expose le nom du jeu, le message d'accueil et l'état de maintenance à PHONE.
- **Relevés d'activité** : toutes les 5 min, le nombre de joueurs connectés et de parties est enregistré (`stats_snapshots`), pour les graphiques.

> Les règles du jeu ne sont pas encore implémentées : `src/game/room.ts` est un socle neutre (salle d'attente → en cours → terminée). Les règles viendront se greffer sur la phase `playing` (voir les `TODO`).

## Démarrage

```bash
npm install
cp .env.example .env         # puis générer JWT_SECRET (commande dans le fichier)
npm run admin:create -- <identifiant> <motdepasse>   # premier compte admin (12 caractères min)
npm run dev                  # http://localhost:3000
```

Sans `DATABASE_URL`, l'API utilise **PGlite**, un Postgres embarqué stocké dans `.data/`. Rien à installer pour le dev.
Pour un vrai Postgres : `docker compose up -d`, puis `DATABASE_URL=postgres://gameoflife:gameoflife@localhost:5432/gameoflife`.
Les migrations s'appliquent automatiquement au démarrage.

> ⚠️ PGlite ne supporte qu'**un seul processus** à la fois. Arrête `npm run dev` avant de lancer `npm run admin:create`, et ne lance jamais deux serveurs de dev en même temps.

| Script | Rôle |
|---|---|
| `npm run dev` | Serveur avec rechargement automatique |
| `npm run build` / `npm start` | Build (`dist/`) et lancement en production |
| `npm test` | Tests unitaires (Vitest) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run db:generate` | Génère une migration après modification de `src/db/schema.ts` |
| `npm run admin:create -- <id> <mdp>` | Crée un admin, ou réinitialise son mot de passe |

## Structure

```
src/
  config/env.ts          variables d'environnement validées (le serveur refuse de démarrer si invalides)
  db/                    schéma Drizzle, connexion (Postgres ou PGlite), journal admin
  auth/                  comptes, génération des identifiants, mots de passe, JWT, sessions, anti-bruteforce
  settings.ts            paramètres du jeu et maintenance (base + mémoire)
  http/                  Fastify : sécurité, routes /api/auth, /api/status et /api/admin/* (players, stats, settings, history)
  realtime/              Socket.IO : namespace joueurs "/" et namespace "/admin"
  game/
    protocol.ts          contrat client <-> serveur (RÉFÉRENCE, copié dans PHONE et ADMIN)
    room.ts              partie générique (indépendante de Socket.IO, testée)
    room-manager.ts      registre des parties et de leurs codes
drizzle/                 migrations SQL
```

## Comptes : deux tables séparées

| | Joueurs (PHONE) | Admins (ADMIN) |
|---|---|---|
| Table | `players` | `admins` |
| Sessions | `player_sessions` | `admin_sessions` |
| Création | par un admin, dans ADMIN | `npm run admin:create` |
| Routes de session | `/api/auth/*` | `/api/admin/auth/*` |
| Cookie | `gol_player_rt` (path `/api/auth`) | `gol_admin_rt` (path `/api/admin/auth`) |
| Audience JWT | `gameoflife-player` | `gameoflife-admin` |
| Durée du token / de la session | 15 min / 30 jours | 10 min / 12 h |
| WebSocket | namespace `/` | namespace `/admin` |

Un token joueur est refusé partout côté admin (routes et socket), et inversement.

## Sauvegarde des données

| Table | Contenu |
|---|---|
| `players` | prénom, nom, identifiant, parties jouées, suspension (+ motif), notes internes, dernière connexion, admin créateur |
| `player_logins` | historique des connexions (date, IP, appareil) |
| `settings` | paramètres généraux et maintenance |
| `stats_snapshots` | relevés d'activité toutes les 5 minutes |
| `games` | chaque partie terminée : code, nom, nombre de joueurs, début/fin, admin créateur |
| `game_players` | participants de chaque partie |
| `admin_actions` | journal : toutes les actions d'administration, reliées au joueur concerné quand il y en a un |

## Endpoints

| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/health` · `/api/status` | public |
| POST | `/api/auth/login` · `/refresh` · `/logout` | public (en-tête `X-Requested-With: GameOfLife`) |
| GET | `/api/auth/me` | joueur |
| POST | `/api/admin/auth/login` · `/refresh` · `/logout` | public (même en-tête) |
| GET | `/api/admin/auth/me` | admin |
| GET | `/api/admin/players` (paramètres : `q`, `page`, `status` = all/active/banned/never, `sort` = recent/name/games/lastLogin) | admin |
| POST | `/api/admin/players` `{ firstName, lastName }` → identifiants générés | admin |
| POST | `/api/admin/players/bulk` `{ players: [...] }` (200 max) | admin |
| GET | `/api/admin/players/:id` → profil complet (présence, stats, parties, connexions, historique) | admin |
| PATCH | `/api/admin/players/:id` `{ firstName?, lastName?, notes? }` | admin |
| POST | `/api/admin/players/:id/reset-password` · `/revoke-sessions` · `/ban` `{ banned, reason? }` | admin |
| DELETE | `/api/admin/players/:id` | admin |
| GET | `/api/admin/stats?days=7` (7, 30 ou 90) | admin |
| GET · PUT | `/api/admin/settings` · `/settings/general` · `/settings/maintenance` | admin |
| GET | `/api/admin/games` · `/api/admin/games/:id/players` | admin |
| GET | `/api/admin/actions` (paramètres : `page`, `type` = player/room/settings/maintenance) | admin |

Les événements WebSocket (rejoindre, chat ; côté admin : créer, lancer, terminer, fermer, retirer) sont décrits dans `src/game/protocol.ts`.

## Sécurité

- **Mots de passe** : Argon2id (paramètres OWASP), générés côté serveur avec un aléa cryptographique (~34 bits), jamais stockés ni journalisés en clair. Réponse en temps constant, que l'identifiant existe ou non.
- **Anti-bruteforce** :
  - 10 tentatives de connexion par minute par IP (100 en dev, où tout arrive de 127.0.0.1) ;
  - **verrouillage de l'identifiant pendant 15 min** après 8 échecs ;
  - codes de partie : 5 essais, puis 1 toutes les 5 s.
- **Sessions** :
  - access token JWT court, gardé en mémoire côté client ;
  - refresh token opaque dans un cookie `httpOnly` + `SameSite=Strict`, stocké haché en base ;
  - rotation à chaque renouvellement ; si un token révoqué est rejoué, toutes les sessions sont révoquées (10 s de tolérance pour plusieurs onglets) ;
  - une suspension ou un nouveau mot de passe coupe immédiatement les sessions et le WebSocket du joueur.
- **CSRF** : vérification de l'`Origin` et de l'en-tête `X-Requested-With`, en plus de `SameSite=Strict`.
- **WebSocket** :
  - token vérifié au handshake, puis le compte est relu en base ;
  - contrôle de l'`Origin` (protection contre le Cross-Site WebSocket Hijacking) ;
  - messages limités à 16 Ko ;
  - limitation de débit par socket ;
  - chaque message est validé par Zod.
- **Serveur autoritaire** : les joueurs ne peuvent que rejoindre, quitter et discuter ; tout le pilotage passe par le namespace admin.
- **HTTP** :
  - Helmet (CSP `default-src 'none'`, HSTS en production, `X-Frame-Options: DENY`) ;
  - CORS sur liste blanche ;
  - taille des requêtes limitée ;
  - aucune erreur 500 détaillée renvoyée au client ;
  - secrets masqués dans les logs.

## Performance

- WebSocket uniquement (pas de long-polling) et `perMessageDeflate` désactivé.
- État des parties en RAM ; la base n'est sollicitée qu'à la connexion et en fin de partie.
- Notifications aux admins regroupées (200 ms).
- Reconnexion transparente : le joueur retrouve sa partie (15 s de grâce en salle d'attente).
- Les parties inactives depuis 6 h sont fermées automatiquement.

## Production

- `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (≥ 32 caractères aléatoires), `CORS_ORIGINS` = domaines de PHONE et ADMIN, `TRUST_PROXY=true` derrière un reverse proxy.
- Les parties ouvertes sont en mémoire : un redémarrage du serveur les ferme (les joueurs sont prévenus). Les parties terminées sont sauvegardées.
- **Montée en charge** : une instance gère plusieurs milliers de joueurs. Au-delà, il faudra répartir les parties entre instances (sharding par partie + `@socket.io/redis-adapter`).
