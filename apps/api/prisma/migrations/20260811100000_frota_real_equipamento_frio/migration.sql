-- CreateEnum
CREATE TYPE "TipoAcionamentoFrio" AS ENUM ('DIESEL', 'DIESEL_ELETRICO', 'ACOPLADO_ELETRICO', 'INOPERANTE');

-- CreateEnum
CREATE TYPE "StatusEquipamentoFrio" AS ENUM ('ATIVO', 'INATIVO', 'EM_MANUTENCAO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoVeiculo" ADD VALUE 'TRES_QUARTOS';
ALTER TYPE "TipoVeiculo" ADD VALUE 'TRUCK_TRES_QUARTOS';
ALTER TYPE "TipoVeiculo" ADD VALUE 'CACAMBA';
ALTER TYPE "TipoVeiculo" ADD VALUE 'SEMI_REBOQUE';

-- AlterTable
ALTER TABLE "veiculos" ADD COLUMN     "capacidade_kg" DECIMAL(10,2),
ADD COLUMN     "cnpj_proprietario" TEXT,
ADD COLUMN     "finalidade" TEXT,
ADD COLUMN     "observacao" TEXT,
ADD COLUMN     "propriedade" TEXT,
ADD COLUMN     "situacao_descrita" TEXT;

-- CreateTable
CREATE TABLE "equipamentos_frio" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT,
    "numero_serie" TEXT,
    "tipo_acionamento" "TipoAcionamentoFrio" NOT NULL DEFAULT 'DIESEL',
    "ano" INTEGER,
    "horimetro" DECIMAL(12,1),
    "status" "StatusEquipamentoFrio" NOT NULL DEFAULT 'ATIVO',
    "observacao" TEXT,
    "veiculo_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "equipamentos_frio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipamentos_frio_unidade_id_status_idx" ON "equipamentos_frio"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "equipamentos_frio_veiculo_id_idx" ON "equipamentos_frio"("veiculo_id");

-- CreateIndex
CREATE INDEX "equipamentos_frio_numero_serie_idx" ON "equipamentos_frio"("numero_serie");

-- AddForeignKey
ALTER TABLE "equipamentos_frio" ADD CONSTRAINT "equipamentos_frio_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipamentos_frio" ADD CONSTRAINT "equipamentos_frio_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

