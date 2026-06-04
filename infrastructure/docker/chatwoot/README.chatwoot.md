# Chatwoot (Kundenservice) — self-host on the Oracle server

Self-hosted omnichannel inbox. The POS embeds the **widget** (Einstellungen →
Kundenservice); a human **agent** answers from the Chatwoot dashboard. Runs as
its own isolated stack (own Postgres + Redis) next to the main Warehouse14 stack.

## App ↔ container split (by design)
- **Container (server):** the Chatwoot Rails app + Sidekiq + its Postgres + Redis
  — heavy, always-on, holds conversations. Lives here, NOT in the desktop app.
- **App (POS):** only the lightweight JS **widget** (loaded from the Chatwoot
  host) + the config/launcher in Einstellungen. Performance stays in the app;
  state + processing stay on the server.

## One-time stand-up
```bash
scp -r infrastructure/docker/chatwoot <user>@<server>:/opt/chatwoot
ssh <server>
cd /opt/chatwoot
cp .env.chatwoot.example .env
# fill SECRET_KEY_BASE (openssl rand -hex 64), POSTGRES_PASSWORD + REDIS_PASSWORD
# (and put the redis password into REDIS_URL too).
nano .env

# prepare the database (first run only)
docker compose -f docker-compose.chatwoot.yml run --rm rails bundle exec rails db:chatwoot_prepare

# bring it up
docker compose -f docker-compose.chatwoot.yml up -d
```

## Cloudflare (public hostname on the existing tunnel)
Zero Trust → Tunnels → the warehouse14 tunnel → **Public Hostname**:
`chat.warehouse14.de` → `http://chatwoot-rails:3000`. (The POS CSP already
allow-lists `chat.warehouse14.de` for script/connect/frame.)

> Note: the Chatwoot containers must share a docker network with `cloudflared`.
> Either run cloudflared in this compose too, or `docker network connect` the
> warehouse14 network to `chatwoot-rails`.

## Onboarding (in the dashboard)
1. Open `https://chat.warehouse14.de` → create the **Super-Admin** (first user).
2. **Postfächer (Inboxes) → Neu → Website** → name it → copy the **Website-Token**.
3. In the POS: Einstellungen → Kundenservice → set **Chatwoot-Adresse** =
   `https://chat.warehouse14.de`, paste the **Website-Token**, toggle **aktiv**.
   The live-chat bubble appears in the POS; messages land in Chatwoot.
4. Connect channels (WhatsApp/Instagram/Facebook) under the same Inbox settings.
   **Human intervention** is built in — an agent picks up any conversation.

## Resources
Chatwoot is a Rails monolith (~1–2 GB RAM with Sidekiq). The Oracle box (4 vCPU /
23 GB) handles it next to the main stack comfortably.
