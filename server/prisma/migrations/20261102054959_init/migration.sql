-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('pending', 'in_progress', 'done', 'failed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('abierta', 'cerrada', 'no_registrada');

-- CreateEnum
CREATE TYPE "attendance_source" AS ENUM ('device', 'manual');

-- CreateEnum
CREATE TYPE "command_status" AS ENUM ('pending', 'sent', 'acked', 'failed');

-- CreateEnum
CREATE TYPE "alarm_closed_by" AS ENUM ('all_exited', 'button', 'cli', 'timeout');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "programa" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "consentimiento" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fingerprints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "plantilla" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creada" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "nombre" TEXT,
    "ultima_conexion" TIMESTAMPTZ,
    "version_firmware" TEXT,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "estado" "enrollment_status" NOT NULL DEFAULT 'pending',
    "expira" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_slots" (
    "device_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "fingerprint_id" UUID,
    "sync_id" TEXT,

    CONSTRAINT "device_slots_pkey" PRIMARY KEY ("device_id","slot")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "dia_semana" INTEGER,
    "fecha" DATE,
    "inicio" TIME NOT NULL,
    "fin" TIME NOT NULL,
    "margen_ingreso" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_students" (
    "schedule_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,

    CONSTRAINT "schedule_students_pkey" PRIMARY KEY ("schedule_id","student_id")
);

-- CreateTable
CREATE TABLE "schedule_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "inicio" TIMESTAMPTZ NOT NULL,
    "fin" TIMESTAMPTZ NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "schedule_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "entrada" TIMESTAMPTZ NOT NULL,
    "salida" TIMESTAMPTZ,
    "origen_entrada" "attendance_source" NOT NULL,
    "origen_salida" "attendance_source",
    "estado" "session_status" NOT NULL DEFAULT 'abierta',
    "motivo_manual" TEXT,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" "command_status" NOT NULL DEFAULT 'pending',
    "intentos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_messages" (
    "message_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "recibido" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respuesta" JSONB,

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("device_id","message_id")
);

-- CreateTable
CREATE TABLE "alarm_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "instance_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ NOT NULL,
    "fin" TIMESTAMPTZ,
    "cerrada_por" "alarm_closed_by",

    CONSTRAINT "alarm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_log" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "detalle" JSONB,
    "fecha" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_documento_key" ON "students"("documento");

-- CreateIndex
CREATE INDEX "fingerprints_student_id_idx" ON "fingerprints"("student_id");

-- CreateIndex
CREATE INDEX "enrollments_student_id_idx" ON "enrollments"("student_id");

-- CreateIndex
CREATE INDEX "enrollments_device_id_estado_idx" ON "enrollments"("device_id", "estado");

-- CreateIndex
CREATE INDEX "device_slots_fingerprint_id_idx" ON "device_slots"("fingerprint_id");

-- CreateIndex
CREATE INDEX "schedule_students_student_id_idx" ON "schedule_students"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_instances_schedule_id_fecha_key" ON "schedule_instances"("schedule_id", "fecha");

-- CreateIndex
CREATE INDEX "attendance_sessions_instance_id_estado_idx" ON "attendance_sessions"("instance_id", "estado");

-- CreateIndex
CREATE INDEX "attendance_sessions_student_id_idx" ON "attendance_sessions"("student_id");

-- CreateIndex
CREATE INDEX "device_commands_device_id_estado_idx" ON "device_commands"("device_id", "estado");

-- CreateIndex
CREATE INDEX "alarm_events_instance_id_idx" ON "alarm_events"("instance_id");

-- CreateIndex
CREATE INDEX "event_log_fecha_idx" ON "event_log"("fecha");

-- AddForeignKey
ALTER TABLE "fingerprints" ADD CONSTRAINT "fingerprints_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_slots" ADD CONSTRAINT "device_slots_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_slots" ADD CONSTRAINT "device_slots_fingerprint_id_fkey" FOREIGN KEY ("fingerprint_id") REFERENCES "fingerprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_students" ADD CONSTRAINT "schedule_students_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_students" ADD CONSTRAINT "schedule_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_instances" ADD CONSTRAINT "schedule_instances_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "schedule_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "schedule_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (not expressible in Prisma): keep if this migration is regenerated.

-- At most one active fingerprint per student.
CREATE UNIQUE INDEX "fingerprints_one_active_per_student" ON "fingerprints" ("student_id") WHERE "activa";

-- A schedule is either weekly (dia_semana) or one-off (fecha), never both or neither.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_weekday_xor_date"
  CHECK (("dia_semana" IS NULL) <> ("fecha" IS NULL));
