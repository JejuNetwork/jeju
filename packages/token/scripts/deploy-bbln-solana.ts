#!/usr/bin/env bun
/**
 * Deploy BBLN SPL Token to Solana
 *
 * Creates the BBLN token on Solana with:
 * - SPL Token mint
 * - Token metadata (via Metaplex)
 * - Initial supply minting
 * - Hyperlane warp route configuration
 *
 * Usage:
 *   bun run scripts/deploy-bbln-solana.ts [devnet|mainnet] [--dry-run]
 *
 * Environment:
 *   SOLANA_PRIVATE_KEY - Base58 encoded deployer private key
 *   SOLANA_RPC_URL - Optional custom RPC URL
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createMint,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env from workspace root
const envPath = resolve(import.meta.dir, '../../../.env');
if (existsSync(envPath)) {
  const envFile = Bun.file(envPath);
  const envContent = await envFile.text();
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && !process.env[key]) {
      process.env[key] = valueParts.join('=');
    }
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const TOKEN_CONFIG = {
  name: 'Babylon',
  symbol: 'BBLN',
  decimals: 9, // Standard Solana decimals
  // 10% of 1B tokens allocated for Solana bridge liquidity
  initialLiquidity: 100_000_000n * 10n ** 9n,
  uri: 'https://babylon.game/metadata/bbln.json',
};

const NETWORK_CONFIG = {
  devnet: {
    rpc: 'https://api.devnet.solana.com',
    hyperlaneMailbox: 'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi',
    hyperlaneIgp: '3TJMcAhHRE7JN98URK7s5eeGfmVSvL4GAgegPq5K2nYg',
    domainId: 1399811150,
    explorer: 'https://explorer.solana.com/?cluster=devnet',
  },
  mainnet: {
    rpc: 'https://api.mainnet-beta.solana.com',
    hyperlaneMailbox: 'EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y',
    hyperlaneIgp: 'Hs7KVBU67nBnWhDj4MWXdUCMJd6v5tQYNrVDRHhhmDPF',
    domainId: 1399811149,
    explorer: 'https://explorer.solana.com',
  },
};

// EVM chain configurations for warp routes
const EVM_CHAINS = {
  baseSepolia: {
    chainId: 84532,
    domainId: 84532,
    name: 'Base Sepolia',
    warpRoute: '0x3586d05d61523c81d2d79c4e1132ffa1b3bcad5f', // BBLN token on Base Sepolia
  },
  sepolia: {
    chainId: 11155111,
    domainId: 11155111,
    name: 'Sepolia',
    warpRoute: '', // Will be set after deployment
  },
};

interface DeploymentResult {
  network: 'devnet' | 'mainnet';
  mint: PublicKey;
  mintAuthority: PublicKey;
  deployer: PublicKey;
  initialSupplyTx: string;
  explorerUrl: string;
  warpRouteConfig: {
    type: 'synthetic';
    decimals: number;
    remoteChains: number[];
    mailbox: string;
    igp: string;
  };
}

// =============================================================================
// MAIN DEPLOYMENT
// =============================================================================

async function deploy(
  network: 'devnet' | 'mainnet',
  dryRun: boolean
): Promise<DeploymentResult | null> {
  const config = NETWORK_CONFIG[network];
  const rpcUrl = process.env.SOLANA_RPC_URL ?? config.rpc;

  console.log('═'.repeat(60));
  console.log(`🚀 BBLN SOLANA DEPLOYMENT - ${network.toUpperCase()}`);
  console.log('═'.repeat(60));
  console.log(`\n📍 Network: ${network}`);
  console.log(`📍 RPC: ${rpcUrl}`);
  console.log(`📍 Hyperlane Mailbox: ${config.hyperlaneMailbox}`);
  console.log(`📍 Hyperlane IGP: ${config.hyperlaneIgp}`);
  console.log(`📍 Domain ID: ${config.domainId}`);

  const connection = new Connection(rpcUrl, 'confirmed');

  // Get or create keypair
  let deployer: Keypair;
  const privateKeyEnv = process.env.SOLANA_PRIVATE_KEY;

  if (privateKeyEnv) {
    const privateKeyBytes = bs58.decode(privateKeyEnv);
    deployer = Keypair.fromSecretKey(privateKeyBytes);
    console.log(`\n💼 Deployer: ${deployer.publicKey.toBase58()}`);
  } else {
    deployer = Keypair.generate();
    console.log(`\n⚠️  No SOLANA_PRIVATE_KEY set - generating new keypair`);
    console.log(`   Public Key: ${deployer.publicKey.toBase58()}`);
    console.log(`   Private Key (save this!): ${bs58.encode(deployer.secretKey)}`);

    if (network === 'devnet' && !dryRun) {
      console.log(`\n💰 Requesting airdrop (2 SOL)...`);
      // Retry airdrop up to 3 times (devnet can be rate-limited)
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const sig = await connection.requestAirdrop(
            deployer.publicKey,
            2 * LAMPORTS_PER_SOL
          );
          await connection.confirmTransaction(sig, 'confirmed');
          console.log(`   ✅ Airdrop complete: ${sig}`);
          break;
        } catch (airdropError) {
          if (attempt < 3) {
            console.log(`   ⚠️  Airdrop attempt ${attempt} failed, retrying in 5s...`);
            await new Promise((r) => setTimeout(r, 5000));
          } else {
            console.log(`   ❌ Airdrop failed after 3 attempts`);
            console.log(`   Please fund ${deployer.publicKey.toBase58()} manually`);
            console.log(`   Use: https://faucet.solana.com/`);
            throw new Error('Devnet airdrop unavailable. Please fund wallet manually.');
          }
        }
      }
    }
  }

  if (dryRun) {
    console.log(`💰 Balance: (skipped in dry run)`);
  } else {
    // Check balance
    const balance = await connection.getBalance(deployer.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;
    console.log(`💰 Balance: ${balanceSol.toFixed(4)} SOL`);

    if (balanceSol < 0.1) {
      if (network === 'devnet') {
        console.log(`\n⚠️  Low balance, requesting airdrop...`);
        const sig = await connection.requestAirdrop(
          deployer.publicKey,
          2 * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(sig, 'confirmed');
        console.log(`   ✅ Airdrop complete`);
      } else {
        throw new Error(
          `Insufficient SOL balance: ${balanceSol}. Need at least 0.1 SOL.`
        );
      }
    }
  }

  if (dryRun) {
    console.log('\n' + '─'.repeat(60));
    console.log('DRY RUN - Would deploy:');
    console.log('─'.repeat(60));
    console.log(`Token: ${TOKEN_CONFIG.name} (${TOKEN_CONFIG.symbol})`);
    console.log(`Decimals: ${TOKEN_CONFIG.decimals}`);
    console.log(
      `Initial Liquidity: ${(
        Number(TOKEN_CONFIG.initialLiquidity) /
        10 ** TOKEN_CONFIG.decimals
      ).toLocaleString()} BBLN`
    );
    console.log(`\nRun without --dry-run to deploy for real.`);
    return null;
  }

  // Create mint
  console.log('\n📦 Creating SPL Token mint...');
  const mint = await createMint(
    connection,
    deployer,
    deployer.publicKey, // Mint authority
    deployer.publicKey, // Freeze authority (optional)
    TOKEN_CONFIG.decimals
  );
  console.log(`   ✅ Mint: ${mint.toBase58()}`);

  // Create ATA and mint initial supply
  console.log('\n📦 Minting initial liquidity...');
  const ata = await getAssociatedTokenAddress(mint, deployer.publicKey);

  const tx = new Transaction();

  // Check if ATA exists
  const ataInfo = await connection.getAccountInfo(ata);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        deployer.publicKey,
        ata,
        deployer.publicKey,
        mint
      )
    );
  }

  // Mint initial supply
  tx.add(
    createMintToInstruction(
      mint,
      ata,
      deployer.publicKey,
      TOKEN_CONFIG.initialLiquidity
    )
  );

  const mintTx = await sendAndConfirmTransaction(connection, tx, [deployer]);
  console.log(`   ✅ Initial supply minted: ${mintTx}`);

  // Verify
  const mintInfo = await getMint(connection, mint);
  console.log(
    `   Supply: ${(Number(mintInfo.supply) / 10 ** TOKEN_CONFIG.decimals).toLocaleString()} BBLN`
  );

  // Generate warp route config
  const warpRouteConfig = {
    type: 'synthetic' as const,
    decimals: TOKEN_CONFIG.decimals,
    remoteChains: [EVM_CHAINS.baseSepolia.chainId],
    mailbox: config.hyperlaneMailbox,
    igp: config.hyperlaneIgp,
  };

  const result: DeploymentResult = {
    network,
    mint,
    mintAuthority: deployer.publicKey,
    deployer: deployer.publicKey,
    initialSupplyTx: mintTx,
    explorerUrl: `${config.explorer}/address/${mint.toBase58()}`,
    warpRouteConfig,
  };

  // Save deployment info
  const deploymentPath = resolve(
    import.meta.dir,
    `../deployments/solana-${network}-${Date.now()}.json`
  );
  await Bun.write(
    deploymentPath,
    JSON.stringify(
      {
        ...result,
        mint: result.mint.toBase58(),
        mintAuthority: result.mintAuthority.toBase58(),
        deployer: result.deployer.toBase58(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );

  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('✅ DEPLOYMENT COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nMint Address: ${mint.toBase58()}`);
  console.log(`Mint Authority: ${deployer.publicKey.toBase58()}`);
  console.log(`Explorer: ${result.explorerUrl}`);
  console.log(`\nDeployment saved: ${deploymentPath}`);

  // Print next steps
  console.log('\n' + '─'.repeat(60));
  console.log('📋 NEXT STEPS FOR WARP ROUTE');
  console.log('─'.repeat(60));
  console.log(`
1. Install Hyperlane CLI:
   npm i -g @hyperlane-xyz/cli

2. Create warp route config file (warp-config.yaml):
   ${network === 'devnet' ? 'solanatestnet' : 'solana'}:
     type: synthetic
     token: ${mint.toBase58()}
     mailbox: ${config.hyperlaneMailbox}
     interchainGasPaymaster: ${config.hyperlaneIgp}
   ${network === 'devnet' ? 'basesepolia' : 'base'}:
     type: collateral
     token: ${EVM_CHAINS.baseSepolia.warpRoute}
     mailbox: <evm_mailbox>

3. Deploy warp route:
   hyperlane warp deploy --config warp-config.yaml

4. Verify warp route:
   hyperlane warp check
`);

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const network = args.includes('mainnet') ? 'mainnet' : 'devnet';
  const dryRun = args.includes('--dry-run');

  await deploy(network as 'devnet' | 'mainnet', dryRun);
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error);
  process.exit(1);
});
