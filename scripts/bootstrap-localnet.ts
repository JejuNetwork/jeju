#!/usr/bin/env bun
/**
 * Bootstrap Localnet
 * 
 * Simple wrapper around bootstrap-localnet-complete.ts
 * Ensures all contracts are deployed for local development.
 */

import { CompleteBootstrapper } from './bootstrap-localnet-complete';

const bootstrapper = new CompleteBootstrapper();
bootstrapper.bootstrap().catch((error) => {
  console.error('Bootstrap failed:', error);
  process.exit(1);
});

