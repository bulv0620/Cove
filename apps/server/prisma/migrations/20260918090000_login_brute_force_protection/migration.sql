-- Persist login throttling across restarts and coordinate concurrent Server processes.
CREATE TABLE `auth_login_throttles` (
    `scope_type` ENUM('USERNAME', 'IP') NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `failure_count` INTEGER NOT NULL DEFAULT 0,
    `cooldown_level` INTEGER NOT NULL DEFAULT 0,
    `window_started_at` DATETIME(3) NULL,
    `last_failure_at` DATETIME(3) NULL,
    `cooldown_until` DATETIME(3) NULL,
    `blocked_attempts` INTEGER NOT NULL DEFAULT 0,
    `limited_audit_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `auth_login_throttles_last_failure_at_idx`(`last_failure_at`),
    INDEX `auth_login_throttles_cooldown_until_idx`(`cooldown_until`),
    PRIMARY KEY (`scope_type`, `key_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Short leases reserve password-verification capacity without holding a database
-- transaction open while Argon2id runs.
CREATE TABLE `auth_login_verification_reservations` (
    `id` CHAR(36) NOT NULL,
    `username_key_hash` CHAR(64) NOT NULL,
    `ip_key_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `auth_login_res_username_expires_idx`(`username_key_hash`, `expires_at`),
    INDEX `auth_login_res_ip_expires_idx`(`ip_key_hash`, `expires_at`),
    INDEX `auth_login_res_expires_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
