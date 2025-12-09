#!/usr/bin/env bun

/**
 * Get Localnet RPC URL
 *
 * Dynamically retrieves the current Kurtosis localnet RPC URL.
 * Kurtosis assigns random ports, so we need to query it.
 *
 * Usage:
 *   bun run scripts/shared/get-localnet-rpc.ts
 *
 * Returns:
 *   http://127.0.0.1:PORT (e.g., http://127.0.0.1:57874)
 */

import { execSync } from 'child_process';

export function getLocalnetRpcUrl(): string {
	try {
		// Get the RPC port from Kurtosis
		const output = execSync('kurtosis port print jeju-localnet op-geth rpc', {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const address = output.trim(); // e.g., "127.0.0.1:57874"

		if (!address || !address.includes(':')) {
			throw new Error('Invalid Kurtosis port output');
		}

		return `http://${address}`;
	} catch (error) {
		// Fallback to default port if Kurtosis is not running
		console.warn('⚠️  Warning: Could not get RPC URL from Kurtosis, using default port 9545');
		console.warn('Make sure localnet is running: bun run localnet:start');
		return 'http://127.0.0.1:9545';
	}
}

// If run directly, print the RPC URL
if (import.meta.main) {
	const rpcUrl = getLocalnetRpcUrl();
	console.log(rpcUrl);
}
