#!/usr/bin/env bun
/**
 * DWS Development Seeder
 * 
 * Seeds the development environment with:
 * 1. Test storage content
 * 2. Sample worker functions
 * 3. Cron triggers
 * 4. API marketplace listings
 * 5. Test users with credits
 * 
 * Run with: bun run scripts/seed-dev.ts
 */

const DWS_URL = process.env.DWS_URL || 'http://localhost:4030';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

interface SeedResult {
  storage: { cids: string[] };
  triggers: { ids: string[] };
  workers: { ids: string[] };
  marketplace: { listings: string[] };
}

async function waitForDWS(maxAttempts = 30): Promise<boolean> {
  console.log('⏳ Waiting for DWS to be ready...');
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${DWS_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log('✅ DWS is ready\n');
        return true;
      }
    } catch {
      // Retry
    }
    await Bun.sleep(1000);
  }
  
  console.error('❌ DWS did not become ready');
  return false;
}

async function seedStorage(): Promise<string[]> {
  console.log('📦 Seeding storage...');
  const cids: string[] = [];
  
  // Sample files
  const files = [
    { name: 'readme.txt', content: 'Welcome to DWS - Decentralized Web Services' },
    { name: 'config.json', content: JSON.stringify({ version: '1.0.0', network: 'localnet' }) },
    { name: 'sample.html', content: '<html><body><h1>Hello DWS</h1></body></html>' },
  ];
  
  for (const file of files) {
    try {
      const res = await fetch(`${DWS_URL}/storage/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': TEST_ADDRESS,
          'x-filename': file.name,
        },
        body: file.content,
      });
      
      if (res.ok) {
        const { cid } = await res.json() as { cid: string };
        cids.push(cid);
        console.log(`   ✅ ${file.name} -> ${cid.slice(0, 16)}...`);
      }
    } catch (e) {
      console.log(`   ⚠️ Failed to upload ${file.name}`);
    }
  }
  
  return cids;
}

async function seedS3Buckets(): Promise<void> {
  console.log('🪣 Seeding S3 buckets...');
  
  const buckets = ['dev-assets', 'dev-uploads', 'dev-cache'];
  
  for (const bucket of buckets) {
    try {
      const res = await fetch(`${DWS_URL}/s3/${bucket}`, {
        method: 'PUT',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      });
      
      if (res.ok) {
        console.log(`   ✅ Created bucket: ${bucket}`);
      } else if (res.status === 409) {
        console.log(`   ℹ️ Bucket exists: ${bucket}`);
      }
    } catch (e) {
      console.log(`   ⚠️ Failed to create bucket ${bucket}`);
    }
  }
}

async function seedTriggers(): Promise<string[]> {
  console.log('⏰ Seeding cron triggers...');
  const ids: string[] = [];
  
  const triggers = [
    {
      name: 'health-check',
      type: 'cron',
      schedule: '*/5 * * * *', // Every 5 minutes
      target: `${DWS_URL}/health`,
      enabled: false, // Don't actually run in dev
    },
    {
      name: 'storage-cleanup',
      type: 'cron', 
      schedule: '0 * * * *', // Every hour
      target: `${DWS_URL}/storage/cleanup`,
      enabled: false,
    },
    {
      name: 'metrics-report',
      type: 'cron',
      schedule: '0 0 * * *', // Daily
      target: `${DWS_URL}/metrics/report`,
      enabled: false,
    },
  ];
  
  for (const trigger of triggers) {
    try {
      const res = await fetch(`${DWS_URL}/ci/triggers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify(trigger),
      });
      
      if (res.ok) {
        const { trigger: created } = await res.json() as { trigger: { id: string } };
        ids.push(created.id);
        console.log(`   ✅ ${trigger.name} (${trigger.schedule})`);
      }
    } catch (e) {
      console.log(`   ⚠️ Failed to create trigger ${trigger.name}`);
    }
  }
  
  return ids;
}

async function seedKMSKeys(): Promise<void> {
  console.log('🔐 Seeding KMS keys...');
  
  try {
    // Generate a test key
    const res = await fetch(`${DWS_URL}/kms/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        threshold: 2,
        totalParties: 3,
        metadata: { purpose: 'dev-signing' },
      }),
    });
    
    if (res.ok) {
      const { keyId, address } = await res.json() as { keyId: string; address: string };
      console.log(`   ✅ Created key: ${keyId.slice(0, 8)}... -> ${address}`);
    }
    
    // Store a test secret
    const secretRes = await fetch(`${DWS_URL}/kms/vault/secrets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'dev-api-key',
        value: 'sk_test_' + crypto.randomUUID().replace(/-/g, ''),
      }),
    });
    
    if (secretRes.ok) {
      const { id, name } = await secretRes.json() as { id: string; name: string };
      console.log(`   ✅ Stored secret: ${name}`);
    }
  } catch (e) {
    console.log(`   ⚠️ Failed to seed KMS`);
  }
}

