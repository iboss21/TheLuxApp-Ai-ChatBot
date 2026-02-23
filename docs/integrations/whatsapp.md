# WhatsApp Business API Integration Guide

Integrate TheLuxApp AI ChatBot with WhatsApp using the Meta Cloud API (no server needed for the WhatsApp side).

---

## How It Works

```
User sends a WhatsApp message to your business number
      ↓
Meta Cloud API sends signed POST to https://your-domain.com/v1/integrations/whatsapp/webhook
      ↓
TheLuxApp processes through AI → Cloud API sends reply to user
```

---

## Prerequisites

- A Meta for Developers account: [developers.facebook.com](https://developers.facebook.com)
- A Meta Business account
- A phone number to register (can be a new SIM or virtual number — cannot be an existing WhatsApp number)

---

## Step 1 — Create a Meta App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Click **Create App** → **Business** → Next
3. Enter app name and your business account
4. From the dashboard, click **Add Product** → **WhatsApp** → **Set up**

---

## Step 2 — Get Your Credentials

In **WhatsApp → API Setup**:

1. **Phone Number ID** → copy → set as `WHATSAPP_PHONE_NUMBER_ID`
2. **Temporary access token** (expires in 24h) — for permanent: create a System User in Business Manager
3. Under **Step 2**, generate a permanent token:
   - Business Manager → System Users → Create System User (Admin role)
   - Add assets (the WhatsApp app)
   - Generate Token → select `whatsapp_business_messaging` + `whatsapp_business_management`
   - Copy → set as `WHATSAPP_ACCESS_TOKEN`

---

## Step 3 — Configure Webhook

1. In **WhatsApp → Configuration** → **Webhook**
2. Click **Edit**
3. **Callback URL**: `https://your-domain.com/v1/integrations/whatsapp/webhook`
4. **Verify Token**: make up a random string (e.g. `luxapp_verify_abc123`) → set as `WHATSAPP_VERIFY_TOKEN`
5. Click **Verify and Save** — TheLuxApp responds to the challenge automatically
6. Subscribe to webhook fields: tick **messages**

---

## Step 4 — Configure Environment Variables

```env
WHATSAPP_VERIFY_TOKEN=luxapp_verify_abc123
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxx...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_TENANT_ID=your-tenant-uuid
```

---

## Step 5 — Register the Integration via API

```bash
curl -X POST https://your-domain.com/v1/integrations/manage \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: YOUR_TENANT_ID" \
  -d '{
    "platform": "whatsapp",
    "name": "My WhatsApp Business",
    "config": {
      "access_token": "EAAxxxxxxxx...",
      "phone_number_id": "123456789012345",
      "verify_token": "luxapp_verify_abc123"
    }
  }'
```

---

## Step 6 — Test

Send a WhatsApp message to your registered number. The bot responds within seconds.

**Test the webhook verification manually:**
```bash
curl "https://your-domain.com/v1/integrations/whatsapp/webhook\
?hub.mode=subscribe\
&hub.verify_token=luxapp_verify_abc123\
&hub.challenge=challenge_string"
# Expected: challenge_string
```

---

## Incoming Message Payload Reference

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "BUSINESS_ACCOUNT_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "PHONE_NUMBER_ID" },
        "messages": [{
          "id": "wamid.xxx",
          "from": "15551234567",
          "timestamp": "1234567890",
          "type": "text",
          "text": { "body": "Hello!" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

---

## Sending a Message via API (direct test)

```bash
curl -X POST \
  https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "15551234567",
    "type": "text",
    "text": { "body": "Hello from TheLuxApp!" }
  }'
```

---

## Production Requirements

For production (reaching users outside your test numbers):
1. Submit your app for **Business Verification** in Meta Business Manager
2. Complete the **WhatsApp Business API approval** process
3. Users must opt-in to receive messages from your number

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Webhook verification fails | Check `WHATSAPP_VERIFY_TOKEN` matches exactly |
| Messages not received | Check webhook subscriptions include `messages` field |
| `401` from Meta API | Token expired — regenerate System User token |
| Response not sent | Check `WHATSAPP_PHONE_NUMBER_ID` is correct |
