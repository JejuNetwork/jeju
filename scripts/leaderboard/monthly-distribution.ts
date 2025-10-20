#!/usr/bin/env bun

/**
 * Monthly Distribution Script
 * 
 * Generates monthly contributor snapshot and submits to blockchain.
 * Run this script at the end of each month to trigger distribution.
 * 
 * Usage:
 *   bun run scripts/leaderboard/monthly-distribution.ts
 *   bun run scripts/leaderboard/monthly-distribution.ts --dry-run
 *   bun run scripts/leaderboard/monthly-distribution.ts --period 2024-12
 */

import { Command } from "commander";
import { generateMonthlySnapshot } from "../../apps/leaderboard/src/lib/blockchain/snapshotGenerator";
import { createBlockchainClientFromEnv } from "../../apps/leaderboard/src/lib/blockchain/contractClient";
import type { Address } from "viem";
import chalk from "chalk";

const program = new Command();

program
  .name("monthly-distribution")
  .description("Generate and submit monthly contributor snapshot")
  .option("--dry-run", "Generate snapshot without submitting to blockchain")
  .option("--period <YYYY-MM>", "Specific period to process (default: last month)")
  .option("--auto-finalize", "Auto-finalize after dispute period (dangerous!)")
  .parse();

const options = program.opts();

async function main() {
  console.log(chalk.bold.blue("\n📊 Monthly Contributor Distribution\n"));

  // Get current pool balance from contract
  const client = createBlockchainClientFromEnv();
  const poolBalance = await client.getContributorPoolBalance();

  console.log(
    chalk.gray(`Current contributor pool: ${poolBalance.toString()} tokens\n`),
  );

  // Generate snapshot
  console.log(chalk.yellow("Generating snapshot..."));
  const snapshot = await generateMonthlySnapshot(undefined, poolBalance);

  console.log(chalk.green("✅ Snapshot generated:"));
  console.log(chalk.gray(`   ID: ${snapshot.snapshotId}`));
  console.log(chalk.gray(`   Period: ${snapshot.period}`));
  console.log(chalk.gray(`   Contributors: ${snapshot.contributors.length}`));
  console.log(
    chalk.gray(`   Total shares: ${snapshot.totalShares.toString()}`),
  );
  console.log(chalk.gray(`   Total pool: ${snapshot.totalPool.toString()}`));

  // Show top 10 contributors
  console.log(chalk.bold("\n🏆 Top 10 Contributors:"));
  for (let i = 0; i < Math.min(10, snapshot.scores.length); i++) {
    const score = snapshot.scores[i];
    const shares = snapshot.shares[i];
    const percentage =
      (Number(shares) / Number(snapshot.totalShares)) * 100;
    console.log(
      chalk.gray(
        `   ${i + 1}. ${score.username}: ${score.weightedScore.toFixed(2)} pts (${percentage.toFixed(2)}%)`,
      ),
    );
  }

  if (options.dryRun) {
    console.log(chalk.yellow("\n🏁 Dry run complete - no blockchain submission"));
    return;
  }

  // Submit to blockchain
  console.log(chalk.yellow("\n📤 Submitting to blockchain..."));

  const contributors = snapshot.walletAddresses.map((addr) => addr as Address);
  const shares = snapshot.shares;

  const txHash = await client.submitMonthlySnapshot(
    snapshot.period,
    contributors,
    shares,
  );

  console.log(chalk.green("✅ Submitted to blockchain"));
  console.log(chalk.gray(`   Transaction: ${txHash}`));

  // Wait for confirmation
  console.log(chalk.yellow("\n⏳ Waiting for confirmation..."));
  await client.waitForTransaction(txHash, 2);

  console.log(chalk.green("✅ Transaction confirmed!"));

  // Show next steps
  console.log(chalk.bold.yellow("\n⏰ Next Steps:"));
  console.log(
    chalk.gray(
      `   1. Wait 48 hours for dispute period`,
    ),
  );
  console.log(
    chalk.gray(
      `   2. Run finalization: bun run scripts/leaderboard/finalize-snapshot.ts --period ${snapshot.period}`,
    ),
  );
  console.log(
    chalk.gray(
      `   3. Contributors can claim rewards`,
    ),
  );

  console.log(chalk.bold.green("\n✅ Monthly distribution complete!\n"));
}

main().catch((error) => {
  console.error(chalk.red("\n❌ Error:"), error);
  process.exit(1);
});


