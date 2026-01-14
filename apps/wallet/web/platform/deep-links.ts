/**
 * Deep Links - URL scheme and universal link handling for Jeju Wallet
 */

// Deep link action constants
export const DeepLinkActions = {
  SEND: 'send',
  RECEIVE: 'receive',
  SWAP: 'swap',
  CONNECT: 'connect',
  SIGN: 'sign',
  IMPORT: 'import',
} as const

export type DeepLinkAction =
  (typeof DeepLinkActions)[keyof typeof DeepLinkActions]

// URL schemes
const JEJU_SCHEME = 'jeju://'
const WALLET_PATH = 'wallet/'
const UNIVERSAL_DOMAIN = 'https://wallet.jejunetwork.org'

export interface DeepLinkParams {
  [key: string]: string | undefined
}

export interface ParsedDeepLink {
  action: string
  params: DeepLinkParams
}

/**
 * Parse a deep link or universal link URL
 * @param url - The URL to parse (jeju:// or https://wallet.jejunetwork.org)
 * @returns Parsed deep link info or null if invalid
 */
export function parseDeepLink(url: string): ParsedDeepLink | null {
  if (!url) return null

  let pathname: string
  let searchParams: URLSearchParams

  // Handle jeju:// scheme
  if (url.startsWith(JEJU_SCHEME)) {
    const withoutScheme = url.slice(JEJU_SCHEME.length)
    // Remove wallet/ prefix if present
    const path = withoutScheme.startsWith(WALLET_PATH)
      ? withoutScheme.slice(WALLET_PATH.length)
      : withoutScheme

    const queryIndex = path.indexOf('?')
    if (queryIndex >= 0) {
      pathname = path.slice(0, queryIndex)
      searchParams = new URLSearchParams(path.slice(queryIndex + 1))
    } else {
      pathname = path
      searchParams = new URLSearchParams()
    }
  }
  // Handle universal links
  else if (url.startsWith(UNIVERSAL_DOMAIN)) {
    try {
      const parsedUrl = new URL(url)
      pathname = parsedUrl.pathname.slice(1) // Remove leading /
      searchParams = parsedUrl.searchParams
    } catch {
      return null
    }
  }
  // Invalid URL
  else {
    return null
  }

  // Extract action from pathname
  const action = pathname.trim() || 'open'

  // Convert URLSearchParams to plain object
  const params: DeepLinkParams = {}
  searchParams.forEach((value, key) => {
    params[key] = value
  })

  return { action, params }
}

/**
 * Build a jeju:// scheme deep link
 * @param action - The action to perform
 * @param params - Optional query parameters
 * @returns The deep link URL
 */
export function buildDeepLink(action: string, params?: DeepLinkParams): string {
  let url = `${JEJU_SCHEME}${WALLET_PATH}${action}`

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, value)
      }
    }
    url += `?${searchParams.toString()}`
  }

  return url
}

/**
 * Build a universal link (https://wallet.jejunetwork.org)
 * @param action - The action to perform
 * @param params - Optional query parameters
 * @returns The universal link URL
 */
export function buildUniversalLink(
  action: string,
  params?: DeepLinkParams,
): string {
  let url = `${UNIVERSAL_DOMAIN}/${action}`

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, value)
      }
    }
    url += `?${searchParams.toString()}`
  }

  return url
}

export interface PaymentRequestParams {
  recipient: string
  amount?: string
  token?: string
  chainId?: number
  memo?: string
}

/**
 * Create a payment request link for receiving funds
 * @param params - Payment request parameters
 * @returns Universal link for the payment request
 */
export function createPaymentRequestLink(params: PaymentRequestParams): string {
  const linkParams: DeepLinkParams = {
    to: params.recipient,
  }

  if (params.amount) linkParams.amount = params.amount
  if (params.token) linkParams.token = params.token
  if (params.chainId) linkParams.chainId = params.chainId.toString()
  if (params.memo) linkParams.memo = params.memo

  return buildUniversalLink('send', linkParams)
}




