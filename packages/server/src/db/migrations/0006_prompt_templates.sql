CREATE TABLE `prompt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('design_plan', 'image_generation')),
	`name` text NOT NULL,
	`description` text,
	`body` text NOT NULL,
	`is_built_in` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `plan_default_template_id` text REFERENCES `prompt_templates`(`id`);
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `image_default_template_id` text REFERENCES `prompt_templates`(`id`);
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `latest_plan_prompt_snapshot` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `draft_selected_direction_id` text;
--> statement-breakpoint
ALTER TABLE `image_items` ADD `prompt_template_id` text REFERENCES `prompt_templates`(`id`);
--> statement-breakpoint
ALTER TABLE `image_versions` ADD `prompt_template_id` text REFERENCES `prompt_templates`(`id`);
--> statement-breakpoint
ALTER TABLE `image_versions` ADD `final_prompt` text;
--> statement-breakpoint
ALTER TABLE `image_versions` ADD `polish_instruction` text;
--> statement-breakpoint
UPDATE `generation_tasks`
SET `draft_selected_direction_id` = (
	SELECT `selected_direction_id`
	FROM `design_plan_versions`
	WHERE `design_plan_versions`.`generation_task_id` = `generation_tasks`.`id`
	  AND `design_plan_versions`.`selected_direction_id` IS NOT NULL
	ORDER BY `design_plan_versions`.`version_number` DESC
	LIMIT 1
)
WHERE `draft_selected_direction_id` IS NULL;
--> statement-breakpoint
UPDATE `image_versions`
SET `final_prompt` = (
	SELECT `request_prompt`
	FROM `model_call_logs`
	WHERE `model_call_logs`.`job_id` = `image_versions`.`job_id`
	  AND `model_call_logs`.`request_prompt` IS NOT NULL
	ORDER BY `model_call_logs`.`created_at` DESC
	LIMIT 1
)
WHERE `final_prompt` IS NULL AND `job_id` IS NOT NULL;
