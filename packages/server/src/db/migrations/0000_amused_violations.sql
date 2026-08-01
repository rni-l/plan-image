CREATE TABLE `analysis_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`competitor_asset_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`input_snapshot` text,
	`error_type` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `competitor_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`file_path` text NOT NULL,
	`checksum` text NOT NULL,
	`original_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_directions` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_task_id` text NOT NULL,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`generation_task_id`) REFERENCES `generation_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_task_id` text NOT NULL,
	`selected_direction_id` text NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`generation_task_id`) REFERENCES `generation_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selected_direction_id`) REFERENCES `design_directions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `generation_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`analysis_version_id` text NOT NULL,
	`output_types` text NOT NULL,
	`config_snapshot` text NOT NULL,
	`current_step` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_version_id`) REFERENCES `analysis_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `image_analysis_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_version_id` text NOT NULL,
	`competitor_asset_id` text NOT NULL,
	`model_output` text NOT NULL,
	`human_override` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`analysis_version_id`) REFERENCES `analysis_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_asset_id`) REFERENCES `competitor_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `image_items` (
	`id` text PRIMARY KEY NOT NULL,
	`design_plan_version_id` text NOT NULL,
	`list_type` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`selling_points` text,
	`suggested_copy` text,
	`composition_intent` text,
	`reference_asset_ids` text,
	`output_preset_snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`design_plan_version_id`) REFERENCES `design_plan_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `image_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`image_item_id` text NOT NULL,
	`file_path` text NOT NULL,
	`checksum` text NOT NULL,
	`generation_type` text NOT NULL,
	`parent_version_id` text,
	`job_id` text,
	`mask_path` text,
	`instruction` text,
	`is_selected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`image_item_id`) REFERENCES `image_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `model_call_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`scene` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`error_type` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `background_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `model_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`is_configured` integer DEFAULT false NOT NULL,
	`key_hint` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_providers_name_unique` ON `model_providers` (`name`);--> statement-breakpoint
CREATE TABLE `model_scene_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`scene` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`parameters` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `model_providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_scene_routes_scene_unique` ON `model_scene_routes` (`scene`);--> statement-breakpoint
CREATE TABLE `output_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`preset_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`format` text DEFAULT 'jpg' NOT NULL,
	`quality` integer DEFAULT 90 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`file_path` text NOT NULL,
	`checksum` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product_specifications` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `selling_points` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`content` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `synthesis_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_version_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_version_id`) REFERENCES `analysis_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `synthesis_reports_analysis_version_id_unique` ON `synthesis_reports` (`analysis_version_id`);