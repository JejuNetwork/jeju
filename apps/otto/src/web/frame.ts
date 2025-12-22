/**
 * Otto Farcaster Frame
 * Minimal interactive Frame for trading
 */

import { Elysia } from 'elysia'
import { getConfig } from '../config'
import { expectValid, FarcasterFramePayloadSchema } from '../schemas'

const BASE_URL = getConfig().baseUrl

/**
 * Escape XML/HTML special characters for safe SVG embedding
 */
function escapeXml(text: string): string {
  const xmlChars: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }
  return text.replace(/[&<>"']/g, (char) => xmlChars[char] ?? char)
}

/**
 * Escape HTML for safe attribute embedding
 */
function escapeHtmlAttr(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[char] ?? char
  })
}

const frame = (p: {
  title: string
  text: string
  buttons: string[]
  input?: string
  postUrl?: string
}) => {
  const safeTitle = escapeHtmlAttr(p.title)
  const safeInput = p.input ? escapeHtmlAttr(p.input) : ''
  const safeButtons = p.buttons.map((b) => escapeHtmlAttr(b))

  return `<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${BASE_URL}/frame/img?t=${encodeURIComponent(p.text)}" />
  ${safeInput ? `<meta property="fc:frame:input:text" content="${safeInput}" />` : ''}
  ${p.postUrl ? `<meta property="fc:frame:post_url" content="${p.postUrl}" />` : ''}
  ${safeButtons.map((b, i) => `<meta property="fc:frame:button:${i + 1}" content="${b}" />`).join('\n')}
</head>
<body>${safeTitle}</body>
</html>`
}

export const frameApi = new Elysia({ prefix: '/frame' })
  // Home
  .get('/', ({ set }) => {
    set.headers['Content-Type'] = 'text/html'
    return frame({
      title: 'Otto',
      text: 'Otto Trading Agent',
      buttons: ['Swap', 'Bridge', 'Balance'],
      postUrl: `${BASE_URL}/frame/action`,
    })
  })

  // Action handler
  .post('/action', ({ body, set }) => {
    const payload = expectValid(
      FarcasterFramePayloadSchema,
      body,
      'Farcaster frame action',
    )
    const btn = payload.untrustedData.buttonIndex
    const input = payload.untrustedData.inputText

    set.headers['Content-Type'] = 'text/html'

    if (btn === 1) {
      // Swap
      if (input) {
        return frame({
          title: 'Swap',
          text: `Swap: ${input}`,
          buttons: ['Confirm', 'Cancel'],
          postUrl: `${BASE_URL}/frame/confirm`,
        })
      }
      return frame({
        title: 'Swap',
        text: 'Enter: amount FROM to TO',
        input: '1 ETH to USDC',
        buttons: ['Get Quote'],
        postUrl: `${BASE_URL}/frame/action`,
      })
    }

    if (btn === 2) {
      // Bridge
      return frame({
        title: 'Bridge',
        text: 'Enter: amount TOKEN from CHAIN to CHAIN',
        input: '1 ETH from ethereum to base',
        buttons: ['Get Quote'],
        postUrl: `${BASE_URL}/frame/action`,
      })
    }

    // Balance
    const fid = payload.untrustedData.fid
    return frame({
      title: 'Balance',
      text: `FID ${fid}\n\nConnect wallet to view balance`,
      buttons: ['Connect', 'Home'],
      postUrl: `${BASE_URL}/frame/action`,
    })
  })

  // Image generator
  .get('/img', ({ query, set }) => {
    const text = query.t ?? 'Otto'
    // Limit text length to prevent abuse
    const safeText = text.length > 200 ? `${text.slice(0, 200)}...` : text
    const lines = safeText.split('\n')
    const firstLine = escapeXml(lines[0] ?? 'Otto')
    const otherLines = escapeXml(lines.slice(1).join(' | '))

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628">
    <rect width="1200" height="628" fill="#111"/>
    <text x="600" y="300" text-anchor="middle" font-family="system-ui" font-size="48" fill="#0af">${firstLine}</text>
    <text x="600" y="360" text-anchor="middle" font-family="system-ui" font-size="24" fill="#666">${otherLines}</text>
  </svg>`
    set.headers['Content-Type'] = 'image/svg+xml'
    return svg
  })

export default frameApi
