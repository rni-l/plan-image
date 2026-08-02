-- Track input/output image counts in model_call_logs for per-image billing
-- null = not an image-generation call (text/vision models)
ALTER TABLE `model_call_logs` ADD `input_image_count` integer;
--> statement-breakpoint
ALTER TABLE `model_call_logs` ADD `output_image_count` integer;
