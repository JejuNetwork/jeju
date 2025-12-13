#!/usr/bin/env bun
import { parseArgs } from 'util';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createPublicClient, createWalletClient, http, type Address, type Hex, namehash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const KEEPALIVE_REGISTRY_ABI = [
  {
    name: 'registerKeepalive',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jnsNode', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'vaultAddress', type: 'address' },
      { name: 'globalMinBalance', type: 'uint256' },
      { name: 'checkInterval', type: 'uint256' },
      { name: 'autoFundAmount', type: 'uint256' },
      { name: 'autoFundEnabled', type: 'bool' },
    ],
    outputs: [{ name: 'keepaliveId', type: 'bytes32' }],
  },
  {
    name: 'addResource',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keepaliveId', type: 'bytes32' },
      { name: 'resourceType', type: 'uint8' },
      { name: 'identifier', type: 'string' },
      { name: 'healthEndpoint', type: 'string' },
      { name: 'minBalance', type: 'uint256' },
      { name: 'required', type: 'bool' },
    ],
    outputs: [],
  },
] as const;

const JNS_REGISTRAR_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'node', type: 'bytes32' }],
  },
  {
    name: 'rentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'price', type: 'uint256' }],
  },
  {
    name: 'available',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const JNS_RESOLVER_ABI = [
  {
    name: 'setContenthash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

interface DeployConfig {
  name: string;
  dir: string;
  jnsName: string;
  minBalance: bigint;
  checkInterval: number;
  autoFund: boolean;
  autoFundAmount: bigint;
  healthEndpoint?: string;
}

interface _DeployResult {
  jnsNode: Hex;
  ipfsCid: string;
  keepaliveId: Hex;
  gatewayUrl: string;
}

async function parseCliArgs(): Promise<DeployConfig> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string', short: 'n' },
      dir: { type: 'string', short: 'd' },
      jns: { type: 'string', short: 'j' },
      'min-balance': { type: 'string', default: '0.1' },
      'check-interval': { type: 'string', default: '3600' },
      'auto-fund': { type: 'boolean', default: true },
      'auto-fund-amount': { type: 'string', default: '0.05' },
      'health-endpoint': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Jeju Network App Deployment CLI

Usage:
  bun scripts/deploy-app.ts --name <name> --dir <path> --jns <name.jeju>

Options:
  -n, --name          App name
  -d, --dir           Directory containing built frontend
  -j, --jns           JNS name (e.g., myapp.jeju)
  --min-balance       Minimum ETH balance for keepalive (default: 0.1)
  --check-interval    Health check interval in seconds (default: 3600)
  --auto-fund         Enable auto-funding (default: true)
  --auto-fund-amount  Amount to auto-fund in ETH (default: 0.05)
  --health-endpoint   Custom health check endpoint
  -h, --help          Show this help

Environment:
  PRIVATE_KEY         Deployer private key
  RPC_URL             Jeju RPC URL
  IPFS_API_URL        IPFS API URL (default: http://localhost:5001)
  JNS_REGISTRAR       JNS Registrar address
  JNS_RESOLVER        JNS Resolver address
  KEEPALIVE_REGISTRY  KeepaliveRegistry address
`);
    process.exit(0);
  }

  if (!values.name || !values.dir || !values.jns) {
    console.error('Error: --name, --dir, and --jns are required');
    process.exit(1);
  }

  if (!existsSync(values.dir)) {
    console.error(`Error: Directory ${values.dir} does not exist`);
    process.exit(1);
  }

  return {
    name: values.name,
    dir: values.dir,
    jnsName: values.jns,
    minBalance: BigInt(Math.floor(parseFloat(values['min-balance'] ?? '0.1') * 1e18)),
    checkInterval: parseInt(values['check-interval'] ?? '3600', 10),
    autoFund: values['auto-fund'] !== false,
    autoFundAmount: BigInt(Math.floor(parseFloat(values['auto-fund-amount'] ?? '0.05') * 1e18)),
    healthEndpoint: values['health-endpoint'],
  };
}

async function uploadToIPFS(dir: string, ipfsApiUrl: string): Promise<string> {
  console.log(`📦 Uploading ${dir} to IPFS...`);

  const files: Array<{ path: string; content: Buffer }> = [];

  function collectFiles(currentDir: string, basePath: string = '') {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relativePath = join(basePath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        collectFiles(fullPath, relativePath);
      } else {
        files.push({
          path: relativePath,
          content: readFileSync(fullPath),
        });
      }
    }
  }

  collectFiles(dir);

  const formData = new FormData();
  for (const file of files) {
    formData.append('file', new Blob([file.content]), file.path);
  }

  const response = await fetch(`${ipfsApiUrl}/api/v0/add?wrap-with-directory=true&recursive=true`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${response.statusText}`);
  }

  const text = await response.text();
  const lines = text.trim().split('\n');
  const lastLine = JSON.parse(lines[lines.length - 1]);

  console.log(`✅ Uploaded to IPFS: ${lastLine.Hash}`);
  return lastLine.Hash;
}

// EIP-1577 contenthash: 0xe3 (IPFS) + 0x01 + 0x70 + multihash
function encodeIPFSContenthash(cid: string): Hex {
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function base58Decode(str: string): Uint8Array {
    const bytes: number[] = [0];
    for (const char of str) {
      const value = BASE58_ALPHABET.indexOf(char);
      if (value === -1) {
        throw new Error(`Invalid base58 character: ${char}`);
      }

      let carry = value;
      for (let i = bytes.length - 1; i >= 0; i--) {
        const n = bytes[i] * 58 + carry;
        bytes[i] = n % 256;
        carry = Math.floor(n / 256);
      }

      while (carry > 0) {
        bytes.unshift(carry % 256);
        carry = Math.floor(carry / 256);
      }
    }

    let leadingZeros = 0;
    for (const char of str) {
      if (char === '1') leadingZeros++;
      else break;
    }

    const result = new Uint8Array(leadingZeros + bytes.length);
    result.set(new Uint8Array(bytes), leadingZeros);
    return result;
  }

  if (!cid.startsWith('Qm') && !cid.startsWith('bafy')) {
    throw new Error(`Unsupported CID format: ${cid}. Expected CIDv0 (Qm...) or CIDv1 (bafy...)`);
  }

  if (cid.startsWith('Qm')) {
    const multihash = base58Decode(cid);

    if (multihash[0] !== 0x12 || multihash[1] !== 0x20 || multihash.length !== 34) {
      throw new Error('Invalid CIDv0 multihash format');
    }

    const contenthash = new Uint8Array(3 + multihash.length);
    contenthash[0] = 0xe3;
    contenthash[1] = 0x01;
    contenthash[2] = 0x70;
    contenthash.set(multihash, 3);

    return `0x${Array.from(contenthash).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex;
  }

  throw new Error('CIDv1 (bafy...) not supported. Use CIDv0 (Qm...)');
}

async function registerJNS(
  name: string,
  owner: Address,
  contenthash: Hex,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  jnsRegistrar: Address,
  jnsResolver: Address
): Promise<Hex> {
  const label = name.replace('.jeju', '');
  console.log(`📝 Registering JNS name: ${name}`);

  const available = await publicClient.readContract({
    address: jnsRegistrar,
    abi: JNS_REGISTRAR_ABI,
    functionName: 'available',
    args: [label],
  });

  if (!available) {
    console.log(`   Name already registered`);
    return namehash(name) as Hex;
  }

  const duration = 365n * 24n * 60n * 60n;
  const price = await publicClient.readContract({
    address: jnsRegistrar,
    abi: JNS_REGISTRAR_ABI,
    functionName: 'rentPrice',
    args: [label, duration],
  });

  console.log(`   Price: ${Number(price) / 1e18} ETH`);

  const { request: registerRequest } = await publicClient.simulateContract({
    address: jnsRegistrar,
    abi: JNS_REGISTRAR_ABI,
    functionName: 'register',
    args: [label, owner, duration],
    value: price,
    account: walletClient.account,
  });

  const registerHash = await walletClient.writeContract(registerRequest);
  await publicClient.waitForTransactionReceipt({ hash: registerHash });

  const node = namehash(name) as Hex;
  console.log(`✅ Registered: ${name}`);

  console.log(`📝 Setting contenthash...`);
  const { request: contenthashRequest } = await publicClient.simulateContract({
    address: jnsResolver,
    abi: JNS_RESOLVER_ABI,
    functionName: 'setContenthash',
    args: [node, contenthash],
    account: walletClient.account,
  });

  const contenthashHash = await walletClient.writeContract(contenthashRequest);
  await publicClient.waitForTransactionReceipt({ hash: contenthashHash });
  console.log(`✅ Contenthash set`);

  return node;
}

async function setupKeepalive(
  config: DeployConfig,
  jnsNode: Hex,
  ipfsCid: string,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  keepaliveRegistry: Address,
  owner: Address
): Promise<Hex> {
  console.log(`🔄 Setting up keepalive...`);

  const { request: registerRequest } = await publicClient.simulateContract({
    address: keepaliveRegistry,
    abi: KEEPALIVE_REGISTRY_ABI,
    functionName: 'registerKeepalive',
    args: [
      jnsNode,
      0n, // No agent
      owner, // Vault is owner for now
      config.minBalance,
      BigInt(config.checkInterval),
      config.autoFundAmount,
      config.autoFund,
    ],
    account: walletClient.account,
  });

  const registerHash = await walletClient.writeContract(registerRequest);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

  const keepaliveId = receipt.logs[0]?.topics[1] ?? ('0x' as Hex);
  console.log(`✅ Keepalive: ${keepaliveId.slice(0, 10)}...`);

  const { request: addResourceRequest } = await publicClient.simulateContract({
    address: keepaliveRegistry,
    abi: KEEPALIVE_REGISTRY_ABI,
    functionName: 'addResource',
    args: [
      keepaliveId,
      0, // IPFS_CONTENT
      ipfsCid,
      '', // No health endpoint for static content
      0n,
      true, // Required
    ],
    account: walletClient.account,
  });

  await walletClient.writeContract(addResourceRequest);

  if (config.healthEndpoint) {
    const { request: healthRequest } = await publicClient.simulateContract({
      address: keepaliveRegistry,
      abi: KEEPALIVE_REGISTRY_ABI,
      functionName: 'addResource',
      args: [
        keepaliveId,
        1, // COMPUTE_ENDPOINT
        config.healthEndpoint,
        config.healthEndpoint,
        0n,
        true,
      ],
      account: walletClient.account,
    });

    await walletClient.writeContract(healthRequest);
    console.log(`✅ Health endpoint added: ${config.healthEndpoint}`);
  }

  return keepaliveId;
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              🍊 JEJU NETWORK APP DEPLOYMENT                  ║
╚══════════════════════════════════════════════════════════════╝
`);

  const config = await parseCliArgs();

  // Validate environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable not set');
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL ?? 'http://localhost:8545';
  const ipfsApiUrl = process.env.IPFS_API_URL ?? 'http://localhost:5001';
  const jnsRegistrar = (process.env.JNS_REGISTRAR ?? '0x0') as Address;
  const jnsResolver = (process.env.JNS_RESOLVER ?? '0x0') as Address;
  const keepaliveRegistry = (process.env.KEEPALIVE_REGISTRY ?? '0x0') as Address;

  // Setup clients
  const account = privateKeyToAccount(privateKey as Hex);
  const chain = rpcUrl.includes('sepolia') ? baseSepolia : base;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  console.log(`📋 Configuration:`);
  console.log(`   App Name: ${config.name}`);
  console.log(`   JNS Name: ${config.jnsName}`);
  console.log(`   Source Dir: ${config.dir}`);
  console.log(`   Min Balance: ${Number(config.minBalance) / 1e18} ETH`);
  console.log(`   Check Interval: ${config.checkInterval}s`);
  console.log(`   Auto-Fund: ${config.autoFund ? 'enabled' : 'disabled'}`);
  console.log(`   Deployer: ${account.address}`);
  console.log('');

  const ipfsCid = await uploadToIPFS(config.dir, ipfsApiUrl);
  const contenthash = encodeIPFSContenthash(ipfsCid);

  const jnsNode = await registerJNS(
    config.jnsName,
    account.address,
    contenthash,
    publicClient,
    walletClient,
    jnsRegistrar,
    jnsResolver
  );

  const keepaliveId = await setupKeepalive(
    config,
    jnsNode,
    ipfsCid,
    publicClient,
    walletClient,
    keepaliveRegistry,
    account.address
  );

  const gatewayUrl = `https://${config.jnsName.replace('.jeju', '')}.jeju.network`;

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    ✅ DEPLOYMENT COMPLETE                    ║
╠══════════════════════════════════════════════════════════════╣
║  JNS Name:     ${config.jnsName.padEnd(44)} ║
║  IPFS CID:     ${ipfsCid.slice(0, 44).padEnd(44)} ║
║  Keepalive:    ${keepaliveId.slice(0, 44).padEnd(44)} ║
║  Gateway URL:  ${gatewayUrl.padEnd(44)} ║
╚══════════════════════════════════════════════════════════════╝

Your app is now live! As long as the keepalive has funds, it will
automatically stay online and recover from any issues.

To fund the keepalive:
  Send ETH to your vault address: ${account.address}
`);
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
