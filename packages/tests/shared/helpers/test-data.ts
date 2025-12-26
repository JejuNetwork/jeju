/**
 * Base Test Data Constants
 *
 * Shared test data including viewports, timeouts, selectors, and form data
 * that can be used across all Jeju Network apps.
 *
 * @module @jejunetwork/tests/helpers/test-data
 *
 * @example
 * ```typescript
 * import { VIEWPORTS, TIMEOUTS, BASE_SELECTORS } from '@jejunetwork/tests';
 *
 * test.beforeEach(async ({ page }) => {
 *   await page.setViewportSize(VIEWPORTS.DESKTOP);
 * });
 *
 * test('should show element', async ({ page }) => {
 *   await expect(page.locator(BASE_SELECTORS.LOGIN_BUTTON))
 *     .toBeVisible({ timeout: TIMEOUTS.MEDIUM });
 * });
 * ```
 */

// ============================================================================
// Viewport Sizes for Responsive Testing
// ============================================================================

/**
 * Standard viewport sizes for responsive testing
 *
 * Covers common device sizes from mobile to ultrawide desktop.
 * Use these to ensure consistent responsive testing across apps.
 */
export const VIEWPORTS = {
  /** iPhone SE - smallest common mobile */
  MOBILE_SMALL: { width: 320, height: 568 },
  /** iPhone 8 - standard mobile */
  MOBILE: { width: 375, height: 667 },
  /** iPhone 11 Pro Max - large mobile */
  MOBILE_LARGE: { width: 414, height: 896 },
  /** iPad - standard tablet */
  TABLET: { width: 768, height: 1024 },
  /** iPad Pro 11" - large tablet */
  TABLET_LARGE: { width: 834, height: 1194 },
  /** Standard laptop/desktop */
  DESKTOP: { width: 1280, height: 800 },
  /** Full HD desktop */
  DESKTOP_LARGE: { width: 1920, height: 1080 },
  /** QHD/2K desktop */
  DESKTOP_ULTRAWIDE: { width: 2560, height: 1440 },
} as const

export type ViewportName = keyof typeof VIEWPORTS
export type Viewport = (typeof VIEWPORTS)[ViewportName]

// ============================================================================
// Timeouts for Different Operations
// ============================================================================

/**
 * Standard timeout values in milliseconds
 *
 * Use these for consistent timeout handling across tests.
 * Adjust based on your CI environment and network conditions.
 */
export const TIMEOUTS = {
  /** Quick checks (element visible) */
  SHORT: 3000,
  /** Standard operations (API calls) */
  MEDIUM: 10000,
  /** Longer operations (page loads) */
  LONG: 30000,
  /** Extended operations (complex flows) */
  EXTRA_LONG: 60000,
  /** Page load timeout */
  PAGE_LOAD: 15000,
  /** API call timeout */
  API_CALL: 10000,
  /** Animation completion */
  ANIMATION: 500,
  /** Wallet popup timeout */
  WALLET_POPUP: 30000,
  /** Transaction confirmation */
  TRANSACTION: 60000,
} as const

export type TimeoutName = keyof typeof TIMEOUTS
export type Timeout = (typeof TIMEOUTS)[TimeoutName]

// ============================================================================
// Base UI Selectors
// ============================================================================

/**
 * Common UI element selectors
 *
 * These selectors work across most Jeju apps with standard component patterns.
 * Apps should extend these with their own specific selectors.
 */
