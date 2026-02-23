# Coolify Deployment Guide

Deploy TheLuxApp AI ChatBot on Coolify with zero-downtime, automatic SSL, and environment variable management.

---

## What is Coolify?

[Coolify](https://coolify.io) is a self-hostable Heroku/Netlify alternative. It handles Docker builds, SSL certs, reverse proxy, rolling deploys, and environment secrets — all from a clean UI.

---

## Option A — Nixpacks (Recommended)

Nixpacks is a zero-config build pack. TheLuxApp includes a `nixpacks.toml` — no Dockerfile knowledge required.

### Steps

1. **Open Coolify Dashboard** → **Projects** → **New Project**
2. Click **+ New Resource** → **Public Repository** (or Private with SSH key)
3. Paste the repo URL: `https://github.com/iboss21/TheLuxApp-Ai-ChatBot`
4. Under **Build Pack**, select **Nixpacks** *(auto-detected from `nixpacks.toml`)*
5. Under **Network** → set **Port**: `3000`
6. Under **Environment Variables** → add all variables from `.env.example`:

```
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/chatbot
REDIS_URL=redis://host:6379
JWT_SECRET=your-strong-secret-min-32-chars
OPENAI_API_KEY=sk-...
DEFAULT_MODEL=gpt-4-turbo-preview
DEFAULT_PROVIDER=openai
CORS_ORIGIN=https://your-domain.com
```

7. Under **Advanced** → set **Health Check Path**: `/health`
8. Click **Deploy** 🚀

---

## Option B — Dockerfile

TheLuxApp includes a multi-stage `Dockerfile` with:
- **Stage 1** (builder): compiles TypeScript
- **Stage 2** (production): minimal Alpine image, non-root user, healthcheck

### Steps

Same as Option A but select **Dockerfile** as the build pack.

The Dockerfile is auto-detected from the root of the repository.

---

## Setting Up PostgreSQL on Coolify

1. **+ New Resource** → **Database** → **PostgreSQL**
2. Select the `pgvector/pgvector:pg16` image (supports vector embeddings)
3. Set credentials and copy the **Internal URL**
4. Use that URL as `DATABASE_URL` in your app environment variables
5. Run the migrations:
   ```bash
   # Connect to the Coolify DB container shell, then:
   psql $DATABASE_URL -f src/db/migrations/001_initial.sql
   psql $DATABASE_URL -f src/db/migrations/002_integrations.sql
   ```

---

## Setting Up Redis on Coolify

1. **+ New Resource** → **Database** → **Redis**
2. Select the `redis:7-alpine` image
3. Copy the **Internal URL** and use as `REDIS_URL`

---

## Advanced: Custom Domain + SSL

1. In your app settings → **Domains**
2. Add your domain: `chat.yourdomain.com`
3. Coolify auto-provisions a Let's Encrypt SSL certificate
4. Update `CORS_ORIGIN` to your domain

---

## Advanced: Horizontal Scaling

1. In app settings → **Advanced** → **Replicas**: set to `2` or more
2. Coolify load-balances between instances
3. Ensure `REDIS_URL` points to a shared Redis instance (not local)

---

## Rolling Deploys / Zero Downtime

Coolify automatically does rolling deploys — new containers are started and health-checked before old ones are stopped. The `/health` endpoint ensures the app is ready before traffic is routed.

---

## Environment Variable Reference

See `.env.example` for the full list. Key production values:

| Variable | Production Value |
|----------|-----------------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | 32+ random characters |
| `CORS_ORIGIN` | your domain |
| `LOG_LEVEL` | `warn` |
| `RATE_LIMIT_MAX` | `60` (adjust for your traffic) |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails | Check Node.js version — needs ≥ 20. Check `nixpacks.toml` |
| App crashes on start | Check `DATABASE_URL` and `REDIS_URL` are correct |
| Health check fails | Ensure port is `3000` and `/health` returns `{"status":"ok"}` |
| SSL not provisioning | Ensure DNS A record points to your Coolify server IP |
