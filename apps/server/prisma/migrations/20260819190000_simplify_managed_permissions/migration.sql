-- Audit and system access are super-admin capabilities, not managed RBAC permissions.
DELETE rp
FROM `role_permissions` rp
INNER JOIN `permissions` p ON p.`id` = rp.`permission_id`
INNER JOIN `resources` r ON r.`id` = p.`resource_id`
WHERE r.`module` IN ('audit', 'system');

DELETE p
FROM `permissions` p
INNER JOIN `resources` r ON r.`id` = p.`resource_id`
WHERE r.`module` IN ('audit', 'system');

DELETE FROM `resources` WHERE `module` IN ('audit', 'system');
