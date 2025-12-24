/**
 * Extension Popup Entry Point
 *
 * Renders the wallet UI in the extension popup window.
 * Uses the same React app as web/mobile with extension-specific adaptations.
 *
 * Fully permissionless - uses Network RPC infrastructure, no external API keys.
 */

import { expectJson } from '@jejunetwork/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { arbitrum, base, bsc, mainnet, optimism } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { z } from 'zod'
import App from '../../web/App'
import '../../web/globals.css'
import { expectSchema } from '../../lib/validation'
import type { EIP1193Param } from '../types'

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

// EIP1193Param schema for recursive validation
const EIP1193ParamSchema: z.ZodType<EIP1193Param> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), EIP1193ParamSchema),
    z.array(EIP1193ParamSchema),
  ]),
)

const PopupParamsSchema = z.object({
  path: z.string().optional(),
  data: z.record(z.string(), EIP1193ParamSchema).optional(),
  requestId: z.string().uuid().optional(),
})

/** Parsed popup parameters */
type PopupParams = z.infer<typeof PopupParamsSchema>

// Extension-specific URL parameter handling
function getPopupParams(): PopupParams {
  const url = new URL(window.location.href)
  const path = url.hash.replace('#/', '')
  const dataParam = url.searchParams.get('data')
  const requestId = url.searchParams.get('requestId')

  const params: PopupParams = {
    path: path || undefined,
    requestId: requestId || undefined,
  }

  if (dataParam) {
    params.data = expectJson(
      dataParam,
      z.record(z.string(), EIP1193ParamSchema),
      'popup data',
    )
  }

  return expectSchema(params, PopupParamsSchema, 'popup params')
}

/** Popup response data - matches global type declaration */
interface PopupResponseData {
  hash?: `0x${string}`
  signature?: `0x${string}`
  intentId?: `0x${string}`
  accounts?: `0x${string}`[]
}

// Send response back to background script
function sendPopupResponse(
  requestId: string,
  approved: boolean,
  data?: PopupResponseData,
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
    __POPUP_PARAMS__?: PopupParams
    __SEND_POPUP_RESPONSE__?: typeof sendPopupResponse
  }
}

window.__POPUP_PARAMS__ = getPopupParams()
window.__SEND_POPUP_RESPONSE__ = sendPopupResponse

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>,
  )
}
