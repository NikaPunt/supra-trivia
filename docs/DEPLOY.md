# Deploying to Debian behind Nginx Proxy Manager

The app runs as a Docker container on an internal network. Only Nginx Proxy Manager (NPM) is exposed to the internet.

## 1. Google OAuth client
1. Google Cloud Console -> APIs & Services -> OAuth consent screen: type **External**, add your host emails as test users (or publish).
2. Credentials -> Create OAuth client ID -> Web application.
3. Authorized redirect URI: `https://trivia.example.com/auth/callback`.
4. Copy the client ID and secret into `.env`.

## 2. Configure
```bash
cp .env.example .env
# set SESSION_SECRET (openssl rand -base64 48), Google credentials and HOST_ALLOWLIST
```

## 3. Start
`docker-compose.yml` joins the external Docker network that NPM is on. Find it with `docker inspect <npm-container> --format '{{json .NetworkSettings.Networks}}'` and set `PROXY_NETWORK` in `.env` (default `proxy`).
```bash
docker compose up -d --build
```

## 4. DNS
Add an `A` record: `trivia.example.com` -> your public IP. If the record is on Cloudflare, use DNS only (grey cloud) unless you want Cloudflare proxying.

## 5. NPM proxy host
- Domain: `trivia.example.com`
- Scheme `http`, Forward host `trivia`, port `3000`
- Enable: **Block Common Exploits**, **Websockets Support**
- SSL tab: request a Let's Encrypt cert, enable **Force SSL** and **HSTS**

Fail2ban and CrowdSec already watch the NPM log directory, so the new host's logs are covered. Check the new `proxy-host-N_access.log` is in that directory.

## Hardening checklist
- Container runs non-root, read-only root filesystem, all capabilities dropped, no published ports.
- Hosts must be on `HOST_ALLOWLIST`. Players never need accounts.
- Back up `data/trivia.db` (SQLite) regularly.
