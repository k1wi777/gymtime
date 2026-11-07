-- H12: offline mode. Additive: existing rows keep their values.

-- What the reader declared in hello and the last clock check.
ALTER TABLE "devices"
  ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "clock_offset_sec" INTEGER,
  ADD COLUMN "clock_checked_at" TIMESTAMPTZ(6);

-- Alarms sounded by the reader itself never drive the server's siren.
CREATE TYPE "alarm_origin" AS ENUM ('server', 'local');
ALTER TABLE "alarm_events"
  ADD COLUMN "origin" "alarm_origin" NOT NULL DEFAULT 'server',
  ADD COLUMN "device_id" TEXT,
  ADD COLUMN "device_event_id" UUID;
-- Idempotency of local alarms (not expressible in Prisma).
CREATE UNIQUE INDEX "alarm_events_device_event_key"
  ON "alarm_events" ("device_id", "device_event_id")
  WHERE "device_event_id" IS NOT NULL;

-- Rosters the readers decided with: slot -> internal student id, no names.
CREATE TABLE "offline_snapshots" (
  "id" UUID NOT NULL,
  "device_id" TEXT NOT NULL,
  "schedule_id" UUID,
  "roster" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offline_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "offline_snapshots_created_at_idx" ON "offline_snapshots" ("created_at");
ALTER TABLE "offline_snapshots"
  ADD CONSTRAINT "offline_snapshots_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every queued event and what the server did with it. The primary key is the
-- idempotency key of a re-sent event.
CREATE TABLE "offline_events" (
  "device_id" TEXT NOT NULL,
  "id" UUID NOT NULL,
  "seq" INTEGER NOT NULL,
  "ts" TIMESTAMPTZ(6) NOT NULL,
  "type" TEXT NOT NULL,
  "slot" INTEGER,
  "snapshot_id" UUID,
  "batch_id" UUID,
  "student_id" UUID,
  "instance_id" UUID,
  "outcome" TEXT NOT NULL,
  "review_reason" TEXT,
  "session_id" UUID,
  "alarm_event_id" UUID,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_by" UUID,
  "resolved_at" TIMESTAMPTZ(6),
  "resolution" TEXT,
  "resolution_note" TEXT,
  "corrected_ts" TIMESTAMPTZ(6),
  CONSTRAINT "offline_events_pkey" PRIMARY KEY ("device_id", "id"),
  CONSTRAINT "offline_events_outcome_check" CHECK ("outcome" IN
    ('pendiente', 'applied', 'por_revisar', 'aprobado', 'corregido',
     'descartado', 'informativo', 'invalido'))
);
CREATE INDEX "offline_events_outcome_received_at_idx" ON "offline_events" ("outcome", "received_at");
CREATE INDEX "offline_events_student_id_ts_idx" ON "offline_events" ("student_id", "ts");
ALTER TABLE "offline_events"
  ADD CONSTRAINT "offline_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "offline_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "offline_events_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "schedule_instances" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "offline_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "offline_events_alarm_event_id_fkey" FOREIGN KEY ("alarm_event_id") REFERENCES "alarm_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "offline_events_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "panel_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
