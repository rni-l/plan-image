CREATE TABLE `auth_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
