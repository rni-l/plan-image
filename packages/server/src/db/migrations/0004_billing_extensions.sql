-- Add billing_model_id to model_scene_routes
-- Allows the request model (e.g. Volcengine endpoint ID) to differ from the billing model name
ALTER TABLE `model_scene_routes` ADD `billing_model_id` text;
--> statement-breakpoint

-- Extend model_pricing with cache pricing, per-input-image pricing, and currency
ALTER TABLE `model_pricing` ADD `currency` text NOT NULL DEFAULT 'USD';
--> statement-breakpoint
ALTER TABLE `model_pricing` ADD `price_per_m_cached_input_tokens` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `model_pricing` ADD `price_per_input_image` real NOT NULL DEFAULT 0;
