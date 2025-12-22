# Agent Task: Farcaster Frame Server Infrastructure

## Priority: P1
## Estimated Time: 2 days
## Dependencies: agent-farcaster-hub-posting

## Objective

Build a complete Farcaster Frames server infrastructure that enables interactive embedded experiences in Farcaster clients, supporting both Frames v1 (OG) and Frames v2 (Mini Apps).

## Background

Farcaster Frames are interactive apps embedded in casts:
- **Frames v1**: Static HTML with button actions, image responses
- **Frames v2**: Full mini-apps with SDK, transactions, auth

We need:
- Frame server with all action handlers
- Frame validation (verify hub signatures)
- Transaction frame support (on-chain actions)
- Frames v2 SDK integration

## Source Files to Analyze

- `packages/oauth3/src/providers/farcaster.ts` - Has frame validation
- `packages/farcaster/src/frames/` - Existing frame types
- Open Frames spec: https://github.com/open-frames/standard

## Implementation Tasks

### 1. Frame Server

File: `packages/farcaster/src/frames/server.ts`

```typescript
/**
 * Farcaster Frame Server
 * 
 * Hono-based server for handling Farcaster Frame requests.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { Address, Hex } from 'viem';

// Frame action payload schema
const FrameActionPayloadSchema = z.object({
  untrustedData: z.object({
    fid: z.number(),
    url: z.string(),
    messageHash: z.string(),
    timestamp: z.number(),
    network: z.number(),
    buttonIndex: z.number(),
    inputText: z.string().optional(),
    castId: z.object({
      fid: z.number(),
      hash: z.string(),
    }),
    state: z.string().optional(),
  }),
  trustedData: z.object({
    messageBytes: z.string(),
  }),
});

export type FrameActionPayload = z.infer<typeof FrameActionPayloadSchema>;

export interface FrameContext {
  fid: number;
  address?: Address;
  buttonIndex: number;
  inputText?: string;
  state?: Record<string, unknown>;
  castHash?: Hex;
  validated: boolean;
}

export interface FrameResponse {
  image: string;
  buttons?: FrameButton[];
  input?: { placeholder: string };
  state?: Record<string, unknown>;
  postUrl?: string;
}

export interface FrameButton {
  label: string;
  action?: 'post' | 'post_redirect' | 'link' | 'mint' | 'tx';
  target?: string;
}

export interface TransactionFrameResponse {
  chainId: string; // eip155:8453 for Base
  method: 'eth_sendTransaction';
  params: {
    abi: unknown[];
    to: Address;
    data?: Hex;
    value?: string;
  };
}

export interface FrameHandler {
  (ctx: FrameContext): Promise<FrameResponse | TransactionFrameResponse>;
}

export interface FrameServerConfig {
  baseUrl: string;
  hubUrl?: string;
  validateSignatures?: boolean;
}

export class FrameServer {
  private app: Hono;
  private handlers: Map<string, Map<number, FrameHandler>> = new Map();
  private hubUrl?: string;
  
  constructor(private config: FrameServerConfig) {
    this.hubUrl = config.hubUrl;
    this.app = new Hono();
    
    this.app.use('*', cors());
    
    // Frame action endpoint
    this.app.post('/frames/:frameId', async (c) => {
      const frameId = c.req.param('frameId');
      const body = await c.req.json();
      
      // Validate payload
      const parseResult = FrameActionPayloadSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json({ error: 'Invalid payload' }, 400);
      }
      
      const payload = parseResult.data;
      
      // Validate signature if enabled
      let validated = false;
      let address: Address | undefined;
      
      if (this.config.validateSignatures) {
        const validation = await this.validateFrameAction(payload);
        validated = validation.valid;
        address = validation.address;
        
        if (!validated) {
          return c.json({ error: 'Invalid signature' }, 401);
        }
      }
      
      // Parse state
      let state: Record<string, unknown> | undefined;
      if (payload.untrustedData.state) {
        try {
          state = JSON.parse(
            Buffer.from(payload.untrustedData.state, 'base64').toString()
          );
        } catch {}
      }
      
      // Build context
      const ctx: FrameContext = {
        fid: payload.untrustedData.fid,
        address,
        buttonIndex: payload.untrustedData.buttonIndex,
        inputText: payload.untrustedData.inputText,
        state,
        castHash: payload.untrustedData.castId.hash as Hex,
        validated,
      };
      
      // Get handler
      const frameHandlers = this.handlers.get(frameId);
      if (!frameHandlers) {
        return c.json({ error: 'Frame not found' }, 404);
      }
      
      const handler = frameHandlers.get(payload.untrustedData.buttonIndex);
      if (!handler) {
        return c.json({ error: 'Button handler not found' }, 404);
      }
      
      // Execute handler
      const response = await handler(ctx);
      
      // Return appropriate response type
      if ('method' in response) {
        // Transaction response
        return c.json(response);
      }
      
      // Standard frame response
      return c.html(this.buildFrameHtml(response, frameId));
    });
    
    // Initial frame endpoint (GET)
    this.app.get('/frames/:frameId', (c) => {
      const frameId = c.req.param('frameId');
      const initialFrame = this.initialFrames.get(frameId);
      
      if (!initialFrame) {
        return c.text('Frame not found', 404);
      }
      
      return c.html(this.buildFrameHtml(initialFrame, frameId));
    });
  }
  
  private initialFrames: Map<string, FrameResponse> = new Map();
  
  /**
   * Register a frame with handlers
   */
  registerFrame(
    frameId: string,
    initial: FrameResponse,
    buttonHandlers: Record<number, FrameHandler>,
  ): void {
    this.initialFrames.set(frameId, initial);
    this.handlers.set(frameId, new Map(Object.entries(buttonHandlers).map(
      ([k, v]) => [parseInt(k), v]
    )));
  }
  
  /**
   * Build frame HTML with meta tags
   */
  private buildFrameHtml(frame: FrameResponse, frameId: string): string {
    const postUrl = frame.postUrl ?? `${this.config.baseUrl}/frames/${frameId}`;
    
    let html = `<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${frame.image}" />
  <meta property="fc:frame:post_url" content="${postUrl}" />`;
    
    // Add buttons
    if (frame.buttons) {
      frame.buttons.forEach((btn, i) => {
        html += `
  <meta property="fc:frame:button:${i + 1}" content="${btn.label}" />`;
        if (btn.action) {
          html += `
  <meta property="fc:frame:button:${i + 1}:action" content="${btn.action}" />`;
        }
        if (btn.target) {
          html += `
  <meta property="fc:frame:button:${i + 1}:target" content="${btn.target}" />`;
        }
      });
    }
    
    // Add input
    if (frame.input) {
      html += `
  <meta property="fc:frame:input:text" content="${frame.input.placeholder}" />`;
    }
    
    // Add state
    if (frame.state) {
      const stateStr = Buffer.from(JSON.stringify(frame.state)).toString('base64');
      html += `
  <meta property="fc:frame:state" content="${stateStr}" />`;
    }
    
    html += `
