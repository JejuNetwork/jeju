import { Hono } from 'hono';
import { config } from '../config';
import { createClients } from '../services/settler';
import { verifyPayment, decodePaymentHeader } from '../services/verifier';
import { parseJsonBody, handleVerifyRequest } from '../lib/route-helpers';
import { buildVerifyErrorResponse, buildVerifySuccessResponse, getNetworkFromRequest } from '../lib/response-builders';

const app = new Hono();

app.post('/', async (c) => {
  const cfg = config();
  const parseResult = await parseJsonBody(c);
  if (parseResult.error) {
    return c.json(buildVerifyErrorResponse('Invalid JSON request body'), 400);
  }

  const handleResult = handleVerifyRequest(c, parseResult.body, cfg.network);
  if (!handleResult.valid) {
    return handleResult.response;
  }

  const { publicClient } = createClients(handleResult.network);
  const result = await verifyPayment(handleResult.body.paymentHeader, handleResult.body.paymentRequirements, publicClient);

  if (!result.valid) {
    return c.json(buildVerifyErrorResponse(result.error ?? 'Verification failed'), 200);
  }

  if (!result.signer || !result.decodedPayment) {
    return c.json(buildVerifyErrorResponse('Verification succeeded but missing signer or payment data'), 500);
  }

  return c.json(buildVerifySuccessResponse(result.signer, result.decodedPayment.amount.toString()), 200);
});

app.post('/signature', async (c) => {
  let body: { paymentHeader: string; network?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ valid: false, error: 'Invalid JSON request body' }, 400);
  }

  if (!body.paymentHeader) {
    return c.json({ valid: false, error: 'Missing paymentHeader' }, 400);
  }

  const cfg = config();
  const network = body.network || cfg.network;
  const payload = decodePaymentHeader(body.paymentHeader);
  
  if (!payload) {
    return c.json({ valid: false, error: 'Invalid payment header encoding' }, 400);
  }

  const { verifySignatureOnly } = await import('../services/verifier');
  const result = await verifySignatureOnly(body.paymentHeader, network);

  if (!result.valid) {
    return c.json({ valid: false, error: result.error }, 200);
  }

  return c.json({
    valid: true,
    signer: result.signer,
    payment: {
      amount: payload.amount,
      recipient: payload.payTo,
      token: payload.asset,
      resource: payload.resource,
      network: payload.network,
    },
  });
});

export default app;
