/**
 * Extension Content Script
 * 
 * Injected into every page to provide the window.ethereum provider.
 * Bridges communication between dApps and the extension background.
 */

// Inject the provider script into the page context
function injectProvider(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// Message bridge between page and extension
interface PageMessage {
  type: 'jeju_request';
  method: string;
  params?: unknown[];
  id: string;
}

interface ExtensionResponse {
  type: 'jeju_response';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

// Listen for messages from the injected script
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'jeju_request') return;

  const message = event.data as PageMessage;
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: message.method,
      data: message.params?.[0],
      id: message.id,
    });

    const response: ExtensionResponse = {
      type: 'jeju_response',
      id: message.id,
      result,
    };
    window.postMessage(response, '*');
  } catch (error) {
    const response: ExtensionResponse = {
      type: 'jeju_response',
      id: message.id,
      error: {
        code: 4001,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    window.postMessage(response, '*');
  }
});

// Listen for events from background script
chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  // Forward events to the page
  window.postMessage({ type: 'jeju_event', event: message.type, data: message }, '*');
});

// Inject provider when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectProvider);
} else {
  injectProvider();
}

