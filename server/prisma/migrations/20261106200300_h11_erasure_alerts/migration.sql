-- Data erasure (students.anonymized_at) and offline alerts (devices), H11.
ALTER TABLE "students" ADD COLUMN "anonymized_at" TIMESTAMPTZ(6);
ALTER TABLE "devices"
  ADD COLUMN "offline_since" TIMESTAMPTZ(6),
  ADD COLUMN "offline_alerted_at" TIMESTAMPTZ(6);
