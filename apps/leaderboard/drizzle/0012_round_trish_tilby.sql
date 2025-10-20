ALTER TABLE `repositories` ADD `description` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `stars` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `repositories` ADD `forks` integer DEFAULT 0;