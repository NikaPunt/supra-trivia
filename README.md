# Trivia

Host your own live trivia night. The **host** builds a trivia from modules and runs the session; **players** join with a room code and a nickname, no account needed.

- Hosts sign in with Google; only emails in `config/hosts.json` are accepted. The project owner is an **admin** with control over all sessions: [docs/ROLES.md](docs/ROLES.md).
- Modules are described in [docs/MODULES.md](docs/MODULES.md).
- Deployment (Debian, Docker, Nginx Proxy Manager, `trivia.example.com`): [docs/DEPLOY.md](docs/DEPLOY.md).
- Known bugs: [docs/BUGS.md](docs/BUGS.md).

## Status

Working: host login and roles, drag-and-drop builder, live sessions (join code, answers, scoring, leaderboard, projector view), admin control, Docker setup.
Not yet verified in a real browser against real Google credentials. The unit and API tests cover the logic.

## Develop

```bash
npm install
cp .env.example .env   # fill in values
cp config/hosts.example.json config/hosts.json   # your email under admins
npm run dev
npm test
```
