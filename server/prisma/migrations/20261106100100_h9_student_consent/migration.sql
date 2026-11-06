-- H9: consent with the version of the text, date and author, plus the student's
-- creation date. The old boolean is replaced by consent_version IS NOT NULL.

ALTER TABLE "students"
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ADD COLUMN "consent_version" TEXT,
  ADD COLUMN "consent_at" TIMESTAMPTZ(6),
  ADD COLUMN "consent_by" UUID;

-- The registration date is the first "student.created" audit event when there
-- is one; students older than the audit trail get the migration date.
UPDATE "students" AS s
SET "created_at" = COALESCE(
  (SELECT MIN(e."fecha") FROM "event_log" e
    WHERE e."tipo" = 'student.created' AND e."detalle" ->> 'studentId' = s."id"::text),
  now()
);

-- Students already in the database are treated as having given consent: they
-- get the current text version, their registration date and no author. Students
-- with consentimiento = false stay without consent.
UPDATE "students"
SET "consent_version" = 'v1-provisional', "consent_at" = "created_at"
WHERE "consentimiento";

ALTER TABLE "students" DROP COLUMN "consentimiento";

ALTER TABLE "students" ADD CONSTRAINT "students_consent_by_fkey" FOREIGN KEY ("consent_by")
  REFERENCES "panel_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
