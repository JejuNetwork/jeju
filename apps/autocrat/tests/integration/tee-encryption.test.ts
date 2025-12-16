// TEE and Encryption Tests
import { describe, test, expect, beforeAll } from 'bun:test';

describe('TEE Encryption', () => {
  let tee: typeof import('../../src/tee');
  
  beforeAll(async () => {
    tee = await import('../../src/tee');
  });

  test('getTEEMode returns local without TEE_ENDPOINT', () => {
    expect(tee.getTEEMode()).toBe('local');
  });

  test('makeTEEDecision works in local mode', async () => {
    const result = await tee.makeTEEDecision({
      proposalId: 'test-proposal-123',
      autocratVotes: [
        { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Good' },
        { role: 'CODE', vote: 'APPROVE', reasoning: 'Sound' },
        { role: 'COMMUNITY', vote: 'APPROVE', reasoning: 'Beneficial' },
        { role: 'SECURITY', vote: 'REJECT', reasoning: 'Minor concern' },
      ],
    });

    expect(typeof result.approved).toBe('boolean');
    expect(result.encryptedHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.attestation.provider).toBe('local');
    console.log(`✅ TEE decision: ${result.approved ? 'APPROVED' : 'REJECTED'} (${result.confidenceScore}%)`);
  });

  test('encryptedReasoning can be decrypted', async () => {
    const result = await tee.makeTEEDecision({
      proposalId: 'test-decrypt-123',
      autocratVotes: [{ role: 'TREASURY', vote: 'APPROVE', reasoning: 'OK' }],
    });
    
    const decrypted = tee.decryptReasoning(result.encryptedReasoning);
    expect((decrypted.context as { proposalId: string }).proposalId).toBe('test-decrypt-123');
    console.log('✅ Encrypted reasoning decrypted');
  });

  test('decision includes recommendations', async () => {
    const result = await tee.makeTEEDecision({
      proposalId: 'test-recs-123',
      autocratVotes: [
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
      autocratVotes: [
        { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'CODE', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'COMMUNITY', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'SECURITY', vote: 'APPROVE', reasoning: 'Yes' },
      ],
    });
    const lowResult = await tee.makeTEEDecision({
      proposalId: 'low',
      autocratVotes: [
        { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Yes' },
        { role: 'CODE', vote: 'REJECT', reasoning: 'No' },
      ],
    });

    expect(highResult.alignmentScore).toBeGreaterThanOrEqual(lowResult.alignmentScore);
    console.log(`✅ Alignment: high=${highResult.alignmentScore}, low=${lowResult.alignmentScore}`);
  });
});

describe('Network KMS Encryption', () => {
  let encryption: typeof import('../../src/encryption');

  beforeAll(async () => {
    encryption = await import('../../src/encryption');
  });

  const makeDecision = (id: string, approved = true): encryption.DecisionData => ({
    proposalId: id, approved, reasoning: 'Test', confidenceScore: 80, alignmentScore: 80,
    autocratVotes: [], model: 'test', timestamp: Date.now(),
  });

  test('getEncryptionStatus shows KMS connected', () => {
    const status = encryption.getEncryptionStatus();
    expect(status.provider).toBe('jeju-kms');
    console.log('✅ Jeju KMS: connected');
  });

  test('encryptDecision works', async () => {
    const encrypted = await encryption.encryptDecision(makeDecision('test-encrypt'));
    expect(encrypted.dataToEncryptHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(encrypted.accessControlConditions.length).toBeGreaterThan(0);
    console.log('✅ Encrypted with Jeju KMS');
  });

  test('decryptDecision works', async () => {
    const encrypted = await encryption.encryptDecision(makeDecision('test-decrypt', false));
    const decrypted = await encryption.decryptDecision(encrypted);
    expect(decrypted.verified).toBe(true);
    const parsed = encryption.parseDecisionData(decrypted.decryptedString);
    expect(parsed.proposalId).toBe('test-decrypt');
    console.log('✅ Decrypted with Jeju KMS');
  });

  test('accessControlConditions reference proposal', async () => {
    const encrypted = await encryption.encryptDecision(makeDecision('test-acl'));
    const hasProposalRef = encrypted.accessControlConditions.some(c => c.parameters?.includes('test-acl'));
    expect(hasProposalRef).toBe(true);
    console.log('✅ Access control references proposal');
  });

  test('canDecrypt returns false for recent decisions', async () => {
    const encrypted = await encryption.encryptDecision(makeDecision('test-recent'));
    expect(await encryption.canDecrypt(encrypted)).toBe(false);
    console.log('✅ Recent decision not decryptable');
  });
});
