# Slack App Integration Guide

Connect TheLuxApp AI ChatBot to Slack using the Events API. The bot will respond to any message in channels or DMs where it's invited.

---

## How It Works

```
User sends a message in a channel
      ↓
Slack sends signed POST to https://your-domain.com/v1/integrations/slack/events
      ↓
TheLuxApp verifies HMAC-SHA256 signature → AI processes → bot posts reply
```

---

## Prerequisites

- A Slack workspace where you have permission to install apps
- TheLuxApp deployed and publicly reachable (HTTPS required)

---

## Step 1 — Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Give it a name (e.g. `TheLuxApp Bot`) and pick your workspace
3. Under **Basic Information → App Credentials**, copy:
   - **Signing Secret** → set as `SLACK_SIGNING_SECRET`

---

## Step 2 — Enable Events API

1. In your app's left sidebar, go to **Event Subscriptions**
2. Toggle **Enable Events** to ON
3. Set **Request URL**: `https://your-domain.com/v1/integrations/slack/events`
4. Slack will send a `url_verification` challenge — TheLuxApp responds automatically.
5. Under **Subscribe to bot events**, click **Add Bot User Event** and add:
   - `message.channels` — messages in public channels
   - `message.im` — direct messages
   - `message.groups` — private channels (optional)
6. Click **Save Changes**

---

## Step 3 — Configure OAuth Scopes

1. Go to **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:
   - `chat:write` — post messages
   - `channels:history` — read channel messages
   - `im:history` — read DM messages
   - `groups:history` — read private channel messages (optional)
3. Click **Install to Workspace** → authorise
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → set as `SLACK_BOT_TOKEN`

---

## Step 4 — Configure Environment Variables

```env
SLACK_SIGNING_SECRET=your-slack-signing-secret
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_TENANT_ID=your-tenant-uuid
```

---

## Step 5 — Register the Integration via API

```bash
curl -X POST https://your-domain.com/v1/integrations/manage \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: YOUR_TENANT_ID" \
  -d '{
    "platform": "slack",
    "name": "My Slack Workspace",
    "config": {
      "bot_token": "xoxb-your-token",
      "signing_secret": "your-signing-secret"
    }
  }'
```

---

## Step 6 — Invite the Bot to a Channel

In Slack, type: `/invite @TheLuxApp`

Then send a message — the bot will respond.

---

## Step 7 — Test

```bash
# Simulate a Slack event (test only — in production Slack signs the request)
curl -X POST https://your-domain.com/v1/integrations/slack/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url_verification",
    "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P"
  }'
# Expected: { "challenge": "3eZbrw1..." }
```

---

## Event Payload Reference

```json
{
  "type": "event_callback",
  "team_id": "T0001",
  "event": {
    "type": "message",
    "user": "U2147483697",
    "text": "Hello, what can you do?",
    "channel": "C2147483705",
    "ts": "1355517523.000005"
  }
}
```

TheLuxApp ignores events that have a `bot_id` field to prevent infinite loops.

---

## Thread Support

Replies are threaded automatically when the original message is in a thread (`thread_ts` is used as the conversation ID).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Invalid Slack signature` | Check `SLACK_SIGNING_SECRET` — must match exactly |
| Timestamp too old (replay) | Ensure your server clock is synced (NTP) |
| Bot doesn't respond | Check bot was invited to the channel |
| Double responses | Check for duplicate Event Subscriptions or multiple instances |

---

## Security Notes

- All requests are verified with **HMAC-SHA256** using your signing secret.
- Requests older than **5 minutes** are rejected to prevent replay attacks.
- The bot never responds to its own messages (`bot_id` filter).
