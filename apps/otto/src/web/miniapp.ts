/**
 * Otto Miniapp
 * Minimal chat interface for Telegram, Farcaster, and Web
 */

import { Elysia } from 'elysia'
import { getConfig } from '../config'

const config = getConfig()

const html = (platform: 'telegram' | 'farcaster' | 'web') => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Otto</title>
  ${platform === 'telegram' ? '<script src="https://telegram.org/js/telegram-web-app.js"></script>' : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui; background: #111; color: #fff; height: 100vh; display: flex; flex-direction: column; }
    #chat { flex: 1; overflow-y: auto; padding: 16px; }
    .msg { margin: 8px 0; padding: 10px 14px; border-radius: 12px; max-width: 80%; white-space: pre-wrap; }
    .user { background: #0af; color: #000; margin-left: auto; }
    .bot { background: #222; }
    .bot a { color: #0af; }
    #input-row { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #333; }
    #input { flex: 1; padding: 12px; border: none; border-radius: 20px; background: #222; color: #fff; font-size: 16px; }
    #send { width: 44px; height: 44px; border: none; border-radius: 50%; background: #0af; color: #000; font-size: 18px; cursor: pointer; }
    .loading { opacity: 0.5; }
  </style>
</head>
<body>
  <div id="chat"></div>
  <div id="input-row">
    <input id="input" placeholder="swap 1 ETH to USDC" autocomplete="off">
    <button id="send">→</button>
  </div>
  <script>
    const API = '${config.baseUrl}/api/chat';
    let sid = null;
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    
    async function init() {
      ${platform === 'telegram' ? 'if(window.Telegram?.WebApp){Telegram.WebApp.ready();Telegram.WebApp.expand();}' : ''}
      const r = await fetch(API + '/session', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
      const d = await r.json();
      sid = d.sessionId;
      d.messages.forEach(m => addMsg(m.content, m.role === 'user'));
    }
    
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
    
    function addMsg(text, isUser) {
      const div = document.createElement('div');
      div.className = 'msg ' + (isUser ? 'user' : 'bot');
      // Escape HTML first, then apply safe formatting for code blocks
      const escaped = escapeHtml(text);
      div.innerHTML = escaped.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }
    
    async function sendMsg() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addMsg(text, true);
      send.classList.add('loading');
      
      const r = await fetch(API + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sid },
        body: JSON.stringify({ message: text })
      });
      const d = await r.json();
      addMsg(d.message.content, false);
      send.classList.remove('loading');
    }
    
    input.onkeypress = e => e.key === 'Enter' && sendMsg();
    send.onclick = sendMsg;
    init();
  </script>
</body>
</html>`

export const miniappApi = new Elysia({ prefix: '/miniapp' })
  .get('/', ({ set }) => {
    set.headers['Content-Type'] = 'text/html'
    return html('web')
  })
  .get('/telegram', ({ set }) => {
    set.headers['Content-Type'] = 'text/html'
    return html('telegram')
  })
  .get('/farcaster', ({ set }) => {
    set.headers['Content-Type'] = 'text/html'
    return html('farcaster')
  })

export default miniappApi
