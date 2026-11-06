-- H9: one row per CSV import (counts only) and the link from students.

CREATE TABLE "import_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "archivo" TEXT NOT NULL,
  "user_id" UUID,
  "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "total" INTEGER NOT NULL,
  "validas" INTEGER NOT NULL,
  "con_error" INTEGER NOT NULL,
  CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "panel_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "students" ADD COLUMN "import_batch_id" UUID;
ALTER TABLE "students" ADD CONSTRAINT "students_import_batch_id_fkey" FOREIGN KEY ("import_batch_id")
  REFERENCES "import_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "students_import_batch_id_idx" ON "students" ("import_batch_id");
