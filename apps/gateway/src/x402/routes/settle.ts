import { Hono, type Context } from 'hono';
import type { DecodedPayment, SettlementResult, PaymentRequirements, AuthParams } from '../lib/schemas';
import type { PublicClient, WalletClient, Hex } from 'viem';
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
import { expect } from '../../lib/validation';

const app = new Hono();

type SettleBody = { paymentHeader: string; paymentRequirements: PaymentRequirements };
type StandardSettleFn = (payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient) => Promise<SettlementResult>;
type GaslessSettleFn = (payment: DecodedPayment, network: string, publicClient: PublicClient, walletClient: WalletClient, authParams: AuthParams) => Promise<SettlementResult>;

async function processSettlement(
  c: Context,
  body: SettleBody,
  network: string,
  settlementFn: StandardSettleFn
): Promise<Response>;
async function processSettlement(
  c: Context,
  body: SettleBody,
  network: string,
  settlementFn: GaslessSettleFn,
  authParams: AuthParams
): Promise<Response>;
async function processSettlement(
  c: Context,
  body: SettleBody,
  network: string,
  settlementFn: StandardSettleFn | GaslessSettleFn,
  authParams?: AuthParams
) {
  const requirements: PaymentRequirements = {
    ...body.paymentRequirements,
    network,
  };

  const { publicClient, walletClient } = await createClients(network);
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
    ? await (settlementFn as GaslessSettleFn)(payment, network, publicClient, walletClient, authParams)
    : await (settlementFn as StandardSettleFn)(payment, network, publicClient, walletClient);

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
