/**
 * Compute Node Server
 *
 * Standard inference server with on-chain settlement
 * Supports x402 payment protocol for micropayments
 */

import {
  Contract,
  getBytes,
  JsonRpcProvider,
  keccak256,
  solidityPackedKeccak256,
  toUtf8Bytes,
  verifyMessage,
  Wallet,
} from 'ethers';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  generateAttestation,
  getAttestationHash,
} from './attestation';
import { detectHardware } from './hardware';
import { createInferenceEngine, type InferenceEngine } from './inference';
import type {
  AttestationReport,
  ChatCompletionRequest,
  ChatCompletionResponse,
  NodeMetrics,
  ProviderConfig,
} from './types';
import {
  type X402PaymentRequirement,
  type X402PaymentHeader,
  parseX402Header as parseX402,
  verifyX402Payment as verifyX402,
  createPaymentRequirement as createX402Requirement,
  getX402Config,
} from '../sdk/x402';
import {
  ContentModerator,
  createContentModerator,
  MemoryIncidentStorage,
  SeverityEnum,
  ContentCategoryEnum,
  type ModerationIncident,
} from '../sdk/content-moderation';

type ContentCategory = typeof ContentCategoryEnum[keyof typeof ContentCategoryEnum];

const parseContentCategory = (name: string): ContentCategory =>
  ContentCategoryEnum[name.toUpperCase() as keyof typeof ContentCategoryEnum] ?? ContentCategoryEnum.SAFE;

// Credit Manager ABI for balance checking
const CREDIT_MANAGER_ABI = [
  'function getBalance(address user, address token) view returns (uint256)',
  'function hasSufficientCredit(address user, address token, uint256 amount) view returns (bool sufficient, uint256 available)',
];

const LEDGER_MANAGER_ABI = [
  'function getAvailableBalance(address user) view returns (uint256)',
  'function getSubAccount(address user, address provider) view returns (tuple(uint256 balance, uint256 pendingRefund, uint256 refundUnlockTime, bool acknowledged))',
];

// Warmth thresholds (milliseconds)
const COLD_THRESHOLD = 60_000; // 60s without inference = cold
const WARM_THRESHOLD = 10_000; // 10s without inference = warm

/**
 * Compute Node Server
 */
export class ComputeNodeServer {
  private app: Hono;
  private wallet: Wallet;
  private _server: ReturnType<typeof Bun.serve> | null = null;
  public config: ProviderConfig;
  private engines: Map<string, InferenceEngine> = new Map();
  private attestation: AttestationReport | null = null;
  
  // Metrics tracking
  private startTime: number = Date.now();
  private firstInferenceTime: number | null = null;
  private lastInferenceTime: number | null = null;
  private totalInferences: number = 0;
  private totalLatency: number = 0;
  
  // x402 Payment support
  private provider: JsonRpcProvider | null = null;
  private creditManager: Contract | null = null;
  private ledgerManager: Contract | null = null;
  private x402Enabled: boolean = false;
  
  // Content moderation
  private moderator!: ContentModerator;
  private moderationStorage!: MemoryIncidentStorage;
  private moderationEnabled: boolean = false;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.wallet = new Wallet(config.privateKey);
    this.app = new Hono();

    // Initialize engines
    for (const model of config.models) {
      this.engines.set(model.name, createInferenceEngine(model));
    }

    // Initialize payment contracts if configured
    this.initializePaymentContracts();
    
    // Initialize content moderation
    this.initializeModeration();
    
