-- CreateTable
CREATE TABLE `smb_bindings` (
    `user_id` CHAR(36) NOT NULL,
    `username` VARCHAR(256) NOT NULL,
    `ciphertext` TEXT NOT NULL,
    `nonce` VARCHAR(32) NOT NULL,
    `auth_tag` VARCHAR(32) NOT NULL,
    `key_id` VARCHAR(32) NOT NULL,
    `version` CHAR(36) NOT NULL,
    `config_fingerprint` CHAR(64) NOT NULL,
    `last_checked_at` DATETIME(3) NOT NULL,
    `last_check_code` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `file_operations` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `binding_version` CHAR(36) NOT NULL,
    `config_fingerprint` CHAR(64) NOT NULL,
    `auth_version` INTEGER NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `relative_path` TEXT NOT NULL,
    `temp_path` TEXT NOT NULL,
    `object_id` VARCHAR(64) NULL,
    `expected_bytes` BIGINT NOT NULL,
    `transferred_bytes` BIGINT NOT NULL DEFAULT 0,
    `state` VARCHAR(32) NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `cleanup_pending` BOOLEAN NOT NULL DEFAULT false,
    `lease_expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `file_operations_state_lease_expires_at_idx`(`state`, `lease_expires_at`),
    UNIQUE INDEX `file_operations_user_id_binding_version_request_id_key`(`user_id`, `binding_version`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `download_tickets` (
    `id` CHAR(36) NOT NULL,
    `secret_hash` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `auth_version` INTEGER NOT NULL,
    `binding_version` CHAR(36) NOT NULL,
    `config_fingerprint` CHAR(64) NOT NULL,
    `relative_path` TEXT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,

    INDEX `download_tickets_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- AddForeignKey
ALTER TABLE `smb_bindings` ADD CONSTRAINT `smb_bindings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_operations` ADD CONSTRAINT `file_operations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_tickets` ADD CONSTRAINT `download_tickets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
