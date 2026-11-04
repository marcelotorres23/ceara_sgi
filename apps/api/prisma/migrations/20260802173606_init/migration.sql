-- CreateEnum
CREATE TYPE "Carteira" AS ENUM ('TECNICA', 'CONSUMO');

-- CreateEnum
CREATE TYPE "DecisaoAprovacao" AS ENUM ('APROVADO', 'APROVADO_COM_RESSALVA', 'DEVOLVIDO', 'REPROVADO');

-- CreateEnum
CREATE TYPE "SeveridadeAuditoria" AS ENUM ('INFO', 'ALERTA', 'SOD_VIOLATION', 'CRITICO');

-- CreateEnum
CREATE TYPE "CanalNotificacao" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateTable
CREATE TABLE "unidades" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cidade" TEXT,
    "uf" CHAR(2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centros_custo" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "responsavel_id" TEXT,
    "orcamento_mensal" DECIMAL(14,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "centros_custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "telefone" TEXT,
    "foto_url" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "unidade_id" TEXT,
    "centro_custo_id" TEXT,
    "mfa_secret" TEXT,
    "ultimo_login_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfis" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "perfis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissoes" (
    "id" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "descricao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfil_permissoes" (
    "perfil_id" TEXT NOT NULL,
    "permissao_id" TEXT NOT NULL,

    CONSTRAINT "perfil_permissoes_pkey" PRIMARY KEY ("perfil_id","permissao_id")
);

-- CreateTable
CREATE TABLE "usuario_perfis" (
    "usuario_id" TEXT NOT NULL,
    "perfil_id" TEXT NOT NULL,
    "escopo" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "usuario_perfis_pkey" PRIMARY KEY ("usuario_id","perfil_id")
);

-- CreateTable
CREATE TABLE "alcadas" (
    "id" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "valor_min" DECIMAL(14,2) NOT NULL,
    "valor_max" DECIMAL(14,2),
    "perfil_aprovador_id" TEXT NOT NULL,
    "propostas_minimas" INTEGER NOT NULL,
    "sla_horas" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alcadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "descricao" TEXT,
    "editavel_por_perfil_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "parametros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT,
    "acao" TEXT NOT NULL,
    "valor_anterior" JSONB,
    "valor_novo" JSONB,
    "severidade" "SeveridadeAuditoria" NOT NULL DEFAULT 'INFO',
    "hash_anterior" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogada_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "canal" "CanalNotificacao" NOT NULL DEFAULT 'IN_APP',
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "entidade" TEXT,
    "entidade_id" TEXT,
    "lida_em" TIMESTAMPTZ(3),
    "enviada_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anexos" (
    "id" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "hash_sha256" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "anexos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unidades_codigo_key" ON "unidades"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "centros_custo_codigo_key" ON "centros_custo"("codigo");

-- CreateIndex
CREATE INDEX "centros_custo_unidade_id_idx" ON "centros_custo"("unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_ativo_idx" ON "usuarios"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "perfis_nome_key" ON "perfis"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "permissoes_recurso_acao_key" ON "permissoes"("recurso", "acao");

-- CreateIndex
CREATE UNIQUE INDEX "alcadas_nivel_key" ON "alcadas"("nivel");

-- CreateIndex
CREATE UNIQUE INDEX "parametros_chave_key" ON "parametros"("chave");

-- CreateIndex
CREATE INDEX "auditoria_entidade_entidade_id_idx" ON "auditoria"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "auditoria_usuario_id_timestamp_idx" ON "auditoria"("usuario_id", "timestamp");

-- CreateIndex
CREATE INDEX "auditoria_severidade_timestamp_idx" ON "auditoria"("severidade", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_refresh_hash_key" ON "sessoes"("refresh_hash");

-- CreateIndex
CREATE INDEX "sessoes_usuario_id_idx" ON "sessoes"("usuario_id");

-- CreateIndex
CREATE INDEX "notificacoes_usuario_id_lida_em_idx" ON "notificacoes"("usuario_id", "lida_em");

-- CreateIndex
CREATE INDEX "anexos_entidade_entidade_id_idx" ON "anexos"("entidade", "entidade_id");

-- AddForeignKey
ALTER TABLE "centros_custo" ADD CONSTRAINT "centros_custo_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centros_custo" ADD CONSTRAINT "centros_custo_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_permissoes" ADD CONSTRAINT "perfil_permissoes_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_permissoes" ADD CONSTRAINT "perfil_permissoes_permissao_id_fkey" FOREIGN KEY ("permissao_id") REFERENCES "permissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_perfis" ADD CONSTRAINT "usuario_perfis_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_perfis" ADD CONSTRAINT "usuario_perfis_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alcadas" ADD CONSTRAINT "alcadas_perfil_aprovador_id_fkey" FOREIGN KEY ("perfil_aprovador_id") REFERENCES "perfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
