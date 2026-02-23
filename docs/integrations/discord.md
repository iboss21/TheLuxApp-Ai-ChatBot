# Discord Bot Integration Guide

Connect TheLuxApp AI ChatBot to your Discord server as a slash-command bot.

---

## How It Works

Discord sends an HTTP POST to your webhook URL for every interaction (slash command or button click). TheLuxApp verifies the Ed25519 signature, processes the message through the AI engine, and returns the response as a follow-up message.

```
User types /ask <message>
      ↓
Discord sends signed POST to https://your-domain.com/v1/integrations/discord/webhook
      ↓
TheLuxApp verifies signature → AI processes → responds via Discord API
```

---

## Prerequisites

- A Discord account with access to the [Discord Developer Portal](https://discord.com/developers/applications)
- TheLuxApp deployed and publicly reachable (HTTPS required)
- Your Tenant UUID and an Admin API key

---

## Step 1 — Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → enter a name (e.g. `TheLuxApp Bot`)
3. Go to **General Information** and copy:
   - **Application ID** → set as `DISCORD_APPLICATION_ID`
   - **Public Key** → set as `DISCORD_PUBLIC_KEY`
4. Go to **Bot** → click **Add Bot**
5. Under **Token**, click **Reset Token** and copy it → set as `DISCORD_BOT_TOKEN`
6. Enable **Message Content Intent** under **Privileged Gateway Intents**

---

## Step 2 — Set Webhook URL in Developer Portal

1. Go to **General Information** → **Interactions Endpoint URL**
2. Enter: `https://your-domain.com/v1/integrations/discord/webhook`
3. Discord will send a PING to verify. TheLuxApp will respond with `{"type":1}` automatically.
4. Click **Save Changes** ✓

---

## Step 3 — Register the /ask Slash Command

Register the slash command with Discord's API. Replace the placeholders:

```bash
curl -X POST \
  https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ask",
    "description": "Ask the AI assistant a question",
    "options": [
      {
        "name": "message",
        "description": "Your question or message",
        "type": 3,
        "required": true
      }
    ]
  }'
```

For **guild-specific** (faster, for testing):
```bash
curl -X POST \
  https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${GUILD_ID}/commands \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ask", "description": "Ask the AI assistant", "options": [{ "name": "message", "description": "Your question", "type": 3, "required": true }] }'
```

---

## Step 4 — Invite the Bot to Your Server

Generate an invite URL:

```
https://discord.com/api/oauth2/authorize
  ?client_id=YOUR_APPLICATION_ID
  &permissions=2048
  &scope=bot%20applications.commands
```

Replace `YOUR_APPLICATION_ID` and open the URL in a browser.

---

## Step 5 — Configure Environment Variables

Add to your `.env`:

```env
DISCORD_PUBLIC_KEY=your-discord-app-public-key
DISCORD_APPLICATION_ID=your-discord-application-id
DISCORD_BOT_TOKEN=Bot your-discord-bot-token
DISCORD_TENANT_ID=your-tenant-uuid
```

---

## Step 6 — Register the Integration via API

```bash
curl -X POST https://your-domain.com/v1/integrations/manage \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: YOUR_TENANT_ID" \
  -d '{
    "platform": "discord",
    "name": "My Discord Server",
    "config": {
      "application_id": "YOUR_APPLICATION_ID",
      "bot_token": "Bot YOUR_TOKEN",
      "public_key": "YOUR_PUBLIC_KEY"
    }
  }'
```

---

## Step 7 — Test

In your Discord server, type:
```
/ask message: What is TheLuxApp?
```

You should see "Bot is thinking…" followed by the AI response.

---

## Webhook Payload Reference

Discord sends interactions to your endpoint as JSON:

```json
{
  "type": 2,
  "id": "interaction-id",
  "token": "interaction-token",
  "application_id": "app-id",
  "guild_id": "guild-id",
  "channel_id": "channel-id",
  "member": {
    "user": { "id": "user-id", "username": "john" }
  },
  "data": {
    "name": "ask",
    "options": [{ "name": "message", "value": "Hello!" }]
  }
}
```

| `type` | Description |
|--------|-------------|
| `1`    | PING — respond with `{"type":1}` |
| `2`    | APPLICATION_COMMAND — slash command |
| `3`    | MESSAGE_COMPONENT — button/select |

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Invalid request signature` | Wrong public key | Double-check `DISCORD_PUBLIC_KEY` |
| `Bot is thinking…` forever | Timeout or crash | Check server logs |
| `Unknown interaction` | Bad slash command format | Re-register the command |
| PING fails | Endpoint not reachable | Ensure HTTPS + public URL |

---

## Security Notes

- All requests are verified using **Ed25519** cryptographic signatures.
- The public key is used to verify — the private key never leaves Discord.
- No auth header is needed (verification replaces auth).
