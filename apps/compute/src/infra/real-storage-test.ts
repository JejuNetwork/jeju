/**
 * Storage Test - Permissionless
 */

import { createHash } from 'crypto';
import type { Hex } from 'viem';

interface StorageConfig {
  privateKey?: Hex;
  arweaveNetwork: 'mainnet' | 'devnet';
  localIPFSUrl: string;
  ipfsGateways: string[];
  arweaveGateways: string[];
}

const DEFAULT_CONFIG: StorageConfig = {
  privateKey: process.env.PRIVATE_KEY as Hex | undefined,
  arweaveNetwork: 'devnet',
  localIPFSUrl: 'http://localhost:5001',
  ipfsGateways: [
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://dweb.link/ipfs/',
  ],
  arweaveGateways: [
    'https://arweave.net/',
    'https://ar-io.net/',
    'https://g8way.io/',
  ],
};

export async function isLocalIPFSAvailable(
  apiUrl = 'http://localhost:5001'
): Promise<boolean> {
  const response = await fetch(`${apiUrl}/api/v0/id`, { method: 'POST' }).catch(
    () => null
  );
  return response?.ok ?? false;
}

export async function uploadToLocalIPFS(
  content: string | Buffer,
  filename: string,
  apiUrl = 'http://localhost:5001'
): Promise<{ cid: string; size: number; url: string }> {
  if (!(await isLocalIPFSAvailable(apiUrl))) {
    throw new Error(`IPFS not available at ${apiUrl}`);
  }

  const data =
    typeof content === 'string' ? content : content.toString('base64');
  const formData = new FormData();
  formData.append('file', new Blob([data]), filename);

  const response = await fetch(`${apiUrl}/api/v0/add`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error(`Upload failed: ${await response.text()}`);

  const result = (await response.json()) as { Hash: string; Size: string };
  return {
    cid: result.Hash,
    size: parseInt(result.Size, 10),
    url: `https://ipfs.io/ipfs/${result.Hash}`,
  };
}

interface IrysClient {
  ready(): Promise<IrysClient>;
  getLoadedBalance(): Promise<bigint>;
  getPrice(bytes: number): Promise<bigint>;
  upload(
    data: string,
    options: { tags: { name: string; value: string }[] }
  ): Promise<{ id: string }>;
  utils: { fromAtomic(amount: bigint): string };
}

export async function uploadToArweave(
  content: string | Buffer,
  privateKey: Hex,
  network: 'mainnet' | 'devnet' = 'devnet'
): Promise<{ txId: string; size: number; url: string; cost: string }> {
  const { default: Irys } = await import('@irys/sdk');
  const url =
    network === 'mainnet'
      ? 'https://node1.irys.xyz'
      : 'https://devnet.irys.xyz';
  const key = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

  const irys = new Irys({
    url,
    token: 'ethereum',
    key,
  }) as unknown as IrysClient;
  await irys.ready();

  const data = typeof content === 'string' ? content : content.toString();
  const size = Buffer.byteLength(data);
  const price = await irys.getPrice(size);

  const receipt = await irys.upload(data, {
    tags: [
      { name: 'App-Name', value: 'jeju-compute' },
      { name: 'Timestamp', value: Date.now().toString() },
    ],
  });

  return {
    txId: receipt.id,
    size,
    url: `https://arweave.net/${receipt.id}`,
    cost: irys.utils.fromAtomic(price),
  };
}

export async function retrieveFromIPFS(
  cid: string,
  config: StorageConfig = DEFAULT_CONFIG
): Promise<{ data: string; gateway: string; latency: number }> {
  for (const gateway of config.ipfsGateways) {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${gateway}${cid}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok)
        return {
          data: await response.text(),
          gateway,
          latency: Date.now() - start,
        };
    } catch {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Failed to retrieve ${cid}`);
}

export async function retrieveFromArweave(
  txId: string,
  config: StorageConfig = DEFAULT_CONFIG
): Promise<{ data: string; gateway: string; latency: number }> {
  for (const gateway of config.arweaveGateways) {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${gateway}${txId}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok)
        return {
          data: await response.text(),
          gateway,
          latency: Date.now() - start,
        };
    } catch {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Failed to retrieve ${txId}`);
}

interface GatewayHealth {
  gateway: string;
  type: 'ipfs' | 'arweave' | 'local-ipfs';
  reachable: boolean;
  latency: number;
}

