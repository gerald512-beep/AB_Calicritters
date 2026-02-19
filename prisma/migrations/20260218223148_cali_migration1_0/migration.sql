/*
  Warnings:

  - Changed the type of `status` on the `experiments` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'ENDED');

-- AlterTable
ALTER TABLE "experiments" DROP COLUMN "status",
ADD COLUMN     "status" "ExperimentStatus" NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropEnum
DROP TYPE "experiment_status";

-- RenameIndex
ALTER INDEX "assignment_user_experiment_unique" RENAME TO "assignments_anonymous_user_id_experiment_id_key";

-- RenameIndex
ALTER INDEX "experiment_variant_unique" RENAME TO "experiment_variants_experiment_id_variant_id_key";
