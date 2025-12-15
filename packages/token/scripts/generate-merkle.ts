#!/usr/bin/env bun
/**
 * Merkle Tree Generator for BBLN Airdrop
 *
 * Generates a Merkle tree from user allocations for on-chain verification.
 * The tree is used by the Airdrop contract to verify user eligibility.
 *
 * Usage:
 *   bun run scripts/generate-merkle.ts [--snapshot] [--output merkle.json]
 *
 * Options:
 *   --snapshot    Take a fresh snapshot from database
 *   --output      Output file path (default: merkle.json)
 */

import { keccak256, encodePacked, type Hex, type Address } from 'viem';
import { db, users, eq, gte, sql } from '@babylon/db';
import {
  AIRDROP_TOKENS,
  ELIZA_HOLDER_BONUS_MULTIPLIER,
  tokensToWei,
} from '../src/config/tokenomics';

// =============================================================================
// TYPES
// =============================================================================

interface UserAllocation {
  address: Address;
  allocation: bigint;
  bonusMultiplier: number;
  pointsBalance: number;
  tradingVolume: number;
  referralCount: number;
}

interface MerkleProof {
  address: Address;
  allocation: string;
  bonusMultiplier: number;
  proof: Hex[];
  leaf: Hex;
}

interface MerkleTreeOutput {
  root: Hex;
  totalAllocations: string;
  totalUsers: number;
  generatedAt: string;
  proofs: MerkleProof[];
}

// =============================================================================
// MERKLE TREE FUNCTIONS
// =============================================================================

function hashLeaf(address: Address, allocation: bigint, bonus: number): Hex {
  return keccak256(
    encodePacked(
      ['address', 'uint256', 'uint8'],
      [address, allocation, bonus]
    )
  );
}

function hashPair(a: Hex, b: Hex): Hex {
  // Sort to ensure consistent ordering
  const [first, second] = a < b ? [a, b] : [b, a];
  return keccak256(encodePacked(['bytes32', 'bytes32'], [first, second]));
}

function buildMerkleTree(leaves: Hex[]): { root: Hex; layers: Hex[][] } {
  if (leaves.length === 0) {
    return { root: '0x' + '0'.repeat(64) as Hex, layers: [[]] };
  }

  // Sort leaves for deterministic tree
  const sortedLeaves = [...leaves].sort();
  const layers: Hex[][] = [sortedLeaves];

  let currentLayer = sortedLeaves;
  while (currentLayer.length > 1) {
    const nextLayer: Hex[] = [];

    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        nextLayer.push(hashPair(currentLayer[i], currentLayer[i + 1]));
      } else {
        // Odd number of elements - promote the last one
        nextLayer.push(currentLayer[i]);
      }
    }

    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return { root: currentLayer[0], layers };
}

function getProof(leaf: Hex, layers: Hex[][]): Hex[] {
  const proof: Hex[] = [];
  let currentHash = leaf;

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const index = layer.indexOf(currentHash);

    if (index === -1) {
      throw new Error(`Leaf not found in layer ${i}`);
    }

    // Get sibling
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;

    if (siblingIndex < layer.length) {
      proof.push(layer[siblingIndex]);
    }

    // Calculate parent hash
    if (siblingIndex < layer.length) {
      currentHash = hashPair(currentHash, layer[siblingIndex]);
    }
  }

  return proof;
}

// =============================================================================
// ALLOCATION CALCULATION
// =============================================================================