export async function checkGatewayHealth(
  config: StorageConfig = DEFAULT_CONFIG
): Promise<GatewayHealth[]> {
  const results: GatewayHealth[] = [];
  const testCid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

  // Local IPFS
  const localStart = Date.now();
  const localAvailable = await isLocalIPFSAvailable(config.localIPFSUrl);
  results.push({
    gateway: config.localIPFSUrl,
    type: 'local-ipfs',
    reachable: localAvailable,
    latency: Date.now() - localStart,
  });

  // IPFS gateways
  for (const gateway of config.ipfsGateways) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${gateway}${testCid}`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      results.push({
        gateway,
        type: 'ipfs',
        reachable: response.ok,
        latency: Date.now() - start,
      });
    } catch {
      results.push({
        gateway,
        type: 'ipfs',
        reachable: false,
        latency: Date.now() - start,
      });
    }
  }

  // Arweave gateways
  for (const gateway of config.arweaveGateways) {
    const start = Date.now();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${gateway}info`, {
      signal: controller.signal,
    });
    results.push({
      gateway,
      type: 'arweave',
      reachable: response.ok,
      latency: Date.now() - start,
    });
  }

  return results;
}

interface StorageTestResult {
  success: boolean;
  localIPFS: {
    available: boolean;
    uploaded: boolean;
    verified: boolean;
    cid?: string;
  };
  arweave: {
    available: boolean;
    uploaded: boolean;
    txId?: string;
    cost?: string;
  };
  gateways: GatewayHealth[];
}

export async function runFullStorageTest(
  config: StorageConfig = DEFAULT_CONFIG
): Promise<StorageTestResult> {
  console.log('\nStorage Test\n');

  const result: StorageTestResult = {
    success: false,
    localIPFS: { available: false, uploaded: false, verified: false },
    arweave: { available: false, uploaded: false },
    gateways: [],
  };

  // 1. Check gateways
  console.log('Gateways:');
  result.gateways = await checkGatewayHealth(config);

  const localHealthy = result.gateways.some(
    (g) => g.type === 'local-ipfs' && g.reachable
  );
  const ipfsHealthy = result.gateways.filter(
    (g) => g.type === 'ipfs' && g.reachable
  ).length;
  const arweaveHealthy = result.gateways.filter(
    (g) => g.type === 'arweave' && g.reachable
  ).length;

  console.log(`  Local IPFS: ${localHealthy ? '✓' : '✗'}`);
  console.log(`  IPFS: ${ipfsHealthy}/${config.ipfsGateways.length}`);
  console.log(`  Arweave: ${arweaveHealthy}/${config.arweaveGateways.length}`);

  const testData = JSON.stringify({ test: true, timestamp: Date.now() });
  const hash = createHash('sha256').update(testData).digest('hex');

  // 2. Local IPFS
  result.localIPFS.available = localHealthy;
  if (localHealthy) {
    console.log('\nLocal IPFS:');
    try {
      const upload = await uploadToLocalIPFS(
        testData,
        `test-${Date.now()}.json`,
        config.localIPFSUrl
      );
      result.localIPFS.uploaded = true;
      result.localIPFS.cid = upload.cid;
      console.log(`  ✓ Uploaded: ${upload.cid}`);

      await new Promise((r) => setTimeout(r, 2000));
      const retrieved = await retrieveFromIPFS(upload.cid, config);
      const retrievedHash = createHash('sha256')
        .update(retrieved.data)
        .digest('hex');
      result.localIPFS.verified = hash === retrievedHash;
      console.log(`  ${result.localIPFS.verified ? '✓' : '✗'} Verified`);
    } catch (e) {
      console.log(`  ✗ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. Arweave
  result.arweave.available = arweaveHealthy > 0 && !!config.privateKey;
  if (result.arweave.available && config.privateKey) {
    console.log('\nArweave:');
    try {
      const upload = await uploadToArweave(
        testData,
        config.privateKey,
        config.arweaveNetwork
      );
      result.arweave.uploaded = true;
      result.arweave.txId = upload.txId;
      result.arweave.cost = upload.cost;
      console.log(`  ✓ Uploaded: ${upload.txId}`);
      console.log(`  Cost: ${upload.cost} ETH`);
    } catch (e) {
      console.log(`  ✗ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!config.privateKey) {
    console.log('\nArweave: Skipped (no PRIVATE_KEY)');
  }

  result.success =
    result.gateways.some((g) => g.reachable) &&
    (result.localIPFS.verified || result.arweave.uploaded);

  console.log(
    `\n${result.success ? '✓' : '✗'} ${result.success ? 'Passed' : 'Failed'}\n`
  );
  return result;
}

if (import.meta.main) {
  runFullStorageTest().then((result) => {
    process.exit(result.success ? 0 : 1);
  });
}
