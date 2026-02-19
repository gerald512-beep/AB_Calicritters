-- CreateEnum
CREATE TYPE "experiment_status" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'ENDED');

-- CreateTable
CREATE TABLE "experiments" (
    "experiment_id" TEXT NOT NULL,
    "status" "experiment_status" NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "targeting" JSONB,
    "config_schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("experiment_id")
);

-- CreateTable
CREATE TABLE "experiment_variants" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "variant_name" TEXT NOT NULL,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    "weight" DOUBLE PRECISION NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "anonymous_user_id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignment_version" INTEGER NOT NULL DEFAULT 1,
    "context" JSONB,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experiment_variants_experiment_id_idx" ON "experiment_variants"("experiment_id");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_variant_unique" ON "experiment_variants"("experiment_id", "variant_id");

-- CreateIndex
CREATE INDEX "assignments_anonymous_user_id_idx" ON "assignments"("anonymous_user_id");

-- CreateIndex
CREATE INDEX "assignments_experiment_id_idx" ON "assignments"("experiment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_user_experiment_unique" ON "assignments"("anonymous_user_id", "experiment_id");

-- AddForeignKey
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("experiment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("experiment_id") ON DELETE CASCADE ON UPDATE CASCADE;
