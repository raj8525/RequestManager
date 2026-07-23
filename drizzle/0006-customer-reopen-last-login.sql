ALTER TABLE `users` ADD `last_login_at` integer;
--> statement-breakpoint
ALTER TABLE `clarification_messages` ADD `message_kind` text DEFAULT 'CONVERSATION' NOT NULL CHECK (`message_kind` in ('CONVERSATION', 'REOPEN_REASON'));
