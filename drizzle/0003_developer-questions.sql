CREATE TABLE `developer_question_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`message_id` integer,
	`uploaded_by_id` integer NOT NULL,
	`storage_name` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `developer_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `developer_question_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "developer_question_attachments_size_check" CHECK("developer_question_attachments"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `developer_question_attachments_storage_name_unique` ON `developer_question_attachments` (`storage_name`);--> statement-breakpoint
CREATE INDEX `developer_question_attachments_question_id_idx` ON `developer_question_attachments` (`question_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `developer_question_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`actor_id` integer,
	`event_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `developer_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "developer_question_events_type_check" CHECK("developer_question_events"."event_type" in ('QUESTION_CREATED', 'DEVELOPER_FOLLOWED_UP', 'CUSTOMER_REPLIED', 'MARKED_SEEN'))
);
--> statement-breakpoint
CREATE INDEX `developer_question_events_question_id_idx` ON `developer_question_events` (`question_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `developer_question_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`author_role` text NOT NULL,
	`content` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `developer_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "developer_question_messages_author_role_check" CHECK("developer_question_messages"."author_role" in ('CUSTOMER', 'DEVELOPER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `developer_question_messages_author_idempotency_unique` ON `developer_question_messages` (`author_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `developer_question_messages_question_id_idx` ON `developer_question_messages` (`question_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `developer_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`created_by_id` integer NOT NULL,
	`content` text NOT NULL,
	`attention_status` text DEFAULT 'WAITING_CUSTOMER' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`create_payload_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "developer_questions_attention_check" CHECK("developer_questions"."attention_status" in ('WAITING_CUSTOMER', 'WAITING_DEVELOPER', 'SEEN')),
	CONSTRAINT "developer_questions_version_check" CHECK("developer_questions"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `developer_questions_creator_idempotency_unique` ON `developer_questions` (`created_by_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `developer_questions_project_id_idx` ON `developer_questions` (`project_id`);--> statement-breakpoint
CREATE INDEX `developer_questions_attention_updated_idx` ON `developer_questions` (`attention_status`,`updated_at`,`id`);