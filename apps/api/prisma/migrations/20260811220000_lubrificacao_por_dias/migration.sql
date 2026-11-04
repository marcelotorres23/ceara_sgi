-- AlterEnum
-- Lubrificacao de chassi: vence por calendario, e nao por rodagem (secao 7.10).
ALTER TYPE "TipoServicoPeriodico" ADD VALUE 'LUBRIFICACAO';

-- AlterEnum
-- Base por dias: o gestor troca km por dias no proprio plano, sem deploy.
ALTER TYPE "BaseMedicao" ADD VALUE 'DIAS';

-- AlterTable
-- Plano por dias nao tem leitura de painel: a medicao da execucao passa a ser opcional.
ALTER TABLE "servicos_periodicos" ALTER COLUMN "medicao" DROP NOT NULL;
