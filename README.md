# Trivia

Host your own live trivia night. The **host** builds a trivia from modules and runs the session; **players** join with a room code and a nickname, no account needed.

- Hosts sign in with Google, and only emails on `HOST_ALLOWLIST` are accepted.
- Modules are described in [docs/MODULES.md](docs/MODULES.md).
- Deployment (Debian, Docker, Nginx Proxy Manager, `trivia.example.com`): [docs/DEPLOY.md](docs/DEPLOY.md).
- Known bugs: [docs/BUGS.md](docs/BUGS.md).

## Status

Done: host auth (Google OIDC + PKCE + allowlist), module registry with validation, trivia CRUD API, Docker setup.
Next: live sessions (join code, players, scoring, WebSocket/SSE), drag-and-drop builder UI, host/player/projector pages ported from 0.1.

## Develop

```bash
npm install
cp .env.example .env   # fill in values
npm run dev
npm test
```
