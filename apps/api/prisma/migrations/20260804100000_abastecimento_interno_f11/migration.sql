-- F11: abastecimento interno (secao 7.9).
--
-- Ate aqui o sistema media o CONSUMO do veiculo, mas nao sabia quanto
-- combustivel havia no tanque: comprava-se 5.000 litros, abastecia-se 4.200,
-- e os 800 restantes eram fe. Tanque, bico, movimentacao e afericao fecham
-- o balanco - cada litro que entra e sai passa a ter registro.

-- CreateEnum
CREATE TYPE "TipoProdutoCombustivel" AS ENUM ('DIESEL_S10', 'DIESEL_S500', 'GASOLINA', 'ETANOL', 'ARLA32', 'LUBRIFICANTE', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoTanque" AS ENUM ('FIXO', 'MOVEL');

-- CreateEnum
CREATE TYPE "TipoMovimentacaoTanque" AS ENUM ('ENTRADA_COMPRA', 'ENTRADA_TRANSFERENCIA', 'ENTRADA_ACERTO', 'SAIDA_ABASTECIMENTO', 'SAIDA_TRANSFERENCIA', 'SAIDA_ACERTO');

-- AlterTable
ALTER TABLE "abastecimentos" ADD COLUMN     "bico_id" TEXT,
ADD COLUMN     "encerrante_final" DECIMAL(14,3),
ADD COLUMN     "encerrante_inicial" DECIMAL(14,3),
ADD COLUMN     "obra_local" TEXT,
ADD COLUMN     "os_id" TEXT,
ADD COLUMN     "produto_id" TEXT,
ADD COLUMN     "rota" TEXT,
ADD COLUMN     "tanque_id" TEXT,
ADD COLUMN     "turno" TEXT;

-- CreateTable
CREATE TABLE "produtos_combustivel" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoProdutoCombustivel" NOT NULL,
    "unidade_medida" TEXT NOT NULL DEFAULT 'L',
    "densidade" DECIMAL(8,4),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "produtos_combustivel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tanques" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoTanque" NOT NULL DEFAULT 'FIXO',
    "produto_id" TEXT NOT NULL,
    "capacidade_litros" DECIMAL(12,3) NOT NULL,
    "saldo_litros" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "custo_medio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "veiculo_id" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultima_afericao_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "inativado_em" TIMESTAMPTZ(3),
    "inativado_por" TEXT,
    "motivo_inativacao" TEXT,

    CONSTRAINT "tanques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bicos" (
    "id" TEXT NOT NULL,
    "tanque_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT,
    "encerrante_atual" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_tanque" (
    "id" TEXT NOT NULL,
    "tanque_id" TEXT NOT NULL,
    "tipo" "TipoMovimentacaoTanque" NOT NULL,
    "litros" DECIMAL(12,3) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "custo_medio_apos" DECIMAL(14,4) NOT NULL,
    "saldo_apos" DECIMAL(12,3) NOT NULL,
    "nota_fiscal" TEXT,
    "fornecedor_id" TEXT,
    "tanque_destino_id" TEXT,
    "abastecimento_id" TEXT,
    "afericao_id" TEXT,
    "motivo" TEXT,
    "usuario_id" TEXT NOT NULL,
    "data" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_tanque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "afericoes_tanque" (
    "id" TEXT NOT NULL,
    "tanque_id" TEXT NOT NULL,
    "data" TIMESTAMPTZ(3) NOT NULL,
    "saldo_sistema" DECIMAL(12,3) NOT NULL,
    "saldo_medido" DECIMAL(12,3) NOT NULL,
    "diferenca" DECIMAL(12,3) NOT NULL,
    "percentual" DECIMAL(8,4) NOT NULL,
    "dentro_da_tolerancia" BOOLEAN NOT NULL,
    "motivo" TEXT,
    "anexo_id" TEXT,
    "aferido_por" TEXT NOT NULL,
    "aprovado_por" TEXT,
    "aprovado_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "afericoes_tanque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "produtos_combustivel_codigo_key" ON "produtos_combustivel"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tanques_codigo_key" ON "tanques"("codigo");

-- CreateIndex
CREATE INDEX "tanques_unidade_id_ativo_idx" ON "tanques"("unidade_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "bicos_tanque_id_codigo_key" ON "bicos"("tanque_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "movimentacoes_tanque_abastecimento_id_key" ON "movimentacoes_tanque"("abastecimento_id");

-- CreateIndex
CREATE INDEX "movimentacoes_tanque_tanque_id_data_idx" ON "movimentacoes_tanque"("tanque_id", "data");

-- CreateIndex
CREATE INDEX "afericoes_tanque_tanque_id_data_idx" ON "afericoes_tanque"("tanque_id", "data");

-- CreateIndex
CREATE INDEX "abastecimentos_tanque_id_data_hora_idx" ON "abastecimentos"("tanque_id", "data_hora");

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_tanque_id_fkey" FOREIGN KEY ("tanque_id") REFERENCES "tanques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_bico_id_fkey" FOREIGN KEY ("bico_id") REFERENCES "bicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos_combustivel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tanques" ADD CONSTRAINT "tanques_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tanques" ADD CONSTRAINT "tanques_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos_combustivel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tanques" ADD CONSTRAINT "tanques_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bicos" ADD CONSTRAINT "bicos_tanque_id_fkey" FOREIGN KEY ("tanque_id") REFERENCES "tanques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_tanque" ADD CONSTRAINT "movimentacoes_tanque_tanque_id_fkey" FOREIGN KEY ("tanque_id") REFERENCES "tanques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_tanque" ADD CONSTRAINT "movimentacoes_tanque_tanque_destino_id_fkey" FOREIGN KEY ("tanque_destino_id") REFERENCES "tanques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_tanque" ADD CONSTRAINT "movimentacoes_tanque_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afericoes_tanque" ADD CONSTRAINT "afericoes_tanque_tanque_id_fkey" FOREIGN KEY ("tanque_id") REFERENCES "tanques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

