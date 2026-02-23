# Telegram Bot Integration Guide

Create a Telegram bot that responds to messages using the TheLuxApp AI engine.

---

## How It Works

```
User sends a message to your bot
      ↓
Telegram sends POST to https://your-domain.com/v1/integrations/telegram/{BOT_TOKEN}/webhook
      ↓
TheLuxApp processes through AI → Telegram API sends reply
```

The bot token in the URL path acts as a shared secret to authenticate Telegram's requests.

---

## Step 1 — Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts — choose a name and username
4. Copy the **token** (format: `123456789:ABCdefGhi...`) → set as `TELEGRAM_BOT_TOKEN`

---

## Step 2 — Configure Environment Variables

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhi...
TELEGRAM_TENANT_ID=your-tenant-uuid
```

---

## Step 3 — Register the Webhook with Telegram

Tell Telegram to send updates to your server:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://your-domain.com/v1/integrations/telegram/${TELEGRAM_BOT_TOKEN}/webhook" \
  -d "allowed_updates=[\"message\"]"
```

Expected response:
```json
{ "ok": true, "result": true, "description": "Webhook was set" }
```

Verify it:
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

---

## Step 4 — Register the Integration via API

```bash
curl -X POST https://your-domain.com/v1/integrations/manage \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: YOUR_TENANT_ID" \
  -d '{
    "platform": "telegram",
    "name": "My Telegram Bot",
    "config": { "bot_token": "123456789:ABCdefGhi..." }
  }'
```

---

## Step 5 — Test

Open your bot in Telegram and send a message. Built-in commands:

| Command | Response |
|---------|----------|
| `/start` | Welcome message |
| `/help` | Help text with available commands |
| `/clear` | Reset conversation context |
| Any text | AI-generated response |

---

## Update Payload Reference

```json
{
  "update_id": 10000,
  "message": {
    "message_id": 1,
    "from": {
      "id": 1111111,
      "first_name": "John",
      "username": "john_doe"
    },
    "chat": { "id": 1111111, "type": "private" },
    "text": "Hello!"
  }
}
```

---

## Group Chat Support

The bot works in group chats automatically. Users can mention it with `@your_bot_username message` or just chat in a group where it has been added.

For groups, set privacy mode off via BotFather:
```
/setprivacy → @YourBot → Disable
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Webhook not receiving updates | Run `getWebhookInfo` — check for errors |
| `Invalid token` (401) | Ensure `TELEGRAM_BOT_TOKEN` matches the webhook URL token |
| Bot not responding | Check `TELEGRAM_TENANT_ID` is set and integration is registered |
| SSL error | Telegram requires a valid SSL certificate (use Let's Encrypt) |

---

## Remove Webhook (switch to polling)

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"
```