    this.setupRoutes();
  }

  private initializePaymentContracts(): void {
    const rpcUrl = this.config.rpcUrl || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545';
    const creditManagerAddr = process.env.CREDIT_MANAGER_ADDRESS;
    const ledgerManagerAddr = process.env.LEDGER_MANAGER_ADDRESS;

    if (creditManagerAddr || ledgerManagerAddr) {
      this.provider = new JsonRpcProvider(rpcUrl);
      
      if (creditManagerAddr) {
        this.creditManager = new Contract(creditManagerAddr, CREDIT_MANAGER_ABI, this.provider);
      }
      if (ledgerManagerAddr) {
        this.ledgerManager = new Contract(ledgerManagerAddr, LEDGER_MANAGER_ABI, this.provider);
      }
      
      this.x402Enabled = process.env.X402_ENABLED === 'true';
    }
  }
  
  private initializeModeration(): void {
    this.moderationStorage = new MemoryIncidentStorage();
    this.moderationEnabled = process.env.MODERATION_ENABLED !== 'false'; // Enabled by default
    
    this.moderator = createContentModerator({
      enableLocalFilter: true,
      enableAIClassifier: !!process.env.AI_MODERATION_ENDPOINT,
      aiClassifierEndpoint: process.env.AI_MODERATION_ENDPOINT,
      aiClassifierModel: process.env.AI_MODERATION_MODEL || 'moderation',
      recordIncidents: true,
      minConfidenceToFlag: 70,
      minConfidenceToBlock: 85,
      onIncident: async (incident: ModerationIncident) => {
        await this.moderationStorage.save(incident);
        if (incident.highestSeverity >= SeverityEnum.HIGH) {
          console.warn(`[Moderation] High severity incident: ${incident.id} from ${incident.userAddress}`);
        }
      },
    });
  }

  private setupRoutes(): void {
    // CORS
    this.app.use('/*', cors());

    // Health check - includes TEE status prominently
    this.app.get('/health', async (c) => {
      const metrics = this.getMetrics();
      const hardware = await detectHardware();
      
      return c.json({
        status: 'ok',
        provider: this.wallet.address,
        models: this.config.models.map((m) => m.name),
        warmth: metrics.warmth,
        uptime: metrics.uptime,
        // Node classification
        nodeType: hardware.nodeType,  // 'cpu' or 'gpu'
        // TEE status - ALWAYS CHECK THIS
        tee: {
          status: hardware.teeInfo.status,
          isReal: hardware.teeInfo.isReal,
          provider: hardware.teeInfo.provider,
          warning: hardware.teeInfo.warning,
        },
      });
    });
    
    // Metrics endpoint
    this.app.get('/v1/metrics', (c) => {
      return c.json(this.getMetrics());
    });

    // List models
    this.app.get('/v1/models', (c) => {
      return c.json({
        object: 'list',
        data: this.config.models.map((m) => ({
          id: m.name,
          object: 'model',
          created: Date.now(),
          owned_by: this.wallet.address,
        })),
      });
    });

    // Attestation - shows TEE status clearly
    this.app.get('/v1/attestation/report', async (c) => {
      const nonce = c.req.query('nonce') || crypto.randomUUID();

      // Generate attestation based on actual TEE environment
      this.attestation = await generateAttestation(this.wallet, nonce);

      return c.json({
        ...this.attestation,
        attestation_hash: getAttestationHash(this.attestation),
        // Highlight TEE status at top level for clarity
        _tee_notice: this.attestation.teeIsReal 
          ? `✅ Real TEE: ${this.attestation.teeStatus}`
          : `⚠️ ${this.attestation.teeWarning}`,
      });
    });

    // Chat completions with x402 payment support and content moderation
    this.app.post('/v1/chat/completions', async (c) => {
      // Verify auth headers (optional for local testing)
      const authValid = await this.verifyAuth(c);
      if (!authValid.valid && process.env.REQUIRE_AUTH === 'true') {
        return c.json({ error: { message: authValid.reason } }, 401);
      }

      const request = await c.req.json<ChatCompletionRequest>();

      // Find engine
      const engine = this.engines.get(request.model);
      if (!engine) {
        return c.json(
          { error: { message: `Model ${request.model} not found` } },
          404
        );
      }

      const userAddress = c.req.header('x-jeju-address') as `0x${string}` | undefined;
      
      // Content moderation check (if enabled)
      if (this.moderationEnabled) {
        const content = request.messages.map(m => m.content).join('\n');
        const moderationResult = await this.moderator.moderate(content, {
          userAddress: userAddress ?? '0x0000000000000000000000000000000000000000' as `0x${string}`,
          providerAddress: this.wallet.address as `0x${string}`,
          modelId: request.model,
          requestType: 'inference',
        });
        
        if (!moderationResult.allowed) {
          const categories = moderationResult.flags.map(f => 
            ContentModerator.getCategoryName(f.category)
          ).join(', ');
          
          return c.json({
            error: {
              message: `Content blocked by moderation policy: ${categories}`,
              code: 'content_policy_violation',
              incidentId: moderationResult.incidentId,
            }
          }, 400);
        }
      }

      // x402 Payment check (if enabled)
      if (this.x402Enabled && userAddress) {
        const estimatedCost = this.estimateInferenceCost(request);
        const paymentCheck = await this.checkPayment(c, userAddress, estimatedCost);
        
        if (!paymentCheck.paid) {
          // Return 402 Payment Required
          return c.json(paymentCheck.requirement, 402);
        }
      }

      // Streaming
      if (request.stream) {
        return this.handleStreamingCompletion(c, engine, request);
      }

      // Non-streaming
      const inferenceStart = Date.now();
      const response = await engine.complete(request);
      const inferenceEnd = Date.now();
      
      // Track metrics
      this.recordInference(inferenceEnd - inferenceStart);

      // Get settlement nonce from auth headers
      const settlementNonceStr = c.req.header('x-jeju-settlement-nonce');

      // Generate request hash and settlement signature
      const requestHash = this.generateRequestHash(response);
      const inputTokens = response.usage.prompt_tokens;
      const outputTokens = response.usage.completion_tokens;

      // Only include settlement data if authenticated with settlement nonce
      if (userAddress && settlementNonceStr) {
        const settlementNonce = Number.parseInt(settlementNonceStr, 10);
        const settlementSig = await this.signSettlement(
          userAddress,
          requestHash,
          inputTokens,
          outputTokens,
          settlementNonce
        );

        return c.json({
          ...response,
          settlement: {
            provider: this.wallet.address,
            requestHash,
            inputTokens,
            outputTokens,
            nonce: settlementNonce,
            signature: settlementSig,
          },
        });
      }

      // Return without settlement data for unauthenticated requests
      return c.json(response);
    });

    // Hardware info
    this.app.get('/v1/hardware', async (c) => {
      const hardware = await detectHardware();
      return c.json(hardware);
    });
    
    // ========== Moderation Endpoints ==========
    
    // Get moderation incidents (admin)
    this.app.get('/v1/moderation/incidents', async (c) => {
      const limit = parseInt(c.req.query('limit') || '100', 10);
      const reviewed = c.req.query('reviewed');
      
      if (reviewed === 'false') {
        const incidents = await this.moderationStorage.getUnreviewed(limit);
        return c.json({ incidents, count: incidents.length });
      }
      
      // Get all incidents (limited functionality without full storage)
      const incidents = await this.moderationStorage.getUnreviewed(limit);
      return c.json({ incidents, count: incidents.length });
    });
    
    // Get training data export
    this.app.get('/v1/moderation/training', async (c) => {
      const category = c.req.query('category');
      const limit = parseInt(c.req.query('limit') || '1000', 10);
      
      // Parse category as ContentCategory if provided
      const categoryValue = category !== undefined ? parseContentCategory(category) : undefined;
      const incidents = await this.moderationStorage.getForTraining(categoryValue, limit);
      
      const trainingData = incidents.map(i => ({
        text: i.inputContent,
        label: ContentModerator.getCategoryName(i.trainingLabel ?? i.flags[0]?.category ?? ContentCategoryEnum.SAFE),
        confidence: i.flags[0]?.confidence ?? 0,
        reviewed: i.reviewed,
      }));
      
      return c.json({ data: trainingData, count: trainingData.length });
    });
    
    // Moderation stats
    this.app.get('/v1/moderation/stats', (c) => {
      return c.json({
        enabled: this.moderationEnabled,
        aiClassifierEnabled: !!process.env.AI_MODERATION_ENDPOINT,
        incidentCount: this.moderationStorage.size(),
      });
    });
  }

  private async handleStreamingCompletion(
    _c: Context,
    engine: InferenceEngine,
    request: ChatCompletionRequest
  ): Promise<Response> {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        for await (const chunk of engine.stream(request)) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  private verifyAuth(c: Context): { valid: boolean; reason?: string } {
    const address = c.req.header('x-jeju-address');
    const nonce = c.req.header('x-jeju-nonce');
    const signature = c.req.header('x-jeju-signature');
    const timestamp = c.req.header('x-jeju-timestamp');

    if (!address || !nonce || !signature || !timestamp) {
      return { valid: false, reason: 'Missing auth headers' };
    }

    // Check timestamp freshness (5 minute window)
    const ts = Number.parseInt(timestamp, 10);
    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) {
      return { valid: false, reason: 'Timestamp expired' };
    }

    // Verify signature - throws on malformed signature
    const message = `${address}:${nonce}:${timestamp}:${this.wallet.address}`;
    const recovered = verifyMessage(message, signature);

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return { valid: false, reason: 'Invalid signature' };
    }

    return { valid: true };
  }

  /**
   * Sign a response for on-chain settlement
   * The signature format must match what InferenceServing.settle() expects:
   * keccak256(user, provider, requestHash, inputTokens, outputTokens, nonce)
   */
  private async signSettlement(
    user: string,
    requestHash: string,
    inputTokens: number,
    outputTokens: number,
    nonce: number
  ): Promise<string> {
    const messageHash = solidityPackedKeccak256(
      ['address', 'address', 'bytes32', 'uint256', 'uint256', 'uint256'],
      [user, this.wallet.address, requestHash, inputTokens, outputTokens, nonce]
    );

    // Sign the hash (ethers adds the "\x19Ethereum Signed Message:\n32" prefix)
    return this.wallet.signMessage(getBytes(messageHash));
  }

  /**
   * Generate request hash from response
   */
  private generateRequestHash(response: ChatCompletionResponse): string {
    return keccak256(
      toUtf8Bytes(JSON.stringify({ id: response.id, model: response.model }))
    );
  }


  /**
   * Get the Hono app for testing
   */
  getApp(): Hono {
    return this.app;
  }

  /**
   * Get provider address
   */
  getAddress(): string {
    return this.wallet.address;
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): NodeMetrics {
    const now = Date.now();
    
    // Calculate warmth
    let warmth: 'cold' | 'warm' | 'hot' = 'cold';
    if (this.lastInferenceTime !== null) {
      const timeSinceInference = now - this.lastInferenceTime;
      if (timeSinceInference < WARM_THRESHOLD) {
        warmth = 'hot';
      } else if (timeSinceInference < COLD_THRESHOLD) {
        warmth = 'warm';
      }
    }
    
    return {
      coldStartTime: this.firstInferenceTime !== null 
        ? this.firstInferenceTime - this.startTime 
        : null,
      warmth,
      lastInferenceAt: this.lastInferenceTime,
      totalInferences: this.totalInferences,
      averageLatency: this.totalInferences > 0 
        ? this.totalLatency / this.totalInferences 
        : null,
      uptime: now - this.startTime,
    };
  }
  
  /**
   * Record an inference for metrics tracking
   */
  private recordInference(latencyMs: number): void {
    const now = Date.now();
    
    if (this.firstInferenceTime === null) {
      this.firstInferenceTime = now;
    }
    
    this.lastInferenceTime = now;
    this.totalInferences++;
    this.totalLatency += latencyMs;
  }

  // ============ x402 Payment Support ============

  /**
   * Estimate the cost of an inference request
   */
  private estimateInferenceCost(request: ChatCompletionRequest): bigint {
    // Rough estimate: 1 token per 4 characters
    const inputChars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedInputTokens = Math.ceil(inputChars / 4);
    const estimatedOutputTokens = request.max_tokens || 500;

    // Find model pricing
    const modelConfig = this.config.models.find(m => m.name === request.model);
    if (!modelConfig) {
      return BigInt(1e14); // Default: 0.0001 ETH
    }

    const inputCost = BigInt(estimatedInputTokens) * modelConfig.pricePerInputToken;
    const outputCost = BigInt(estimatedOutputTokens) * modelConfig.pricePerOutputToken;
    
    return inputCost + outputCost;
  }

  /**
   * Check if user has paid for the request via x402
   */
  private async checkPayment(
    c: Context,
    userAddress: string,
    estimatedCost: bigint
  ): Promise<{ paid: boolean; requirement?: X402PaymentRequirement }> {
    // Check x402 payment header
    const paymentHeader = c.req.header('X-Payment');
    if (paymentHeader) {
      const parsed = this.parseX402Header(paymentHeader);
      if (parsed && this.verifyX402Payment(parsed, userAddress, estimatedCost)) {
        return { paid: true };
      }
    }

    // Check credit balance (gracefully handle contract errors)
    if (this.creditManager) {
      try {
        const getBalanceFn = this.creditManager.getFunction('getBalance');
        const balance = await getBalanceFn(userAddress, '0x0000000000000000000000000000000000000000') as bigint;
        if (balance >= estimatedCost) {
          return { paid: true };
        }
      } catch {
        // CreditManager not deployed or call failed - continue to check ledger
      }
    }

    // Check ledger balance (gracefully handle contract errors)
    if (this.ledgerManager) {
      try {
        const getSubAccountFn = this.ledgerManager.getFunction('getSubAccount');
        const subAccount = await getSubAccountFn(userAddress, this.wallet.address) as { balance: bigint };
        if (subAccount.balance >= estimatedCost) {
          return { paid: true };
        }
      } catch {
        // LedgerManager not deployed or call failed - require payment
      }
    }

    // Return 402 requirement
    return {
      paid: false,
      requirement: this.createPaymentRequirement('/v1/chat/completions', estimatedCost),
    };
  }

  /**
   * Parse x402 payment header (uses shared x402 module)
   */
  private parseX402Header(header: string): X402PaymentHeader | null {
    return parseX402(header);
  }

  /**
   * Verify x402 payment (uses shared x402 module)
   */
  private verifyX402Payment(
    payment: X402PaymentHeader,
    userAddress: string,
    _estimatedCost: bigint
  ): boolean {
    return verifyX402(
      payment, 
      this.wallet.address as `0x${string}`, 
      userAddress as `0x${string}`
    );
  }

  /**
   * Create x402 payment requirement response (uses shared x402 module)
   */
  private createPaymentRequirement(resource: string, amountWei: bigint): X402PaymentRequirement {
    const x402Config = getX402Config();
    return createX402Requirement(
      resource,
      amountWei,
      this.wallet.address as `0x${string}`,
      `AI inference on ${this.config.models.map(m => m.name).join(', ')}`,
      x402Config.network
    );
  }

  /**
   * Start the server
   */
  async start(port: number): Promise<void> {
    // Detect hardware to show TEE status
    const hardware = await detectHardware();
    const teeStatus = hardware.teeInfo.status;
    const teeIsReal = hardware.teeInfo.isReal;

    console.log(`🚀 Compute Node starting...`);
    console.log(`   Provider: ${this.wallet.address}`);
    console.log(`   Port: ${port}`);
    console.log(`   Models: ${this.config.models.map((m) => m.name).join(', ')}`);
    console.log(`   Node Type: ${hardware.nodeType.toUpperCase()}`);
    
    // Show TEE status prominently
    if (teeIsReal) {
      console.log(`   ✅ TEE: ${teeStatus} (REAL - production ready)`);
    } else {
      console.log(`   ⚠️  TEE: ${teeStatus} (SIMULATED - NOT for production)`);
      if (hardware.teeInfo.warning) {
        console.log(`   ⚠️  ${hardware.teeInfo.warning}`);
      }
    }

    this._server = Bun.serve({
      port,
      fetch: this.app.fetch,
    });

    console.log(`✅ Compute Node running at http://localhost:${port}`);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this._server) {
      this._server.stop();
      this._server = null;
    }
  }
}

