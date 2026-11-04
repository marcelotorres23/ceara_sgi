-- CreateEnum
CREATE TYPE "TipoConclusaoOs" AS ENUM ('TOTAL', 'PARCIAL');

-- AlterEnum
ALTER TYPE "OrigemOrdemServico" ADD VALUE 'OS_PARCIAL';

-- AlterTable
ALTER TABLE "ordens_servico" ADD COLUMN     "anotacoes_mecanico" TEXT,
ADD COLUMN     "conclusao_tipo" "TipoConclusaoOs",
ADD COLUMN     "mecanico" TEXT,
ADD COLUMN     "os_retorno_id" TEXT,
ADD COLUMN     "pendencia" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ordens_servico_os_retorno_id_key" ON "ordens_servico"("os_retorno_id");

-- AddForeignKey
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_os_retorno_id_fkey" FOREIGN KEY ("os_retorno_id") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

