-- CreateEnum
CREATE TYPE "TipoPessoaExterna" AS ENUM ('VISITANTE', 'MOTORISTA_EXTERNO', 'CLIENTE', 'FORNECEDOR', 'PRESTADOR');

-- CreateEnum
CREATE TYPE "TipoAcesso" AS ENUM ('PESSOA', 'VEICULO_EXTERNO', 'VEICULO_PROPRIO');

-- CreateEnum
CREATE TYPE "StatusAcesso" AS ENUM ('AGENDADO', 'NO_PATIO', 'EM_TRANSITO', 'ENCERRADO', 'CANCELADO', 'RECUSADO');

-- CreateEnum
CREATE TYPE "GravidadeOcorrenciaPortaria" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');

-- CreateTable
CREATE TABLE "pontos_acesso" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "pontos_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pessoas_externas" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "nome" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "tipo" "TipoPessoaExterna" NOT NULL,
    "empresa" TEXT,
    "telefone" TEXT,
    "foto_url" TEXT,
    "cnh_numero" TEXT,
    "cnh_vencimento" TIMESTAMPTZ(3),
    "observacao" TEXT,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "motivo_bloqueio" TEXT,
    "bloqueado_em" TIMESTAMPTZ(3),
    "bloqueado_por" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "inativado_em" TIMESTAMPTZ(3),
    "inativado_por" TEXT,
    "motivo_inativacao" TEXT,

    CONSTRAINT "pessoas_externas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acessos_portaria" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "ponto_acesso_id" TEXT NOT NULL,
    "tipo" "TipoAcesso" NOT NULL,
    "status" "StatusAcesso" NOT NULL DEFAULT 'NO_PATIO',
    "pessoa_externa_id" TEXT,
    "motorista_id" TEXT,
    "veiculo_id" TEXT,
    "placa_externa" TEXT,
    "transportadora" TEXT,
    "destino" TEXT,
    "responsavel_id" TEXT,
    "autorizado_por_id" TEXT,
    "motivo" TEXT NOT NULL,
    "previsto_para" TIMESTAMPTZ(3),
    "entrada_em" TIMESTAMPTZ(3),
    "saida_em" TIMESTAMPTZ(3),
    "cracha" TEXT,
    "cracha_devolvido" BOOLEAN NOT NULL DEFAULT false,
    "lacre" TEXT,
    "nota_fiscal" TEXT,
    "carga_descricao" TEXT,
    "hodometro_saida" DECIMAL(12,1),
    "hodometro_retorno" DECIMAL(12,1),
    "observacao_entrada" TEXT,
    "observacao_saida" TEXT,
    "motivo_encerramento" TEXT,
    "registrado_entrada_por" TEXT,
    "registrado_saida_por" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "acessos_portaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acesso_transicoes" (
    "id" TEXT NOT NULL,
    "acesso_id" TEXT NOT NULL,
    "de" "StatusAcesso" NOT NULL,
    "para" "StatusAcesso" NOT NULL,
    "motivo" TEXT,
    "usuario_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acesso_transicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocorrencias_portaria" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "ponto_acesso_id" TEXT,
    "acesso_id" TEXT,
    "gravidade" "GravidadeOcorrenciaPortaria" NOT NULL DEFAULT 'BAIXA',
    "descricao" TEXT NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "anexo_id" TEXT,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocorrencias_portaria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pontos_acesso_unidade_id_codigo_key" ON "pontos_acesso"("unidade_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "pessoas_externas_documento_key" ON "pessoas_externas"("documento");

-- CreateIndex
CREATE INDEX "pessoas_externas_nome_idx" ON "pessoas_externas"("nome");

-- CreateIndex
CREATE INDEX "pessoas_externas_tipo_bloqueado_idx" ON "pessoas_externas"("tipo", "bloqueado");

-- CreateIndex
CREATE INDEX "acessos_portaria_unidade_id_status_idx" ON "acessos_portaria"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "acessos_portaria_status_entrada_em_idx" ON "acessos_portaria"("status", "entrada_em");

-- CreateIndex
CREATE INDEX "acessos_portaria_placa_externa_idx" ON "acessos_portaria"("placa_externa");

-- CreateIndex
CREATE INDEX "acessos_portaria_veiculo_id_saida_em_idx" ON "acessos_portaria"("veiculo_id", "saida_em");

-- CreateIndex
CREATE INDEX "acessos_portaria_pessoa_externa_id_idx" ON "acessos_portaria"("pessoa_externa_id");

-- CreateIndex
CREATE INDEX "acesso_transicoes_acesso_id_created_at_idx" ON "acesso_transicoes"("acesso_id", "created_at");

-- CreateIndex
CREATE INDEX "ocorrencias_portaria_unidade_id_ocorrido_em_idx" ON "ocorrencias_portaria"("unidade_id", "ocorrido_em");

-- CreateIndex
CREATE INDEX "ocorrencias_portaria_gravidade_idx" ON "ocorrencias_portaria"("gravidade");

-- AddForeignKey
ALTER TABLE "pontos_acesso" ADD CONSTRAINT "pontos_acesso_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pessoas_externas" ADD CONSTRAINT "pessoas_externas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_ponto_acesso_id_fkey" FOREIGN KEY ("ponto_acesso_id") REFERENCES "pontos_acesso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_pessoa_externa_id_fkey" FOREIGN KEY ("pessoa_externa_id") REFERENCES "pessoas_externas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_motorista_id_fkey" FOREIGN KEY ("motorista_id") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_autorizado_por_id_fkey" FOREIGN KEY ("autorizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso_transicoes" ADD CONSTRAINT "acesso_transicoes_acesso_id_fkey" FOREIGN KEY ("acesso_id") REFERENCES "acessos_portaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias_portaria" ADD CONSTRAINT "ocorrencias_portaria_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias_portaria" ADD CONSTRAINT "ocorrencias_portaria_ponto_acesso_id_fkey" FOREIGN KEY ("ponto_acesso_id") REFERENCES "pontos_acesso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias_portaria" ADD CONSTRAINT "ocorrencias_portaria_acesso_id_fkey" FOREIGN KEY ("acesso_id") REFERENCES "acessos_portaria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

