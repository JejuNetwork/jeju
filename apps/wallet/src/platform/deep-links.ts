/**
 * Deep Links Handler
 */

import { getPlatformInfo } from './detection';

export interface DeepLinkParams {
  action: string;
  params: Record<string, string>;
}

type DeepLinkCallback = (params: DeepLinkParams) => void;

const SCHEME = 'jeju';
const HOST = 'wallet';

export function parseDeepLink(url: string): DeepLinkParams | null {
  try {
    const parsed = new URL(url);
    
    if (parsed.protocol === `${SCHEME}:`) {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const action = pathParts[0] ?? 'open';
      const params: Record<string, string> = {};
      
      parsed.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      return { action, params };
    }

    if (parsed.hostname === 'wallet.jeju.network') {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const action = pathParts[0] ?? 'open';
      const params: Record<string, string> = {};
      
      parsed.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      return { action, params };
    }

    return null;
  } catch {
    return null;
  }
}

export function buildDeepLink(action: string, params: Record<string, string> = {}): string {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  
  return `${SCHEME}://${HOST}/${action}${queryString ? `?${queryString}` : ''}`;
}

export function buildUniversalLink(action: string, params: Record<string, string> = {}): string {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  
  return `https://wallet.jeju.network/${action}${queryString ? `?${queryString}` : ''}`;
}

const callbacks: Map<string, DeepLinkCallback[]> = new Map();

export function onDeepLink(action: string, callback: DeepLinkCallback): () => void {
  const existing = callbacks.get(action) ?? [];
  existing.push(callback);
  callbacks.set(action, existing);

  return () => {
    const updated = callbacks.get(action)?.filter(cb => cb !== callback) ?? [];
    callbacks.set(action, updated);
  };
}

function dispatchDeepLink(params: DeepLinkParams): void {
  const actionCallbacks = callbacks.get(params.action) ?? [];
  const wildcardCallbacks = callbacks.get('*') ?? [];

  for (const callback of [...actionCallbacks, ...wildcardCallbacks]) {
    callback(params);
  }
}

export async function initDeepLinks(): Promise<void> {
  const platform = getPlatformInfo();

  switch (platform.category) {
    case 'mobile':
      await initCapacitorDeepLinks();
      break;
    case 'desktop':
      await initTauriDeepLinks();
      break;
    case 'extension':
      initExtensionDeepLinks();
      break;
    default:
      initWebDeepLinks();
  }
}

async function initCapacitorDeepLinks(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    
    App.addListener('appUrlOpen', ({ url }) => {
      const params = parseDeepLink(url);
      if (params) dispatchDeepLink(params);
    });

    const launchUrl = await App.getLaunchUrl();
    if (launchUrl?.url) {
      const params = parseDeepLink(launchUrl.url);
      if (params) dispatchDeepLink(params);
    }
  } catch (err) {
    console.error('Failed to init Capacitor deep links:', err);
  }
}

async function initTauriDeepLinks(): Promise<void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    
    await listen<string>('deep-link', (event) => {
      const params = parseDeepLink(event.payload);
      if (params) dispatchDeepLink(params);
    });
  } catch (err) {
    console.error('Failed to init Tauri deep links:', err);
  }
}

function initExtensionDeepLinks(): void {
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: { type?: string; url?: string }) => {
      if (message.type === 'deep-link' && message.url) {
        const params = parseDeepLink(message.url);
        if (params) dispatchDeepLink(params);
      }
    });
  }
}

function initWebDeepLinks(): void {
  const params = parseDeepLink(window.location.href);
  if (params) dispatchDeepLink(params);

  window.addEventListener('hashchange', () => {
    const hashParams = parseDeepLink(window.location.href);
    if (hashParams) dispatchDeepLink(hashParams);
  });
}

export const DeepLinkActions = {
  SEND: 'send',
  RECEIVE: 'receive',
  SWAP: 'swap',
  CONNECT: 'connect',
  SIGN: 'sign',
  IMPORT: 'import',
} as const;

export function createPaymentRequestLink(params: {
  recipient: string;
  amount?: string;
  token?: string;
  chainId?: number;
  memo?: string;
}): string {
  const linkParams: Record<string, string> = {
    to: params.recipient,
  };

  if (params.amount) linkParams['amount'] = params.amount;
  if (params.token) linkParams['token'] = params.token;
  if (params.chainId) linkParams['chainId'] = params.chainId.toString();
  if (params.memo) linkParams['memo'] = params.memo;

  return buildUniversalLink(DeepLinkActions.SEND, linkParams);
}

export function createWalletConnectLink(uri: string): string {
  return buildDeepLink(DeepLinkActions.CONNECT, { uri: encodeURIComponent(uri) });
}
