# Docker Deployment Guide

Run the full TheLuxApp AI ChatBot stack with Docker Compose in under 2 minutes.

---

## Quick Start

```bash
git clone https://github.com/iboss21/TheLuxApp-Ai-ChatBot
cd TheLuxApp-Ai-ChatBot
cp .env.example .env
# Edit .env with your API keys
docker compose up -d
```

App is live at: `http://localhost:3000`
Landing page at: `http://localhost:3000/` (served from `public/`)

---

## What `docker compose up` starts

| Service | Image | Port |
|---------|-------|------|
| `app` | Built from `Dockerfile` | 3000 |
| `db` | `pgvector/pgvector:pg16` | 5432 |
| `redis` | `redis:7-alpine` | 6379 |

---

## Run Migrations

After the DB container is healthy, run migrations:

```bash
docker compose exec db psql -U chatbot -d chatbot \
  -f /docker-entrypoint-initdb.d/001_initial.sql

# Then for integrations support:
docker compose cp src/db/migrations/002_integrations.sql db:/tmp/
docker compose exec db psql -U chatbot -d chatbot -f /tmp/002_integrations.sql
```

Or use the one-liner:
```bash
docker compose exec app sh -c "
  until pg_isready -h db; do sleep 1; done
  psql \$DATABASE_URL -f /app/src/db/migrations/001_initial.sql
  psql \$DATABASE_URL -f /app/src/db/migrations/002_integrations.sql
"
```

---

## Build the Docker Image Manually

```bash
docker build -t theluxapp:latest .
```

Multi-platform (for ARM/Apple Silicon):
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t theluxapp:latest .
```

---

## Run Without Compose

```bash
docker run -d \
  --name theluxapp \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/chatbot \
  -e REDIS_URL=redis://host:6379 \
  -e JWT_SECRET=your-secret \
  -e OPENAI_API_KEY=sk-... \
  theluxapp:latest
```

---

## Production Tips

### Use a `.env` file (never bake secrets into the image)

```bash
docker run --env-file .env -p 3000:3000 theluxapp:latest
```

### Enable restart policy

```bash
docker run --restart=unless-stopped ...
```

### Resource limits

```yaml
# In docker-compose.yml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

---

## Reverse Proxy with Nginx

```nginx
server {
    listen 443 ssl;
    server_name chat.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/chat.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;  # Allow time for streaming responses
        proxy_buffering    off;   # Required for SSE streaming
    }
}
```

---

## Healthcheck

The app exposes `GET /health`:
```json
{ "status": "ok", "timestamp": "2026-01-01T00:00:00.000Z" }
```

Docker Compose healthcheck is configured in the `Dockerfile`:
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

---

## Logs

```bash
# All services
docker compose logs -f

# App only
docker compose logs -f app

# Last 100 lines
docker compose logs --tail=100 app
```

---

## Upgrade

```bash
git pull
docker compose build app
docker compose up -d app
```
