DROP INDEX `projects_code_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_unique` ON `projects` (lower("code"));