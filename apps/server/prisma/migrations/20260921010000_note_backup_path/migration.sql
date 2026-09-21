-- The conditional replace swap parks the replaced version in this registered
-- reserved-name sibling so an interrupted commit can be restored by identity.
ALTER TABLE `note_write_operations` ADD COLUMN `backup_path` TEXT NULL;
