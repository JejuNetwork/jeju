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
CREATE UNIQUE INDEX `idx_repo_summaries_unique_combo` ON `repo_summaries` (`repo_id`,`interval_type`,`date`);