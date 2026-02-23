# n8n Automation Guide

Connect TheLuxApp AI ChatBot to n8n to build powerful automation workflows — trigger AI conversations from any of 400+ connected services.

---

## Quick Start

1. Download [`n8n/luxapp-workflow.json`](../../n8n/luxapp-workflow.json)
2. In n8n: **Workflows** → **Import from File** → upload the JSON
3. Set the required environment variables in n8n
4. Activate the workflow

---

## Required n8n Environment Variables

In your n8n instance, add these credentials/variables:

| Variable | Value | Where to find |
|----------|-------|---------------|
| `LUXAPP_BASE_URL` | `https://your-domain.com` | Your deployment URL |
| `LUXAPP_API_KEY` | `lux_xxxxxxxx` | From `POST /auth/api-keys` |
| `LUXAPP_TENANT_ID` | `UUID` | Your tenant UUID |

In n8n, set these under **Settings → Environment Variables** or pass them in the HTTP Request node headers directly.

---

## What the Workflow Does

```
[Webhook Trigger] → [Normalise Input] → [Guard: Empty?]
                                              ↓
                                     [LuxApp Chat API]
                                              ↓
                                    [Check Response]
                                       ↙        ↘
                              [Format OK]    [Format Error]
                                       ↘        ↙
                                  [Respond to Webhook]
```

**Plus a separate health check sub-workflow:**
```
[Hourly Schedule] → [GET /health] → [Health OK?]
                                       ↙    ↘
                                 [Log OK]  [Alert!]
```

---

## Calling the Workflow

Send a POST to the workflow's webhook URL:

```bash
curl -X POST https://your-n8n.com/webhook/luxapp-chat \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "web",
    "userId": "user-123",
    "message": "What is the refund policy?",
    "conversationId": ""
  }'
```

Response:
```json
{
  "reply": "Our refund policy allows returns within 30 days...",
  "conversationId": "uuid-here",
  "model": "gpt-4-turbo-preview",
  "citations": [{ "title": "Refund Policy Doc", "url": null }]
}
```

---

## Extending the Workflow

### Trigger from Airtable row

Add an **Airtable Trigger** node before the **Normalise Input** node:
```json
{
  "platform": "airtable",
  "userId": "={{ $json.fields['Customer Email'] }}",
  "message": "={{ $json.fields['Question'] }}"
}
```

### Send reply to email

After **Format Success Response**, add a **Send Email** node:
```
To: {{ $json.userEmail }}
Subject: Your AI response
Body: {{ $json.reply }}
```

### Post to Slack channel

After **Format Success Response**, add a **Slack** node:
```
Channel: #ai-responses
Message: *{{ $json.userId }}*: {{ $json.reply }}
```

### Store conversation in Google Sheets

After **Format Success Response**, add a **Google Sheets** node to log every conversation.

---

## Platform-Specific Trigger Examples

### Discord → n8n → LuxApp (via webhook relay)

If you use a Discord bot that forwards messages to n8n:
```json
{
  "platform": "discord",
  "userId": "{{ discord_user_id }}",
  "message": "{{ discord_message_content }}"
}
```

### Zapier-style: New form submission → AI response → Email

1. **Typeform/Jotform trigger** — new submission
2. **HTTP Request** → POST to `luxapp-chat` webhook
3. **Email node** → send AI reply to submitter

---

## Workflow JSON Structure

The workflow uses standard n8n node types:

| Node | Type | Purpose |
|------|------|---------|
| Webhook Trigger | `n8n-nodes-base.webhook` | Receive HTTP requests |
| Set | `n8n-nodes-base.set` | Map/transform fields |
| IF | `n8n-nodes-base.if` | Conditional branching |
| HTTP Request | `n8n-nodes-base.httpRequest` | Call LuxApp API |
| Respond to Webhook | `n8n-nodes-base.respondToWebhook` | Return HTTP response |
| Schedule Trigger | `n8n-nodes-base.scheduleTrigger` | Periodic jobs |
| Code | `n8n-nodes-base.code` | Custom JS logic |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Webhook URL not found | Ensure workflow is **activated** (toggle in top-right) |
| `401` from LuxApp API | Check `LUXAPP_API_KEY` and `LUXAPP_TENANT_ID` |
| Empty `reply` | Check `LUXAPP_BASE_URL` points to correct server |
| Workflow import fails | Ensure n8n version ≥ 1.0 |

---

## Useful n8n Resources

- [n8n Docs](https://docs.n8n.io)
- [HTTP Request Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
- [Webhook Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
