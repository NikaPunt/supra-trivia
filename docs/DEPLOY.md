# Deploying

The app is one small Node server with a SQLite file. Run it however suits you. This page lists the common ways and gives each one ready-to-use files in [`deploy/`](../deploy).

## What every setup needs

- **Node 20 or newer** (or Docker, which brings its own).
- **An https address** such as `https://trivia.example.com`. Google sign-in only works over https, and the app checks that requests come from this exact address. Every option below gives you one.
- **A place to keep `data/`**, which holds the database. Back it up.
- **Exactly one running copy.** Live game state is held in memory and the database is a single file, so do not scale it to several instances.
- A **Google OAuth client** and a **hosts file** (steps 1 to 3 below).

## Which one?

| You have | Use | Effort |
|---|---|---|
| A home server or VPS and nothing else | [Docker with Caddy](#b-docker-with-caddy) | Low. HTTPS is automatic |
| A home server and a domain on Cloudflare, and you would rather not open ports | [Cloudflare Tunnel](#c-cloudflare-tunnel) | Low. No ports, no certificates |
| A server that already runs a reverse proxy (Nginx Proxy Manager, Traefik, nginx) | [Docker behind your proxy](#a-docker-behind-a-reverse-proxy-you-already-have) | Low |
| A server and you prefer no Docker | [Node and systemd](#d-node-and-systemd-no-docker) | Medium |
| No server at all | [Fly.io or another host](#e-flyio-and-other-hosts) | Medium |

## Steps every setup shares

### 1. Google sign-in
Hosts sign in with Google.
1. Google Cloud Console, **APIs & Services**, **OAuth consent screen**: type **External**. Add your host emails as test users, or publish the app (it only asks for basic profile scopes, so no review is needed). The list in step 3 is what actually decides who can host.
2. **Credentials**, **Create OAuth client ID**, **Web application**.
3. **Authorized redirect URI**: `https://YOUR-ADDRESS/auth/callback`, for example `https://trivia.example.com/auth/callback`.
4. Keep the client ID and secret for step 2.

### 2. Configure
```bash
cp .env.example .env
```
Set `BASE_URL` (your https address, no trailing slash), `SESSION_SECRET` (a long random string, make one with `openssl rand -base64 48`), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Never commit `.env`.

### 3. Say who may host
```bash
cp config/hosts.example.json config/hosts.json
```
List your own email under `admins` (full control over every session) and your friends under `hosts`. See [ROLES.md](ROLES.md). On platforms without files, set `HOSTS_JSON` to the same content instead.

### 4. Make `data/` writable (Docker only)
The container runs as an ordinary user (uid 1000), so create the folder yourself before the first start. Otherwise Docker creates it as root and the app cannot write its database.
```bash
mkdir -p data
```
If you see `unable to open database file`, run `sudo chown -R 1000:1000 data`.

---

## A. Docker behind a reverse proxy you already have

Use the `docker-compose.yml` in the repository root. It publishes no ports. It joins an existing Docker network that your proxy is on, so the proxy reaches the app by its container name.

```bash
# the network your proxy runs on:  docker network ls
echo 'PROXY_NETWORK=your_proxy_network' >> .env
mkdir -p data
docker compose up -d --build
docker compose logs -f trivia
```

Then add a proxy host: forward `http://trivia:3000`, request a certificate and force HTTPS.

**Nginx Proxy Manager:** domain = your address, scheme `http`, forward host `trivia`, port `3000`, turn on *Block Common Exploits* and, on the SSL tab, request a Let's Encrypt certificate with *Force SSL* and *HSTS*. Live updates use server-sent events and work through it as is; the app sends `X-Accel-Buffering: no` so nothing buffers them.

**Traefik:** add labels to the `trivia` service, for example `traefik.http.routers.trivia.rule=Host(...)`, `...tls.certresolver=...`, and `traefik.http.services.trivia.loadbalancer.server.port=3000`.

If your proxy logs are watched by fail2ban or CrowdSec, the new host's log is covered automatically when it lands in the same folder.

## B. Docker with Caddy

Caddy in the same compose file fetches and renews the certificate on its own. Needs ports 80 and 443 reachable from the internet and a DNS record for your address pointing at the machine.

```bash
echo 'DOMAIN=trivia.example.com' >> .env
mkdir -p data
docker compose --env-file .env -f deploy/caddy/docker-compose.yml up -d --build
```
Files: [`deploy/caddy/docker-compose.yml`](../deploy/caddy/docker-compose.yml), [`deploy/caddy/Caddyfile`](../deploy/caddy/Caddyfile).

## C. Cloudflare Tunnel

Nothing listens on the internet: a small connector inside Docker dials out to Cloudflare, which gives you https and keeps your home address private. Your domain must be on Cloudflare.

1. Cloudflare, **Zero Trust**, **Networks**, **Tunnels**, create a tunnel and copy its token.
2. In the tunnel's **Public hostname** add your address with service `http://trivia:3000`.
3. ```bash
   echo 'TUNNEL_TOKEN=paste-the-token' >> .env
   mkdir -p data
   docker compose --env-file .env -f deploy/cloudflare-tunnel/docker-compose.yml up -d --build
   ```
File: [`deploy/cloudflare-tunnel/docker-compose.yml`](../deploy/cloudflare-tunnel/docker-compose.yml).

## D. Node and systemd (no Docker)

```bash
# build
sudo useradd --system --home /opt/trivia --shell /usr/sbin/nologin trivia
sudo git clone <your repo url> /opt/trivia && cd /opt/trivia
sudo npm ci && sudo npm run build && sudo npm prune --omit=dev

# configure (outside the code folder)
sudo mkdir -p /etc/trivia
sudo cp .env /etc/trivia/trivia.env              # then edit, see below
sudo cp config/hosts.json /etc/trivia/hosts.json
sudo chown -R root:trivia /etc/trivia && sudo chmod 640 /etc/trivia/*

# run
sudo cp deploy/systemd/trivia.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now trivia
```
In `/etc/trivia/trivia.env` also set:
```
DB_PATH=/var/lib/trivia/trivia.db
HOSTS_FILE=/etc/trivia/hosts.json
HOST=127.0.0.1
```
`HOST=127.0.0.1` matters: the app trusts the proxy's `X-Forwarded-For` header, so only the proxy may reach it.

Put nginx in front with [`deploy/nginx/trivia.conf`](../deploy/nginx/trivia.conf), then get the certificate (certbot adds the HTTPS block and the redirect):
```bash
sudo cp deploy/nginx/trivia.conf /etc/nginx/sites-available/trivia   # edit server_name first
sudo ln -s /etc/nginx/sites-available/trivia /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d trivia.example.com
```
Caddy works as well: `reverse_proxy 127.0.0.1:3000` with `flush_interval -1`.

Logs: `journalctl -u trivia -f`. Update: `git pull`, `npm ci`, `npm run build`, `sudo systemctl restart trivia`.

## E. Fly.io and other hosts

**Fly.io**: [`fly.toml`](../fly.toml) and [`deploy/fly/Dockerfile`](../deploy/fly/Dockerfile) are ready. Rename the app, set `BASE_URL`, then:
```bash
fly launch --no-deploy --copy-config      # say no to a database
fly volumes create trivia_data --size 1
fly secrets set SESSION_SECRET="$(openssl rand -base64 48)" GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  HOSTS_JSON='{"admins":["you@gmail.com"],"hosts":[]}'
fly deploy
fly scale count 1
```
Use `https://your-app.fly.dev` as the redirect URI in step 1, or add your own domain (`fly certs add trivia.example.com`) if Google rejects the default hostname.

**Any other host** (Render, Railway, a VPS panel, Kubernetes): it needs
- build: `npm ci && npm run build`, start: `npm start` (or use the `Dockerfile`),
- the environment variables from `.env.example`, with the port in `PORT`,
- a **persistent disk** mounted where `DB_PATH` points,
- **one instance only**, and no scale-to-zero (live games are held in memory),
- health check: `GET /healthz`.

---

## Proxy headers and the listen address
The app uses the `X-Forwarded-For` header from your proxy to tell visitors apart for rate limiting, and it assumes only the proxy can reach it. Docker setups here publish no ports; non-Docker setups should set `HOST=127.0.0.1`. Do not expose the app's port to the internet directly.

## Backups
The database holds your trivias and sessions. [`tools/backup.sh`](../tools/backup.sh) takes a consistent copy while the app is running, plus the hosts file and `.env`, and keeps the newest 30:
```bash
DEST=/path/to/backups tools/backup.sh
# nightly with cron:
30 3 * * *  DEST=/path/to/backups /path/to/Trivia/tools/backup.sh
```
The backup contains your secrets, so keep it somewhere only you can read. To restore, stop the app and put `trivia.db` back at `DB_PATH`.

## Updating
Docker: `git pull && docker compose up -d --build` (use the same `-f` file you started with). Existing data is kept; the database only ever gains columns.

## Hardening checklist
- The container runs as a non-root user with a read-only filesystem and no capabilities, and publishes no ports.
- Only emails in the hosts file can host. Players never need accounts.
- Admins can see and control every session; their actions on other people's things are logged.
- Keep `.env`, `config/hosts.json` and `data/` out of git (they already are in `.gitignore`).

## Not covered
Running several copies behind a load balancer, or a managed database. The app is built for one small server.
