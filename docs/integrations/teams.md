# Microsoft Teams Bot Integration Guide

Add TheLuxApp AI ChatBot to Microsoft Teams using Azure Bot Service and the Bot Framework.

---

## How It Works

```
User sends a message to your Teams bot
      ↓
Bot Framework sends Activity POST to https://your-domain.com/v1/integrations/teams/webhook
      ↓
TheLuxApp processes through AI → returns reply Activity
```

---

## Prerequisites

- An Azure account with an active subscription
- Microsoft 365 tenant with Teams admin access
- TheLuxApp deployed with an HTTPS URL

---

## Step 1 — Create an Azure Bot Resource

1. Go to [portal.azure.com](https://portal.azure.com)
2. Search for **Azure Bot** → **Create**
3. Fill in:
   - Bot handle: `TheLuxApp-Bot`
   - Subscription, Resource Group
   - Type of App: **Multi-tenant**
   - Create new Microsoft App ID (auto-generated)
4. Click **Review + Create** → **Create**
5. After deployment, go to **Configuration**:
   - Copy **Microsoft App ID** → set as `TEAMS_APP_ID`
   - Click **Manage Password** → **New client secret** → copy → set as `TEAMS_APP_PASSWORD`

---

## Step 2 — Configure Messaging Endpoint

1. In your Azure Bot resource → **Configuration**
2. Set **Messaging endpoint**: `https://your-domain.com/v1/integrations/teams/webhook`
3. Click **Apply**

---

## Step 3 — Enable Teams Channel

1. In your Azure Bot → **Channels**
2. Click **Microsoft Teams** → **Apply**

---

## Step 4 — Configure Environment Variables

```env
TEAMS_APP_ID=your-azure-app-id
TEAMS_APP_PASSWORD=your-azure-app-client-secret
TEAMS_TENANT_ID=your-tenant-uuid
```

---

## Step 5 — Register the Integration via API

```bash
curl -X POST https://your-domain.com/v1/integrations/manage \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: YOUR_TENANT_ID" \
  -d '{
    "platform": "teams",
    "name": "My Teams Bot",
    "config": {
      "app_id": "YOUR_APP_ID",
      "app_password": "YOUR_APP_PASSWORD"
    }
  }'
```

---

## Step 6 — Create a Teams App Manifest

Create `manifest.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "YOUR_APP_ID",
  "developer": {
    "name": "TheLuxApp",
    "websiteUrl": "https://your-domain.com",
    "privacyUrl": "https://your-domain.com",
    "termsOfUseUrl": "https://your-domain.com"
  },
  "name": { "short": "TheLuxApp AI", "full": "TheLuxApp AI ChatBot" },
  "description": {
    "short": "Enterprise AI ChatBot",
    "full": "Enterprise AI chatbot powered by GPT-4 and Claude"
  },
  "icons": { "outline": "outline.png", "color": "color.png" },
  "accentColor": "#c9a96e",
  "bots": [{
    "botId": "YOUR_APP_ID",
    "scopes": ["personal", "team", "groupchat"],
    "supportsFiles": false,
    "isNotificationOnly": false
  }],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": ["your-domain.com"]
}
```

Package as a `.zip`: `manifest.json` + `color.png` (192×192) + `outline.png` (32×32)

Upload in Teams Admin Center or directly in Teams:
Teams → Apps → Manage your apps → Upload a custom app

---

## Activity Payload Reference

Teams sends Bot Framework `Activity` objects:

```json
{
  "type": "message",
  "id": "message-id",
  "serviceUrl": "https://smba.trafficmanager.net/...",
  "from": {
    "id": "29:user-aad-object-id",
    "name": "John Doe",
    "aadObjectId": "aad-object-id"
  },
  "conversation": { "id": "conversation-id" },
  "text": "Hello! What can you help me with?",
  "channelId": "msteams"
}
```

TheLuxApp responds inline with:
```json
{
  "type": "message",
  "text": "AI response here",
  "replyToId": "original-message-id"
}
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401 Unauthorized` | Verify `TEAMS_APP_ID` and `TEAMS_APP_PASSWORD` |
| Messages not received | Check messaging endpoint URL in Azure portal |
| Unrecognised service URL | Only Azure Bot Framework URLs are accepted |
| HTML tags in text | Teams sends `<at>BotName</at>` mentions — these are stripped automatically |

---

## Testing with Bot Framework Emulator

Download [Bot Framework Emulator](https://github.com/microsoft/BotFramework-Emulator) to test locally before deploying to Teams.