</head>
<body>
  <img src="${frame.image}" />
</body>
</html>`;
    
    return html;
  }
  
  /**
   * Validate frame action via hub
   */
  private async validateFrameAction(payload: FrameActionPayload): Promise<{
    valid: boolean;
    address?: Address;
  }> {
    if (!this.hubUrl) {
      return { valid: false };
    }
    
    try {
      const response = await fetch(`${this.hubUrl}/v1/validateMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(payload.trustedData.messageBytes, 'hex'),
      });
      
      if (!response.ok) {
        return { valid: false };
      }
      
      const result = await response.json();
      
      return {
        valid: result.valid === true,
        address: result.message?.data?.frameActionBody?.address,
      };
    } catch {
      return { valid: false };
    }
  }
  
  /**
   * Get Hono app for mounting
   */
  getApp(): Hono {
    return this.app;
  }
}
```

### 2. Frame Builder

File: `packages/farcaster/src/frames/builder.ts`

```typescript
/**
 * Frame Builder
 * 
 * Fluent API for building Farcaster frames.
 */

import type { FrameResponse, FrameButton, FrameHandler, FrameContext } from './server';

export class FrameBuilder {
  private frame: FrameResponse = {
    image: '',
    buttons: [],
  };
  private buttonHandlers: Record<number, FrameHandler> = {};
  
  /**
   * Set frame image
   */
  image(url: string): this {
    this.frame.image = url;
    return this;
  }
  
