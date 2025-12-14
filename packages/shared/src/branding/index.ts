/**
 * Shared Branding Utilities
 * 
 * Re-exports branding from config and provides React-friendly utilities
 */

// Re-export everything from config
export {
  getBranding,
  getNetworkName,
  getNetworkDisplayName,
  getNetworkTagline,
  getNetworkDescription,
  getChainBranding,
  getUrls,
  getVisualBranding,
  getFeatures,
  getCliBranding,
  getLegal,
  getSupport,
  getNativeToken,
  getGovernanceToken,
  interpolate,
  generateForkBranding,
  setConfigPath,
  clearBrandingCache,
  type BrandingConfig,
  type ChainBranding,
  type TokenBranding,
  type UrlsBranding,
  type VisualBranding,
  type FeaturesBranding,
  type LegalBranding,
  type SupportBranding,
  type CliBranding,
} from '@jejunetwork/config';

/**
 * Get CSS variables from branding for use in apps
 */
export function getBrandingCssVars(): Record<string, string> {
  // Import dynamically to avoid circular deps
  const { getVisualBranding, getNetworkName } = require('@jejunetwork/config');
  const visual = getVisualBranding();
  
  return {
    '--brand-primary': visual.primaryColor,
    '--brand-secondary': visual.secondaryColor,
    '--brand-accent': visual.accentColor,
    '--brand-bg': visual.backgroundColor,
    '--brand-text': visual.textColor,
  };
}

/**
 * Apply branding CSS variables to document
 */
export function applyBrandingToDocument(): void {
  if (typeof document === 'undefined') return;
  
  const vars = getBrandingCssVars();
  const root = document.documentElement;
  
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}


