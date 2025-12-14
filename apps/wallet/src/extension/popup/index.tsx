/**
 * Extension Popup Entry Point
 * 
 * Renders the wallet UI in the extension popup window.
 * Uses the same React app as web/mobile with extension-specific adaptations.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, base, arbitrum, optimism, polygon } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import App from '../../App';
import '../../index.css';

// Wagmi config for extension
const config = createConfig({
  chains: [mainnet, base, arbitrum, optimism, polygon],
  connectors: [
    injected(),
    walletConnect({
      projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'demo',
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      gcTime: 1000 * 60 * 5,
    },
  },
});

// Extension-specific URL parameter handling
function getPopupParams(): { path?: string; data?: Record<string, unknown>; requestId?: string } {
  const url = new URL(window.location.href);
  const path = url.hash.replace('#/', '');
  const data = url.searchParams.get('data');
  const requestId = url.searchParams.get('requestId');

  return {
    path: path || undefined,
    data: data ? JSON.parse(data) : undefined,
    requestId: requestId || undefined,
  };
}

// Send response back to background script
function sendPopupResponse(requestId: string, approved: boolean, data?: Record<string, unknown>): void {
  chrome.runtime.sendMessage({
    type: 'popup_response',
    requestId,
    approved,
    ...data,
  });
}

// Make these available globally for the app
declare global {
  interface Window {
    __POPUP_PARAMS__?: ReturnType<typeof getPopupParams>;
    __SEND_POPUP_RESPONSE__?: typeof sendPopupResponse;
  }
}

window.__POPUP_PARAMS__ = getPopupParams();
window.__SEND_POPUP_RESPONSE__ = sendPopupResponse;

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {/* @ts-expect-error - React 18 type compat with wagmi */}
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>
  );
}

