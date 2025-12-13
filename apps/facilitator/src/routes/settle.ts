import { Hono } from 'hono';
import type { Hex } from 'viem';
import { config } from '../config';
import {
  createClients,
  settlePayment,
  settleGaslessPayment,
  formatAmount,
  getFacilitatorStats,
} from '../services/settler';
import { verifyPayment } from '../services/verifier';
import { parseJsonBody, handleSettleRequest, handleRouteError } from '../lib/route-helpers';
import { buildSettleErrorResponse, buildSettleSuccessResponse, getNetworkFromRequest } from '../lib/response-builders';

const app = new Hono();

async function processSettlement(
  c: any,
  body: { paymentHeader: string; paymentRequirements: { network?: string } },
  network: string,
  settlementFn: (payment: any, network: string, publicClient: any, walletClient: any, ...args: any[]) => Promise<any>,
  ...settlementArgs: any[]
) {
  const { publicClient, walletClient } = createClients(network);
  const verifyResult = await verifyPayment(body.paymentHeader, body.paymentRequirements, publicClient);

  if (!verifyResult.valid) {
    return c.json(buildSettleErrorResponse(network, verifyResult.error ?? 'Payment verification failed'), 200);
  }

  if (!verifyResult.decodedPayment) {
    return c.json(buildSettleErrorResponse(network, 'Verification succeeded but payment data missing'), 500);
  }

  const payment = verifyResult.decodedPayment;
  const amountInfo = formatAmount(payment.amount, network, payment.token);

  if (!walletClient) {
    return c.json(buildSettleErrorResponse(network, 'Settlement wallet not configured', payment.payer, payment.recipient, amountInfo), 503);
  }

  const stats = await getFacilitatorStats(publicClient);
  const feeBps = Number(stats.protocolFeeBps);
  const settlementResult = await settlementFn(payment, network, publicClient, walletClient, ...settlementArgs);

  if (!settlementResult.success) {
    return c.json(buildSettleErrorResponse(network, settlementResult.error ?? 'Settlement failed', payment.payer, payment.recipient, amountInfo, settlementResult.txHash ?? null), 200);
  }

  return c.json(buildSettleSuccessResponse(network, payment, settlementResult, feeBps), 200);
}

app.post('/', async (c) => {
  const cfg = config();
  const parseResult = await parseJsonBody(c);
  if (parseResult.error) {
    return c.json(buildSettleErrorResponse(cfg.network, 'Invalid JSON request body'), 400);
  }

  const handleResult = handleSettleRequest(c, parseResult.body, cfg.network);
  if (!handleResult.valid) {
    return handleResult.response;
  }

  return processSettlement(c, handleResult.body, handleResult.network, settlePayment);
});

app.post('/gasless', async (c) => {
  const cfg = config();

  let body: SettleRequest & {
    authParams: {
      validAfter: number;
      validBefore: number;
      authNonce: string;
      authSignature: string;
    };
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({
      success: false,
      txHash: null,
      networkId: cfg.network,
      settlementId: null,
      payer: null,
      recipient: null,
      amount: null,
      fee: null,
      net: null,
      error: 'Invalid JSON request body',
      timestamp: Date.now(),
    }, 400);
  }

  const validation = validateSettleRequest(body, true);
  if (!validation.valid) {
    const isClientError = validation.error && (validation.error.includes('Missing') || validation.error.includes('Invalid JSON') || validation.error.includes('Unsupported x402Version'));
    const status = isClientError ? 400 : 200;
    return c.json({
      success: false,
      txHash: null,
      networkId: cfg.network,
      settlementId: null,
      payer: null,
      recipient: null,
      amount: null,
      fee: null,
      net: null,
      error: validation.error || 'Validation failed',
      timestamp: Date.now(),
    }, status);
  }
  body = validation.body as typeof body;

  const network = body.paymentRequirements.network || cfg.network;

  try {
    const { publicClient, walletClient } = createClients(network);
    const verifyResult = await verifyPayment(body.paymentHeader, body.paymentRequirements, publicClient);

    if (!verifyResult.valid) {
      return c.json({
        success: false,
        txHash: null,
        networkId: network,
        settlementId: null,
        payer: null,
        recipient: null,
        amount: null,
        fee: null,
        net: null,
        error: verifyResult.error || 'Payment verification failed',
        timestamp: Date.now(),
      }, 200);
    }

    const payment = verifyResult.decodedPayment!;
    const amountInfo = formatAmount(payment.amount, network, payment.token);

    if (!walletClient) {
      return c.json({
        success: false,
        txHash: null,
        networkId: network,
        settlementId: null,
        payer: payment.payer,
        recipient: payment.recipient,
        amount: amountInfo,
        fee: null,
        net: null,
        error: 'Settlement wallet not configured',
        timestamp: Date.now(),
      }, 503);
    }

    const stats = await getFacilitatorStats(publicClient);
    const feeBps = Number(stats.protocolFeeBps);
    const settlementResult = await settleGaslessPayment(
      payment,
      network,
      publicClient,
      walletClient,
      {
        validAfter: body.authParams.validAfter,
        validBefore: body.authParams.validBefore,
        authNonce: body.authParams.authNonce as Hex,
        authSignature: body.authParams.authSignature as Hex,
      }
    );

    if (!settlementResult.success) {
      return c.json({
        success: false,
        txHash: settlementResult.txHash || null,
        networkId: network,
        settlementId: null,
        payer: payment.payer,
        recipient: payment.recipient,
        amount: amountInfo,
        fee: null,
        net: null,
        error: settlementResult.error || 'Gasless settlement failed',
        timestamp: Date.now(),
      }, 200);
    }

    return c.json(buildSettlementResponse(network, payment, settlementResult, feeBps), 200);
  } catch (e) {
    return c.json({
      success: false,
      txHash: null,
      networkId: network,
      settlementId: null,
      payer: null,
      recipient: null,
      amount: null,
      fee: null,
      net: null,
      error: `Gasless settlement error: ${e instanceof Error ? e.message : String(e)}`,
      timestamp: Date.now(),
    }, 500);
  }
});

export default app;
