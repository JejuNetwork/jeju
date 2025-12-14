// TEE and Lit Protocol Encryption Tests
import { describe, test, expect, beforeAll } from 'bun:test';

describe('TEE Encryption', () => {
  let tee: typeof import('../../src/tee');
  
  beforeAll(async () => {
    tee = await import('../../src/tee');
  });

  test('getTEEMode returns simulated without API key', () => {
    expect(tee.getTEEMode()).toBe('simulated');
  });

  test('makeTEEDecision works in simulated mode', async () => {
    const result = await tee.makeTEEDecision({
      proposalId: 'test-proposal-123',
      councilVotes: [
        { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Good' },
        { role: 'CODE', vote: 'APPROVE', reasoning: 'Sound' },
        { role: 'COMMUNITY', vote: 'APPROVE', reasoning: 'Beneficial' },
        { role: 'SECURITY', vote: 'REJECT', reasoning: 'Minor concern' },
      ],
    });

    expect(typeof result.approved).toBe('boolean');
    expect(result.encryptedHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.attestation.provider).toBe('simulated');
    console.log(`✅ TEE decision: ${result.approved ? 'APPROVED' : 'REJECTED'} (${result.confidenceScore}%)`);
  });

  test('encryptedReasoning can be decrypted', async () => {
    const result = await tee.makeTEEDecision({
      proposalId: 'test-decrypt-123',
      councilVotes: [{ role: 'TREASURY', vote: 'APPROVE', reasoning: 'OK' }],
    });
    
    const decrypted = tee.decryptReasoning(result.encryptedReasoning);
    expect((decrypted.context as { proposalId: string }).proposalId).toBe('test-decrypt-123');
    console.log('✅ Encrypted reasoning decrypted');
  });

  test('decision includes recommendations', async () => {
    const result = await tee.makeTEEDecision({
      proposalId: 'test-recs-123',
      councilVotes: [
        { role: 'TREASURY', vote: 'REJECT', reasoning: 'Too expensive' },
        { role: 'CODE', vote: 'REJECT', reasoning: 'Not feasible' },
      ],
    });
    
    expect(result.recommendations.length).toBeGreaterThan(0);
    console.log(`✅ Recommendations: ${result.recommendations.join(', ')}`);
  });

  test('alignment score reflects council consensus', async () => {
    const highResult = await tee.makeTEEDecision({
      proposalId: 'high',
      councilVotes: [
        { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'CODE', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'COMMUNITY', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'SECURITY', vote: 'APPROVE', reasoning: 'Yes' },
      ],
    });
    const lowResult = await tee.makeTEEDecision({
      proposalId: 'low',
      councilVotes: [
        { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'CODE', vote: 'REJECT', reasoning: 'No' },
      ],
    });

    expect(highResult.alignmentScore).toBeGreaterThanOrEqual(lowResult.alignmentScore);
    console.log(`✅ Alignment: high=${highResult.alignmentScore}, low=${lowResult.alignmentScore}`);
  });
});

describe('Network KMS Encryption', () => {
  let lit: typeof import('../../src/lit-encryption');

  beforeAll(async () => {
    lit = await import('../../src/lit-encryption');
  });

  const makeDecision = (id: string, approved = true): lit.DecisionData => ({
    proposalId: id, approved, reasoning: 'Test', confidenceScore: 80, alignmentScore: 80,
    councilVotes: [], model: 'test', timestamp: Date.now(),
  });

  test('getLitStatus shows in-house KMS connected', () => {
    const status = lit.getLitStatus();
    expect(status.connected).toBe(true);
    expect(status.fallbackMode).toBe(false);
    expect(status.network).toBe('jeju-kms');
    console.log('✅ In-house KMS: connected');
  });

  test('encryptDecision works with in-house encryption', async () => {
    const encrypted = await lit.encryptDecision(makeDecision('test-encrypt'));
    expect(encrypted.dataToEncryptHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(encrypted.accessControlConditions.length).toBeGreaterThan(0);
    console.log('✅ Encrypted with in-house KMS');
  });

  test('decryptDecision works with in-house encryption', async () => {
    const encrypted = await lit.encryptDecision(makeDecision('test-decrypt', false));
    const decrypted = await lit.decryptDecision(encrypted);
    expect(decrypted.verified).toBe(true); // In-house KMS always verifies
    const parsed = lit.parseDecisionData(decrypted.decryptedString);
    expect(parsed.proposalId).toBe('test-decrypt');
    console.log('✅ Decrypted with in-house KMS');
  });

  test('accessControlConditions reference proposal', async () => {
    const encrypted = await lit.encryptDecision(makeDecision('test-acl'));
    const hasProposalRef = encrypted.accessControlConditions.some(c => c.parameters?.includes('test-acl'));
    expect(hasProposalRef).toBe(true);
    console.log('✅ Access control references proposal');
  });

  test('canDecrypt returns false for recent decisions', async () => {
    const encrypted = await lit.encryptDecision(makeDecision('test-recent'));
    expect(await lit.canDecrypt(encrypted)).toBe(false);
    console.log('✅ Recent decision not decryptable');
  });
});
