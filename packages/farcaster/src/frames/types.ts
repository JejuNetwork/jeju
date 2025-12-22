import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { AddressSchema } from '../hub/schemas';

// Re-export FrameActionPayload from schemas to avoid duplication
export type { FrameActionPayload } from '../hub/schemas';

// ============ Frame Metadata ============

export interface FrameMetadata {
  version: 'vNext';
  image: string;
  imageAspectRatio?: '1.91:1' | '1:1';
  buttons?: FrameButton[];
  inputText?: string;
  postUrl?: string;
  state?: string;
}

export interface FrameButton {
  label: string;
  action?: 'post' | 'post_redirect' | 'link' | 'mint' | 'tx';
  target?: string;
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
  chainId: string;
  method: 'eth_sendTransaction';
  params: FrameTransactionParams;
}

export interface FrameTransactionParams {
  to: Address;
  value?: Hex;
  data?: Hex;
  attribution?: boolean;
}

// ============ Jeju-Specific Frame State Schemas ============

export const JejuBridgeFrameStateSchema = z.object({
  sourceChain: z.number(),
  targetChain: z.number(),
  token: AddressSchema,
  amount: z.string(),
  recipient: AddressSchema.optional(),
});

export const JejuSwapFrameStateSchema = z.object({
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  amountIn: z.string(),
  slippage: z.number(),
});

export const JejuAgentFrameStateSchema = z.object({
  agentId: AddressSchema,
  action: z.enum(['view', 'delegate', 'hire']),
});

export type JejuBridgeFrameState = z.infer<typeof JejuBridgeFrameStateSchema>;
export type JejuSwapFrameState = z.infer<typeof JejuSwapFrameStateSchema>;
export type JejuAgentFrameState = z.infer<typeof JejuAgentFrameStateSchema>;

// ============ Frame Response Types ============

export interface FrameResponse {
  html: string;
  metadata: FrameMetadata;
}

export interface FrameErrorResponse {
  error: string;
  code?: string;
}

// ============ Helper Functions ============

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

export function parseFrameState<T>(state: string | undefined, schema: z.ZodType<T>): T | null {
  if (!state) return null;
  const decoded = decodeURIComponent(state);
  const json: unknown = JSON.parse(decoded);
  const result = schema.safeParse(json);
  if (!result.success) return null;
  return result.data;
}

export function encodeFrameState<T>(state: T): string {
  return encodeURIComponent(JSON.stringify(state));
}
