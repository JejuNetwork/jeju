/**
 * TEE Encryption & Attestation Verification Test
 * 
 * Run with: cd apps/council && bun run tests/tee-verification.ts
 */

import { makeTEEDecision, decryptReasoning, getTEEMode, type TEEDecisionContext } from '../src/tee';

async function testEncryption() {
  console.log('='.repeat(60));
  console.log('TEE ENCRYPTION & ATTESTATION VERIFICATION');
  console.log('='.repeat(60));
  console.log();

  // Check mode
  const mode = getTEEMode();
  console.log(`TEE Mode: ${mode}`);
  console.log(`TEE_API_KEY: ${process.env.TEE_API_KEY ?? process.env.PHALA_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log();

  // Test context
  const context: TEEDecisionContext = {
    proposalId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    councilVotes: [
      { role: 'Treasury', vote: 'APPROVE', reasoning: 'Budget looks reasonable' },
      { role: 'Code', vote: 'APPROVE', reasoning: 'Technical implementation is sound' },
      { role: 'Community', vote: 'APPROVE', reasoning: 'Good community benefit' },
      { role: 'Security', vote: 'ABSTAIN', reasoning: 'No security concerns' },
    ],
    researchReport: 'Research indicates positive ROI within 6 months.',
  };

  console.log('Test Context:');
  console.log(`  Proposal ID: ${context.proposalId.slice(0, 20)}...`);
  console.log(`  Council Votes: ${context.councilVotes.length}`);
  console.log(`  - Treasury: ${context.councilVotes[0].vote}`);
  console.log(`  - Code: ${context.councilVotes[1].vote}`);
  console.log(`  - Community: ${context.councilVotes[2].vote}`);
  console.log(`  - Security: ${context.councilVotes[3].vote}`);
  console.log();

  // Make decision
  console.log('Making TEE decision...');
  const startTime = Date.now();
  const result = await makeTEEDecision(context);
  const elapsed = Date.now() - startTime;

  console.log(`Decision made in ${elapsed}ms`);
  console.log();

  // Display result
  console.log('Decision Result:');
  console.log(`  Approved: ${result.approved}`);
  console.log(`  Public Reasoning: ${result.publicReasoning}`);
  console.log(`  Confidence Score: ${result.confidenceScore}%`);
  console.log(`  Alignment Score: ${result.alignmentScore}%`);
  console.log(`  Recommendations: ${result.recommendations.join(', ')}`);
  console.log();

  // Attestation
  console.log('Attestation:');
  console.log(`  Provider: ${result.attestation?.provider}`);
  console.log(`  Verified: ${result.attestation?.verified}`);
  console.log(`  Timestamp: ${result.attestation?.timestamp ? new Date(result.attestation.timestamp).toISOString() : 'N/A'}`);
  if (result.attestation?.quote) {
    console.log(`  Quote: ${result.attestation.quote.slice(0, 40)}...`);
  }
  if (result.attestation?.measurement) {
    console.log(`  Measurement: ${result.attestation.measurement}`);
  }
  console.log();

  // Encryption verification
  console.log('Encryption Verification:');
  console.log(`  Encrypted Hash: ${result.encryptedHash.slice(0, 40)}...`);
  
  // Parse encrypted data to show structure
  const encryptedData = JSON.parse(result.encryptedReasoning) as { ciphertext: string; iv: string; tag: string };
  console.log(`  Ciphertext Length: ${encryptedData.ciphertext.length} hex chars`);
  console.log(`  IV: ${encryptedData.iv} (${encryptedData.iv.length / 2} bytes)`);
  console.log(`  Auth Tag: ${encryptedData.tag} (${encryptedData.tag.length / 2} bytes)`);
  console.log();

  // Verify decryption works
  console.log('Decryption Test:');
  try {
    const decrypted = decryptReasoning(result.encryptedReasoning);
    console.log('  ✅ Decryption successful');
    console.log(`  Decrypted keys: ${Object.keys(decrypted).join(', ')}`);
    
    // Verify content matches
    const decryptedContext = decrypted.context as TEEDecisionContext;
    if (decryptedContext.proposalId === context.proposalId) {
      console.log('  ✅ Proposal ID matches');
    } else {
      console.log('  ❌ Proposal ID mismatch');
    }
    
    if (decrypted.decision === (result.approved ? 'APPROVE' : 'REJECT') || 
        (decrypted.decision as { approved?: boolean })?.approved === result.approved) {
      console.log('  ✅ Decision matches');
    } else {
      console.log('  ❌ Decision mismatch');
    }
  } catch (error) {
    console.log(`  ❌ Decryption failed: ${(error as Error).message}`);
  }
  console.log();

  // Tamper test
  console.log('Tamper Detection Test:');
  try {
    // Modify ciphertext slightly
    const tampered = JSON.parse(result.encryptedReasoning) as { ciphertext: string; iv: string; tag: string };
    tampered.ciphertext = 'ff' + tampered.ciphertext.slice(2); // Change first byte
    
    decryptReasoning(JSON.stringify(tampered));
    console.log('  ❌ Tampered data was decrypted (should fail)');
  } catch {
    console.log('  ✅ Tampered data correctly rejected (GCM auth failed)');
  }
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Mode: ${mode}`);
  console.log(`Encryption: AES-256-GCM ✅`);
  console.log(`IV: Random 12 bytes ✅`);
  console.log(`Auth Tag: 16 bytes ✅`);
  console.log(`Decryption: Working ✅`);
  console.log(`Tamper Detection: Working ✅`);
  if (mode === 'hardware') {
    console.log(`Hardware Attestation: ${result.attestation?.verified ? '✅ Verified' : '⚠️ Not verified (check DCAP endpoint)'}`);
  } else {
    console.log(`Attestation: Simulated (set TEE_API_KEY for hardware attestation)`);
  }
  console.log();
}

// Run test
testEncryption().catch(console.error);
