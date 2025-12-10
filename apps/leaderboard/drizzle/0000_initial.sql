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
CREATE UNIQUE INDEX `idx_contributor_snapshots_period_unique` ON `contributor_snapshots` (`period`);--> statement-breakpoint
CREATE TABLE `issue_comment_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`user` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `issue_comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_issue_comment_reactions_comment_id` ON `issue_comment_reactions` (`comment_id`);--> statement-breakpoint
CREATE INDEX `idx_issue_comment_reactions_user` ON `issue_comment_reactions` (`user`);--> statement-breakpoint
CREATE INDEX `idx_issue_comment_reactions_content` ON `issue_comment_reactions` (`content`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_issue_comment_reaction_user_content` ON `issue_comment_reactions` (`comment_id`,`user`,`content`);--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`body` text DEFAULT '',
	`created_at` text NOT NULL,
	`updated_at` text,
	`author` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `raw_issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_issue_comments_issue_id` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_issue_comments_author` ON `issue_comments` (`author`);--> statement-breakpoint
CREATE INDEX `idx_issue_comments_author_date` ON `issue_comments` (`author`,`created_at`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`issue_id`, `label_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `raw_issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_issue_labels_issue_id` ON `issue_labels` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_issue_labels_label_id` ON `issue_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `issue_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`user` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `raw_issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_issue_reactions_issue_id` ON `issue_reactions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_issue_reactions_user` ON `issue_reactions` (`user`);--> statement-breakpoint
CREATE INDEX `idx_issue_reactions_content` ON `issue_reactions` (`content`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_issue_reaction_user_content` ON `issue_reactions` (`issue_id`,`user`,`content`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text DEFAULT '',
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_labels_name` ON `labels` (`name`);--> statement-breakpoint
CREATE TABLE `overall_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`interval_type` text DEFAULT 'month' NOT NULL,
	`date` text NOT NULL,
	`summary` text DEFAULT '',
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_overall_summaries_date` ON `overall_summaries` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_overall_summaries_unique_combo` ON `overall_summaries` (`interval_type`,`date`);--> statement-breakpoint
CREATE TABLE `pr_closing_issue_references` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`issue_number` integer NOT NULL,
	`issue_title` text NOT NULL,
	`issue_state` text NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `raw_pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`) REFERENCES `raw_issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pr_closing_issue_refs_pr_id` ON `pr_closing_issue_references` (`pr_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_closing_issue_refs_issue_id` ON `pr_closing_issue_references` (`issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_pr_closing_issue_ref` ON `pr_closing_issue_references` (`pr_id`,`issue_id`);--> statement-breakpoint
CREATE TABLE `pr_comment_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`user` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `pr_comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pr_comment_reactions_comment_id` ON `pr_comment_reactions` (`comment_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_comment_reactions_user` ON `pr_comment_reactions` (`user`);--> statement-breakpoint
CREATE INDEX `idx_pr_comment_reactions_content` ON `pr_comment_reactions` (`content`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_pr_comment_reaction_user_content` ON `pr_comment_reactions` (`comment_id`,`user`,`content`);--> statement-breakpoint
CREATE TABLE `pr_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_id` text NOT NULL,
	`body` text DEFAULT '',
	`created_at` text NOT NULL,
	`updated_at` text,
	`author` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `raw_pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pr_comments_pr_id` ON `pr_comments` (`pr_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_comments_author` ON `pr_comments` (`author`);--> statement-breakpoint
CREATE INDEX `idx_pr_comments_author_date` ON `pr_comments` (`author`,`created_at`);--> statement-breakpoint
CREATE TABLE `pr_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`user` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `raw_pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pr_reactions_pr_id` ON `pr_reactions` (`pr_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_reactions_user` ON `pr_reactions` (`user`);--> statement-breakpoint
CREATE INDEX `idx_pr_reactions_content` ON `pr_reactions` (`content`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_pr_reaction_user_content` ON `pr_reactions` (`pr_id`,`user`,`content`);--> statement-breakpoint
CREATE TABLE `pr_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_id` text NOT NULL,
	`state` text NOT NULL,
	`body` text DEFAULT '',
	`created_at` text NOT NULL,
	`author` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `raw_pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pr_reviews_pr_id` ON `pr_reviews` (`pr_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_reviews_author` ON `pr_reviews` (`author`);--> statement-breakpoint
CREATE INDEX `idx_pr_reviews_author_date` ON `pr_reviews` (`author`,`created_at`);--> statement-breakpoint
CREATE TABLE `pull_request_labels` (
	`pr_id` text NOT NULL,
	`label_id` text NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`pr_id`, `label_id`),
	FOREIGN KEY (`pr_id`) REFERENCES `raw_pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pr_labels_pr_id` ON `pull_request_labels` (`pr_id`);--> statement-breakpoint
CREATE INDEX `idx_pr_labels_label_id` ON `pull_request_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `raw_commit_files` (
	`id` text PRIMARY KEY NOT NULL,
	`sha` text NOT NULL,
	`filename` text NOT NULL,
	`additions` integer DEFAULT 0,
	`deletions` integer DEFAULT 0,
	`changes` integer DEFAULT 0,
	`changeType` text,
	`patch` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`sha`) REFERENCES `raw_commits`(`oid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_raw_commit_files_sha` ON `raw_commit_files` (`sha`);--> statement-breakpoint
CREATE TABLE `raw_commits` (
	`oid` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`message_headline` text,
	`committed_date` text NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`author_date` text NOT NULL,
	`author` text,
	`repository` text NOT NULL,
	`additions` integer DEFAULT 0,
	`deletions` integer DEFAULT 0,
	`changed_files` integer DEFAULT 0,
	`pull_request_id` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`author`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `raw_pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_raw_commits_author` ON `raw_commits` (`author`);--> statement-breakpoint
CREATE INDEX `idx_raw_commits_repo` ON `raw_commits` (`repository`);--> statement-breakpoint
CREATE INDEX `idx_raw_commits_date` ON `raw_commits` (`committed_date`);--> statement-breakpoint
CREATE INDEX `idx_raw_commits_pr_id` ON `raw_commits` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `idx_raw_commits_repo_author_date` ON `raw_commits` (`repository`,`author`,`committed_date`);--> statement-breakpoint
CREATE TABLE `raw_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '',
	`state` text NOT NULL,
	`locked` integer DEFAULT 0,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	`repository` text NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`author`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_raw_issues_author` ON `raw_issues` (`author`);--> statement-breakpoint
CREATE INDEX `idx_raw_issues_repo` ON `raw_issues` (`repository`);--> statement-breakpoint
CREATE INDEX `idx_raw_issues_created_at` ON `raw_issues` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_raw_issues_repo_author_date` ON `raw_issues` (`repository`,`author`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_raw_issues_state` ON `raw_issues` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_issue_repo_number` ON `raw_issues` (`repository`,`number`);--> statement-breakpoint
CREATE TABLE `raw_pr_files` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_id` text NOT NULL,
	`path` text NOT NULL,
	`additions` integer DEFAULT 0,
	`deletions` integer DEFAULT 0,
	`changeType` text,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `raw_pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_raw_pr_files_pr_id` ON `raw_pr_files` (`pr_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_pr_id_path` ON `raw_pr_files` (`pr_id`,`path`);--> statement-breakpoint
CREATE TABLE `raw_pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '',
	`state` text NOT NULL,
	`merged` integer DEFAULT 0 NOT NULL,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	`merged_at` text,
	`repository` text NOT NULL,
	`head_ref_oid` text,
	`base_ref_oid` text,
	`additions` integer DEFAULT 0,
	`deletions` integer DEFAULT 0,
	`changed_files` integer DEFAULT 0,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`author`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_raw_prs_author` ON `raw_pull_requests` (`author`);--> statement-breakpoint
CREATE INDEX `idx_raw_prs_repo` ON `raw_pull_requests` (`repository`);--> statement-breakpoint
CREATE INDEX `idx_raw_prs_created_at` ON `raw_pull_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_raw_prs_repo_author_date` ON `raw_pull_requests` (`repository`,`author`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_raw_prs_state` ON `raw_pull_requests` (`state`);--> statement-breakpoint
CREATE INDEX `idx_raw_prs_merged` ON `raw_pull_requests` (`merged`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_repo_number` ON `raw_pull_requests` (`repository`,`number`);--> statement-breakpoint
CREATE TABLE `repo_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`interval_type` text DEFAULT 'month' NOT NULL,
	`date` text NOT NULL,
	`summary` text DEFAULT '',
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_repo_summaries_repo_id` ON `repo_summaries` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_repo_summaries_date` ON `repo_summaries` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repo_summaries_unique_combo` ON `repo_summaries` (`repo_id`,`interval_type`,`date`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`repo_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`stars` integer DEFAULT 0,
	`forks` integer DEFAULT 0,
	`last_fetched_at` text DEFAULT '',
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unq_repo_owner_name` ON `repositories` (`owner`,`name`);--> statement-breakpoint
CREATE TABLE `tags` (
	`name` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '',
	`weight` real DEFAULT 1 NOT NULL,
	`patterns` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_daily_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`date` text NOT NULL,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`pr_score` real DEFAULT 0,
	`issue_score` real DEFAULT 0,
	`review_score` real DEFAULT 0,
	`comment_score` real DEFAULT 0,
	`metrics` text DEFAULT '{}' NOT NULL,
	`category` text DEFAULT 'day',
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_username` ON `user_daily_scores` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_date` ON `user_daily_scores` (`date`);--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_category` ON `user_daily_scores` (`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_daily_scores_username_date_category` ON `user_daily_scores` (`username`,`date`,`category`);--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_username_date` ON `user_daily_scores` (`username`,`date`);--> statement-breakpoint
CREATE TABLE `user_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text,
	`interval_type` text DEFAULT 'day' NOT NULL,
	`date` text NOT NULL,
	`summary` text DEFAULT '',
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_user_daily_summaries_username` ON `user_summaries` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_daily_summaries_date` ON `user_summaries` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_daily_summaries_unique_combo` ON `user_summaries` (`username`,`interval_type`,`date`);--> statement-breakpoint
CREATE TABLE `user_tag_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`tag` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`points_to_next` real DEFAULT 0 NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag`) REFERENCES `tags`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_user_tag_scores_username` ON `user_tag_scores` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_tag_scores_tag` ON `user_tag_scores` (`tag`);--> statement-breakpoint
CREATE INDEX `idx_user_tag_scores_score` ON `user_tag_scores` (`score`);--> statement-breakpoint
CREATE INDEX `idx_user_tag_scores_username_tag` ON `user_tag_scores` (`username`,`tag`);--> statement-breakpoint
CREATE TABLE `users` (
	`username` text PRIMARY KEY NOT NULL,
	`avatar_url` text DEFAULT '',
	`is_bot` integer DEFAULT 0 NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`wallet_data_updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `wallet_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`chain_id` text(100) NOT NULL,
	`account_address` text(100) NOT NULL,
	`label` text(100),
	`is_primary` integer DEFAULT false,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wallet_addresses_user_id` ON `wallet_addresses` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_wallet_addresses_chain_id` ON `wallet_addresses` (`chain_id`);--> statement-breakpoint
CREATE INDEX `idx_wallet_addresses_address` ON `wallet_addresses` (`account_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `unq_user_chain_primary` ON `wallet_addresses` (`user_id`,`chain_id`) WHERE "wallet_addresses"."is_primary" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `unq_user_chain_address` ON `wallet_addresses` (`user_id`,`chain_id`,`account_address`);