/**
 * Create and start a compute node from environment variables
 *
 * Default port is 4007 (COMPUTE_PORT) for Jeju integration
 */
export async function startComputeNode(): Promise<ComputeNodeServer> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error(`
╔══════════════════════════════════════════════════════════════════╗
║                 PRIVATE_KEY Required                             ║
╚══════════════════════════════════════════════════════════════════╝

To start a compute node, you need a wallet private key.

Quick start with test key:
  PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 bun run node

Or copy the example env file:
  cp env.example .env
  # Edit .env with your private key
  bun run node

Generate a new wallet:
  cast wallet new
`);
    process.exit(1);
  }

  // Use COMPUTE_PORT (Jeju standard) with fallback to PORT
  const port = Number.parseInt(
    process.env.COMPUTE_PORT || process.env.PORT || '4007',
    10
  );

  const config: ProviderConfig = {
    privateKey,
    registryAddress: process.env.REGISTRY_ADDRESS || '',
    ledgerAddress: process.env.LEDGER_ADDRESS || '',
    inferenceAddress: process.env.INFERENCE_ADDRESS || '',
    rpcUrl: process.env.RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545',
    port,
    models: [
      {
        name: process.env.MODEL_NAME || 'mock-model',
        backend: (process.env.MODEL_BACKEND as 'ollama' | 'mock') || 'mock',
        endpoint: process.env.MODEL_ENDPOINT,
        pricePerInputToken: BigInt(
          process.env.PRICE_PER_INPUT_TOKEN || '1000000000'
        ), // 1 gwei
        pricePerOutputToken: BigInt(
          process.env.PRICE_PER_OUTPUT_TOKEN || '2000000000'
        ), // 2 gwei
        maxContextLength: Number.parseInt(
          process.env.MAX_CONTEXT_LENGTH || '4096',
          10
        ),
      },
    ],
  };

  const server = new ComputeNodeServer(config);
  await server.start(port);
  return server;
}
