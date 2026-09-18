CREATE TABLE `image_assets` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `binding_version` CHAR(36) NOT NULL,
    `config_fingerprint` CHAR(64) NOT NULL,
    `request_id` CHAR(36) NULL,
    `relative_path` VARCHAR(512) NOT NULL,
    `temp_path` VARCHAR(512) NULL,
    `object_id` VARCHAR(128) NULL,
    `media_type` VARCHAR(64) NULL,
    `extension` VARCHAR(16) NULL,
    `size_bytes` BIGINT NOT NULL DEFAULT 0,
    `sha256` CHAR(64) NULL,
    `state` VARCHAR(32) NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `cleanup_pending` BOOLEAN NOT NULL DEFAULT false,
    `publish_requested` BOOLEAN NOT NULL DEFAULT false,
    `lease_expires_at` DATETIME(3) NULL,
    `source_modified_at` DATETIME(3) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_assets_binding_path_key`(`user_id`, `binding_version`, `relative_path`),
    UNIQUE INDEX `image_assets_request_key`(`user_id`, `binding_version`, `request_id`),
    INDEX `image_assets_user_id_binding_version_state_updated_at_idx`(`user_id`, `binding_version`, `state`, `updated_at`),
    INDEX `image_assets_state_lease_expires_at_idx`(`state`, `lease_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `image_public_grants` (
    `id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `public_id` CHAR(43) NOT NULL,
    `binding_version` CHAR(36) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `image_public_grants_public_id_key`(`public_id`),
    INDEX `image_public_grants_asset_id_revoked_at_idx`(`asset_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `image_public_rate_buckets` (
    `bucket_key` CHAR(64) NOT NULL,
    `minute_start` DATETIME(0) NOT NULL,
    `request_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `image_public_rate_buckets_minute_start_idx`(`minute_start`),
    PRIMARY KEY (`bucket_key`, `minute_start`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `image_assets`
    ADD CONSTRAINT `image_assets_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `image_public_grants`
    ADD CONSTRAINT `image_public_grants_asset_id_fkey`
    FOREIGN KEY (`asset_id`) REFERENCES `image_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
