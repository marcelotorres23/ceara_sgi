-- Multiunidade (secao 5.6) + F7 pneus e manutencao (secoes 7.4 e 7.5).
--
-- unidade_id entra como NULL, e retrocarregado a partir do vinculo existente e so
-- entao vira NOT NULL: base ja em producao nao pode quebrar na subida.
-- Fallback: a unidade mais antiga cadastrada, que na base semeada e a matriz.

-- AlterTable: unidade_id retrocarregado
ALTER TABLE "veiculos" ADD COLUMN "unidade_id" TEXT;
ALTER TABLE "motoristas" ADD COLUMN "unidade_id" TEXT;
ALTER TABLE "solicitacoes" ADD COLUMN "unidade_id" TEXT;
ALTER TABLE "lotes" ADD COLUMN "unidade_id" TEXT;

-- veiculo herda a unidade do centro de custo
UPDATE "veiculos" v
   SET "unidade_id" = cc."unidade_id"
  FROM "centros_custo" cc
 WHERE cc."id" = v."centro_custo_id";

-- solicitacao herda a unidade do centro de custo (denormalizacao para filtro e relatorio)
UPDATE "solicitacoes" s
   SET "unidade_id" = cc."unidade_id"
  FROM "centros_custo" cc
 WHERE cc."id" = s."centro_custo_id";

-- motorista herda a unidade do veiculo padrao, quando houver
UPDATE "motoristas" m
   SET "unidade_id" = v."unidade_id"
  FROM "veiculos" v
 WHERE v."id" = m."veiculo_padrao_id";

-- lote herda a unidade das proprias solicitacoes
UPDATE "lotes" l
   SET "unidade_id" = s."unidade_id"
  FROM "solicitacoes" s
 WHERE s."lote_id" = l."id" AND s."unidade_id" IS NOT NULL;

-- o que sobrou sem vinculo cai na unidade mais antiga
UPDATE "veiculos"     SET "unidade_id" = (SELECT "id" FROM "unidades" ORDER BY "created_at" ASC LIMIT 1) WHERE "unidade_id" IS NULL;
UPDATE "motoristas"   SET "unidade_id" = (SELECT "id" FROM "unidades" ORDER BY "created_at" ASC LIMIT 1) WHERE "unidade_id" IS NULL;
UPDATE "solicitacoes" SET "unidade_id" = (SELECT "id" FROM "unidades" ORDER BY "created_at" ASC LIMIT 1) WHERE "unidade_id" IS NULL;
UPDATE "lotes"        SET "unidade_id" = (SELECT "id" FROM "unidades" ORDER BY "created_at" ASC LIMIT 1) WHERE "unidade_id" IS NULL;

ALTER TABLE "veiculos"     ALTER COLUMN "unidade_id" SET NOT NULL;
ALTER TABLE "motoristas"   ALTER COLUMN "unidade_id" SET NOT NULL;
ALTER TABLE "solicitacoes" ALTER COLUMN "unidade_id" SET NOT NULL;
ALTER TABLE "lotes"        ALTER COLUMN "unidade_id" SET NOT NULL;

-- CreateEnum
CREATE TYPE "TipoPneu" AS ENUM ('NOVO', 'RECAPADO');

-- CreateEnum
CREATE TYPE "StatusPneu" AS ENUM ('EM_ESTOQUE', 'EM_USO', 'EM_RECAPAGEM', 'EM_REPARO', 'SUCATA');

-- CreateEnum
CREATE TYPE "TipoMovimentacaoPneu" AS ENUM ('INSTALACAO', 'RODIZIO', 'REMOCAO', 'ENVIO_RECAPAGEM', 'RETORNO_RECAPAGEM', 'ENVIO_REPARO', 'RETORNO_REPARO', 'SUCATEAMENTO');

-- CreateEnum
CREATE TYPE "GatilhoManutencao" AS ENUM ('KM', 'HORAS', 'DIAS');

-- CreateEnum
CREATE TYPE "TipoOrdemServico" AS ENUM ('PREVENTIVA', 'CORRETIVA');

