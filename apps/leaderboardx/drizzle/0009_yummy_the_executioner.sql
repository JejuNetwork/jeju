-- Add NOT NULL columns with empty string defaults
ALTER TABLE `repositories` ADD `owner` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `repositories` ADD `name` text NOT NULL DEFAULT '';--> statement-breakpoint

-- Back-fill existing rows from repo_id (format: "owner/name")
UPDATE `repositories` 
SET `owner` = substr(`repo_id`, 1, instr(`repo_id`, '/') - 1),
    `name` = substr(`repo_id`, instr(`repo_id`, '/') + 1);--> statement-breakpoint

-- Create the unique index on owner and name
CREATE UNIQUE INDEX `unq_repo_owner_name` ON `repositories` (`owner`,`name`);