import React, { createContext, useContext, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'

// Platform detection context
interface PlatformInfo {
  isMobile: boolean
  isIOS: boolean
  isAndroid: boolean
  isMac: boolean
  isWindows: boolean
  isLinux: boolean
  isTauri: boolean
  isTouch: boolean
}

const PlatformContext = createContext<PlatformInfo>({
  isMobile: false,
  isIOS: false,
  isAndroid: false,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isTauri: false,
  isTouch: false,
})

export const usePlatform = () => useContext(PlatformContext)

function detectPlatform(): PlatformInfo {
  const ua = navigator.userAgent
  const platform = navigator.platform

  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  const isMobile = isIOS || isAndroid || /Mobile/.test(ua)
  const isMac = /Mac/.test(platform) && !isIOS
  const isWindows = /Win/.test(platform)
  const isLinux = /Linux/.test(platform) && !isAndroid
  const isTauri = '__TAURI__' in window
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  return {
    isMobile,
    isIOS,
    isAndroid,
    isMac,
    isWindows,
    isLinux,
    isTauri,
    isTouch,
  }
}

function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [platform, setPlatform] = useState<PlatformInfo>(detectPlatform)

  useEffect(() => {
    // Re-detect on resize (for responsive testing)
    const handleResize = () => {
      setPlatform(detectPlatform())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Add platform-specific classes to document
  useEffect(() => {
    const classes: string[] = []
    if (platform.isMobile) classes.push('is-mobile')
    if (platform.isIOS) classes.push('is-ios')
    if (platform.isAndroid) classes.push('is-android')
    if (platform.isTauri) classes.push('is-tauri')
    if (platform.isTouch) classes.push('is-touch')

    document.documentElement.classList.add(...classes)
    return () => {
      document.documentElement.classList.remove(...classes)
    }
  }, [platform])

  return (
    <PlatformContext.Provider value={platform}>
      {children}
    </PlatformContext.Provider>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error(
    'Root element not found. Ensure index.html contains <div id="root"></div>',
  )
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PlatformProvider>
      <App />
    </PlatformProvider>
  </React.StrictMode>,
)
