import { Hono } from 'hono';
import type { PaymentRequirements } from '../lib/types';
import { config } from '../config';
import { createClients } from '../services/settler';
import { verifyPayment, decodePaymentHeader } from '../services/verifier';
import { parseJsonBody, handleVerifyRequest } from '../lib/route-helpers';
import { buildVerifyErrorResponse, buildVerifySuccessResponse } from '../lib/response-builders';

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
  const requirements = {
    ...handleResult.body.paymentRequirements,
    network: handleResult.network,
  } as PaymentRequirements;
  const result = await verifyPayment(handleResult.body.paymentHeader, requirements, publicClient);

  if (!result.valid) {
    return c.json(buildVerifyErrorResponse(result.error ?? 'Verification failed'), 200);
  }

  if (!result.signer || !result.decodedPayment) {
    return c.json(buildVerifyErrorResponse('Verification succeeded but missing signer or payment data'), 500);
  }

  return c.json(buildVerifySuccessResponse(result.signer, result.decodedPayment.amount.toString()), 200);
});

app.post('/signature', async (c) => {
  const parseResult = await parseJsonBody<{ paymentHeader: string; network?: string }>(c);
  if (parseResult.error) {
    return c.json({ valid: false, error: 'Invalid JSON request body' }, 400);
  }

  if (!parseResult.body.paymentHeader) {
    return c.json({ valid: false, error: 'Missing paymentHeader' }, 400);
  }

  const cfg = config();
  function getNetworkFromRequest(requirementsNetwork: string | undefined, defaultNetwork: string): string {
    return requirementsNetwork ?? defaultNetwork;
  }
  const network = getNetworkFromRequest(parseResult.body.network, cfg.network);
  const payload = decodePaymentHeader(parseResult.body.paymentHeader);
  
  if (!payload) {
    return c.json({ valid: false, error: 'Invalid payment header encoding' }, 400);
  }

  const { verifySignatureOnly } = await import('../services/verifier');
  const result = await verifySignatureOnly(parseResult.body.paymentHeader, network);

  if (!result.valid) {
    return c.json({ valid: false, error: result.error ?? 'Signature verification failed' }, 200);
  }

  if (!result.signer) {
    return c.json({ valid: false, error: 'Signature verification succeeded but signer not found' }, 500);
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
