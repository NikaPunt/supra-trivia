# Deploy files

Ready-to-use files for the common ways to run the app. The step-by-step guide is [docs/DEPLOY.md](../docs/DEPLOY.md).

| Folder | What it is |
|---|---|
| (repo root) `docker-compose.yml` | Docker behind a reverse proxy you already run |
| `caddy/` | Docker with Caddy in front, automatic HTTPS |
| `cloudflare-tunnel/` | Docker with a Cloudflare Tunnel, no open ports |
| `systemd/` and `nginx/` | Run with Node and no Docker |
| `fly/` and (repo root) `fly.toml` | Fly.io |