  /**
   * Add a button
   */
  button(
    label: string,
    handler: FrameHandler,
    options?: {
      action?: FrameButton['action'];
      target?: string;
    },
  ): this {
    const buttonIndex = (this.frame.buttons?.length ?? 0) + 1;
    
    this.frame.buttons = [
      ...(this.frame.buttons ?? []),
      {
        label,
        action: options?.action ?? 'post',
        target: options?.target,
      },
    ];
    
    this.buttonHandlers[buttonIndex] = handler;
    
    return this;
  }
  
  /**
   * Add text input
   */
  input(placeholder: string): this {
    this.frame.input = { placeholder };
    return this;
  }
  
  /**
   * Set frame state
   */
  state(data: Record<string, unknown>): this {
    this.frame.state = data;
    return this;
  }
  
  /**
   * Build the frame
   */
  build(): {
    initial: FrameResponse;
    handlers: Record<number, FrameHandler>;
  } {
    return {
      initial: this.frame,
      handlers: this.buttonHandlers,
    };
  }
}

/**
 * Create a new frame builder
 */
export function frame(): FrameBuilder {
  return new FrameBuilder();
}

// ============ Helper functions for common patterns ============

/**
 * Create a simple navigation frame
 */
export function navigationFrame(params: {
  image: string;
  nextHandler: FrameHandler;
  prevHandler?: FrameHandler;
}): ReturnType<FrameBuilder['build']> {
  const builder = frame().image(params.image);
  
  if (params.prevHandler) {
    builder.button('← Back', params.prevHandler);
  }
  
  builder.button('Next →', params.nextHandler);
  
  return builder.build();
}

/**
 * Create a transaction frame
 */
export function txFrame(params: {
  image: string;
  buttonLabel: string;
  chainId: number;
  to: Address;
  data?: Hex;
  value?: bigint;
}): ReturnType<FrameBuilder['build']> {
  return frame()
    .image(params.image)
    .button(params.buttonLabel, async () => ({
      chainId: `eip155:${params.chainId}`,
      method: 'eth_sendTransaction',
      params: {
        abi: [],
        to: params.to,
        data: params.data,
        value: params.value?.toString(),
      },
    }), { action: 'tx' })
    .build();
}
```

### 3. Frame Image Generator

File: `packages/farcaster/src/frames/image.ts`

```typescript
/**
 * Frame Image Generator
 * 
 * Generates dynamic images for frames using canvas.
 */

// Note: This requires @napi-rs/canvas or similar for server-side rendering

export interface ImageGeneratorConfig {
  width?: number;
  height?: number;
  backgroundColor?: string;
  fontFamily?: string;
}

export interface TextOptions {
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;
}

export class FrameImageGenerator {
  private width: number;
  private height: number;
  private backgroundColor: string;
  private fontFamily: string;
  
  constructor(config?: ImageGeneratorConfig) {
    // Frame recommended size: 1.91:1 aspect ratio
    this.width = config?.width ?? 1200;
    this.height = config?.height ?? 628;
    this.backgroundColor = config?.backgroundColor ?? '#1a1a2e';
    this.fontFamily = config?.fontFamily ?? 'Inter, sans-serif';
  }
  
  /**
   * Generate image as data URL
   */
  async generate(draw: (ctx: CanvasContext) => void): Promise<string> {
    // In production, use @napi-rs/canvas
    // For now, return placeholder
    return 'data:image/png;base64,...';
  }
  
  /**
   * Generate and upload to IPFS
   */
  async generateAndUpload(
    draw: (ctx: CanvasContext) => void,
    ipfsClient: IPFSClient,
  ): Promise<string> {
    const dataUrl = await this.generate(draw);
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const cid = await ipfsClient.add(buffer);
    return `ipfs://${cid}`;
  }
}

// Simplified canvas context interface
export interface CanvasContext {
  fillStyle: string;
  font: string;
  textAlign: CanvasTextAlign;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  drawImage(img: unknown, x: number, y: number, w?: number, h?: number): void;
}
```

### 4. Frames v2 (Mini Apps) Support

File: `packages/farcaster/src/frames/v2.ts`

```typescript
/**
 * Frames v2 (Mini Apps) Support
 * 
 * Implements Farcaster Frames v2 specification for full mini-apps.
 */

import { Hono } from 'hono';
import type { Address, Hex } from 'viem';

export interface FrameV2Config {
  appUrl: string;
  splashImageUrl: string;
  splashBackgroundColor: string;
  webhookUrl?: string;
}

