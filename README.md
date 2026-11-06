# Trivia

Host your own live trivia night. The **host** builds a trivia from modules and runs the session; **players** join with a room code and a nickname, no account needed.

- Hosts sign in with Google; only emails in `config/hosts.json` are accepted. The project owner is an **admin** with control over all sessions: [docs/ROLES.md](docs/ROLES.md).
- How to write a good trivia: [docs/GUIDELINES.md](docs/GUIDELINES.md) and [docs/THEME_BANK.md](docs/THEME_BANK.md). The app is built around them.
- Question types: [docs/MODULES.md](docs/MODULES.md).
- Look and feel (after Niko Pirosmani): [docs/DESIGN.md](docs/DESIGN.md).
- Deployment (Docker with your proxy, Caddy, Cloudflare Tunnel, systemd and nginx, Fly.io): [docs/DEPLOY.md](docs/DEPLOY.md).
- Running a game (the step order, the timer, the console tabs, the projector): [docs/HOSTING.md](docs/HOSTING.md).
- Playing as a team on several phones: [docs/TEAMS.md](docs/TEAMS.md).
- Every limit the app enforces (wagers, confidence values, sizes, time): [docs/LIMITS.md](docs/LIMITS.md).
- Scoring, guess limits and manual points: [docs/SCORING.md](docs/SCORING.md).
- Bug log: [docs/BUGS.md](docs/BUGS.md).

## Develop

```bash
npm install
cp .env.example .env   # fill in values
cp config/hosts.example.json config/hosts.json   # your email under admins
npm run dev
npm test
```

## License

[MIT](LICENSE). The bundled fonts keep their own open licences, noted in `public/fonts/README.txt`.
