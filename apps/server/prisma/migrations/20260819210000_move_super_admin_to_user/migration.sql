-- Super administrator is a platform identity, not a configurable role.
ALTER TABLE `users`
    ADD COLUMN `is_super_admin` BOOLEAN NOT NULL DEFAULT false;

-- Preserve exactly one legacy super administrator, preferring the earliest user id.
SET @platform_super_admin_id = (
    SELECT MIN(ra.`user_id`)
    FROM `role_assignments` ra
    INNER JOIN `roles` r ON r.`id` = ra.`role_id`
    WHERE r.`code` = 'super_admin' OR r.`is_super_admin` = true
);

UPDATE `users`
SET `is_super_admin` = IF(
        @platform_super_admin_id IS NOT NULL AND `id` = @platform_super_admin_id,
        true,
        false
    ),
    `auth_version` = `auth_version` + 1;

-- Legacy built-in roles are removed; custom roles are preserved.
DELETE FROM `roles` WHERE `code` IN ('super_admin', 'viewer');

ALTER TABLE `roles`
    DROP COLUMN `is_super_admin`;
