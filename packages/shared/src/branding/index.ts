/**
 * Shared Branding Utilities
 *
 * React-friendly branding utilities
 */

import { getVisualBranding as getVisualBrandingConfig } from '@jejunetwork/config'

/**
 * Get CSS variables from branding for use in apps
 */
export function getBrandingCssVars(): Record<string, string> {
  const visual = getVisualBrandingConfig()

  return {
    '--brand-primary': visual.primaryColor,
    '--brand-secondary': visual.secondaryColor,
    '--brand-accent': visual.accentColor,
    '--brand-bg': visual.backgroundColor,
    '--brand-text': visual.textColor,
  }
}

/**
 * Apply branding CSS variables to document
 */
export function applyBrandingToDocument(): void {
  if (typeof document === 'undefined') return

  const vars = getBrandingCssVars()
  const root = document.documentElement

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}
