-- Optional contact data of the student (Ley 1581: minimisation, both nullable).
ALTER TABLE "students" ADD COLUMN "correo" TEXT,
ADD COLUMN "telefono" TEXT;
