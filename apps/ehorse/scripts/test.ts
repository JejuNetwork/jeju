#!/usr/bin/env bun
/**
 * Quick Test Script for eHorse
 * Verifies the game is running correctly
 */

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => Promise<boolean>): Promise<void> {
  totalTests++;
  try {
    const success = await fn();
    if (success) {
      passedTests++;
      console.log(`✅ ${name}`);
    } else {
      console.log(`❌ ${name}`);
    }
  } catch (error) {
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🧪 eHorse Racing Game Tests                                ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`🌐 Testing: ${EHORSE_URL}\n`);

  await test('Server is reachable', async () => {
    const res = await fetch(`${EHORSE_URL}/health`);
    return res.ok;
  });

  await test('A2A Agent Card is accessible', async () => {
    const res = await fetch(`${EHORSE_URL}/.well-known/agent-card.json`);
    const card = await res.json();
    return card.name === 'eHorse Racing Game' && card.skills.length >= 3;
  });

  await test('Race API returns current race', async () => {
    const res = await fetch(`${EHORSE_URL}/api/race`);
    const race = await res.json();
    return race.id && race.horses.length === 4;
  });

  await test('Horses API returns 4 horses', async () => {
    const res = await fetch(`${EHORSE_URL}/api/horses`);
    const data = await res.json();
    return data.horses.length === 4;
  });

  await test('History API is working', async () => {
    const res = await fetch(`${EHORSE_URL}/api/history`);
    const data = await res.json();
    return Array.isArray(data.races);
  });

  await test('Frontend is served', async () => {
    const res = await fetch(`${EHORSE_URL}/`);
    const html = await res.text();
    return html.includes('eHorse Racing');
  });

  await test('A2A skills are discoverable', async () => {
    const res = await fetch(`${EHORSE_URL}/.well-known/agent-card.json`);
    const card = await res.json();
    const skillIds = card.skills.map((s: { id: string }) => s.id);
    return skillIds.includes('get-race-status') && 
           skillIds.includes('get-horses') && 
           skillIds.includes('get-race-history');
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (passedTests === totalTests) {
    console.log(`\n✅ All ${totalTests} tests passed!`);
    console.log('\neHorse is running correctly.');
    console.log('\nNext steps:');
    console.log('   1. Open http://localhost:5700 to see the races');
    console.log('   2. Deploy contracts: bun run deploy');
    console.log('   3. Run agent: bun run agent');
    console.log('');
    process.exit(0);
  } else {
    console.log(`\n❌ ${totalTests - passedTests} of ${totalTests} tests failed!`);
    console.log('\nMake sure eHorse server is running:');
    console.log('   source .env && bun run dev');
    console.log('');
    process.exit(1);
  }
}

main();


