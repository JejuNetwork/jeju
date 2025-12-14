/**
 * In-App Purchase (IAP) Compliance Layer
 */

import { getPlatformInfo, isMobile, isIOS, isAndroid } from './detection';

export type MobileRestrictedFeature =
  | 'crypto-purchase'
  | 'nft-purchase'
  | 'subscription'
  | 'fiat-onramp'
  | 'swap-with-fee';

interface FeatureAvailability {
  available: boolean;
  requiresExternalBrowser: boolean;
  reason?: string;
}

export function checkFeatureAvailability(feature: MobileRestrictedFeature): FeatureAvailability {
  if (!isMobile()) {
    return { available: true, requiresExternalBrowser: false };
  }

  switch (feature) {
    case 'crypto-purchase':
    case 'fiat-onramp':
      return {
        available: true,
        requiresExternalBrowser: true,
        reason: 'Crypto purchases must be completed in your browser to comply with app store guidelines.',
      };

    case 'nft-purchase':
      return {
        available: true,
        requiresExternalBrowser: true,
        reason: 'NFT purchases must be completed in your browser to comply with app store guidelines.',
      };

    case 'subscription':
      return { available: true, requiresExternalBrowser: false };

    case 'swap-with-fee':
      return { available: true, requiresExternalBrowser: false };

    default:
      return { available: true, requiresExternalBrowser: false };
  }
}

export async function openInExternalBrowser(url: string): Promise<boolean> {
  const platform = getPlatformInfo();

  if (platform.category === 'mobile') {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'fullscreen' });
      return true;
    } catch {
      window.open(url, '_system');
      return true;
    }
  }

  window.open(url, '_blank');
  return true;
}

export function getPurchaseUrl(params: {
  type: 'crypto' | 'nft';
  asset?: string;
  amount?: string;
  recipient?: string;
}): string {
  const baseUrl = 'https://wallet.jeju.network/purchase';
  const searchParams = new URLSearchParams({
    type: params.type,
    ...(params.asset && { asset: params.asset }),
    ...(params.amount && { amount: params.amount }),
    ...(params.recipient && { recipient: params.recipient }),
    platform: getPlatformInfo().type,
  });

  return `${baseUrl}?${searchParams.toString()}`;
}

export async function handleCryptoPurchase(params: {
  asset: string;
  amount?: string;
  recipient?: string;
}): Promise<{ handled: boolean; external: boolean }> {
  const availability = checkFeatureAvailability('crypto-purchase');

  if (availability.requiresExternalBrowser) {
    const url = getPurchaseUrl({
      type: 'crypto',
      asset: params.asset,
      amount: params.amount,
      recipient: params.recipient,
    });
    await openInExternalBrowser(url);
    return { handled: true, external: true };
  }

  return { handled: false, external: false };
}

export async function handleNFTPurchase(params: {
  contractAddress: string;
  tokenId: string;
  marketplace?: string;
}): Promise<{ handled: boolean; external: boolean }> {
  const availability = checkFeatureAvailability('nft-purchase');

  if (availability.requiresExternalBrowser) {
    const marketplace = params.marketplace ?? 'opensea';
    const url = `https://${marketplace}.io/assets/${params.contractAddress}/${params.tokenId}`;
    await openInExternalBrowser(url);
    return { handled: true, external: true };
  }

  return { handled: false, external: false };
}

export const PREMIUM_PRODUCTS = {
  MONTHLY: 'network.jeju.wallet.premium.monthly',
  YEARLY: 'network.jeju.wallet.premium.yearly',
} as const;

export function getIAPComplianceMessage(feature: MobileRestrictedFeature): string | null {
  const availability = checkFeatureAvailability(feature);
  return availability.requiresExternalBrowser ? availability.reason ?? null : null;
}

export function requiresExternalPurchase(): boolean {
  return isMobile();
}

export function getTermsUrl(): string {
  const base = 'https://jeju.network/legal';
  
  if (isIOS()) return `${base}/terms-ios`;
  if (isAndroid()) return `${base}/terms-android`;
  return `${base}/terms`;
}

export function getPrivacyUrl(): string {
  const base = 'https://jeju.network/legal';
  
  if (isIOS()) return `${base}/privacy-ios`;
  if (isAndroid()) return `${base}/privacy-android`;
  return `${base}/privacy`;
}
