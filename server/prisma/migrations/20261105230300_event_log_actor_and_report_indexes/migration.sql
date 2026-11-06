-- Who originated each audited event.
CREATE TYPE "actor_type" AS ENUM ('user', 'system', 'device');

ALTER TABLE "event_log"
  ADD COLUMN "actor_type" "actor_type" NOT NULL DEFAULT 'system',
  ADD COLUMN "actor_id" TEXT;

-- Indexes for the future reports (sessions by date, student and occurrence).
CREATE INDEX "attendance_sessions_entrada_idx" ON "attendance_sessions" ("entrada");
CREATE INDEX "attendance_sessions_student_id_entrada_idx"
  ON "attendance_sessions" ("student_id", "entrada");
CREATE INDEX "schedule_instances_fecha_idx" ON "schedule_instances" ("fecha");

-- Covered by the composite index above.
DROP INDEX "attendance_sessions_student_id_idx";