-- CreateEnum
CREATE TYPE "OrigemOrdemServico" AS ENUM ('PLANO', 'CHECKLIST', 'MOTORISTA', 'ANOMALIA_ABASTECIMENTO', 'INSPECAO_PNEU', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatusOrdemServico" AS ENUM ('ABERTA', 'EM_EXECUCAO', 'AGUARDANDO_PECA', 'CONCLUIDA', 'CANCELADA');

-- AlterTable

-- AlterTable

-- AlterTable

-- AlterTable

-- CreateTable
CREATE TABLE "pneus" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "numero_fogo" TEXT NOT NULL,
    "serie" TEXT,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "medida" TEXT NOT NULL,
    "dot" TEXT,
    "tipo" "TipoPneu" NOT NULL DEFAULT 'NOVO',
    "recapagens" INTEGER NOT NULL DEFAULT 0,
    "custo_aquisicao" DECIMAL(14,2) NOT NULL,
    "custo_acumulado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "km_acumulado" DECIMAL(12,1) NOT NULL DEFAULT 0,
    "cpk" DECIMAL(12,6),
    "sulco_inicial_mm" DECIMAL(5,2),
    "sulco_atual_mm" DECIMAL(5,2),
    "vida_util_km" DECIMAL(12,1),
    "status" "StatusPneu" NOT NULL DEFAULT 'EM_ESTOQUE',
    "veiculo_id" TEXT,
    "posicao_id" TEXT,
    "hodometro_instalacao" DECIMAL(12,1),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "inativado_em" TIMESTAMPTZ(3),
    "inativado_por" TEXT,
    "motivo_inativacao" TEXT,

    CONSTRAINT "pneus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pneu_movimentacoes" (
    "id" TEXT NOT NULL,
    "pneu_id" TEXT NOT NULL,
    "tipo" "TipoMovimentacaoPneu" NOT NULL,
    "veiculo_id" TEXT,
    "posicao_id" TEXT,
    "data" TIMESTAMPTZ(3) NOT NULL,
    "hodometro" DECIMAL(12,1),
    "km_rodados" DECIMAL(12,1),
    "sulco_mm" DECIMAL(5,2),
    "custo" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "usuario_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pneu_movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pneu_inspecoes" (
    "id" TEXT NOT NULL,
    "pneu_id" TEXT NOT NULL,
    "data" TIMESTAMPTZ(3) NOT NULL,
    "sulco_mm" DECIMAL(5,2) NOT NULL,
    "pressao_psi" DECIMAL(6,2),
    "avaria" TEXT,
    "anexo_id" TEXT,
    "inspetor_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pneu_inspecoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planos_manutencao" (
    "id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "gatilho_tipo" "GatilhoManutencao" NOT NULL,
    "gatilho_valor" DECIMAL(12,1) NOT NULL,
    "antecedencia" DECIMAL(12,1) NOT NULL,
    "ultimo_valor" DECIMAL(12,1),
    "ultimo_em" TIMESTAMPTZ(3),
    "proximo_valor" DECIMAL(12,1),
    "proximo_em" TIMESTAMPTZ(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "planos_manutencao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordens_servico" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "tipo" "TipoOrdemServico" NOT NULL,
    "origem" "OrigemOrdemServico" NOT NULL DEFAULT 'MANUAL',
    "origem_id" TEXT,
    "plano_id" TEXT,
    "descricao" TEXT NOT NULL,
    "oficina" TEXT,
    "terceiro" BOOLEAN NOT NULL DEFAULT false,
    "aberta_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciada_em" TIMESTAMPTZ(3),
    "fechada_em" TIMESTAMPTZ(3),
    "hodometro" DECIMAL(12,1),
    "horimetro" DECIMAL(12,1),
    "custo_pecas" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "custo_mao_obra" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "custo_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tempo_parado_horas" DECIMAL(10,2),
    "status" "StatusOrdemServico" NOT NULL DEFAULT 'ABERTA',
    "motivo_cancelamento" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "ordens_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "os_itens" (
    "id" TEXT NOT NULL,
    "os_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "item_id" TEXT,
    "quantidade" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "custo_unitario" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "custo" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "mao_de_obra" BOOLEAN NOT NULL DEFAULT false,
    "movimentacao_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "os_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pneus_numero_fogo_key" ON "pneus"("numero_fogo");

-- CreateIndex
CREATE INDEX "pneus_unidade_id_status_idx" ON "pneus"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "pneus_veiculo_id_idx" ON "pneus"("veiculo_id");

-- CreateIndex
CREATE INDEX "pneus_marca_modelo_idx" ON "pneus"("marca", "modelo");

-- CreateIndex
CREATE INDEX "pneu_movimentacoes_pneu_id_data_idx" ON "pneu_movimentacoes"("pneu_id", "data");

-- CreateIndex
CREATE INDEX "pneu_movimentacoes_veiculo_id_data_idx" ON "pneu_movimentacoes"("veiculo_id", "data");

-- CreateIndex
CREATE INDEX "pneu_inspecoes_pneu_id_data_idx" ON "pneu_inspecoes"("pneu_id", "data");

-- CreateIndex
CREATE INDEX "planos_manutencao_veiculo_id_ativo_idx" ON "planos_manutencao"("veiculo_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "ordens_servico_numero_key" ON "ordens_servico"("numero");

-- CreateIndex
CREATE INDEX "ordens_servico_unidade_id_status_idx" ON "ordens_servico"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "ordens_servico_veiculo_id_aberta_em_idx" ON "ordens_servico"("veiculo_id", "aberta_em");

-- CreateIndex
CREATE INDEX "os_itens_os_id_idx" ON "os_itens"("os_id");

-- CreateIndex
CREATE INDEX "lotes_unidade_id_status_idx" ON "lotes"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "motoristas_unidade_id_idx" ON "motoristas"("unidade_id");

-- CreateIndex
CREATE INDEX "solicitacoes_unidade_id_status_idx" ON "solicitacoes"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "veiculos_unidade_id_idx" ON "veiculos"("unidade_id");

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pneus" ADD CONSTRAINT "pneus_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pneus" ADD CONSTRAINT "pneus_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pneus" ADD CONSTRAINT "pneus_posicao_id_fkey" FOREIGN KEY ("posicao_id") REFERENCES "posicoes_pneu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pneu_movimentacoes" ADD CONSTRAINT "pneu_movimentacoes_pneu_id_fkey" FOREIGN KEY ("pneu_id") REFERENCES "pneus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pneu_movimentacoes" ADD CONSTRAINT "pneu_movimentacoes_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pneu_movimentacoes" ADD CONSTRAINT "pneu_movimentacoes_posicao_id_fkey" FOREIGN KEY ("posicao_id") REFERENCES "posicoes_pneu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pneu_inspecoes" ADD CONSTRAINT "pneu_inspecoes_pneu_id_fkey" FOREIGN KEY ("pneu_id") REFERENCES "pneus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_manutencao" ADD CONSTRAINT "planos_manutencao_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos_manutencao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_os_id_fkey" FOREIGN KEY ("os_id") REFERENCES "ordens_servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

