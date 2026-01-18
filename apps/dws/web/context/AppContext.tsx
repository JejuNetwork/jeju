/**
 * App-wide Context Provider
 *
 * Manages:
 * - View mode (consumer/provider) with localStorage persistence
 * - Theme (dark/light) with localStorage persistence
 * - Toast notifications
 * - Keyboard shortcuts
 * - Onboarding state
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ViewMode } from '../types'

// ============ Toast System ============

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

// ============ Theme ============

export type Theme = 'dark' | 'light'

// ============ Context Types ============

interface AppContextValue {
  // View Mode
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void

  // Toasts
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  showSuccess: (title: string, message?: string) => void
  showError: (title: string, message?: string) => void
  showWarning: (title: string, message?: string) => void
  showInfo: (title: string, message?: string) => void

  // Onboarding
  hasSeenOnboarding: boolean
  setHasSeenOnboarding: (seen: boolean) => void

  // Confirmation Dialog
  confirm: (options: ConfirmOptions) => Promise<boolean>
  confirmState: ConfirmState | null
  resolveConfirm: (result: boolean) => void
}

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

interface ConfirmState extends ConfirmOptions {
  resolve: (result: boolean) => void
}

const AppContext = createContext<AppContextValue | null>(null)

// ============ Storage Keys ============

const STORAGE_KEYS = {
  viewMode: 'dws-view-mode',
  theme: 'dws-theme',
  onboarding: 'dws-onboarding-seen',
} as const

// ============ Provider ============

export function AppProvider({ children }: { children: ReactNode }) {
  // View Mode - persisted
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'consumer'
    const stored = localStorage.getItem(STORAGE_KEYS.viewMode)
    return stored === 'provider' ? 'provider' : 'consumer'
  })

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    localStorage.setItem(STORAGE_KEYS.viewMode, mode)
  }, [])

  // Theme - persisted
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = localStorage.getItem(STORAGE_KEYS.theme)
    if (stored === 'light' || stored === 'dark') return stored
    // Default to system preference
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  })

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem(STORAGE_KEYS.theme, newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const newToast: Toast = { ...toast, id }
    setToasts((prev) => [...prev, newToast])

    // Auto-remove after duration
    const duration = toast.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showSuccess = useCallback(
    (title: string, message?: string) => {
      addToast({ type: 'success', title, message })
    },
    [addToast],
  )

  const showError = useCallback(
    (title: string, message?: string) => {
      addToast({ type: 'error', title, message, duration: 8000 })
    },
    [addToast],
  )

  const showWarning = useCallback(
    (title: string, message?: string) => {
      addToast({ type: 'warning', title, message })
    },
    [addToast],
  )

  const showInfo = useCallback(
    (title: string, message?: string) => {
      addToast({ type: 'info', title, message })
    },
    [addToast],
  )

  // Onboarding
  const [hasSeenOnboarding, setHasSeenOnboardingState] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(STORAGE_KEYS.onboarding) === 'true'
  })

  const setHasSeenOnboarding = useCallback((seen: boolean) => {
    setHasSeenOnboardingState(seen)
    localStorage.setItem(STORAGE_KEYS.onboarding, seen ? 'true' : 'false')
  }, [])

  // Confirmation Dialog
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ ...options, resolve })
    })
  }, [])

  const resolveConfirm = useCallback(
    (result: boolean) => {
      if (confirmState) {
        confirmState.resolve(result)
        setConfirmState(null)
      }
    },
    [confirmState],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Cmd/Ctrl + K - Focus search (future)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        // TODO: Focus global search
      }

      // Cmd/Ctrl + B - Toggle sidebar (handled in Layout)

      // Escape - Close modals/confirmations
      if (e.key === 'Escape' && confirmState) {
        resolveConfirm(false)
      }

      // G + D - Go to Dashboard
      if (e.key === 'g') {
        // Wait for second key
        const handleSecondKey = (e2: KeyboardEvent) => {
          document.removeEventListener('keydown', handleSecondKey)
          if (e2.key === 'd') {
            window.location.href = '/'
          } else if (e2.key === 's') {
            window.location.href = '/storage/buckets'
          } else if (e2.key === 'c') {
            window.location.href = '/compute/containers'
          } else if (e2.key === 'w') {
            window.location.href = '/compute/workers'
          } else if (e2.key === 'b') {
            window.location.href = '/billing'
          }
        }
        setTimeout(() => {
          document.addEventListener('keydown', handleSecondKey, { once: true })
          setTimeout(
            () => document.removeEventListener('keydown', handleSecondKey),
            1000,
          )
        }, 0)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [confirmState, resolveConfirm])

  const value = useMemo(
    () => ({
      viewMode,
      setViewMode,
      theme,
      setTheme,
      toggleTheme,
      toasts,
      addToast,
      removeToast,
      showSuccess,
      showError,
      showWarning,
      showInfo,
      hasSeenOnboarding,
      setHasSeenOnboarding,
      confirm,
      confirmState,
      resolveConfirm,
    }),
    [
      viewMode,
      setViewMode,
      theme,
      setTheme,
      toggleTheme,
      toasts,
      addToast,
      removeToast,
      showSuccess,
      showError,
      showWarning,
      showInfo,
      hasSeenOnboarding,
      setHasSeenOnboarding,
      confirm,
      confirmState,
      resolveConfirm,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// ============ Hook ============

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}

// Convenience hooks
export function useViewMode() {
  const { viewMode, setViewMode } = useApp()
  return { viewMode, setViewMode }
}

export function useTheme() {
  const { theme, setTheme, toggleTheme } = useApp()
  return { theme, setTheme, toggleTheme }
}

export function useToast() {
  const { showSuccess, showError, showWarning, showInfo, addToast } = useApp()
  return { showSuccess, showError, showWarning, showInfo, addToast }
}

export function useConfirm() {
  const { confirm } = useApp()
  return confirm
}
