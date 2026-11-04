-- CreateEnum
CREATE TYPE "TipoVeiculo" AS ENUM ('TRUCK', 'TOCO', 'CARRETA', 'UTILITARIO', 'VAN', 'MOTO');

-- CreateEnum
CREATE TYPE "StatusVeiculo" AS ENUM ('ATIVO', 'MANUTENCAO', 'INATIVO', 'VENDIDO');

-- CreateEnum
CREATE TYPE "StatusMotorista" AS ENUM ('ATIVO', 'AFASTADO', 'INATIVO');

-- CreateEnum
CREATE TYPE "TipoAnomaliaAbastecimento" AS ENUM ('CONSUMO_FORA_DA_MEDIA', 'LITRAGEM_ACIMA_DO_TANQUE', 'HODOMETRO_RETROCEDEU', 'ABASTECIMENTOS_MUITO_PROXIMOS', 'SEM_CHECKLIST_NO_DIA');

-- CreateTable
CREATE TABLE "veiculos" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "frota_numero" TEXT NOT NULL,
    "renavam" TEXT,
    "chassi" TEXT,
    "tipo" "TipoVeiculo" NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "ano" INTEGER,
    "config_eixos" TEXT,
    "capacidade_tanque" DECIMAL(10,2),
    "hodometro_atual" DECIMAL(12,1) NOT NULL DEFAULT 0,
    "horimetro_atual" DECIMAL(12,1),
    "centro_custo_id" TEXT,
    "status" "StatusVeiculo" NOT NULL DEFAULT 'ATIVO',
    "foto_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,

    CONSTRAINT "veiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "veiculo_documentos" (
    "id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT,
    "emissao" TIMESTAMPTZ(3),
    "vencimento" TIMESTAMPTZ(3) NOT NULL,
    "anexo_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "veiculo_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posicoes_pneu" (
    "id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "eixo" INTEGER NOT NULL,
    "lado" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "posicoes_pneu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motoristas" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "cnh_numero" TEXT NOT NULL,
    "cnh_categoria" TEXT NOT NULL,
    "cnh_vencimento" TIMESTAMPTZ(3) NOT NULL,
    "toxicologico_vencimento" TIMESTAMPTZ(3),
    "aso_vencimento" TIMESTAMPTZ(3),
    "veiculo_padrao_id" TEXT,
    "status" "StatusMotorista" NOT NULL DEFAULT 'ATIVO',
    "foto_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "motoristas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abastecimentos" (
    "id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "motorista_id" TEXT NOT NULL,
    "data_hora" TIMESTAMPTZ(3) NOT NULL,
    "posto" TEXT NOT NULL,
    "posto_interno" BOOLEAN NOT NULL DEFAULT false,
    "tipo_combustivel" TEXT NOT NULL,
    "litros" DECIMAL(10,3) NOT NULL,
    "valor_unitario" DECIMAL(10,4) NOT NULL,
    "valor_total" DECIMAL(14,2) NOT NULL,
    "hodometro" DECIMAL(12,1) NOT NULL,
    "horimetro" DECIMAL(12,1),
    "forma_pagamento" TEXT,
    "numero_cartao" TEXT,
    "km_percorridos" DECIMAL(12,1),
    "consumo_kml" DECIMAL(10,3),
    "custo_por_km" DECIMAL(10,4),
    "desvio_percentual" DECIMAL(10,4),
    "anomalia" BOOLEAN NOT NULL DEFAULT false,
    "anomalia_tipos" JSONB NOT NULL DEFAULT '[]',
    "justificativa" TEXT,
    "foto_painel_id" TEXT,
    "foto_cupom_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,

    CONSTRAINT "abastecimentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "veiculos_placa_key" ON "veiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "veiculos_frota_numero_key" ON "veiculos"("frota_numero");

-- CreateIndex
CREATE INDEX "veiculos_status_idx" ON "veiculos"("status");

-- CreateIndex
CREATE INDEX "veiculo_documentos_veiculo_id_idx" ON "veiculo_documentos"("veiculo_id");

-- CreateIndex
CREATE INDEX "veiculo_documentos_vencimento_idx" ON "veiculo_documentos"("vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "posicoes_pneu_veiculo_id_codigo_key" ON "posicoes_pneu"("veiculo_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "motoristas_usuario_id_key" ON "motoristas"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "motoristas_cpf_key" ON "motoristas"("cpf");

-- CreateIndex
CREATE INDEX "motoristas_status_idx" ON "motoristas"("status");

-- CreateIndex
CREATE INDEX "abastecimentos_veiculo_id_data_hora_idx" ON "abastecimentos"("veiculo_id", "data_hora");

-- CreateIndex
CREATE INDEX "abastecimentos_anomalia_idx" ON "abastecimentos"("anomalia");

-- AddForeignKey
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "veiculo_documentos" ADD CONSTRAINT "veiculo_documentos_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posicoes_pneu" ADD CONSTRAINT "posicoes_pneu_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_veiculo_padrao_id_fkey" FOREIGN KEY ("veiculo_padrao_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_motorista_id_fkey" FOREIGN KEY ("motorista_id") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

