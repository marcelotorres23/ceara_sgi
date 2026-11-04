-- CreateEnum
CREATE TYPE "TipoChecklist" AS ENUM ('SAIDA', 'RETORNO', 'MANUTENCAO_PREVENTIVA', 'ENTREGA_DE_VEICULO');

-- CreateEnum
CREATE TYPE "TipoRespostaItem" AS ENUM ('OK_NAO_OK_NA', 'NUMERICO', 'TEXTO', 'SELECAO');

-- CreateEnum
CREATE TYPE "ExigenciaFoto" AS ENUM ('SEMPRE', 'SE_REPROVADO', 'NUNCA');

-- CreateEnum
CREATE TYPE "StatusChecklist" AS ENUM ('EM_EXECUCAO', 'CONCLUIDO', 'BLOQUEADO', 'LIBERADO_EXCEPCIONALMENTE', 'CANCELADO');

-- CreateTable
CREATE TABLE "checklist_modelos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoChecklist" NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "veiculo_tipo" "TipoVeiculo",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,

    CONSTRAINT "checklist_modelos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_grupos" (
    "id" TEXT NOT NULL,
    "modelo_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "checklist_grupos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_itens_modelo" (
    "id" TEXT NOT NULL,
    "grupo_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo_resposta" "TipoRespostaItem" NOT NULL,
    "critico" BOOLEAN NOT NULL DEFAULT false,
    "exige_foto" "ExigenciaFoto" NOT NULL DEFAULT 'SE_REPROVADO',
    "ordem" INTEGER NOT NULL,
    "ajuda" TEXT,
    "opcoes" JSONB,

    CONSTRAINT "checklist_itens_modelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "modelo_id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "motorista_id" TEXT NOT NULL,
    "tipo" "TipoChecklist" NOT NULL,
    "iniciado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizado_em" TIMESTAMPTZ(3),
    "gps_lat_inicio" DECIMAL(10,7),
    "gps_lng_inicio" DECIMAL(10,7),
    "gps_lat_fim" DECIMAL(10,7),
    "gps_lng_fim" DECIMAL(10,7),
    "hodometro" DECIMAL(12,1),
    "status" "StatusChecklist" NOT NULL DEFAULT 'EM_EXECUCAO',
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "liberado_por" TEXT,
    "liberacao_motivo" TEXT,
    "liberado_em" TIMESTAMPTZ(3),
    "assinatura_motorista_url" TEXT,
    "assinatura_conferente_url" TEXT,
    "pdf_anexo_id" TEXT,
    "sincronizado_em" TIMESTAMPTZ(3),
    "idempotencia_chave" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_respostas" (
    "id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "item_modelo_id" TEXT NOT NULL,
    "resposta" TEXT NOT NULL,
    "observacao" TEXT,
    "conforme" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_respostas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_fotos" (
    "id" TEXT NOT NULL,
    "resposta_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumb_url" TEXT,
    "tirada_em" TIMESTAMPTZ(3) NOT NULL,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "hash_sha256" TEXT NOT NULL,
    "marca_dagua" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklist_modelos_tipo_ativo_idx" ON "checklist_modelos"("tipo", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_modelos_nome_versao_key" ON "checklist_modelos"("nome", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_grupos_modelo_id_ordem_key" ON "checklist_grupos"("modelo_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_itens_modelo_grupo_id_ordem_key" ON "checklist_itens_modelo"("grupo_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "checklists_numero_key" ON "checklists"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "checklists_idempotencia_chave_key" ON "checklists"("idempotencia_chave");

-- CreateIndex
CREATE INDEX "checklists_veiculo_id_iniciado_em_idx" ON "checklists"("veiculo_id", "iniciado_em");

-- CreateIndex
CREATE INDEX "checklists_status_idx" ON "checklists"("status");

-- CreateIndex
CREATE INDEX "checklists_bloqueado_idx" ON "checklists"("bloqueado");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_respostas_checklist_id_item_modelo_id_key" ON "checklist_respostas"("checklist_id", "item_modelo_id");

-- CreateIndex
CREATE INDEX "checklist_fotos_resposta_id_idx" ON "checklist_fotos"("resposta_id");

-- AddForeignKey
ALTER TABLE "checklist_grupos" ADD CONSTRAINT "checklist_grupos_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "checklist_modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_itens_modelo" ADD CONSTRAINT "checklist_itens_modelo_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "checklist_grupos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "checklist_modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_motorista_id_fkey" FOREIGN KEY ("motorista_id") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_respostas" ADD CONSTRAINT "checklist_respostas_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_respostas" ADD CONSTRAINT "checklist_respostas_item_modelo_id_fkey" FOREIGN KEY ("item_modelo_id") REFERENCES "checklist_itens_modelo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_fotos" ADD CONSTRAINT "checklist_fotos_resposta_id_fkey" FOREIGN KEY ("resposta_id") REFERENCES "checklist_respostas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- `checklist_fotos` e append-only (secao 11): evidencia fotografica nao se apaga.
DROP TRIGGER IF EXISTS trg_checklist_fotos_append_only ON checklist_fotos;
CREATE TRIGGER trg_checklist_fotos_append_only
  BEFORE DELETE ON checklist_fotos
  FOR EACH ROW EXECUTE FUNCTION auditoria_append_only();

DO $$
BEGIN
  EXECUTE format('REVOKE DELETE, TRUNCATE ON TABLE checklist_fotos FROM %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem privilegio para revogar.';
END;
$$;
