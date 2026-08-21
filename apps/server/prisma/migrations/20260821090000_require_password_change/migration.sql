-- Temporary credentials must be replaced before an account can access protected resources.
ALTER TABLE `users`
    ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false;
