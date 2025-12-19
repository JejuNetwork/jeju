/**
 * Otto Farcaster Frame
 * Minimal interactive Frame for trading
 */

import { Hono } from 'hono';
import type { FarcasterFramePayload } from '../types';
import { getConfig } from '../config';

export const frameApi = new Hono();
const BASE_URL = getConfig().baseUrl;

const frame = (p: { title: string; text: string; buttons: string[]; input?: string; postUrl?: string }) => `<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${BASE_URL}/frame/img?t=${encodeURIComponent(p.text)}" />
  ${p.input ? `<meta property="fc:frame:input:text" content="${p.input}" />` : ''}
  ${p.postUrl ? `<meta property="fc:frame:post_url" content="${p.postUrl}" />` : ''}
  ${p.buttons.map((b, i) => `<meta property="fc:frame:button:${i + 1}" content="${b}" />`).join('\n')}
</head>
<body>${p.title}</body>
</html>`;

// Home
frameApi.get('/', (c) => c.html(frame({
  title: 'Otto',
  text: 'Otto Trading Agent',
  buttons: ['Swap', 'Bridge', 'Balance'],
  postUrl: `${BASE_URL}/frame/action`,
})));

// Action handler
frameApi.post('/action', async (c) => {
  const payload = await c.req.json() as FarcasterFramePayload;
  const btn = payload.untrustedData.buttonIndex;
  const input = payload.untrustedData.inputText;
  
  if (btn === 1) {
    // Swap
    if (input) {
      return c.html(frame({
        title: 'Swap',
        text: `Swap: ${input}`,
        buttons: ['Confirm', 'Cancel'],
        postUrl: `${BASE_URL}/frame/confirm`,
      }));
    }
    return c.html(frame({
      title: 'Swap',
      text: 'Enter: amount FROM to TO',
      input: '1 ETH to USDC',
      buttons: ['Get Quote'],
      postUrl: `${BASE_URL}/frame/action`,
    }));
  }
  
  if (btn === 2) {
    // Bridge
    return c.html(frame({
      title: 'Bridge',
      text: 'Enter: amount TOKEN from CHAIN to CHAIN',
      input: '1 ETH from ethereum to base',
      buttons: ['Get Quote'],
      postUrl: `${BASE_URL}/frame/action`,
    }));
  }
  
  // Balance
  const fid = payload.untrustedData.fid;
  return c.html(frame({
    title: 'Balance',
    text: `FID ${fid}\n\nConnect wallet to view balance`,
    buttons: ['Connect', 'Home'],
    postUrl: `${BASE_URL}/frame/action`,
  }));
});

// Image generator
frameApi.get('/img', (c) => {
  const text = c.req.query('t') ?? 'Otto';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628">
    <rect width="1200" height="628" fill="#111"/>
    <text x="600" y="300" text-anchor="middle" font-family="system-ui" font-size="48" fill="#0af">${text.split('\n')[0]}</text>
    <text x="600" y="360" text-anchor="middle" font-family="system-ui" font-size="24" fill="#666">${text.split('\n').slice(1).join(' | ')}</text>
  </svg>`;
  c.header('Content-Type', 'image/svg+xml');
  return c.body(svg);
});

export default frameApi;
