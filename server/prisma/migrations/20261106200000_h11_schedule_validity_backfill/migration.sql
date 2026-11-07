-- H10 defect: deactivating a student did not close their validity intervals in
-- "schedule_students", so the reports kept counting absences for occurrences
-- after the deactivation. Data only, no schema change. Idempotent: it only
-- touches rows with "valid_to" IS NULL, so a second run changes nothing.
--
-- The closing instant is the first 'student.deactivated' event of the event
-- log (never earlier than the interval start). Inactive students WITHOUT such
-- event (deactivated before the event log existed) are NOT touched: closing
-- their intervals would invent evidence. They are counted in a NOTICE; the
-- runbook gives the query to decide by hand.

UPDATE "schedule_students" AS ss
SET "valid_to" = GREATEST(ev."first_at", ss."valid_from")
FROM "students" AS s,
     LATERAL (
       SELECT MIN(e."fecha") AS "first_at"
         FROM "event_log" e
        WHERE e."tipo" = 'student.deactivated'
          AND e."detalle" ->> 'studentId' = s."id"::text
     ) AS ev
WHERE ss."student_id" = s."id"
  AND NOT s."activo"
  AND ss."valid_to" IS NULL
  AND ev."first_at" IS NOT NULL;

DO $$
DECLARE
  orphans integer;
BEGIN
  SELECT COUNT(DISTINCT s."id") INTO orphans
    FROM "students" s
    JOIN "schedule_students" ss ON ss."student_id" = s."id" AND ss."valid_to" IS NULL
   WHERE NOT s."activo";
  IF orphans > 0 THEN
    RAISE NOTICE 'H11: % inactive student(s) keep an open schedule interval and have no student.deactivated event; review them by hand (see docs/runbook.md)', orphans;
  END IF;
END $$;
