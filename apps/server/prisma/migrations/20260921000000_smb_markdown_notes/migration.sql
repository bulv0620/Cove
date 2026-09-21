-- Notes keeps no Markdown bodies in MySQL; this table only records in-flight
-- SMB write operations so interrupted commits can be reconciled or proven safe.
CREATE TABLE `note_write_operations` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `binding_version` CHAR(36) NOT NULL,
    `config_fingerprint` CHAR(64) NOT NULL,
    `auth_version` INTEGER NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `relative_path` TEXT NOT NULL,
    `temp_path` TEXT NOT NULL,
    `source_object_id` VARCHAR(64) NULL,
    `source_modified_at` DATETIME(3) NULL,
    `source_size_bytes` BIGINT NOT NULL DEFAULT 0,
    `source_sha256` CHAR(64) NULL,
    `target_object_id` VARCHAR(64) NULL,
    `target_sha256` CHAR(64) NULL,
    `target_size_bytes` BIGINT NOT NULL DEFAULT 0,
    `target_modified_at` DATETIME(3) NULL,
    `target_modified_raw` VARCHAR(64) NULL,
    `state` VARCHAR(32) NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `cleanup_pending` BOOLEAN NOT NULL DEFAULT false,
    `lease_expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `note_write_operations_request_key`(`user_id`, `binding_version`, `request_id`),
    INDEX `note_write_operations_state_lease_expires_at_idx`(`state`, `lease_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `note_write_operations`
    ADD CONSTRAINT `note_write_operations_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
