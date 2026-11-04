-- CreateEnum
CREATE TYPE "StatusBateria" AS ENUM ('EM_ESTOQUE', 'EM_USO', 'EM_ANALISE_GARANTIA', 'SUCATA');

-- CreateTable
CREATE TABLE "baterias" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "identificacao" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "numero_serie" TEXT,
    "amperagem" INTEGER,
    "tensao_nominal" DECIMAL(5,2),
    "data_compra" DATE,
    "custo" DECIMAL(14,2),
    "garantia_meses" INTEGER,
    "vida_util_meses" INTEGER,
    "status" "StatusBateria" NOT NULL DEFAULT 'EM_ESTOQUE',
    "veiculo_id" TEXT,
    "posicao" INTEGER,
    "instalada_em" TIMESTAMPTZ(3),
    "hodometro_instalacao" DECIMAL(12,1),
    "retirada_em" TIMESTAMPTZ(3),
    "motivo_retirada" TEXT,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "baterias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicoes_bateria" (
    "id" TEXT NOT NULL,
    "bateria_id" TEXT NOT NULL,
    "medido_em" TIMESTAMPTZ(3) NOT NULL,
    "tensao_v" DECIMAL(5,2) NOT NULL,
    "densidade" DECIMAL(5,3),
    "apos_rodar" BOOLEAN NOT NULL DEFAULT false,
    "hodometro" DECIMAL(12,1),
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "medicoes_bateria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "baterias_unidade_id_status_idx" ON "baterias"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "baterias_veiculo_id_idx" ON "baterias"("veiculo_id");

-- CreateIndex
CREATE UNIQUE INDEX "baterias_unidade_id_identificacao_key" ON "baterias"("unidade_id", "identificacao");

-- CreateIndex
CREATE INDEX "medicoes_bateria_bateria_id_medido_em_idx" ON "medicoes_bateria"("bateria_id", "medido_em");

-- AddForeignKey
ALTER TABLE "baterias" ADD CONSTRAINT "baterias_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baterias" ADD CONSTRAINT "baterias_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicoes_bateria" ADD CONSTRAINT "medicoes_bateria_bateria_id_fkey" FOREIGN KEY ("bateria_id") REFERENCES "baterias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bateria em uso tem veiculo e data de instalacao; em estoque, nao tem nem um nem outro.
ALTER TABLE "baterias" ADD CONSTRAINT "baterias_uso_coerente"
  CHECK (("status" <> 'EM_USO') OR ("veiculo_id" IS NOT NULL AND "instalada_em" IS NOT NULL));
