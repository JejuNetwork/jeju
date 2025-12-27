/**
 * Jeju Name Service Browser Extension - Content Script
 *
 * Intercepts link clicks to .jeju domains and handles them via the extension.
 * Also provides a way to show JNS domain info in the page.
 */

;(function () {
  'use strict'

  // Check if we're on a .jeju domain
  const hostname = window.location.hostname
  const isJejuDomain = hostname.endsWith('.jeju')

  if (isJejuDomain) {
    // Add visual indicator that this is a JNS-resolved domain
    addJnsIndicator()
  }

  // Intercept clicks on .jeju links
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest('a')
      if (!link) return

      const href = link.getAttribute('href')
      if (!href) return

      // Check if it's a .jeju link
      if (isJejuUrl(href)) {
        event.preventDefault()
        event.stopPropagation()

        // Send to background script for resolution
        chrome.runtime.sendMessage(
          {
            type: 'navigateToJeju',
            url: href,
          },
          (response) => {
            if (response?.redirectUrl) {
              window.location.href = response.redirectUrl
            }
          },
        )
      }
    },
    true,
  )

  // Handle form submissions to .jeju domains
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target
      const action = form.getAttribute('action')
      if (action && isJejuUrl(action)) {
        event.preventDefault()
        chrome.runtime.sendMessage({
          type: 'navigateToJeju',
          url: action,
        })
      }
    },
    true,
  )

  function isJejuUrl(url) {
    if (url.includes('.jeju')) {
      // Quick check
      const match = url.match(/https?:\/\/([^\/]+\.jeju)/)
      if (match) return true

      // Protocol-relative or relative URL
      if (url.startsWith('//') && url.includes('.jeju/')) return true
    }
    return false
  }

  function addJnsIndicator() {
    // Create floating indicator
    const indicator = document.createElement('div')
    indicator.id = 'jns-indicator'
    indicator.innerHTML = `
      <style>
        #jns-indicator {
          position: fixed;
          bottom: 16px;
          right: 16px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          padding: 8px 12px;
          border-radius: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
          z-index: 999999;
          cursor: pointer;
          transition: transform 0.2s, opacity 0.2s;
        }
        #jns-indicator:hover {
          transform: scale(1.05);
        }
        #jns-indicator.hidden {
          opacity: 0;
          pointer-events: none;
        }
        #jns-indicator .dot {
          width: 6px;
          height: 6px;
          background: #22c55e;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
      <span class="dot"></span>
      <span>JNS: ${hostname}</span>
    `

    indicator.addEventListener('click', () => {
      // Open domain info in new tab
      chrome.runtime.sendMessage({
        type: 'openDomainInfo',
        domain: hostname,
      })
    })

    // Append after DOM is ready
    if (document.body) {
      document.body.appendChild(indicator)
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(indicator)
      })
    }

    // Auto-hide after 10 seconds
    setTimeout(() => {
      indicator.classList.add('hidden')
    }, 10000)
  }

  // Listen for messages from the extension
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'showJnsInfo') {
      showJnsInfoPanel(message.info)
      sendResponse({ success: true })
    }
    return true
  })

  function showJnsInfoPanel(info) {
    // Remove existing panel
    const existing = document.getElementById('jns-info-panel')
    if (existing) existing.remove()

    const panel = document.createElement('div')
    panel.id = 'jns-info-panel'
    panel.innerHTML = `
      <style>
        #jns-info-panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #0a0a0f;
          color: #e8e8ec;
          border: 1px solid #2a2a36;
          border-radius: 12px;
          padding: 24px;
          min-width: 400px;
          max-width: 500px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
          z-index: 9999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #jns-info-panel .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        #jns-info-panel h2 {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
        }
        #jns-info-panel .close {
          background: none;
          border: none;
          color: #a0a0ac;
          cursor: pointer;
          font-size: 20px;
        }
        #jns-info-panel .close:hover {
          color: #e8e8ec;
        }
        #jns-info-panel .row {
          display: flex;
          margin-bottom: 12px;
        }
        #jns-info-panel .label {
          width: 120px;
          color: #a0a0ac;
          font-size: 13px;
        }
        #jns-info-panel .value {
          flex: 1;
          font-family: monospace;
          font-size: 13px;
          word-break: break-all;
        }
        #jns-info-panel .overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 9999998;
        }
      </style>
      <div class="overlay" onclick="this.parentElement.remove()"></div>
      <div class="header">
        <h2>JNS Domain Info</h2>
        <button class="close" onclick="this.closest('#jns-info-panel').remove()">&times;</button>
      </div>
      <div class="row">
        <span class="label">Domain:</span>
        <span class="value">${info.domain || '-'}</span>
      </div>
      <div class="row">
        <span class="label">Node:</span>
        <span class="value">${info.node ? info.node.slice(0, 20) + '...' : '-'}</span>
      </div>
      <div class="row">
        <span class="label">IPFS Hash:</span>
        <span class="value">${info.ipfsHash || '-'}</span>
      </div>
      <div class="row">
        <span class="label">Worker:</span>
        <span class="value">${info.workerEndpoint || '-'}</span>
      </div>
      <div class="row">
        <span class="label">Resolved via:</span>
        <span class="value">${info.resolvedVia || '-'}</span>
      </div>
    `

    document.body.appendChild(panel)
  }
})()
