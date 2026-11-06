-- Validity intervals for schedule_students: removing a student closes
-- "valid_to" instead of deleting the row.

ALTER TABLE "schedule_students"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "valid_from" TIMESTAMPTZ(6),
  ADD COLUMN "valid_to" TIMESTAMPTZ(6);

-- Existing assignments stay active with a retroactive start: the first day of
-- the schedule's oldest occurrence (Bogota midnight), never later than now,
-- so the past sessions of the iteration 1 remain covered.
UPDATE "schedule_students" AS ss
SET "valid_from" = LEAST(
  COALESCE(
    (SELECT MIN(i."fecha")::timestamp AT TIME ZONE 'America/Bogota'
       FROM "schedule_instances" i
      WHERE i."schedule_id" = ss."schedule_id"),
    now()
  ),
  now()
);

ALTER TABLE "schedule_students" ALTER COLUMN "valid_from" SET NOT NULL;

ALTER TABLE "schedule_students" DROP CONSTRAINT "schedule_students_pkey";
ALTER TABLE "schedule_students" ADD CONSTRAINT "schedule_students_pkey" PRIMARY KEY ("id");

-- At most one open interval per schedule and student (not expressible in Prisma).
CREATE UNIQUE INDEX "schedule_students_one_active"
  ON "schedule_students" ("schedule_id", "student_id") WHERE "valid_to" IS NULL;

-- The student-only index is covered by the composite one.
DROP INDEX "schedule_students_student_id_idx";
CREATE INDEX "schedule_students_schedule_id_valid_to_idx"
  ON "schedule_students" ("schedule_id", "valid_to");
CREATE INDEX "schedule_students_student_id_valid_from_idx"
  ON "schedule_students" ("student_id", "valid_from");
