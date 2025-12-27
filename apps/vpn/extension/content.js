/**
 * Jeju VPN Browser Extension - Content Script
 *
 * Runs on all pages to provide:
 * 1. WebRTC leak protection
 * 2. JNS indicator for resolved pages
 */

// ============================================================================
// WebRTC Leak Protection
// ============================================================================

/**
 * Inject WebRTC protection script to prevent IP leaks
 * This overrides RTCPeerConnection to use proxy-only ICE candidates
 */
function injectWebRTCProtection() {
  const script = document.createElement('script')
  script.textContent = `
    (function() {
      // Store original RTCPeerConnection
      const OriginalRTCPeerConnection = window.RTCPeerConnection;
      const OriginalRTCPeerConnectionIceEvent = window.RTCPeerConnectionIceEvent;
      
      // Override RTCPeerConnection to filter local IP candidates
      window.RTCPeerConnection = function(config, constraints) {
        // Force relay-only candidates to prevent IP leaks
        const modifiedConfig = {
          ...config,
          iceTransportPolicy: 'relay', // Only use TURN servers
        };
        
        const pc = new OriginalRTCPeerConnection(modifiedConfig, constraints);
        
        // Intercept setLocalDescription to filter candidates
        const originalSetLocalDescription = pc.setLocalDescription.bind(pc);
        pc.setLocalDescription = function(description) {
          if (description && description.sdp) {
            // Remove host candidates (local IPs)
            description.sdp = description.sdp.replace(/a=candidate:[^\\r\\n]*typ host[^\\r\\n]*/g, '');
            // Remove srflx candidates (STUN - reveals IP)
            description.sdp = description.sdp.replace(/a=candidate:[^\\r\\n]*typ srflx[^\\r\\n]*/g, '');
          }
          return originalSetLocalDescription(description);
        };
        
        return pc;
      };
      
      // Copy static properties
      window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
      
      // Copy static methods
      Object.keys(OriginalRTCPeerConnection).forEach(key => {
        window.RTCPeerConnection[key] = OriginalRTCPeerConnection[key];
      });
      
      console.log('[Jeju VPN] WebRTC protection active');
    })();
  `
  
  // Inject as early as possible
  const target = document.head || document.documentElement
  target.insertBefore(script, target.firstChild)
  script.remove() // Clean up
}

// ============================================================================
// JNS Page Indicator
// ============================================================================

/**
 * Show indicator for JNS-resolved pages
 */
function showJNSIndicator(domain) {
  // Create indicator element
  const indicator = document.createElement('div')
  indicator.id = 'jeju-jns-indicator'
  indicator.innerHTML = `
    <style>
      #jeju-jns-indicator {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 255, 136, 0.9);
        color: #000;
        padding: 8px 16px;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        font-weight: 500;
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        animation: jns-slide-in 0.3s ease;
      }
      
      @keyframes jns-slide-in {
        from {
          transform: translateX(100px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      #jeju-jns-indicator svg {
        width: 16px;
        height: 16px;
      }
      
      #jeju-jns-indicator .jns-close {
        margin-left: 8px;
        cursor: pointer;
        opacity: 0.7;
      }
      
      #jeju-jns-indicator .jns-close:hover {
        opacity: 1;
      }
    </style>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
    <span>JNS: ${domain}</span>
    <span class="jns-close" onclick="this.parentElement.remove()">✕</span>
  `
  
  document.body.appendChild(indicator)
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (indicator.parentElement) {
      indicator.style.animation = 'jns-slide-in 0.3s ease reverse'
      setTimeout(() => indicator.remove(), 300)
    }
  }, 5000)
}

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'showJNSIndicator':
      if (message.domain && document.body) {
        showJNSIndicator(message.domain)
      }
      sendResponse({ success: true })
      break
      
    case 'enableWebRTCProtection':
      injectWebRTCProtection()
      sendResponse({ success: true })
      break
      
    case 'ping':
      sendResponse({ pong: true })
      break
  }
  return true
})

// ============================================================================
// Initialization
// ============================================================================

// Check settings and apply WebRTC protection if enabled
chrome.storage.local.get('jejuVpnSettings', (result) => {
  const settings = result.jejuVpnSettings || {}
  
  if (settings.webrtcProtection !== false && settings.proxyEnabled) {
    injectWebRTCProtection()
  }
})

// Check if this page was JNS-resolved
const urlParams = new URLSearchParams(window.location.search)
const jnsDomain = urlParams.get('__jns_domain')
if (jnsDomain) {
  // Wait for body to be ready
  if (document.body) {
    showJNSIndicator(jnsDomain)
  } else {
    document.addEventListener('DOMContentLoaded', () => showJNSIndicator(jnsDomain))
  }
}

console.log('[Jeju VPN] Content script loaded')
