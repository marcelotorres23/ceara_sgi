-- AlterTable
ALTER TABLE "almoxarifados" ADD COLUMN     "inativado_em" TIMESTAMPTZ(3),
ADD COLUMN     "inativado_por" TEXT,
ADD COLUMN     "motivo_inativacao" TEXT;

-- AlterTable
ALTER TABLE "fornecedores" ADD COLUMN     "inativado_em" TIMESTAMPTZ(3),
ADD COLUMN     "inativado_por" TEXT,
ADD COLUMN     "motivo_inativacao" TEXT;

-- AlterTable
ALTER TABLE "itens" ADD COLUMN     "inativado_em" TIMESTAMPTZ(3),
ADD COLUMN     "inativado_por" TEXT,
ADD COLUMN     "motivo_inativacao" TEXT;

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "inativado_em" TIMESTAMPTZ(3),
ADD COLUMN     "inativado_por" TEXT,
ADD COLUMN     "motivo_inativacao" TEXT;

-- AlterTable
ALTER TABLE "veiculos" ADD COLUMN     "inativado_em" TIMESTAMPTZ(3),
ADD COLUMN     "inativado_por" TEXT,
ADD COLUMN     "motivo_inativacao" TEXT;

