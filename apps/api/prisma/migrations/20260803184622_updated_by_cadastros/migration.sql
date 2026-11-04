-- AlterTable
ALTER TABLE "almoxarifados" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "updated_by" TEXT;

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "updated_by" TEXT;

-- AlterTable
ALTER TABLE "veiculos" ADD COLUMN     "updated_by" TEXT;

