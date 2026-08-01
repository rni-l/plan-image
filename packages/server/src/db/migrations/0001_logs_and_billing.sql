-- Extend model_call_logs with token counts
ALTER TABLE `model_call_logs` ADD `prompt_tokens` integer;
--> statement-breakpoint
ALTER TABLE `model_call_logs` ADD `completion_tokens` integer;
--> statement-breakpoint
ALTER TABLE `model_call_logs` ADD `total_tokens` integer;
--> statement-breakpoint

-- HTTP API request log
CREATE TABLE `api_request_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status_code` integer,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint

-- Per-model pricing configuration
CREATE TABLE `model_pricing` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`price_per_m_input_tokens` real NOT NULL DEFAULT 0,
	`price_per_m_output_tokens` real NOT NULL DEFAULT 0,
	`is_image_model` integer NOT NULL DEFAULT 0,
	`price_per_image` real NOT NULL DEFAULT 0,
	`updated_at` integer NOT NULL,
	UNIQUE(`provider`, `model_id`)
);
