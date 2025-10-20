CREATE TABLE `airdrop_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`airdrop_id` integer NOT NULL,
	`username` text NOT NULL,
	`wallet_address` text NOT NULL,
	`amount` text NOT NULL,
	`shares` text NOT NULL,
	`claimed` integer DEFAULT 0 NOT NULL,
	`claimed_at` text,
	`tx_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`airdrop_id`) REFERENCES `airdrops`(`airdrop_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_airdrop_claims_airdrop` ON `airdrop_claims` (`airdrop_id`);--> statement-breakpoint
CREATE INDEX `idx_airdrop_claims_username` ON `airdrop_claims` (`username`);--> statement-breakpoint
CREATE INDEX `idx_airdrop_claims_wallet` ON `airdrop_claims` (`wallet_address`);--> statement-breakpoint
CREATE INDEX `idx_airdrop_claims_claimed` ON `airdrop_claims` (`claimed`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_airdrop_claims_unique` ON `airdrop_claims` (`airdrop_id`,`username`);--> statement-breakpoint
CREATE TABLE `airdrops` (
	`airdrop_id` integer PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`token_address` text NOT NULL,
	`token_symbol` text,
	`token_decimals` integer DEFAULT 18,
	`total_amount` text NOT NULL,
	`creator_address` text NOT NULL,
	`contributor_count` integer NOT NULL,
	`claimed_count` integer DEFAULT 0 NOT NULL,
	`claimed_amount` text DEFAULT '0' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`tx_hash` text,
	`cancelled_at` text,
	`cancel_tx_hash` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `contributor_snapshots`(`snapshot_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_airdrops_snapshot` ON `airdrops` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_airdrops_token` ON `airdrops` (`token_address`);--> statement-breakpoint
CREATE INDEX `idx_airdrops_creator` ON `airdrops` (`creator_address`);--> statement-breakpoint
CREATE INDEX `idx_airdrops_active` ON `airdrops` (`active`);--> statement-breakpoint
CREATE INDEX `idx_airdrops_created_at` ON `airdrops` (`created_at`);--> statement-breakpoint
CREATE TABLE `contributor_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`username` text NOT NULL,
	`wallet_address` text,
	`score` real NOT NULL,
	`shares` text NOT NULL,
	`percentage` real NOT NULL,
	`rank` integer NOT NULL,
	`estimated_reward` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `contributor_snapshots`(`snapshot_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contributor_allocations_snapshot` ON `contributor_allocations` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_contributor_allocations_username` ON `contributor_allocations` (`username`);--> statement-breakpoint
CREATE INDEX `idx_contributor_allocations_wallet` ON `contributor_allocations` (`wallet_address`);--> statement-breakpoint
CREATE INDEX `idx_contributor_allocations_rank` ON `contributor_allocations` (`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contributor_allocations_unique` ON `contributor_allocations` (`snapshot_id`,`username`);--> statement-breakpoint
CREATE TABLE `contributor_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`period` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`total_pool` text NOT NULL,
	`total_shares` text NOT NULL,
	`contributor_count` integer NOT NULL,
	`submitted_to_chain` integer DEFAULT 0 NOT NULL,
	`tx_hash` text,
	`finalized_tx_hash` text,
	`merkle_root` text,
	`ipfs_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`submitted_at` text,
	`finalized_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_contributor_snapshots_period` ON `contributor_snapshots` (`period`);--> statement-breakpoint
CREATE INDEX `idx_contributor_snapshots_submitted` ON `contributor_snapshots` (`submitted_to_chain`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contributor_snapshots_period_unique` ON `contributor_snapshots` (`period`);