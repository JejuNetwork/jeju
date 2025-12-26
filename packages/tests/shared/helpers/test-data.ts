/** Shared test data constants */

export const VIEWPORTS = {
  MOBILE_SMALL: { width: 320, height: 568 },
  MOBILE: { width: 375, height: 667 },
  MOBILE_LARGE: { width: 414, height: 896 },
  TABLET: { width: 768, height: 1024 },
  TABLET_LARGE: { width: 834, height: 1194 },
  DESKTOP: { width: 1280, height: 800 },
  DESKTOP_LARGE: { width: 1920, height: 1080 },
  DESKTOP_ULTRAWIDE: { width: 2560, height: 1440 },
} as const

export type ViewportName = keyof typeof VIEWPORTS
export type Viewport = (typeof VIEWPORTS)[ViewportName]

export const TIMEOUTS = {
  SHORT: 3000,
  MEDIUM: 10000,
  LONG: 30000,
  EXTRA_LONG: 60000,
  PAGE_LOAD: 15000,
  API_CALL: 10000,
  ANIMATION: 500,
  WALLET_POPUP: 30000,
  TRANSACTION: 60000,
} as const

export type TimeoutName = keyof typeof TIMEOUTS

export const BASE_SELECTORS = {
  LOGIN_BUTTON:
    'button:has-text("Log in"), button:has-text("Login"), button:has-text("Connect Wallet"), button:has-text("Connect"), button:has-text("Sign in")',
  LOGOUT_BUTTON:
    'button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Disconnect")',
  USER_MENU: '[data-testid="user-menu"]',
  WALLET_ADDRESS: '[data-testid="wallet-address"]',
  NAV_LINK: 'nav a, [role="navigation"] a',
  BOTTOM_NAV: '[data-testid="bottom-nav"], nav.fixed.bottom-0',
  SIDEBAR: '[data-testid="sidebar"], aside, [role="complementary"]',
  BREADCRUMB: '[data-testid="breadcrumb"], nav[aria-label="breadcrumb"]',
  INPUT: 'input',
  TEXTAREA: 'textarea',
  SELECT: 'select',
  CHECKBOX: 'input[type="checkbox"]',
  RADIO: 'input[type="radio"]',
  SLIDER: 'input[type="range"], [role="slider"]',
  SUBMIT_BUTTON: 'button[type="submit"]',
  LOADING_SKELETON: '[data-testid="skeleton"], .skeleton',
  LOADING_SPINNER: '[data-testid="spinner"], .spinner, .loading',
  ERROR_MESSAGE: '[role="alert"], .error, .text-red, [data-testid="error"]',
  SUCCESS_MESSAGE: '.success, .text-green, [data-testid="success"]',
  TOAST: '[data-testid="toast"], [role="status"]',
  MODAL: '[role="dialog"], .modal, [data-testid="modal"]',
  MODAL_CLOSE: '[data-testid="modal-close"], button[aria-label="Close"]',
  OVERLAY: '[data-testid="overlay"], .overlay',
  TABLE: 'table, [role="table"]',
  TABLE_ROW: 'tr, [role="row"]',
  LIST: 'ul, ol, [role="list"]',
  LIST_ITEM: 'li, [role="listitem"]',
  CARD: '[data-testid*="card"], .card',
  TAB: '[role="tab"]',
  TAB_PANEL: '[role="tabpanel"]',
  SEARCH_INPUT: 'input[type="search"], input[placeholder*="Search"]',
} as const

export const TEST_FORM_DATA = {
  DISPLAY_NAME: 'Test User Display Name',
  USERNAME: 'testuser123',
  BIO: 'Test bio for E2E testing',
  EMAIL: 'test@example.com',
  POST_CONTENT: 'Test post from E2E tests',
  COMMENT_CONTENT: 'Test comment',
  CHAT_MESSAGE: 'Test message',
  SEARCH_QUERY: 'test query',
  AMOUNT_SMALL: '0.01',
  AMOUNT_MEDIUM: '1.0',
  AMOUNT_LARGE: '100.0',
  EMPTY_STRING: '',
  LONG_STRING: 'A'.repeat(5000),
  SPECIAL_CHARS: '!@#$%^&*(){}[]<>?/\\|`~',
  UNICODE_STRING: '日本語テスト 🎉 émojis äöü',
  WHITESPACE_ONLY: '   \t\n   ',
  XSS_ATTEMPT: '<script>alert("xss")</script>',
  SQL_INJECTION: "'; DROP TABLE users; --",
  PATH_TRAVERSAL: '../../../etc/passwd',
} as const

export const TEST_NUMBERS = {
  NEGATIVE: -999999,
  ZERO: 0,
  SMALL_DECIMAL: 0.001,
  NORMAL: 100,
  LARGE: 999999999999,
  INFINITY: Infinity,
  NAN: NaN,
} as const

export const TRADING_TEST_DATA = {
  PERP_SIZES: [1, 10, 100, 0.5, 0.01] as const,
  LEVERAGE_VALUES: [1, 2, 5, 10, 20] as const,
  PREDICTION_AMOUNTS: [1, 10, 100, 0.5] as const,
  YES_NO_SIDES: ['YES', 'NO'] as const,
  INVALID_SIZE: -1,
  INVALID_LEVERAGE: 1000,
  INVALID_AMOUNT: -100,
} as const

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

export function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function generateTestEmail(prefix = 'test'): string {
  return `${generateTestId(prefix)}@test.jeju.network`
}

export function generateTestUsername(prefix = 'testuser'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))
