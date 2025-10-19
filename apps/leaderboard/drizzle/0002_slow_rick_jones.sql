DROP INDEX `idx_user_daily_summaries_username_date`;--> statement-breakpoint
ALTER TABLE `user_daily_summaries` ADD `interval_type` text DEFAULT 'day' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_daily_summaries_unique_combo` ON `user_daily_summaries` (`username`,`interval_type`,`date`);