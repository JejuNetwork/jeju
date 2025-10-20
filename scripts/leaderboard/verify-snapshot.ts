#!/usr/bin/env bun

/**
 * Snapshot Verification Script
 * 
 * Verifies integrity of a snapshot before submission to blockchain.
 * Checks scores, shares, wallet addresses, and total calculations.
 * 
 * Usage:
 *   bun run scripts/leaderboard/verify-snapshot.ts
 *   bun run scripts/leaderboard/verify-snapshot.ts --period 12
 */

import { Command } from "commander";
import { getLatestSnapshot } from "../../apps/leaderboard/src/lib/blockchain/snapshotGenerator";
import { db } from "../../apps/leaderboard/src/lib/data/db";
import chalk from "chalk";

const program = new Command();

program
  .name("verify-snapshot")
  .description("Verify snapshot integrity before blockchain submission")
  .option("--period <number>", "Specific period to verify")
  .parse();

const options = program.opts();

async function verifySnapshot() {
  console.log(chalk.bold.blue("\n🔍 Snapshot Verification\n"));

  const snapshot = await getLatestSnapshot();

  if (!snapshot) {
    console.log(chalk.red("❌ No snapshot found"));
    process.exit(1);
  }

  console.log(chalk.gray(`Verifying snapshot: ${snapshot.snapshotId}\n`));

  let errors = 0;
  let warnings = 0;

  // Check 1: All contributors have wallet addresses
  console.log(chalk.yellow("Checking wallet addresses..."));
  for (let i = 0; i < snapshot.contributors.length; i++) {
    if (!snapshot.walletAddresses[i] || snapshot.walletAddresses[i] === "") {
      console.log(
        chalk.red(`   ❌ ${snapshot.contributors[i]}: No wallet address`),
      );
      errors++;
    }
  }
  if (errors === 0) {
    console.log(chalk.green(`   ✅ All ${snapshot.contributors.length} contributors have wallets`));
  }

  // Check 2: Shares sum to totalShares
  console.log(chalk.yellow("\nChecking share calculations..."));
  const calculatedTotal = snapshot.shares.reduce((sum, s) => sum + s, 0n);
  if (calculatedTotal !== snapshot.totalShares) {
    console.log(
      chalk.red(
        `   ❌ Share mismatch: ${calculatedTotal} !== ${snapshot.totalShares}`,
      ),
    );
    errors++;
  } else {
    console.log(chalk.green(`   ✅ Total shares correct: ${snapshot.totalShares}`));
  }

  // Check 3: No zero shares
  console.log(chalk.yellow("\nChecking for zero shares..."));
  const zeroShares = snapshot.shares.filter((s) => s === 0n).length;
  if (zeroShares > 0) {
    console.log(
      chalk.orange(`   ⚠️  ${zeroShares} contributors with zero shares (will be filtered)`),
    );
    warnings++;
  } else {
    console.log(chalk.green("   ✅ No zero shares"));
  }

  // Check 4: Reasonable distribution (no one has >50%)
  console.log(chalk.yellow("\nChecking distribution fairness..."));
  for (let i = 0; i < snapshot.shares.length; i++) {
    const percentage =
      (Number(snapshot.shares[i]) / Number(snapshot.totalShares)) * 100;
    if (percentage > 50) {
      console.log(
        chalk.orange(
          `   ⚠️  ${snapshot.contributors[i]}: ${percentage.toFixed(1)}% (>50%)`,
        ),
      );
      warnings++;
    }
  }
  console.log(chalk.green("   ✅ Distribution check complete"));

  // Check 5: Database consistency
  console.log(chalk.yellow("\nChecking database records..."));
  const dbSnapshot = await db.query.contributorSnapshots.findFirst({
    where: (snapshots, { eq }) => eq(snapshots.period, snapshot.period),
    with: {
      allocations: true,
    },
  });

  if (!dbSnapshot) {
    console.log(chalk.red("   ❌ Snapshot not found in database"));
    errors++;
  } else {
    if (dbSnapshot.allocations.length !== snapshot.contributors.length) {
      console.log(
        chalk.red(
          `   ❌ Allocation count mismatch: ${dbSnapshot.allocations.length} !== ${snapshot.contributors.length}`,
        ),
      );
      errors++;
    } else {
      console.log(
        chalk.green(`   ✅ ${dbSnapshot.allocations.length} allocations in database`),
      );
    }
  }

  // Summary
  console.log(chalk.bold("\n📊 Verification Summary:\n"));
  console.log(chalk.gray(`   Period: ${snapshot.period}`));
  console.log(chalk.gray(`   Contributors: ${snapshot.contributors.length}`));
  console.log(chalk.gray(`   Total Pool: ${snapshot.totalPool.toString()}`));
  console.log(chalk.gray(`   Total Shares: ${snapshot.totalShares.toString()}`));
  console.log(chalk.gray(`   Errors: ${errors}`));
  console.log(chalk.gray(`   Warnings: ${warnings}`));

  if (errors > 0) {
    console.log(chalk.bold.red("\n❌ VERIFICATION FAILED - DO NOT SUBMIT\n"));
    process.exit(1);
  } else if (warnings > 0) {
    console.log(chalk.bold.yellow("\n⚠️  VERIFICATION PASSED WITH WARNINGS\n"));
    process.exit(0);
  } else {
    console.log(chalk.bold.green("\n✅ VERIFICATION PASSED - READY TO SUBMIT\n"));
    process.exit(0);
  }
}

main();


