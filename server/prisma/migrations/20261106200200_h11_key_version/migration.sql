-- Version of the encryption key of each template (H11). Existing templates
-- were sealed with the only key there was: version 1; nothing is rewritten.
ALTER TABLE "fingerprints" ADD COLUMN "key_version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "fingerprints_key_version_idx" ON "fingerprints"("key_version");
