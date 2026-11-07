-- Own token per device (H11): only the hash is stored. All NULL = the device
-- still uses the shared DEVICE_TOKEN (transition).
ALTER TABLE "devices"
  ADD COLUMN "token_hash" TEXT,
  ADD COLUMN "token_created_at" TIMESTAMPTZ(6),
  ADD COLUMN "token_revoked_at" TIMESTAMPTZ(6);
