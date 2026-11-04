-- CreateEnum
CREATE TYPE "OrigemLeitura" AS ENUM ('CTASMART_AUTO', 'CTASMART_MANUAL', 'ABASTECIMENTO', 'EXECUCAO_OFICINA', 'CHECKLIST', 'PORTARIA', 'DIGITACAO', 'IMPORTACAO_LEGADO');

-- CreateEnum
CREATE TYPE "TipoMedidor" AS ENUM ('ODOMETRO', 'HORIMETRO_VEICULO', 'HORIMETRO_FRIO');

-- CreateEnum
CREATE TYPE "SuspeitaLeitura" AS ENUM ('REGRESSAO', 'SALTO');

-- CreateTable
CREATE TABLE "leituras" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "tipo" "TipoMedidor" NOT NULL,
    "valor" DECIMAL(12,1) NOT NULL,
    "medido_em" TIMESTAMPTZ(3) NOT NULL,
    "origem" "OrigemLeitura" NOT NULL,
    "veiculo_id" TEXT,
    "equipamento_frio_id" TEXT,
    "abastecimento_id" TEXT,
    "servico_periodico_id" TEXT,
    "checklist_id" TEXT,
    "acesso_portaria_id" TEXT,
    "suspeita" "SuspeitaLeitura",
    "observacao" TEXT,
    "confirmada_por" TEXT,
    "confirmada_em" TIMESTAMPTZ(3),
    "avancou_ativo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "leituras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leituras_veiculo_id_tipo_medido_em_idx" ON "leituras"("veiculo_id", "tipo", "medido_em");

-- CreateIndex
CREATE INDEX "leituras_equipamento_frio_id_tipo_medido_em_idx" ON "leituras"("equipamento_frio_id", "tipo", "medido_em");

-- CreateIndex
CREATE INDEX "leituras_unidade_id_suspeita_idx" ON "leituras"("unidade_id", "suspeita");

-- AddForeignKey
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_equipamento_frio_id_fkey" FOREIGN KEY ("equipamento_frio_id") REFERENCES "equipamentos_frio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma leitura e de um veiculo ou de um aparelho de frio, nunca dos dois nem de nenhum.
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_ativo_unico"
  CHECK (("veiculo_id" IS NOT NULL) <> ("equipamento_frio_id" IS NOT NULL));
