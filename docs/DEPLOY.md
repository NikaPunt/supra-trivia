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

Live updates arrive over a server-sent-events stream. The app checks that the stream is really delivering and quietly falls back to checking every 3 seconds if a proxy holds it back, so a misbehaving proxy slows nothing down but is chattier. To fix the cause, turn off response buffering for this host: in Nginx Proxy Manager add `proxy_buffering off;` under the host's Advanced tab (the app already sends `X-Accel-Buffering: no`, which nginx honours unless something overrides it).

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
The app reads the visitor's address from the `X-Forwarded-For` header to tell visitors apart for rate limiting. It believes that header only from senders listed in `TRUST_PROXY`, and takes the first address, reading from the app outwards, that is not one of them. A visitor can therefore put anything they like in the header and still be counted under their real address, whether your proxy overwrites the header or appends to it (Nginx Proxy Manager appends).

- The default trusts private addresses (`loopback, linklocal, uniquelocal`), which is where a proxy on the same machine or the same Docker network lives. Every setup on this page works with it.
- If devices you do not trust share that private network with the app, narrow it to your proxy alone, for example the Docker network's range: `TRUST_PROXY=172.18.0.0/16` (find it with `docker network inspect YOUR_PROXY_NETWORK --format '{{(index .IPAM.Config 0).Subnet}}'`).
- `TRUST_PROXY=false` believes nobody; use it only if the app faces the internet with no proxy.
- Docker setups here publish no ports; non-Docker setups should set `HOST=127.0.0.1` so only the proxy can reach the app.

To check: `curl -H 'X-Forwarded-For: 1.2.3.4' https://YOUR-ADDRESS/api/me`, then look at the app's log. `remoteAddress` on that request must be your own address, not `1.2.3.4`.

## Backups
Everything worth keeping is the database in `data/`, plus your `.env` and hosts file.

- **Do not copy `trivia.db` with `cp` while the app runs.** The database keeps recent changes in side files (`-wal`, `-shm`) and a plain copy can come out incomplete. [`deploy/backup.sh`](../deploy/backup.sh) uses SQLite's own backup, checks the copy, keeps the last 30, and exits non-zero on any failure. Run it nightly from cron:
  ```
  30 3 * * * /path/to/trivia/deploy/backup.sh /path/to/trivia /mnt/backup/trivia >> /var/log/trivia-backup.log 2>&1
  ```
- **Keep a copy somewhere else.** A backup on a drive in the same machine does not survive theft, fire or a bad power supply. Send the backup folder off the machine with something that encrypts before uploading (restic, or rclone with a crypt remote): the backup holds your secrets.
- **Know when it fails.** Have cron mail you, or end the cron line with a ping to an uptime service (`&& curl -fsS https://hc-ping.com/YOUR-ID`), so a week of silent failures cannot happen.
- **Run it by hand before every update.**

### Restoring
1. Stop the app: `docker compose stop trivia`.
2. Move the current `data/` aside (`mv data data.broken`), make a new `data/`, and copy the backup's `trivia.db` into it. Remove any `trivia.db-wal` and `trivia.db-shm` next to it: they belong to the old database.
3. Put back `.env` and `config/hosts.json` if they were lost. The same `SESSION_SECRET` keeps everyone signed in; a new one signs everyone out and nothing else.
4. Start the app: `docker compose up -d`, then `docker compose logs trivia`. A line saying a stored game "could not be loaded and was skipped" names a game that is damaged; everything else is running.

Try this once on another folder before you need it.

## Updating
```bash
deploy/backup.sh . /mnt/backup/trivia                                   # or however you back up
git pull
TRIVIA_TAG=$(git rev-parse --short HEAD) docker compose up -d --build   # use the same -f file you started with
docker compose logs --tail 50 trivia
```
Existing data is kept. The database is brought up to date by itself, in numbered steps that only ever add to it, and games and trivias saved by any earlier version load as they are: a game that was running picks up where it stopped, with the rules it started under.

**Going back:** each build is tagged with its commit, so the previous one is still on the machine: `docker image ls supra-trivia`, then `TRIVIA_TAG=<previous tag> docker compose up -d` (without `--build`). An older build refuses to open a database that a newer one has changed the structure of, and says so in its log; in that case restore the backup you took before updating.

Avoid updating while a game is being played: the restart takes a few seconds and every screen reconnects by itself, but there is no reason to test that on a live audience.

## Watching it
- `GET /healthz` answers 200 only when the database answers too. Point an uptime check at `https://YOUR-ADDRESS/healthz`.
- The compose files cap the container's memory and the size of its logs, and stop it cleanly.
- What the app logs, the audit log, and the record kept of every session are described in [LOGGING.md](LOGGING.md). The admin page shows the server's state at a glance.
- `GAME_RETENTION_DAYS` deletes finished sessions after that many days. The default, 0, keeps them forever; they cost disk space only.

## Hardening checklist
- The container runs as a non-root user with a read-only filesystem and no capabilities, and publishes no ports.
- Only emails in the hosts file can host. Players never need accounts.
- Admins can see and control every session; their actions on other people's things are logged.
- Keep `.env`, `config/hosts.json` and `data/` out of git (they already are in `.gitignore`).

## Not covered
Running several copies behind a load balancer, or a managed database. The app is built for one small server.
