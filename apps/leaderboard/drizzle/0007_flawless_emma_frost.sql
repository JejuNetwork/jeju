PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_daily_scores` (
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
INSERT INTO `__new_user_daily_scores`("id", "username", "date", "timestamp", "score", "pr_score", "issue_score", "review_score", "comment_score", "metrics", "category", "last_updated") SELECT "id", "username", "date", "timestamp", "score", "pr_score", "issue_score", "review_score", "comment_score", "metrics", "category", "last_updated" FROM `user_daily_scores`;--> statement-breakpoint
DROP TABLE `user_daily_scores`;--> statement-breakpoint
ALTER TABLE `__new_user_daily_scores` RENAME TO `user_daily_scores`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_username` ON `user_daily_scores` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_date` ON `user_daily_scores` (`date`);--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_category` ON `user_daily_scores` (`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_daily_scores_username_date_category` ON `user_daily_scores` (`username`,`date`,`category`);--> statement-breakpoint
CREATE INDEX `idx_user_daily_scores_username_date` ON `user_daily_scores` (`username`,`date`);