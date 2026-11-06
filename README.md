# Trivia

Host your own live trivia night. The **host** builds a trivia from modules and runs the session; **players** join with a room code and a nickname, no account needed.

- Hosts sign in with Google; only emails in `config/hosts.json` are accepted. The project owner is an **admin** with control over all sessions: [docs/ROLES.md](docs/ROLES.md).
- How to write a good trivia: [docs/GUIDELINES.md](docs/GUIDELINES.md) and [docs/THEME_BANK.md](docs/THEME_BANK.md). The app is built around them.
- Question types: [docs/MODULES.md](docs/MODULES.md).
- Look and feel (after Niko Pirosmani): [docs/DESIGN.md](docs/DESIGN.md).
- Deployment (Docker with your proxy, Caddy, Cloudflare Tunnel, systemd and nginx, Fly.io): [docs/DEPLOY.md](docs/DEPLOY.md).
- Playing as a team on several phones: [docs/TEAMS.md](docs/TEAMS.md).
- Scoring, guess limits and manual points: [docs/SCORING.md](docs/SCORING.md).
- Known bugs: [docs/BUGS.md](docs/BUGS.md).

## Status

Working: host login and roles, the drag-and-drop builder (two clues, answer type, tiers, a 2-5-2-1 meter, import/export), live sessions with a secret overall theme, confidence sets and a final wager, round-end scoreboards, PIN rejoin, a projector view, admin control, Docker setup. A converter brings 0.1 trivias across.
Not yet exercised in a real browser against real Google login; the unit and API tests cover the logic.

## Develop

```bash
npm install
cp .env.example .env   # fill in values
cp config/hosts.example.json config/hosts.json   # your email under admins
npm run dev
npm test
```
