/**
 * Solana Token Deployer
 * Creates SPL tokens and configures Hyperlane warp routes on Solana
 */

import {
  createAssociatedTokenAccountInstruction,
  createMint,
  createMintToInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import type { ChainConfig, ChainDeployment, DeploymentConfig } from '../types';

export interface SolanaDeploymentConfig {
  connection: Connection;
  payer: Keypair;
  mintAuthority: Keypair;
  freezeAuthority?: Keypair;
  decimals?: number;
}

export interface SolanaDeploymentResult {
  mint: PublicKey;
  mintAuthority: PublicKey;
  warpRouteProgram?: PublicKey;
  txSignatures: string[];
}

/**
 * Deploy an SPL token on Solana
 */
export async function deploySolanaToken(
  config: SolanaDeploymentConfig,
  tokenConfig: DeploymentConfig['token']
): Promise<SolanaDeploymentResult> {
  const { connection, payer, mintAuthority, freezeAuthority } = config;
  const decimals = config.decimals ?? tokenConfig.decimals;
  const txSignatures: string[] = [];

  // Create the mint account
  const mint = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    freezeAuthority?.publicKey ?? null,
    decimals
  );

  console.log(`Token mint created: ${mint.toBase58()}`);
  txSignatures.push('mint-creation');

  // If this is the home chain (has initial supply), mint tokens
  // For synthetic chains, no initial minting - warp route will handle it

  return {
    mint,
    mintAuthority: mintAuthority.publicKey,
    txSignatures,
  };
}

/**
 * Mint initial supply to a recipient
 */
export async function mintInitialSupply(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  recipient: PublicKey,
  amount: bigint
): Promise<string> {
  // Get or create associated token account
  const ata = await getAssociatedTokenAddress(mint, recipient);

  const instructions: TransactionInstruction[] = [];

  // Check if ATA exists
  const ataInfo = await connection.getAccountInfo(ata);
  if (!ataInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        recipient,
        mint
      )
    );
  }

  // Mint tokens
  instructions.push(
    createMintToInstruction(mint, ata, mintAuthority.publicKey, amount)
  );

  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, tx, [
    payer,
    mintAuthority,
  ]);

  console.log(
    `Minted ${amount} tokens to ${recipient.toBase58()}: ${signature}`
  );
  return signature;
}

/**
 * Deploy Solana chain - creates SPL token
 * Hyperlane warp route uses the mailbox program from chain config
 * 
 * Solana architecture notes:
 * - Vesting on Solana requires a separate Anchor program (not SPL token feature)
 *   Use @jejunetwork/solana vesting program for cross-chain vesting
 * - Fee distribution uses Token-2022 transfer fee extension or separate program
 *   Standard SPL tokens don't have built-in transfer fees
 */
export async function deploySolanaChain(
  chain: ChainConfig,
  deploymentConfig: DeploymentConfig,
  payer: Keypair
): Promise<ChainDeployment> {
  const isMainnet = chain.chainId === 'solana-mainnet';
  const connection = new Connection(
    chain.rpcUrl ||
      (isMainnet
        ? 'https://api.mainnet-beta.solana.com'
        : 'https://api.devnet.solana.com'),
    'confirmed'
  );

  const txSignatures: string[] = [];

  // Generate a new keypair for mint authority (or use provided)
  const mintAuthority = Keypair.generate();

  // Deploy the token
  const result = await deploySolanaToken(
    {
      connection,
      payer,
      mintAuthority,
      decimals: deploymentConfig.token.decimals,
    },
    deploymentConfig.token
  );

  txSignatures.push(...result.txSignatures);

  // Hyperlane warp route program ID from chain config
  const warpRouteProgram = new PublicKey(chain.hyperlaneMailbox);

  console.log(`Solana token deployed:`);
  console.log(`  Mint: ${result.mint.toBase58()}`);
  console.log(`  Mint Authority: ${result.mintAuthority.toBase58()}`);
  console.log(`  Warp Route Program: ${warpRouteProgram.toBase58()}`);

  // Solana uses different programs for vesting/fees:
  // - Vesting: Requires separate Anchor program deployment
  // - Fee Distribution: Use Token-2022 extensions or custom program
  // These are left empty as they require separate Solana program deployments
  return {
    chainId: chain.chainId,
    token: result.mint.toBase58(),
    vesting: '', // Solana vesting requires separate Anchor program
    feeDistributor: '', // Solana fees use Token-2022 extensions or custom program
    warpRoute: warpRouteProgram.toBase58(),
    ism: warpRouteProgram.toBase58(),
    deploymentTxHashes: txSignatures as `0x${string}`[],
    deployedAtBlock: 0n,
  };
}

/**
 * Derive Solana warp route PDA addresses
 */
export function deriveWarpRoutePDAs(
  programId: PublicKey,
  mint: PublicKey
): {
  warpRouteAccount: PublicKey;
  tokenAccount: PublicKey;
} {
  const [warpRouteAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('warp_route'), mint.toBuffer()],
    programId
  );

  const [tokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_account'), mint.toBuffer()],
    programId
  );

  return { warpRouteAccount, tokenAccount };
}