export interface FrameV2Context {
  fid: number;
  address?: Address;
  location?: {
    type: 'cast' | 'channel' | 'direct_cast';
    castHash?: Hex;
    channelId?: string;
  };
}

export interface FrameV2NotificationPayload {
  notificationId: string;
  title: string;
  body: string;
  targetUrl: string;
  tokens: string[];
}

export class FrameV2Server {
  private app: Hono;
  
  constructor(private config: FrameV2Config) {
    this.app = new Hono();
    
    // Manifest endpoint
    this.app.get('/.well-known/farcaster.json', (c) => {
      return c.json({
        accountAssociation: {
          header: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFZDI1NTE5In0',
          payload: 'eyJkb21haW4iOiJleGFtcGxlLmNvbSJ9',
          signature: 'signature-here',
        },
        frame: {
          version: '1',
          name: 'My Frame App',
          iconUrl: `${config.appUrl}/icon.png`,
          homeUrl: config.appUrl,
          splashImageUrl: config.splashImageUrl,
          splashBackgroundColor: config.splashBackgroundColor,
          webhookUrl: config.webhookUrl,
        },
      });
    });
    
    // Webhook endpoint for notifications
    if (config.webhookUrl) {
      this.app.post('/webhook', async (c) => {
        const event = await c.req.json();
        await this.handleWebhookEvent(event);
        return c.json({ success: true });
      });
    }
  }
  
  /**
   * Send notification to user
   */
  async sendNotification(payload: FrameV2NotificationPayload): Promise<void> {
    // Send via Farcaster notification API
    await fetch('https://api.warpcast.com/v2/ext-send-frame-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  
  /**
   * Handle webhook events
   */
  private async handleWebhookEvent(event: unknown): Promise<void> {
    // Handle frame_added, frame_removed, notifications_disabled, etc.
  }
  
  getApp(): Hono {
    return this.app;
  }
}
```

### 5. Export and Integration

File: `packages/farcaster/src/frames/index.ts`

```typescript
export * from './server';
export * from './builder';
export * from './image';
export * from './v2';
export * from './types';
```

## Example Usage

```typescript
import { FrameServer, frame, txFrame } from '@jejunetwork/farcaster/frames';

const frameServer = new FrameServer({
  baseUrl: 'https://frames.jeju.network',
  hubUrl: 'https://hub.jeju.network',
  validateSignatures: true,
});

// Register a simple poll frame
const pollFrame = frame()
  .image('https://example.com/poll.png')
  .button('Option A', async (ctx) => ({
    image: 'https://example.com/voted-a.png',
    buttons: [{ label: 'Share', action: 'link', target: 'https://...' }],
  }))
  .button('Option B', async (ctx) => ({
    image: 'https://example.com/voted-b.png',
    buttons: [{ label: 'Share', action: 'link', target: 'https://...' }],
  }))
  .build();

frameServer.registerFrame('poll-1', pollFrame.initial, pollFrame.handlers);

// Register a transaction frame
const mintFrame = txFrame({
  image: 'https://example.com/mint.png',
  buttonLabel: 'Mint NFT',
  chainId: 8453, // Base
  to: '0x...',
  value: 0n,
});

frameServer.registerFrame('mint-nft', mintFrame.initial, mintFrame.handlers);

// Mount to main app
app.route('/api', frameServer.getApp());
```

## Acceptance Criteria

- [ ] Frame server handles POST/GET requests
- [ ] Signature validation via hub works
- [ ] Transaction frames work
- [ ] Frame builder API is ergonomic
- [ ] Frames v2 manifest works
- [ ] Image generation works
- [ ] State management works

## Output Files

1. `packages/farcaster/src/frames/server.ts`
2. `packages/farcaster/src/frames/builder.ts`
3. `packages/farcaster/src/frames/image.ts`
4. `packages/farcaster/src/frames/v2.ts`
5. `packages/farcaster/src/frames/index.ts`

## Testing

```typescript
describe('FrameServer', () => {
  test('handles frame action');
  test('validates hub signature');
  test('returns correct HTML meta tags');
  test('handles transaction frames');
  test('manages state');
});
```

## Commands

```bash
cd packages/farcaster

# Run frame tests
bun test src/frames/*.test.ts

# Start development frame server
bun run dev:frames
```

