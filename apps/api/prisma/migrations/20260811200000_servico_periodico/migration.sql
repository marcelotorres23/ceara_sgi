-- CreateEnum
CREATE TYPE "TipoServicoPeriodico" AS ENUM ('OLEO_MOTOR', 'OLEO_DIFERENCIAL', 'OLEO_CAIXA_MARCHA', 'OLEO_THERMO_KING', 'ALINHAMENTO', 'BALANCEAMENTO');

-- CreateEnum
CREATE TYPE "BaseMedicao" AS ENUM ('HODOMETRO', 'HORIMETRO');

-- CreateTable
CREATE TABLE "planos_servico_periodico" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "tipo" "TipoServicoPeriodico" NOT NULL,
    "base" "BaseMedicao" NOT NULL,
    "intervalo" DECIMAL(12,1) NOT NULL,
    "avisar_com" DECIMAL(12,1) NOT NULL,
    "modelo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "planos_servico_periodico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicos_periodicos" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "tipo" "TipoServicoPeriodico" NOT NULL,
    "base" "BaseMedicao" NOT NULL,
    "veiculo_id" TEXT,
    "equipamento_frio_id" TEXT,
    "plano_id" TEXT,
    "executado_em" TIMESTAMPTZ(3) NOT NULL,
    "medicao" DECIMAL(12,1) NOT NULL,
    "intervalo" DECIMAL(12,1) NOT NULL,
    "proxima" DECIMAL(12,1) NOT NULL,
    "item_id" TEXT,
    "quantidade" DECIMAL(12,3),
    "custo" DECIMAL(14,2),
    "oficina" TEXT,
    "ordem_servico_id" TEXT,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "servicos_periodicos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planos_servico_periodico_unidade_id_tipo_idx" ON "planos_servico_periodico"("unidade_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "planos_servico_periodico_unidade_id_tipo_modelo_key" ON "planos_servico_periodico"("unidade_id", "tipo", "modelo");

-- CreateIndex
CREATE INDEX "servicos_periodicos_veiculo_id_tipo_executado_em_idx" ON "servicos_periodicos"("veiculo_id", "tipo", "executado_em");

-- CreateIndex
CREATE INDEX "servicos_periodicos_equipamento_frio_id_tipo_executado_em_idx" ON "servicos_periodicos"("equipamento_frio_id", "tipo", "executado_em");

-- CreateIndex
CREATE INDEX "servicos_periodicos_unidade_id_tipo_idx" ON "servicos_periodicos"("unidade_id", "tipo");

-- AddForeignKey
ALTER TABLE "planos_servico_periodico" ADD CONSTRAINT "planos_servico_periodico_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_periodicos" ADD CONSTRAINT "servicos_periodicos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_periodicos" ADD CONSTRAINT "servicos_periodicos_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_periodicos" ADD CONSTRAINT "servicos_periodicos_equipamento_frio_id_fkey" FOREIGN KEY ("equipamento_frio_id") REFERENCES "equipamentos_frio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_periodicos" ADD CONSTRAINT "servicos_periodicos_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos_servico_periodico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_periodicos" ADD CONSTRAINT "servicos_periodicos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_periodicos" ADD CONSTRAINT "servicos_periodicos_ordem_servico_id_fkey" FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Um servico periodico e de um veiculo ou de um equipamento de frio, nunca dos dois nem de nenhum.
ALTER TABLE "servicos_periodicos" ADD CONSTRAINT "servicos_periodicos_ativo_unico"
  CHECK (("veiculo_id" IS NOT NULL) <> ("equipamento_frio_id" IS NOT NULL));
