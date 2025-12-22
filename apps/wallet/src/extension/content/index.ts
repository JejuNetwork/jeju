/**
 * Extension Content Script
 * 
 * Injected into every page to provide the window.ethereum provider.
 * Bridges communication between dApps and the extension background.
 */

import type { PageRequest, PageResponse, BackgroundEventMessage, EIP1193Param } from '../types';

// Inject the provider script into the page context
function injectProvider(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// Listen for messages from the injected script
window.addEventListener('message', async (event: MessageEvent<PageRequest | { type: string }>) => {
  if (event.source !== window) return;
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type !== 'jeju_request') return;

  const message = event.data as PageRequest;
  
  const result = await chrome.runtime.sendMessage({
    type: message.method,
    data: message.params?.[0] as Record<string, EIP1193Param> | undefined,
    id: message.id,
  });

  const response: PageResponse = {
    type: 'jeju_response',
    id: message.id,
    result: result as EIP1193Param,
  };
  window.postMessage(response, '*');
});

// Listen for events from background script
chrome.runtime.onMessage.addListener((message: BackgroundEventMessage) => {
  // Forward events to the page
  window.postMessage({ type: 'jeju_event', event: message.type, data: message }, '*');
});

// Inject provider when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectProvider);
} else {
  injectProvider();
}

