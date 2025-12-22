/**
 * Extension Popup Entry Point
 *
 * Renders the wallet UI in the extension popup window.
 * Uses the same React app as web/mobile with extension-specific adaptations.
 *
 * Fully permissionless - uses Network RPC infrastructure, no external API keys.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { arbitrum, base, bsc, mainnet, optimism } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { z } from 'zod'
import App from '../../App'
import '../../index.css'
import { expectJson, expectSchema } from '../../lib/validation'

// Network RPC - open API, no keys required
const JEJU_RPC = 'https://rpc.jejunetwork.org'

// Wagmi config for extension - fully permissionless
const config = createConfig({
  chains: [mainnet, base, arbitrum, optimism, bsc],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(`${JEJU_RPC}/eth`),
    [base.id]: http(`${JEJU_RPC}/base`),
    [arbitrum.id]: http(`${JEJU_RPC}/arbitrum`),
    [optimism.id]: http(`${JEJU_RPC}/optimism`),
    [bsc.id]: http(`${JEJU_RPC}/bsc`),
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      gcTime: 1000 * 60 * 5,
    },
  },
})

const PopupParamsSchema = z.object({
  path: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().uuid().optional(),
})

// Extension-specific URL parameter handling
function getPopupParams(): z.infer<typeof PopupParamsSchema> {
  const url = new URL(window.location.href)
  const path = url.hash.replace('#/', '')
  const data = url.searchParams.get('data')
  const requestId = url.searchParams.get('requestId')

  const params: {
    path?: string
    data?: Record<string, unknown>
    requestId?: string
  } = {
    path: path || undefined,
    requestId: requestId || undefined,
  }

  if (data) {
    params.data = expectJson(
      data,
      z.record(z.string(), z.unknown()),
      'popup data',
    )
  }

  return expectSchema(params, PopupParamsSchema, 'popup params')
}

// Send response back to background script
function sendPopupResponse(
  requestId: string,
  approved: boolean,
  data?: Record<string, unknown>,
): void {
  chrome.runtime.sendMessage({
    type: 'popup_response',
    requestId,
    approved,
    ...data,
  })
}

// Make these available globally for the app
declare global {
  interface Window {
    __POPUP_PARAMS__?: ReturnType<typeof getPopupParams>
    __SEND_POPUP_RESPONSE__?: typeof sendPopupResponse
  }
}

window.__POPUP_PARAMS__ = getPopupParams()
window.__SEND_POPUP_RESPONSE__ = sendPopupResponse

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {/* @ts-expect-error - React 18 type compat with wagmi */}
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>,
  )
}