export const BASE_SELECTORS = {
  // Authentication
  LOGIN_BUTTON:
    'button:has-text("Log in"), button:has-text("Login"), button:has-text("Connect Wallet"), button:has-text("Connect"), button:has-text("Sign in")',
  LOGOUT_BUTTON:
    'button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Disconnect")',
  USER_MENU: '[data-testid="user-menu"]',
  WALLET_ADDRESS: '[data-testid="wallet-address"]',

  // Navigation
  NAV_LINK: 'nav a, [role="navigation"] a',
  BOTTOM_NAV: '[data-testid="bottom-nav"], nav.fixed.bottom-0',
  SIDEBAR: '[data-testid="sidebar"], aside, [role="complementary"]',
  BREADCRUMB: '[data-testid="breadcrumb"], nav[aria-label="breadcrumb"]',

  // Forms
  INPUT: 'input',
  TEXTAREA: 'textarea',
  SELECT: 'select',
  CHECKBOX: 'input[type="checkbox"]',
  RADIO: 'input[type="radio"]',
  SLIDER: 'input[type="range"], [role="slider"]',
  SUBMIT_BUTTON: 'button[type="submit"]',

  // Feedback
  LOADING_SKELETON: '[data-testid="skeleton"], .skeleton',
  LOADING_SPINNER: '[data-testid="spinner"], .spinner, .loading',
  ERROR_MESSAGE: '[role="alert"], .error, .text-red, [data-testid="error"]',
  SUCCESS_MESSAGE: '.success, .text-green, [data-testid="success"]',
  TOAST: '[data-testid="toast"], [role="status"]',

  // Modals & Overlays
  MODAL: '[role="dialog"], .modal, [data-testid="modal"]',
  MODAL_CLOSE: '[data-testid="modal-close"], button[aria-label="Close"]',
  OVERLAY: '[data-testid="overlay"], .overlay',

  // Tables & Lists
  TABLE: 'table, [role="table"]',
  TABLE_ROW: 'tr, [role="row"]',
  LIST: 'ul, ol, [role="list"]',
  LIST_ITEM: 'li, [role="listitem"]',

  // Cards
  CARD: '[data-testid*="card"], .card',

  // Tabs
  TAB: '[role="tab"]',
  TAB_PANEL: '[role="tabpanel"]',

  // Search
  SEARCH_INPUT: 'input[type="search"], input[placeholder*="Search"]',
} as const

// ============================================================================
// Test Form Data
// ============================================================================

/**
 * Common test data for form inputs
 *
 * Includes both valid data and edge cases for thorough testing.
 */
export const TEST_FORM_DATA = {
  // Profile data
  DISPLAY_NAME: 'Test User Display Name',
  USERNAME: 'testuser123',
  BIO: 'This is a test bio for E2E testing purposes.',
  EMAIL: 'test@example.com',

  // Content
  POST_CONTENT: 'This is a test post from E2E tests',
  COMMENT_CONTENT: 'This is a test comment',
  CHAT_MESSAGE: 'Hello, this is a test message.',

  // Search
  SEARCH_QUERY: 'test search query',

  // Numeric
  AMOUNT_SMALL: '0.01',
  AMOUNT_MEDIUM: '1.0',
  AMOUNT_LARGE: '100.0',

  // Edge cases
  EMPTY_STRING: '',
  LONG_STRING: 'A'.repeat(5000),
  SPECIAL_CHARS: '!@#$%^&*(){}[]<>?/\\|`~',
  UNICODE_STRING: '日本語テスト 🎉 émojis äöü',
  WHITESPACE_ONLY: '   \t\n   ',

  // Security test inputs (for validation testing)
  XSS_ATTEMPT: '<script>alert("xss")</script>',
  SQL_INJECTION: "'; DROP TABLE users; --",
  PATH_TRAVERSAL: '../../../etc/passwd',
} as const

/**
 * Numeric test values for trading/financial inputs
 */
export const TEST_NUMBERS = {
  NEGATIVE: -999999,
  ZERO: 0,
  SMALL_DECIMAL: 0.001,
  NORMAL: 100,
  LARGE: 999999999999,
  INFINITY: Infinity,
  NAN: NaN,
} as const

// ============================================================================
// Trading Test Data
// ============================================================================

/**
 * Test data for trading operations
 */
export const TRADING_TEST_DATA = {
  // Perp trading
  PERP_SIZES: [1, 10, 100, 0.5, 0.01] as const,
  LEVERAGE_VALUES: [1, 2, 5, 10, 20] as const,

  // Prediction market
  PREDICTION_AMOUNTS: [1, 10, 100, 0.5] as const,
  YES_NO_SIDES: ['YES', 'NO'] as const,

  // Invalid inputs
  INVALID_SIZE: -1,
  INVALID_LEVERAGE: 1000,
  INVALID_AMOUNT: -100,
} as const

// ============================================================================
// HTTP Status Codes for API Testing
// ============================================================================

/**
 * Common HTTP status codes for API testing
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique test ID with timestamp
 *
 * @param prefix - Optional prefix for the ID
 * @returns Unique ID string
 */
export function generateTestId(prefix = 'test'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Generate test email address
 *
 * @param prefix - Optional prefix for the email
 * @returns Unique test email
 */
export function generateTestEmail(prefix = 'test'): string {
  return `${generateTestId(prefix)}@test.jeju.network`
}

/**
 * Generate test username
 *
 * @param prefix - Optional prefix for the username
 * @returns Unique test username
 */
export function generateTestUsername(prefix = 'testuser'): string {
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${random}`
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
