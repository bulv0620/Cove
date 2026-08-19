-- Add page/action semantics and a self-referencing permission hierarchy.
ALTER TABLE `permissions`
    ADD COLUMN `type` ENUM('PAGE', 'ACTION') NOT NULL DEFAULT 'ACTION',
    ADD COLUMN `parent_id` CHAR(36) NULL,
    ADD COLUMN `sort_order` INTEGER NOT NULL DEFAULT 0;

INSERT INTO `permissions`
    (`id`, `code`, `module`, `resource`, `action`, `name`, `description`, `type`, `sort_order`)
VALUES
    ('30000000-0000-7000-8000-000000000001', 'identity.user.page', 'identity', 'user', 'page', 'User management', 'Access the user management page.', 'PAGE', 10),
    ('30000000-0000-7000-8000-000000000002', 'identity.role.page', 'identity', 'role', 'page', 'Role management', 'Access the role management page.', 'PAGE', 20),
    ('30000000-0000-7000-8000-000000000003', 'system.status.page', 'system', 'status', 'page', 'System status', 'Access the system status page.', 'PAGE', 10),
    ('30000000-0000-7000-8000-000000000004', 'audit.log.page', 'audit', 'log', 'page', 'Audit logs', 'Access the audit log page.', 'PAGE', 10);

UPDATE `permissions`
SET `parent_id` = '30000000-0000-7000-8000-000000000001'
WHERE `module` = 'identity' AND `resource` = 'user' AND `type` = 'ACTION';

UPDATE `permissions`
SET `parent_id` = '30000000-0000-7000-8000-000000000002'
WHERE `module` = 'identity' AND `resource` = 'role' AND `type` = 'ACTION';

UPDATE `permissions`
SET `parent_id` = '30000000-0000-7000-8000-000000000003'
WHERE `module` = 'system' AND `resource` = 'status' AND `type` = 'ACTION';

UPDATE `permissions`
SET `parent_id` = '30000000-0000-7000-8000-000000000004'
WHERE `module` = 'audit' AND `resource` = 'log' AND `type` = 'ACTION';

-- Existing roles that can perform an action also gain access to its page.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `granted_by`)
SELECT DISTINCT child_grant.`role_id`, child.`parent_id`, child_grant.`granted_by`
FROM `role_permissions` AS child_grant
INNER JOIN `permissions` AS child ON child.`id` = child_grant.`permission_id`
WHERE child.`parent_id` IS NOT NULL;

-- Page access replaces the old read-only gate for these pages.
UPDATE `permissions`
SET `status` = 'DISABLED', `parent_id` = NULL
WHERE `code` IN ('identity.user.read', 'identity.role.read', 'system.status.read', 'audit.read');

CREATE INDEX `permissions_parent_id_sort_order_idx`
    ON `permissions`(`parent_id`, `sort_order`);

ALTER TABLE `permissions`
    ADD CONSTRAINT `permissions_parent_id_fkey`
    FOREIGN KEY (`parent_id`) REFERENCES `permissions`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
