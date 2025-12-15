#!/usr/bin/env bun

import { ThresholdSigner } from './integration/threshold-signer';

async function main() {
  console.log('🔐 Threshold Signer\n');

  const threshold = parseInt(process.env.SIGNER_THRESHOLD || '2', 10);
  const signerAddresses = (process.env.SIGNER_ADDRESSES || '').split(',').filter(Boolean);

  console.log(`Threshold: ${threshold}, Signers: ${signerAddresses.length || 'any'}\n`);

  const signer = new ThresholdSigner(threshold);
  for (const addr of signerAddresses) {
    signer.addSigner(addr.trim());
  }

  console.log('Threshold signer running. Ctrl+C to stop.\n');

  const statusInterval = setInterval(() => {
    const pending = signer.getPendingBatches().length;
    if (pending > 0) console.log(`Pending batches: ${pending}`);
  }, 30000);

  process.on('SIGINT', () => { clearInterval(statusInterval); process.exit(0); });
  process.on('SIGTERM', () => { clearInterval(statusInterval); process.exit(0); });

  await new Promise(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });
