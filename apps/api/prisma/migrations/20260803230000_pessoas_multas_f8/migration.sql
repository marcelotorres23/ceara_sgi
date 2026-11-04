-- CreateEnum
CREATE TYPE "GravidadeMulta" AS ENUM ('LEVE', 'MEDIA', 'GRAVE', 'GRAVISSIMA');

-- CreateEnum
CREATE TYPE "StatusMulta" AS ENUM ('REGISTRADA', 'CONDUTOR_INDICADO', 'EM_RECURSO', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusColaborador" AS ENUM ('ATIVO', 'AFASTADO', 'DESLIGADO');

-- CreateEnum
CREATE TYPE "TipoCriterio" AS ENUM ('POSITIVO', 'NEGATIVO');

-- CreateEnum
CREATE TYPE "StatusOcorrencia" AS ENUM ('SUGERIDA', 'VALIDADA', 'CONTESTADA', 'MANTIDA', 'REVERTIDA', 'DESCARTADA');

-- CreateTable
CREATE TABLE "multas" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "motorista_id" TEXT,
    "ait" TEXT NOT NULL,
    "data_infracao" TIMESTAMPTZ(3) NOT NULL,
    "local" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "gravidade" "GravidadeMulta" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "pontos" INTEGER NOT NULL DEFAULT 0,
    "prazo_indicacao" TIMESTAMPTZ(3),
    "prazo_recurso" TIMESTAMPTZ(3),
    "status" "StatusMulta" NOT NULL DEFAULT 'REGISTRADA',
    "anexo_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "multas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "matricula" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "setor" TEXT NOT NULL,
    "admissao" TIMESTAMPTZ(3) NOT NULL,
    "gestor_id" TEXT,
    "status" "StatusColaborador" NOT NULL DEFAULT 'ATIVO',
    "foto_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "inativado_em" TIMESTAMPTZ(3),
    "inativado_por" TEXT,
    "motivo_inativacao" TEXT,

    CONSTRAINT "colaboradores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criterios_pontuacao" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoCriterio" NOT NULL,
    "descricao" TEXT NOT NULL,
    "peso" INTEGER NOT NULL,
    "automatico" BOOLEAN NOT NULL DEFAULT false,
    "evento_gatilho" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "criterios_pontuacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocorrencias" (
    "id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    "criterio_id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "pontos" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "evidencia_tipo" TEXT,
    "evidencia_id" TEXT,
    "anexo_id" TEXT,
    "status" "StatusOcorrencia" NOT NULL DEFAULT 'VALIDADA',
    "lancado_por" TEXT,
    "lancado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contestar_ate" TIMESTAMPTZ(3),
    "contestada_em" TIMESTAMPTZ(3),
    "contestacao_texto" TEXT,
    "contestacao_anexo_id" TEXT,
    "decisao" TEXT,
    "decidido_por" TEXT,
    "decidido_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ocorrencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pontuacao_mensal" (
    "id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "pontos_base" INTEGER NOT NULL,
    "pontos_positivos" INTEGER NOT NULL,
    "pontos_negativos" INTEGER NOT NULL,
    "pontos_final" INTEGER NOT NULL,
    "ocorrencias" INTEGER NOT NULL DEFAULT 0,
    "fechado_em" TIMESTAMPTZ(3),
    "fechado_por" TEXT,
    "pdf_anexo_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pontuacao_mensal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "multas_ait_key" ON "multas"("ait");

-- CreateIndex
CREATE INDEX "multas_unidade_id_status_idx" ON "multas"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "multas_motorista_id_data_infracao_idx" ON "multas"("motorista_id", "data_infracao");

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_usuario_id_key" ON "colaboradores"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_matricula_key" ON "colaboradores"("matricula");

-- CreateIndex
CREATE INDEX "colaboradores_unidade_id_setor_idx" ON "colaboradores"("unidade_id", "setor");

-- CreateIndex
CREATE INDEX "colaboradores_status_idx" ON "colaboradores"("status");

-- CreateIndex
CREATE UNIQUE INDEX "criterios_pontuacao_codigo_key" ON "criterios_pontuacao"("codigo");

-- CreateIndex
CREATE INDEX "ocorrencias_colaborador_id_competencia_idx" ON "ocorrencias"("colaborador_id", "competencia");

-- CreateIndex
CREATE INDEX "ocorrencias_status_idx" ON "ocorrencias"("status");

-- CreateIndex
CREATE INDEX "pontuacao_mensal_competencia_idx" ON "pontuacao_mensal"("competencia");

-- CreateIndex
CREATE UNIQUE INDEX "pontuacao_mensal_colaborador_id_competencia_key" ON "pontuacao_mensal"("colaborador_id", "competencia");

-- AddForeignKey
ALTER TABLE "multas" ADD CONSTRAINT "multas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multas" ADD CONSTRAINT "multas_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multas" ADD CONSTRAINT "multas_motorista_id_fkey" FOREIGN KEY ("motorista_id") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_gestor_id_fkey" FOREIGN KEY ("gestor_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias" ADD CONSTRAINT "ocorrencias_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias" ADD CONSTRAINT "ocorrencias_criterio_id_fkey" FOREIGN KEY ("criterio_id") REFERENCES "criterios_pontuacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontuacao_mensal" ADD CONSTRAINT "pontuacao_mensal_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