async function calculateAllocations(): Promise<UserAllocation[]> {
  console.log('📊 Fetching user data from database...');

  // Get all eligible users (with wallet and minimum points)
  const eligibleUsers = await db
    .select({
      id: users.id,
      walletAddress: users.walletAddress,
      reputationPoints: users.reputationPoints,
      invitePoints: users.invitePoints,
      earnedPoints: users.earnedPoints,
      bonusPoints: users.bonusPoints,
      referralCount: users.referralCount,
      lifetimePnL: users.lifetimePnL,
      totalDeposited: users.totalDeposited,
    })
    .from(users)
    .where(
      sql`${users.isActor} = false 
          AND ${users.walletAddress} IS NOT NULL 
          AND ${users.reputationPoints} >= 1000`
    );

  console.log(`   Found ${eligibleUsers.length} eligible users`);

  if (eligibleUsers.length === 0) {
    return [];
  }

  // Calculate total points for proportional allocation
  const totalPoints = eligibleUsers.reduce(
    (sum, u) => sum + u.reputationPoints,
    0
  );

  console.log(`   Total points in pool: ${totalPoints.toLocaleString()}`);

  // Calculate allocations
  const airdropPoolWei = tokensToWei(AIRDROP_TOKENS);
  const allocations: UserAllocation[] = [];

  for (const user of eligibleUsers) {
    if (!user.walletAddress) continue;

    // Calculate proportional allocation based on points
    const pointsWeight = user.reputationPoints / totalPoints;

    // Weight factors (simplified - can be expanded)
    const baseAllocation = BigInt(
      Math.floor(Number(airdropPoolWei) * pointsWeight * 0.4)
    );

    // Trading activity bonus (25% weight)
    const tradingVolume = Number(user.totalDeposited ?? 0) * 10;
    const tradingAllocation = BigInt(
      Math.floor(Number(airdropPoolWei) * (tradingVolume / 1_000_000_000) * 0.25)
    );

    // Referral bonus (10% weight)
    const referralAllocation = BigInt(
      Math.floor(
        Number(airdropPoolWei) * ((user.referralCount ?? 0) / 1000) * 0.1
      )
    );

    // Total before bonus
    let totalAllocation = baseAllocation + tradingAllocation + referralAllocation;

    // Cap at maximum per user (1% of pool)
    const maxAllocation = airdropPoolWei / 100n;
    if (totalAllocation > maxAllocation) {
      totalAllocation = maxAllocation;
    }

    // Minimum allocation (0.001% of pool)
    const minAllocation = airdropPoolWei / 100000n;
    if (totalAllocation < minAllocation) {
      totalAllocation = minAllocation;
    }

    // TODO: Check ELIZA token holdings
    const isElizaHolder = false;
    const bonusMultiplier = isElizaHolder ? ELIZA_HOLDER_BONUS_MULTIPLIER : 100;

    // Apply bonus
    const finalAllocation = (totalAllocation * BigInt(bonusMultiplier)) / 100n;

    allocations.push({
      address: user.walletAddress as Address,
      allocation: finalAllocation,
      bonusMultiplier,
      pointsBalance: user.reputationPoints,
      tradingVolume,
      referralCount: user.referralCount ?? 0,
    });
  }

  // Sort by allocation descending
  allocations.sort((a, b) =>
    a.allocation > b.allocation ? -1 : a.allocation < b.allocation ? 1 : 0
  );

  return allocations;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const outputPath = args.includes('--output')
    ? args[args.indexOf('--output') + 1]
    : 'merkle.json';

  console.log('═'.repeat(60));
  console.log('🌳 BBLN AIRDROP MERKLE TREE GENERATOR');
  console.log('═'.repeat(60));

  // Calculate allocations
  const allocations = await calculateAllocations();

  if (allocations.length === 0) {
    console.log('\n⚠️  No eligible users found. Creating empty Merkle tree.');
    const output: MerkleTreeOutput = {
      root: '0x' + '0'.repeat(64) as Hex,
      totalAllocations: '0',
      totalUsers: 0,
      generatedAt: new Date().toISOString(),
      proofs: [],
    };
    await Bun.write(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n📄 Output saved to: ${outputPath}`);
    return;
  }

  console.log(`\n📊 Allocation Summary:`);
  console.log(`   Total users: ${allocations.length}`);

  const totalAllocation = allocations.reduce(
    (sum, a) => sum + a.allocation,
    0n
  );
  console.log(
    `   Total allocated: ${(Number(totalAllocation) / 1e18).toLocaleString()} BBLN`
  );
  console.log(
    `   Top allocation: ${(Number(allocations[0].allocation) / 1e18).toLocaleString()} BBLN`
  );

  // Build Merkle tree
  console.log('\n🌳 Building Merkle tree...');

  const leaves = allocations.map((a) =>
    hashLeaf(a.address, a.allocation, a.bonusMultiplier)
  );

  const { root, layers } = buildMerkleTree(leaves);

  console.log(`   Merkle root: ${root}`);

  // Generate proofs for each user
  console.log('\n📝 Generating proofs...');

  const proofs: MerkleProof[] = allocations.map((a, i) => {
    const leaf = leaves[i];
    const proof = getProof(leaf, layers);

    return {
      address: a.address,
      allocation: a.allocation.toString(),
      bonusMultiplier: a.bonusMultiplier,
      proof,
      leaf,
    };
  });

  // Create output
  const output: MerkleTreeOutput = {
    root,
    totalAllocations: totalAllocation.toString(),
    totalUsers: allocations.length,
    generatedAt: new Date().toISOString(),
    proofs,
  };

  // Write output
  await Bun.write(outputPath, JSON.stringify(output, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('✅ MERKLE TREE GENERATED');
  console.log('═'.repeat(60));
  console.log(`\nMerkle Root: ${root}`);
  console.log(`Total Users: ${allocations.length}`);
  console.log(`Total Allocated: ${(Number(totalAllocation) / 1e18).toLocaleString()} BBLN`);
  console.log(`Output File: ${outputPath}`);
  console.log('\n');
}

main().catch((error) => {
  console.error('Failed to generate Merkle tree:', error);
  process.exit(1);
});
