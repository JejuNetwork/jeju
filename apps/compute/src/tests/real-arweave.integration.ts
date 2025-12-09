/**
 * Real Arweave Integration Tests
 *
 * Uploads encrypted data to Arweave devnet, then downloads and decrypts.
 * Requires PRIVATE_KEY environment variable.
 *
 * Run:
 *   PRIVATE_KEY=0x... bun test src/tests/real-arweave.integration.ts
 *
 * Note: Devnet is free, no real tokens needed.
 */

import { describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { createDevnetStorage } from '../storage/arweave-storage.js';
import { StateManager } from '../storage/state-manager.js';
import { TEEEnclave } from '../tee/enclave.js';

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
const SKIP_REASON = PRIVATE_KEY
  ? undefined
  : 'Set PRIVATE_KEY env var to run real Arweave tests';

describe.skipIf(!PRIVATE_KEY)('Arweave Upload/Download', () => {
  test('uploads and retrieves JSON data', async () => {
    const storage = createDevnetStorage(PRIVATE_KEY!, true);

    const testData = {
      timestamp: Date.now(),
      message: 'Hello from Jeju Compute!',
      random: Math.random(),
    };

    const result = await storage.uploadJSON(testData, {
      tags: { 'Test-Type': 'upload-test' },
    });

    expect(result.id).toBeDefined();
    expect(result.url).toContain('arweave.net');

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const downloaded = await storage.downloadJSON<typeof testData>(result.id);

    expect(downloaded.timestamp).toBe(testData.timestamp);
    expect(downloaded.message).toBe(testData.message);
    expect(downloaded.random).toBe(testData.random);
  }, 30000);
});

describe.skipIf(!PRIVATE_KEY)('Encrypted State Flow', () => {
  test('full encrypt → upload → download → decrypt cycle', async () => {
    const enclave = await TEEEnclave.create({
      codeHash:
        '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678' as Hex,
      instanceId: 'arweave-test',
      verbose: true,
    });

    const storage = createDevnetStorage(PRIVATE_KEY!, true);
    const stateManager = new StateManager(enclave, storage, {
      verbose: true,
    });

    const secretState = {
      gameId: 'jeju-test-001',
      timestamp: Date.now(),
      players: [
        { name: 'alice', secretCards: ['ace-spades', 'king-hearts'] },
        { name: 'bob', secretCards: ['queen-diamonds', 'jack-clubs'] },
      ],
      hiddenTreasure: { x: 42, y: 73, value: 1000 },
      aiWeights: Array.from({ length: 10 }, () => Math.random()),
    };

    // Save encrypted state
    const checkpoint = await stateManager.saveState(secretState);
    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.url).toBeDefined();
    expect(checkpoint.hash).toBeDefined();

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Load and decrypt
    const loadedState = await stateManager.loadState<typeof secretState>(
      checkpoint.id
    );

    expect(loadedState.gameId).toBe(secretState.gameId);
    expect(loadedState.players.length).toBe(2);
    expect(loadedState.players[0]!.secretCards).toEqual(
      secretState.players[0]!.secretCards
    );
    expect(loadedState.hiddenTreasure).toEqual(secretState.hiddenTreasure);
    expect(loadedState.aiWeights.length).toBe(10);

    // Save public training data
    const trainingData = [
      { input: [1, 2, 3], output: [0.5], timestamp: Date.now() },
      { input: [4, 5, 6], output: [0.8], timestamp: Date.now() },
    ];

    const dataset = await stateManager.saveTrainingData(
      trainingData,
      '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex,
      '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex
    );

    expect(dataset.id).toBeDefined();
    expect(dataset.sampleCount).toBe(2);

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const publicData = await stateManager.loadTrainingData(dataset.id);
    expect(publicData.samples.length).toBe(2);

    // Key rotation
    const rotatedCheckpoint = await stateManager.rotateKey();
    expect(rotatedCheckpoint.keyVersion).toBe(2);

    await enclave.shutdown();
  }, 60000);
});

describe.skipIf(!PRIVATE_KEY)('Tamper Detection', () => {
  test('rejects tampered ciphertext from Arweave', async () => {
    const enclave = await TEEEnclave.create({
      codeHash:
        '0xabcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234' as Hex,
      instanceId: 'tamper-test',
    });

    const storage = createDevnetStorage(PRIVATE_KEY!, false);
    const stateManager = new StateManager(enclave, storage);

    const checkpoint = await stateManager.saveState({ secret: 'value' });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Download and tamper
    const rawData = await storage.download(checkpoint.id);
    const jsonStr = new TextDecoder().decode(rawData);
    const sealed = JSON.parse(jsonStr);

    const tamperedCiphertext = Buffer.from(sealed.payload.ciphertext, 'base64');
    const firstByte = tamperedCiphertext[0] ?? 0;
    tamperedCiphertext[0] = firstByte ^ 0xff;
    sealed.payload.ciphertext = tamperedCiphertext.toString('base64');

    let decryptFailed = false;
    try {
      await enclave.decryptState(sealed);
    } catch {
      decryptFailed = true;
    }
    expect(decryptFailed).toBe(true);

    await enclave.shutdown();
  }, 30000);
});

// Print skip message if no private key
if (SKIP_REASON) {
  console.log(`\n⚠️  ${SKIP_REASON}`);
  console.log(
    '  PRIVATE_KEY=0x... bun test src/tests/real-arweave.integration.ts\n'
  );
}
