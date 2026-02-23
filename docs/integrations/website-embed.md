# Website Embed Guide

Add a floating AI chat widget to any website with a single `<script>` tag.

---

## Quick Start — 2 Lines of Code

```html
<!-- Paste before </body> on any HTML page -->
<script
  src="https://your-domain.com/embed.js"
  data-api-key="lux_your_api_key"
  data-tenant-id="your-tenant-uuid"
></script>
```

That's it. A floating chat button will appear in the bottom-right corner.

---

## Get Your API Key

```bash
# 1. Get a JWT (admin login)
curl -X POST https://your-domain.com/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "password",
    "username": "admin@example.com",
    "password": "your-password",
    "tenant_id": "your-tenant-uuid"
  }'

# 2. Create an API key (use the JWT from above)
curl -X POST https://your-domain.com/auth/api-keys \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Website Embed Key",
    "scopes": ["chat"]
  }'
# Copy the "key" field from the response → use as data-api-key
```

---

## Full Configuration Options

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-api-key` | *(required)* | Your API key (from `/auth/api-keys`) |
| `data-tenant-id` | *(required)* | Your tenant UUID |
| `data-base-url` | *(auto-detect)* | Override the API base URL |
| `data-title` | `AI Assistant` | Chat window title |
| `data-subtitle` | `Powered by TheLuxApp` | Subtitle under the title |
| `data-theme` | `dark` | `dark` or `light` |
| `data-position` | `bottom-right` | `bottom-right`, `bottom-left`, `top-right`, `top-left` |
| `data-accent` | `#c9a96e` | Accent/button color (any CSS color) |

---

## Full Example

```html
<script
  src="https://your-domain.com/embed.js"
  data-api-key="lux_abc123def456"
  data-tenant-id="550e8400-e29b-41d4-a716-446655440000"
  data-base-url="https://your-domain.com"
  data-title="Support Assistant"
  data-subtitle="AI-powered · Always on"
  data-theme="dark"
  data-position="bottom-right"
  data-accent="#6366f1"
></script>
```

---

## Light Theme Example

```html
<script
  src="https://your-domain.com/embed.js"
  data-api-key="lux_your_key"
  data-tenant-id="your-uuid"
  data-theme="light"
  data-accent="#2563eb"
  data-title="Help Center"
></script>
```

---

## What the Widget Does

1. Renders a **floating button** (bottom-right by default)
2. On click, opens a **chat panel** with your configured title
3. Sends messages to `POST /v1/chat/completions` with your API key
4. Displays the AI response with optional **citation sources**
5. Maintains **conversation context** across messages (same session)
6. Supports **Enter to send**, **Shift+Enter for newline**

---

## CORS Configuration

If the widget is served from a different domain than the API, ensure CORS is configured:

```env
# In your .env
CORS_ORIGIN=https://your-website.com
```

Or allow multiple origins:
```env
CORS_ORIGIN=https://site1.com,https://site2.com
```

---

## Content Security Policy

If your site uses CSP, add:
```
script-src 'self' https://your-domain.com;
connect-src 'self' https://your-domain.com;
```

---

## Programmatic Control

The widget exposes a global API:

```javascript
// Open the chat programmatically
document.getElementById('lux-fab').click();

// Or trigger from your own button
document.querySelector('#my-chat-btn').addEventListener('click', () => {
  document.getElementById('lux-fab').click();
});
```

---

## Embedding in React / Next.js

```jsx
// components/ChatWidget.jsx
import { useEffect } from 'react';

export default function ChatWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://your-domain.com/embed.js';
    script.setAttribute('data-api-key', process.env.NEXT_PUBLIC_CHAT_API_KEY);
    script.setAttribute('data-tenant-id', process.env.NEXT_PUBLIC_TENANT_ID);
    script.setAttribute('data-theme', 'dark');
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);
  return null;
}
```

---

## Iframe Alternative

If you prefer an iframe:

```html
<iframe
  src="https://your-domain.com/?embed=true&api_key=lux_xxx&tenant_id=yyy"
  width="400"
  height="600"
  style="border:none;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.2)"
></iframe>
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Widget doesn't appear | Check browser console for JS errors |
| `401 Unauthorized` | Verify `data-api-key` and `data-tenant-id` |
| CORS errors | Add your website domain to `CORS_ORIGIN` env var |
| Widget blocked by CSP | Add script-src and connect-src for your API domain |
| Conversations reset on reload | This is by design — conversation IDs are in-memory |
