-- Add signature verification columns to wallet_addresses
ALTER TABLE `wallet_addresses` ADD COLUMN `signature` text;
ALTER TABLE `wallet_addresses` ADD COLUMN `signature_message` text;
ALTER TABLE `wallet_addresses` ADD COLUMN `is_verified` integer DEFAULT false;
ALTER TABLE `wallet_addresses` ADD COLUMN `verified_at` text;
--> statement-breakpoint
CREATE INDEX `idx_wallet_addresses_verified` ON `wallet_addresses` (`is_verified`);
--> statement-breakpoint
-- Create reputation attestations table for ERC-8004 integration
CREATE TABLE `reputation_attestations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`wallet_address` text(100) NOT NULL,
	`chain_id` text(100) NOT NULL,
	`total_score` real DEFAULT 0 NOT NULL,
	`pr_score` real DEFAULT 0 NOT NULL,
	`issue_score` real DEFAULT 0 NOT NULL,
	`review_score` real DEFAULT 0 NOT NULL,
	`commit_score` real DEFAULT 0 NOT NULL,
	`merged_pr_count` integer DEFAULT 0 NOT NULL,
	`total_pr_count` integer DEFAULT 0 NOT NULL,
	`total_commits` integer DEFAULT 0 NOT NULL,
	`normalized_score` integer DEFAULT 0 NOT NULL,
	`attestation_hash` text,
	`oracle_signature` text,
	`tx_hash` text,
	`agent_id` integer,
	`validation_request_hash` text,
	`score_calculated_at` text NOT NULL,
	`attested_at` text,
	`submitted_on_chain_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attestations_user_id` ON `reputation_attestations` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_attestations_wallet` ON `reputation_attestations` (`wallet_address`);
--> statement-breakpoint
CREATE INDEX `idx_attestations_agent_id` ON `reputation_attestations` (`agent_id`);
--> statement-breakpoint
CREATE INDEX `idx_attestations_hash` ON `reputation_attestations` (`attestation_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unq_attestation_wallet_chain` ON `reputation_attestations` (`wallet_address`,`chain_id`);
--> statement-breakpoint
-- Create agent identity links table
CREATE TABLE `agent_identity_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`wallet_address` text(100) NOT NULL,
	`chain_id` text(100) NOT NULL,
	`agent_id` integer NOT NULL,
	`registry_address` text(100) NOT NULL,
	`is_verified` integer DEFAULT false,
	`verified_at` text,
	`verification_tx_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_links_user_id` ON `agent_identity_links` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_agent_links_wallet` ON `agent_identity_links` (`wallet_address`);
--> statement-breakpoint
CREATE INDEX `idx_agent_links_agent_id` ON `agent_identity_links` (`agent_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unq_agent_link` ON `agent_identity_links` (`wallet_address`,`chain_id`,`agent_id`);
