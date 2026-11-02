-- Additive: FIFO order for replaying pending commands after a reconnection.
-- Existing rows get the migration timestamp; no row is changed or removed.
ALTER TABLE "device_commands"
ADD COLUMN "creada" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
