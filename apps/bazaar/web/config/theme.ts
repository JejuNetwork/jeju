/**
 * Nocturne Bazaar Theme Tokens
 * Type-safe theme configuration for the Bazaar app
 *
 * Design Philosophy:
 * - Deep indigo background (#070816) as primary canvas
 * - Amber glow accents (#ffb43a) for primary actions
 * - Cyan neon (#00f2ff) for secondary/data elements
 * - Nebula purple (#1e1140) for depth layers
 * - Glass morphism with blur effects
 * - Volumetric noise texture overlay
 * - Smooth 300ms theme transitions
 */

export const theme = {
  name: 'nocturne-bazaar',

  // Fonts
  fonts: {
    sans: "'Outfit', system-ui, sans-serif",
    display: "'Outfit', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },

  // Brand Colors
  colors: {
    // Primary - Amber glow
    primary: '#ffb43a',
    primaryDark: '#e59a20',
    primaryLight: '#ffc566',

    // Accent - Cyan neon
    accent: '#00f2ff',
    accentDark: '#00c4cf',
    accentLight: '#4df7ff',

    // Tertiary - Silk violet
    violet: '#4c1d95',
    violetDark: '#3b1578',
    violetLight: '#6d28d9',

    // Status
    success: '#10B981',
    error: '#EF4444',
    warning: '#F59E0B',
    info: '#3B82F6',
  },

  // Light Mode (subtle version for accessibility)
  light: {
    bgPrimary: '#f8f7fc',
    bgSecondary: '#efedf5',
    bgTertiary: '#e6e3ef',
    surface: '#ffffff',
    surfaceElevated: '#ffffff',
    border: 'rgba(76, 29, 149, 0.15)',
    borderStrong: 'rgba(76, 29, 149, 0.25)',
    textPrimary: '#070816',
    textSecondary: '#4a4a5a',
    textTertiary: '#71717a',
  },

  // Dark Mode (primary mode for Nocturne theme)
  dark: {
    bgPrimary: '#070816', // Deep indigo
    bgSecondary: '#0f0c29', // Slightly lighter
    bgTertiary: '#1e1140', // Nebula purple
    surface: 'rgba(15, 12, 41, 0.6)', // Glass background
    surfaceElevated: 'rgba(30, 17, 64, 0.7)',
    border: 'rgba(255, 255, 255, 0.1)',
    borderStrong: 'rgba(255, 255, 255, 0.15)',
    textPrimary: '#d4d4d8', // Sand stone
    textSecondary: '#a1a1aa',
    textTertiary: '#71717a',
  },

  // Effects
  effects: {
    glassBlur: '10px',
    shadowCard: '0 20px 40px rgba(0, 0, 0, 0.4)',
    shadowCardHover: '0 30px 60px rgba(0, 0, 0, 0.6), 0 0 20px rgba(255, 180, 58, 0.1)',
    shadowGlow: '0 0 20px rgba(255, 180, 58, 0.4)',
    shadowGlowSm: '0 0 15px rgba(255, 180, 58, 0.3)',
    shadowCyanGlow: '0 0 10px rgba(0, 242, 255, 0.5)',
    focusRing: '0 0 0 3px rgba(255, 180, 58, 0.4)',
  },

  // Transitions
  transitions: {
    theme: '300ms ease',
    fast: '150ms ease',
    normal: '200ms ease',
    card: '500ms cubic-bezier(0.23, 1, 0.32, 1)',
  },
} as const

export type Theme = typeof theme

// Utility to generate CSS variable value
export function getCssVar(path: string): string {
  return `var(--${path.replace(/\./g, '-')})`
}
