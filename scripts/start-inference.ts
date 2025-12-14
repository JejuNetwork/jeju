#!/usr/bin/env bun
/**
 * Start local inference server
 */

import { createInferenceServer } from '../packages/cli/src/services/inference';

const server = createInferenceServer({ port: 4100 });
await server.start();

console.log('Inference server running. Press Ctrl+C to stop.');

// Keep the process running
await new Promise(() => {});


