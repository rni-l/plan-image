DROP INDEX `model_scene_routes_scene_unique`;--> statement-breakpoint
ALTER TABLE `model_scene_routes` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `model_scene_routes` SET `is_default` = true WHERE `is_default` = false;--> statement-breakpoint
ALTER TABLE `model_call_logs` ADD `model_route_id` text REFERENCES `model_scene_routes`(`id`);--> statement-breakpoint
CREATE INDEX `model_scene_routes_scene_idx` ON `model_scene_routes` (`scene`);--> statement-breakpoint
CREATE INDEX `model_call_logs_model_route_id_idx` ON `model_call_logs` (`model_route_id`);
