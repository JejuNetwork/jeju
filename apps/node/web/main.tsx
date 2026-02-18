import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './context/AppContext'
import './globals.css'

// Create a debug log that we can capture
const debugLogs: string[] = []
const originalConsoleLog = console.log
const originalConsoleError = console.error
console.log = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  debugLogs.push(`[LOG] ${msg}`)
  originalConsoleLog.apply(console, args)
}
console.error = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  debugLogs.push(`[ERROR] ${msg}`)
  originalConsoleError.apply(console, args)
}
// Expose for debugging
;(window as any).__JEJU_DEBUG_LOGS__ = debugLogs

console.log('[JejuNode] main.tsx starting...')
console.log('[JejuNode] window.__TAURI__:', typeof window.__TAURI__)

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
)
