-- User deletion is managed as an explicit page action permission.
INSERT INTO `permissions`
    (`id`, `code`, `action`, `name`, `description`, `type`, `parent_id`, `sort_order`, `status`, `resource_id`)
SELECT
    UUID(),
    'identity.user.delete',
    'delete',
    'Delete users',
    'Permanently delete user accounts.',
    'ACTION',
    page_permission.`id`,
    70,
    'ACTIVE',
    managed_resource.`id`
FROM `resources` managed_resource
INNER JOIN `permissions` page_permission
    ON page_permission.`resource_id` = managed_resource.`id`
    AND page_permission.`code` = 'identity.user.page'
WHERE managed_resource.`code` = 'identity.user'
  AND NOT EXISTS (
      SELECT 1 FROM `permissions` existing_permission
      WHERE existing_permission.`code` = 'identity.user.delete'
  );

-- Keep the stored snapshot consistent even though Administrator resolves permissions dynamically.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `granted_by`)
SELECT administrator_role.`id`, user_delete_permission.`id`, NULL
FROM `roles` administrator_role
INNER JOIN `permissions` user_delete_permission
    ON user_delete_permission.`code` = 'identity.user.delete'
WHERE administrator_role.`code` = 'administrator';
