-- Resource entities: permissions are grouped under resources (资源 → 角色 → 用户).
-- The resources table becomes the single source of truth for module/resource.

CREATE TABLE IF NOT EXISTS `resources` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(128) NOT NULL,
    `module` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `icon` VARCHAR(64) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `resources_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Backfill one row per distinct (module, resource) pair from ACTIVE permissions.
-- Placeholder names; the RBAC seed refreshes name/description/icon/sort_order by code.
INSERT INTO `resources` (`id`, `code`, `module`, `name`, `sort_order`, `created_at`, `updated_at`)
SELECT UUID(), CONCAT(`module`, '.', `resource`), `module`, `resource`, 10, NOW(3), NOW(3)
FROM `permissions`
WHERE `status` = 'ACTIVE'
GROUP BY `module`, `resource`;

-- Link permissions to their resource. DISABLED rows match too because their
-- module/resource columns map to the same resources (e.g. audit.read -> audit.log).
ALTER TABLE `permissions`
    ADD COLUMN `resource_id` CHAR(36) NULL;

UPDATE `permissions` p
INNER JOIN `resources` r ON r.`code` = CONCAT(p.`module`, '.', p.`resource`)
SET p.`resource_id` = r.`id`;

-- Fails loudly if any row could not be matched.
ALTER TABLE `permissions`
    MODIFY COLUMN `resource_id` CHAR(36) NOT NULL;

ALTER TABLE `permissions`
    ADD CONSTRAINT `permissions_resource_id_fkey`
    FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX `permissions_resource_id_idx`
    ON `permissions`(`resource_id`);

-- The old string columns are replaced by the relation.
ALTER TABLE `permissions`
    DROP COLUMN `module`,
    DROP COLUMN `resource`;