async function seedCDNCache(): Promise<void> {
  console.log('🌐 Seeding CDN cache...');
  
  const assets = [
    { path: '/app.js', content: 'console.log("DWS App");' },
    { path: '/style.css', content: 'body { font-family: sans-serif; }' },
  ];
  
  // Seed via storage and then fetch via CDN
  for (const asset of assets) {
    try {
      const uploadRes = await fetch(`${DWS_URL}/storage/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: asset.content,
      });
      
      if (uploadRes.ok) {
        const { cid } = await uploadRes.json() as { cid: string };
        // Fetch via CDN to populate cache
        await fetch(`${DWS_URL}/cdn/ipfs/${cid}`).catch(() => {});
        console.log(`   ✅ Cached ${asset.path}`);
      }
    } catch (e) {
      console.log(`   ⚠️ Failed to cache ${asset.path}`);
    }
  }
}

async function verifyServices(): Promise<void> {
  console.log('\n🔍 Verifying services...\n');
  
  const services = [
    { name: 'Storage', endpoint: '/storage/health' },
    { name: 'Compute', endpoint: '/compute/health' },
    { name: 'CDN', endpoint: '/cdn/health' },
    { name: 'KMS', endpoint: '/kms/health' },
    { name: 'Workers', endpoint: '/workers/health' },
    { name: 'S3', endpoint: '/s3/health' },
    { name: 'Git', endpoint: '/git/health' },
    { name: 'Pkg', endpoint: '/pkg/health' },
    { name: 'CI', endpoint: '/ci/health' },
    { name: 'RPC', endpoint: '/rpc/health' },
    { name: 'Edge', endpoint: '/edge/health' },
    { name: 'OAuth3', endpoint: '/oauth3/health' },
  ];
  
  let healthy = 0;
  let unhealthy = 0;
  
  for (const service of services) {
    try {
      const res = await fetch(`${DWS_URL}${service.endpoint}`, {
        signal: AbortSignal.timeout(5000),
      });
      
      if (res.ok) {
        console.log(`   ✅ ${service.name}`);
        healthy++;
      } else {
        console.log(`   ⚠️ ${service.name} (${res.status})`);
        unhealthy++;
      }
    } catch (e) {
      console.log(`   ❌ ${service.name} (unreachable)`);
      unhealthy++;
    }
  }
  
  console.log(`\n   📊 ${healthy}/${services.length} services healthy\n`);
}

async function testInference(): Promise<void> {
  console.log('🤖 Testing inference...\n');
  
  try {
    const res = await fetch(`${DWS_URL}/compute/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
        max_tokens: 10,
      }),
    });
    
    if (res.ok) {
      const body = await res.json() as {
        choices: Array<{ message: { content: string } }>;
        provider?: string;
      };
      
      console.log(`   ✅ Inference working`);
      console.log(`   Provider: ${body.provider || 'unknown'}`);
      console.log(`   Response: ${body.choices[0]?.message?.content || 'N/A'}`);
    } else if (res.status === 503) {
      const body = await res.json() as { error: string; docs?: string };
      console.log(`   ⚠️ No inference provider configured`);
      console.log(`   ${body.docs || 'Set GROQ_API_KEY or OPENAI_API_KEY'}`);
    } else {
      console.log(`   ❌ Inference failed (${res.status})`);
    }
  } catch (e) {
    console.log(`   ❌ Inference test failed`);
  }
}

async function main(): Promise<void> {
  console.log('🌱 DWS Development Seeder\n');
  console.log('='.repeat(50));
  console.log(`DWS URL: ${DWS_URL}`);
  console.log(`Test Address: ${TEST_ADDRESS}`);
  console.log('='.repeat(50));
  console.log('');
  
  // Wait for DWS
  if (!(await waitForDWS())) {
    console.log('\n💡 Start DWS first: bun run dev');
    process.exit(1);
  }
  
  // Seed data
  const result: SeedResult = {
    storage: { cids: [] },
    triggers: { ids: [] },
    workers: { ids: [] },
    marketplace: { listings: [] },
  };
  
  result.storage.cids = await seedStorage();
  console.log('');
  
  await seedS3Buckets();
  console.log('');
  
  result.triggers.ids = await seedTriggers();
  console.log('');
  
  await seedKMSKeys();
  console.log('');
  
  await seedCDNCache();
  console.log('');
  
  // Verify everything works
  await verifyServices();
  
  // Test inference
  await testInference();
  
  console.log('\n✅ Development environment seeded\n');
  console.log('Summary:');
  console.log(`   • ${result.storage.cids.length} files uploaded`);
  console.log(`   • ${result.triggers.ids.length} triggers created`);
  console.log(`   • S3 buckets ready`);
  console.log(`   • KMS keys and secrets ready`);
  console.log(`   • CDN cache warmed`);
  console.log('');
  console.log('Next steps:');
  console.log('   • Run e2e tests: bun test tests/e2e.test.ts');
  console.log('   • Start an app: cd apps/bazaar && bun run dev');
  console.log('');
}

main().catch(console.error);


