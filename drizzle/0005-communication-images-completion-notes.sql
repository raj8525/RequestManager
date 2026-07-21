ALTER TABLE `public_remarks` ADD `payload_fingerprint` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clarification_messages` ADD `payload_fingerprint` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `public_remark_attachments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `public_remark_id` integer NOT NULL,
  `request_id` integer NOT NULL,
  `uploaded_by_id` integer NOT NULL,
  `storage_name` text NOT NULL,
  `original_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`public_remark_id`) REFERENCES `public_remarks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "public_remark_attachments_size_check" CHECK(`size_bytes` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_remark_attachments_storage_name_unique` ON `public_remark_attachments` (`storage_name`);
--> statement-breakpoint
CREATE INDEX `public_remark_attachments_remark_id_idx` ON `public_remark_attachments` (`public_remark_id`);
--> statement-breakpoint
CREATE INDEX `public_remark_attachments_request_id_idx` ON `public_remark_attachments` (`request_id`);
--> statement-breakpoint
CREATE TABLE `clarification_message_attachments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `message_id` integer NOT NULL,
  `request_id` integer NOT NULL,
  `uploaded_by_id` integer NOT NULL,
  `storage_name` text NOT NULL,
  `original_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`message_id`) REFERENCES `clarification_messages`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "clarification_message_attachments_size_check" CHECK(`size_bytes` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clarification_message_attachments_storage_name_unique` ON `clarification_message_attachments` (`storage_name`);
--> statement-breakpoint
CREATE INDEX `clarification_message_attachments_message_id_idx` ON `clarification_message_attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `clarification_message_attachments_request_id_idx` ON `clarification_message_attachments` (`request_id`);
--> statement-breakpoint
CREATE TABLE `completion_notes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `request_id` integer NOT NULL,
  `content` text DEFAULT '' NOT NULL,
  `updated_by_id` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completion_notes_request_id_unique` ON `completion_notes` (`request_id`);
--> statement-breakpoint
CREATE TABLE `completion_note_attachments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `completion_note_id` integer NOT NULL,
  `request_id` integer NOT NULL,
  `uploaded_by_id` integer NOT NULL,
  `storage_name` text NOT NULL,
  `original_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`completion_note_id`) REFERENCES `completion_notes`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "completion_note_attachments_size_check" CHECK(`size_bytes` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completion_note_attachments_storage_name_unique` ON `completion_note_attachments` (`storage_name`);
--> statement-breakpoint
CREATE INDEX `completion_note_attachments_note_id_idx` ON `completion_note_attachments` (`completion_note_id`);
--> statement-breakpoint
CREATE INDEX `completion_note_attachments_request_id_idx` ON `completion_note_attachments` (`request_id`);
