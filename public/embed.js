/**
 * TheLuxApp AI ChatBot — Website Embed Widget
 *
 * Usage:
 *   <script
 *     src="https://your-domain.com/embed.js"
 *     data-api-key="lux_your_api_key"
 *     data-tenant-id="your-tenant-uuid"
 *     data-title="AI Assistant"
 *     data-subtitle="Powered by TheLuxApp"
 *     data-theme="dark"
 *     data-position="bottom-right"
 *     data-base-url="https://your-domain.com"
 *   ></script>
 */
(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────────
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var cfg = {
    apiKey:    script.getAttribute('data-api-key') || '',
    tenantId:  script.getAttribute('data-tenant-id') || '',
    baseUrl:   (script.getAttribute('data-base-url') || '').replace(/\/$/, ''),
    title:     script.getAttribute('data-title') || 'AI Assistant',
    subtitle:  script.getAttribute('data-subtitle') || 'Powered by TheLuxApp',
    theme:     script.getAttribute('data-theme') || 'dark',
    position:  script.getAttribute('data-position') || 'bottom-right',
    accentColor: script.getAttribute('data-accent') || '#c9a96e',
  };

  if (!cfg.apiKey) { console.warn('[LuxApp] data-api-key is required'); return; }

  // ── Styles ─────────────────────────────────────────────────────────────────
  var isDark = cfg.theme !== 'light';
  var bg     = isDark ? '#0e0e0e' : '#ffffff';
  var bg2    = isDark ? '#161616' : '#f5f5f5';
  var text   = isDark ? '#ffffff' : '#111111';
  var muted  = isDark ? '#888888' : '#666666';
  var border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  var gold   = cfg.accentColor;

  var isLeft  = cfg.position.includes('left');
  var isTop   = cfg.position.includes('top');
  var posCSS  = (isLeft ? 'left:24px;' : 'right:24px;') + (isTop ? 'top:24px;' : 'bottom:24px;');

  var style = document.createElement('style');
  style.textContent = [
    '#lux-fab{position:fixed;' + posCSS + 'z-index:2147483640;width:56px;height:56px;border-radius:50%;background:' + gold + ';border:none;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;transition:transform .25s,box-shadow .25s;outline:none;}',
    '#lux-fab:hover{transform:scale(1.08);box-shadow:0 8px 28px rgba(0,0,0,0.45);}',
    '#lux-fab svg{width:26px;height:26px;fill:' + (isDark ? '#000' : '#fff') + ';}',
    '#lux-panel{position:fixed;' + posCSS + 'z-index:2147483639;width:380px;max-width:calc(100vw - 48px);height:560px;max-height:calc(100vh - 100px);background:' + bg + ';border:1px solid ' + border + ';border-radius:20px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.5);transition:transform .3s cubic-bezier(.16,1,.3,1),opacity .3s;transform-origin:bottom right;font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;}',
    '#lux-panel.lux-hidden{transform:scale(0.85) translateY(12px);opacity:0;pointer-events:none;}',
    '#lux-header{background:' + gold + ';padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}',
    '#lux-header-info{display:flex;align-items:center;gap:10px;}',
    '#lux-avatar{width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1rem;color:#000;}',
    '#lux-title{font-weight:800;font-size:0.95rem;color:#000;line-height:1.2;}',
    '#lux-subtitle{font-size:0.7rem;color:rgba(0,0,0,0.55);font-weight:500;}',
    '#lux-close{background:none;border:none;cursor:pointer;color:rgba(0,0,0,0.5);font-size:1.3rem;line-height:1;padding:4px;transition:color .2s;}',
    '#lux-close:hover{color:#000;}',
    '#lux-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;}',
    '#lux-messages::-webkit-scrollbar{width:4px;}',
    '#lux-messages::-webkit-scrollbar-track{background:transparent;}',
    '#lux-messages::-webkit-scrollbar-thumb{background:' + border + ';border-radius:4px;}',
    '.lux-msg{max-width:85%;padding:10px 14px;border-radius:14px;font-size:0.875rem;line-height:1.55;word-break:break-word;}',
    '.lux-msg-user{background:' + gold + ';color:#000;align-self:flex-end;border-bottom-right-radius:4px;font-weight:500;}',
    '.lux-msg-bot{background:' + bg2 + ';color:' + text + ';align-self:flex-start;border-bottom-left-radius:4px;border:1px solid ' + border + ';}',
    '.lux-msg-system{background:transparent;color:' + muted + ';align-self:center;font-size:0.78rem;text-align:center;}',
    '.lux-typing{display:flex;gap:4px;padding:10px 14px;}',
    '.lux-dot{width:6px;height:6px;background:' + muted + ';border-radius:50%;animation:lux-bounce .9s infinite ease-in-out;}',
    '.lux-dot:nth-child(2){animation-delay:.15s;}',
    '.lux-dot:nth-child(3){animation-delay:.3s;}',
    '@keyframes lux-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
    '#lux-footer{padding:12px 16px;border-top:1px solid ' + border + ';display:flex;gap:8px;flex-shrink:0;background:' + bg + ';}',
    '#lux-input{flex:1;background:' + bg2 + ';border:1px solid ' + border + ';border-radius:10px;padding:10px 14px;color:' + text + ';font-size:0.875rem;outline:none;resize:none;font-family:inherit;transition:border-color .2s;max-height:80px;overflow-y:auto;}',
    '#lux-input:focus{border-color:' + gold + ';}',
    '#lux-input::placeholder{color:' + muted + ';}',
    '#lux-send{width:38px;height:38px;border-radius:10px;background:' + gold + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;align-self:flex-end;}',
    '#lux-send:hover{background:' + (isDark ? '#e8c87a' : '#b8935a') + ';}',
    '#lux-send:disabled{opacity:0.5;cursor:not-allowed;}',
    '#lux-send svg{width:18px;height:18px;fill:#000;}',
  ].join('');
  document.head.appendChild(style);

  // ── DOM ─────────────────────────────────────────────────────────────────────
  var fab = document.createElement('button');
  fab.id = 'lux-fab';
  fab.setAttribute('aria-label', 'Open chat');
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  document.body.appendChild(fab);

  var panel = document.createElement('div');
  panel.id = 'lux-panel';
  panel.className = 'lux-hidden';
  panel.innerHTML = [
    '<div id="lux-header">',
    '  <div id="lux-header-info">',
    '    <div id="lux-avatar">AI</div>',
    '    <div><div id="lux-title">' + escHtml(cfg.title) + '</div>',
    '    <div id="lux-subtitle">' + escHtml(cfg.subtitle) + '</div></div>',
    '  </div>',
    '  <button id="lux-close" aria-label="Close chat">×</button>',
    '</div>',
    '<div id="lux-messages"></div>',
    '<div id="lux-footer">',
    '  <textarea id="lux-input" placeholder="Type a message…" rows="1"></textarea>',
    '  <button id="lux-send" aria-label="Send">',
    '    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    '  </button>',
    '</div>',
  ].join('');
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector('#lux-messages');
  var inputEl    = panel.querySelector('#lux-input');
  var sendBtn    = panel.querySelector('#lux-send');
  var closeBtn   = panel.querySelector('#lux-close');

  // ── State ───────────────────────────────────────────────────────────────────
  var conversationId = null;
  var isOpen = false;
  var isLoading = false;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function appendMessage(role, text) {
    var el = document.createElement('div');
    el.className = 'lux-msg lux-msg-' + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'lux-msg lux-msg-bot lux-typing';
    el.id = 'lux-typing';
    el.innerHTML = '<span class="lux-dot"></span><span class="lux-dot"></span><span class="lux-dot"></span>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTyping() {
    var el = document.getElementById('lux-typing');
    if (el) el.remove();
  }

  function setLoading(v) {
    isLoading = v;
    sendBtn.disabled = v;
    inputEl.disabled = v;
  }

  // ── Chat API ────────────────────────────────────────────────────────────────
  function sendMessage(text) {
    if (!text.trim() || isLoading) return;
    appendMessage('user', text);
    inputEl.value = '';
    inputEl.style.height = '';
    setLoading(true);
    showTyping();

    var endpoint = cfg.baseUrl + '/v1/chat/completions';
    var body = {
      messages: [{ role: 'user', content: text }],
      stream: false,
      tools_enabled: true,
      knowledge_enabled: true,
    };
    if (conversationId) body.conversation_id = conversationId;

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'ApiKey ' + cfg.apiKey,
        'X-Tenant-ID': cfg.tenantId,
      },
      body: JSON.stringify(body),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      removeTyping();
      if (data.conversation_id) conversationId = data.conversation_id;
      var reply = data.content || data.error?.message || 'Sorry, something went wrong.';
      var msgEl = appendMessage('bot', reply);

      // Show citations if present
      if (data.citations && data.citations.length > 0) {
        var citEl = document.createElement('div');
        citEl.className = 'lux-msg lux-msg-system';
        citEl.textContent = '📎 Sources: ' + data.citations.map(function(c){ return c.title; }).join(', ');
        messagesEl.appendChild(citEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    })
    .catch(function () {
      removeTyping();
      appendMessage('bot', 'Sorry, I could not connect to the server. Please try again.');
    })
    .finally(function () { setLoading(false); });
  }

  // ── Events ───────────────────────────────────────────────────────────────────
  fab.addEventListener('click', function () {
    isOpen = !isOpen;
    panel.classList.toggle('lux-hidden', !isOpen);
    fab.setAttribute('aria-label', isOpen ? 'Close chat' : 'Open chat');
    if (isOpen) {
      if (messagesEl.children.length === 0) {
        appendMessage('bot', 'Hi there! 👋 How can I help you today?');
      }
      setTimeout(function () { inputEl.focus(); }, 300);
    }
  });

  closeBtn.addEventListener('click', function () {
    isOpen = false;
    panel.classList.add('lux-hidden');
    fab.setAttribute('aria-label', 'Open chat');
  });

  sendBtn.addEventListener('click', function () {
    sendMessage(inputEl.value);
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  // Auto-grow textarea
  inputEl.addEventListener('input', function () {
    this.style.height = '';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

  // Close on backdrop click (only if fully outside)
  document.addEventListener('click', function (e) {
    if (isOpen && !panel.contains(e.target) && e.target !== fab) {
      isOpen = false;
      panel.classList.add('lux-hidden');
    }
  });
})();
