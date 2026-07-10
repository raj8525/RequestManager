CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`uploaded_by_id` integer NOT NULL,
	`storage_name` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachments_size_bytes_check" CHECK("attachments"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_storage_name_unique` ON `attachments` (`storage_name`);--> statement-breakpoint
CREATE INDEX `attachments_request_id_idx` ON `attachments` (`request_id`);--> statement-breakpoint
CREATE TABLE `auth_throttle` (
	`normalized_username` text NOT NULL,
	`source_hash` text NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`normalized_username`, `source_hash`),
	CONSTRAINT "auth_throttle_failure_count_check" CHECK("auth_throttle"."failure_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `clarification_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`author_role` text NOT NULL,
	`content` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clarification_messages_author_role_check" CHECK("clarification_messages"."author_role" in ('CUSTOMER', 'DEVELOPER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clarification_messages_author_idempotency_unique` ON `clarification_messages` (`author_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `clarification_messages_request_id_idx` ON `clarification_messages` (`request_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `private_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`developer_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`developer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_notes_request_developer_unique` ON `private_notes` (`request_id`,`developer_id`);--> statement-breakpoint
CREATE INDEX `private_notes_developer_id_idx` ON `private_notes` (`developer_id`);--> statement-breakpoint
CREATE TABLE `project_memberships` (
	`customer_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`customer_id`, `project_id`),
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_memberships_project_id_idx` ON `project_memberships` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_unique` ON `projects` (`code`);--> statement-breakpoint
CREATE TABLE `public_remarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`content` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_remarks_author_idempotency_unique` ON `public_remarks` (`author_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `public_remarks_request_id_idx` ON `public_remarks` (`request_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `request_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`actor_id` integer,
	`event_type` text NOT NULL,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "request_events_type_check" CHECK("request_events"."event_type" in ('REQUEST_CREATED', 'REQUEST_UPDATED', 'PROGRESS_CHANGED', 'REQUEST_PAUSED', 'REQUEST_RESUMED', 'REQUEST_ARCHIVED', 'REQUEST_RESTORED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED', 'PUBLIC_REMARK_ADDED', 'CLARIFICATION_ASKED', 'CLARIFICATION_REPLIED')),
	CONSTRAINT "request_events_visibility_check" CHECK("request_events"."visibility" in ('PUBLIC', 'DEVELOPER'))
);
--> statement-breakpoint
CREATE INDEX `request_events_request_id_idx` ON `request_events` (`request_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`created_by_id` integer NOT NULL,
	`content` text NOT NULL,
	`request_type` text NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`progress_status` text DEFAULT 'UNSCHEDULED' NOT NULL,
	`record_status` text DEFAULT 'ACTIVE' NOT NULL,
	`needs_customer_reply` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "requests_type_check" CHECK("requests"."request_type" in ('BUG', 'CHANGE', 'NEW_FEATURE')),
	CONSTRAINT "requests_priority_check" CHECK("requests"."priority" in ('URGENT', 'IMPORTANT', 'NORMAL')),
	CONSTRAINT "requests_progress_status_check" CHECK("requests"."progress_status" in ('UNSCHEDULED', 'SCHEDULED', 'COMPLETED')),
	CONSTRAINT "requests_record_status_check" CHECK("requests"."record_status" in ('ACTIVE', 'PAUSED', 'ARCHIVED')),
	CONSTRAINT "requests_version_check" CHECK("requests"."version" >= 1),
	CONSTRAINT "requests_paused_state_check" CHECK("requests"."record_status" <> 'PAUSED' or "requests"."progress_status" = 'SCHEDULED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_creator_idempotency_unique` ON `requests` (`created_by_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `requests_project_id_idx` ON `requests` (`project_id`);--> statement-breakpoint
CREATE INDEX `requests_created_by_id_idx` ON `requests` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `requests_updated_at_idx` ON `requests` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('CUSTOMER', 'DEVELOPER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (lower("username"));
