import type {
  BackgroundEventMessage,
  PageRequest,
  PageResponse,
} from '../types'

// Type guard for PageRequest messages
function isPageRequest(data: { type: string }): data is PageRequest {
  return data.type === 'jeju_request' && 'id' in data && 'method' in data
}

// Inject the provider script into the page context
function injectProvider(): void {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('injected.js')
  script.onload = () => script.remove()
  ;(document.head || document.documentElement).appendChild(script)
}

// Listen for messages from the injected script
window.addEventListener(
  'message',
  async (event: MessageEvent<PageRequest | { type: string }>) => {
    // Only accept messages from the same window/frame
    if (event.source !== window) return
    // Verify the message origin matches the current page
    if (event.origin !== window.location.origin) return
    if (!event.data || typeof event.data !== 'object') return
    if (!isPageRequest(event.data)) return

    const message = event.data

    const result = await chrome.runtime.sendMessage({
      type: message.method,
      data: message.params?.[0],
      id: message.id,
    })

    const response: PageResponse = {
      type: 'jeju_response',
      id: message.id,
      result: result,
    }
    // Send response only to the same origin
    window.postMessage(response, window.location.origin)
  },
)

// Listen for events from background script
chrome.runtime.onMessage.addListener((message: BackgroundEventMessage) => {
  // Forward events to the page (only to same origin)
  window.postMessage(
    { type: 'jeju_event', event: message.type, data: message },
    window.location.origin,
  )
})

// Inject provider when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectProvider)
} else {
  injectProvider()
}
