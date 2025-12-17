/**
 * @fileoverview Farcaster Frames Types
 * 
 * Types for building Farcaster Frames (interactive mini-apps).
 * @see https://docs.farcaster.xyz/reference/frames/spec
 */

import type { Address, Hex } from 'viem';

// ============ Frame Metadata ============

export interface FrameMetadata {
  /** Frame specification version */
  version: 'vNext';
  /** Frame image URL */
  image: string;
  /** Image aspect ratio */
  imageAspectRatio?: '1.91:1' | '1:1';
  /** Buttons (max 4) */
  buttons?: FrameButton[];
  /** Input text field */
  inputText?: string;
  /** Post URL for button actions */
  postUrl?: string;
  /** State data (max 4096 bytes) */
  state?: string;
}

export interface FrameButton {
  /** Button label (max 256 bytes) */
  label: string;
  /** Button action type */
  action?: 'post' | 'post_redirect' | 'link' | 'mint' | 'tx';
  /** Target URL for link/tx actions */
  target?: string;
}

// ============ Frame Actions ============

export interface FrameActionPayload {
  /** Untrusted data from frame action */
  untrustedData: {
    fid: number;
    url: string;
    messageHash: Hex;
    timestamp: number;
    network: number;
    buttonIndex: number;
    inputText?: string;
    state?: string;
    transactionId?: Hex;
    address?: Address;
    castId: {
      fid: number;
      hash: Hex;
    };
  };
  /** Trusted data (signature verified by hub) */
  trustedData: {
    messageBytes: Hex;
  };
}

export interface FrameValidationResult {
  isValid: boolean;
  message?: FrameMessage;
  error?: string;
}

export interface FrameMessage {
  fid: number;
  url: string;
  messageHash: Hex;
  timestamp: number;
  network: number;
  buttonIndex: number;
  inputText?: string;
  state?: string;
  transactionId?: Hex;
  address?: Address;
  castId?: {
    fid: number;
    hash: Hex;
  };
}

// ============ Transaction Frames ============

export interface FrameTransactionTarget {
  /** Chain ID in CAIP-2 format (e.g., 'eip155:8453' for Base) */
  chainId: string;
  /** Transaction method */
  method: 'eth_sendTransaction';
  /** Transaction parameters */
  params: FrameTransactionParams;
}

export interface FrameTransactionParams {
  /** Recipient address */
  to: Address;
  /** ETH value in wei (hex) */
  value?: Hex;
  /** Transaction data */
  data?: Hex;
  /** Attribution (optional, for tracking) */
  attribution?: boolean;
}

// ============ Jeju-Specific Frame Types ============

export interface JejuBridgeFrameState {
  sourceChain: number;
  targetChain: number;
  token: Address;
  amount: string;
  recipient?: Address;
}

export interface JejuSwapFrameState {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  slippage: number;
}

export interface JejuAgentFrameState {
  agentId: Address;
  action: 'view' | 'delegate' | 'hire';
}

// ============ Frame Response Types ============

export interface FrameResponse {
  /** Frame HTML with meta tags */
  html: string;
  /** Frame metadata for programmatic use */
  metadata: FrameMetadata;
}

export interface FrameErrorResponse {
  error: string;
  code?: string;
}

// ============ Helper Functions ============

/**
 * Generate frame meta tags HTML
 */
export function generateFrameMetaTags(metadata: FrameMetadata): string {
  const tags: string[] = [
    `<meta property="fc:frame" content="${metadata.version}" />`,
    `<meta property="fc:frame:image" content="${metadata.image}" />`,
  ];

  if (metadata.imageAspectRatio) {
    tags.push(`<meta property="fc:frame:image:aspect_ratio" content="${metadata.imageAspectRatio}" />`);
  }

  if (metadata.postUrl) {
    tags.push(`<meta property="fc:frame:post_url" content="${metadata.postUrl}" />`);
  }

  if (metadata.inputText) {
    tags.push(`<meta property="fc:frame:input:text" content="${metadata.inputText}" />`);
  }

  if (metadata.state) {
    tags.push(`<meta property="fc:frame:state" content="${encodeURIComponent(metadata.state)}" />`);
  }

  if (metadata.buttons) {
    metadata.buttons.forEach((button, index) => {
      const i = index + 1;
      tags.push(`<meta property="fc:frame:button:${i}" content="${button.label}" />`);
      if (button.action) {
        tags.push(`<meta property="fc:frame:button:${i}:action" content="${button.action}" />`);
      }
      if (button.target) {
        tags.push(`<meta property="fc:frame:button:${i}:target" content="${button.target}" />`);
      }
    });
  }

  return tags.join('\n');
}

/**
 * Create a frame HTML response
 */
export function createFrameResponse(metadata: FrameMetadata, title = 'Jeju Frame'): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:image" content="${metadata.image}" />
  ${generateFrameMetaTags(metadata)}
</head>
<body>
  <h1>${title}</h1>
</body>
</html>`;
}

/**
 * Parse frame state from URL-encoded string
 */
export function parseFrameState<T>(state: string | undefined): T | null {
  if (!state) return null;
  try {
    return JSON.parse(decodeURIComponent(state)) as T;
  } catch {
    return null;
  }
}

/**
 * Encode frame state for URL
 */
export function encodeFrameState<T>(state: T): string {
  return encodeURIComponent(JSON.stringify(state));
}

