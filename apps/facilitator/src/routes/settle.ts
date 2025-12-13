import { Hono } from 'hono';
import type { Hex } from 'viem';
import type { DecodedPayment, SettlementResult, PaymentRequirements } from '../lib/types';
import type { PublicClient, WalletClient } from 'viem';
import { config } from '../config';
import {
  createClients,
  settlePayment,
  settleGaslessPayment,
  formatAmount,
  getFacilitatorStats,
} from '../services/settler';
import { verifyPayment } from '../services/verifier';
import { parseJsonBody, handleSettleRequest } from '../lib/route-helpers';
import { buildSettleErrorResponse, buildSettleSuccessResponse } from '../lib/response-builders';

const app = new Hono();

async function processSettlement(
  c: any,
  body: { paymentHeader: string; paymentRequirements: PaymentRequirements },
  network: string,
  settlementFn: (payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient) => Promise<SettlementResult>
): Promise<Response>;
async function processSettlement(
  c: any,
  body: { paymentHeader: string; paymentRequirements: PaymentRequirements },
  network: string,
  settlementFn: (payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient, authParams: { validAfter: number; validBefore: number; authNonce: Hex; authSignature: Hex }) => Promise<SettlementResult>,
  authParams: { validAfter: number; validBefore: number; authNonce: Hex; authSignature: Hex }
): Promise<Response>;
async function processSettlement(
  c: any,
  body: { paymentHeader: string; paymentRequirements: PaymentRequirements },
  network: string,
  settlementFn: ((payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient) => Promise<SettlementResult>) | ((payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient, authParams: { validAfter: number; validBefore: number; authNonce: Hex; authSignature: Hex }) => Promise<SettlementResult>),
  authParams?: { validAfter: number; validBefore: number; authNonce: Hex; authSignature: Hex }
) {
  const requirements: PaymentRequirements = {
    ...body.paymentRequirements,
    network,
  };

  const { publicClient, walletClient } = createClients(network);
  const verifyResult = await verifyPayment(body.paymentHeader, requirements, publicClient);

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
  const settlementResult = authParams
    ? await (settlementFn as (payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient, authParams: { validAfter: number; validBefore: number; authNonce: Hex; authSignature: Hex }) => Promise<SettlementResult>)(payment, network, publicClient, walletClient, authParams)
    : await (settlementFn as (payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient) => Promise<SettlementResult>)(payment, network, publicClient, walletClient);

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

  const bodyWithNetwork: { paymentHeader: string; paymentRequirements: PaymentRequirements } = {
    paymentHeader: handleResult.body.paymentHeader,
    paymentRequirements: {
      ...handleResult.body.paymentRequirements,
      network: handleResult.network,
    } as PaymentRequirements,
  };

  return processSettlement(c, bodyWithNetwork, handleResult.network, settlePayment);
});

app.post('/gasless', async (c) => {
  const cfg = config();
  const parseResult = await parseJsonBody(c);
  if (parseResult.error) {
    return c.json(buildSettleErrorResponse(cfg.network, 'Invalid JSON request body'), 400);
  }

  const handleResult = handleSettleRequest(c, parseResult.body, cfg.network, true);
  if (!handleResult.valid) {
    return handleResult.response;
  }

  const authParams = handleResult.body.authParams;
  if (!authParams || typeof authParams !== 'object') {
    return c.json(buildSettleErrorResponse(cfg.network, 'Missing authParams for EIP-3009'), 400);
  }

  const auth: { validAfter: number; validBefore: number; authNonce: Hex; authSignature: Hex } = {
    validAfter: authParams.validAfter as number,
    validBefore: authParams.validBefore as number,
    authNonce: authParams.authNonce as Hex,
    authSignature: authParams.authSignature as Hex,
  };

  const bodyWithNetwork: { paymentHeader: string; paymentRequirements: PaymentRequirements } = {
    paymentHeader: handleResult.body.paymentHeader,
    paymentRequirements: {
      ...handleResult.body.paymentRequirements,
      network: handleResult.network,
    } as PaymentRequirements,
  };

  return processSettlement(c, bodyWithNetwork, handleResult.network, settleGaslessPayment, auth);
});

export default app;
