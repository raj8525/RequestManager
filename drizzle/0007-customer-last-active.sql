ALTER TABLE `users` ADD `last_active_at` integer;
--> statement-breakpoint
UPDATE `users`
SET `last_active_at` = `last_login_at`
WHERE `role` = 'CUSTOMER' AND `last_login_at` IS NOT NULL;
