-- CreateEnum
CREATE TYPE "Criticidade" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "StatusSolicitacao" AS ENUM ('RASCUNHO', 'ABERTA', 'EM_TRIAGEM', 'DEVOLVIDA', 'EM_LOTE', 'ATENDIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusLote" AS ENUM ('RASCUNHO', 'TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'PEDIDO_EMITIDO', 'AGUARDANDO_ENTREGA', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'NF_LANCADA', 'ENCERRADO', 'DEVOLVIDO_AO_SOLICITANTE', 'EM_RENEGOCIACAO', 'REPROVADO', 'CANCELADO', 'BLOQUEADO_DIVERGENCIA');

-- CreateEnum
CREATE TYPE "StatusFornecedor" AS ENUM ('EM_ANALISE', 'HOMOLOGADO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "StatusHomologacaoItem" AS ENUM ('EM_ANALISE', 'HOMOLOGADO', 'REPROVADO');

-- CreateEnum
CREATE TYPE "CurvaABC" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "TipoFrete" AS ENUM ('CIF', 'FOB');

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('EMITIDO', 'CONFIRMADO', 'PARCIALMENTE_RECEBIDO', 'RECEBIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "sequencias" (
    "chave" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sequencias_pkey" PRIMARY KEY ("chave","ano")
);

-- CreateTable
CREATE TABLE "familias" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "pai_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "familias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "especificacao" TEXT,
    "familia_id" TEXT,
    "unidade_medida" TEXT NOT NULL,
    "codigo_fabricante" TEXT,
    "curva_abc" "CurvaABC",
    "critico" BOOLEAN NOT NULL DEFAULT false,
    "preco_medio" DECIMAL(14,2),
    "status_homologacao" "StatusHomologacaoItem" NOT NULL DEFAULT 'EM_ANALISE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedores" (
    "id" TEXT NOT NULL,
    "razao_social" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "cnpj" TEXT NOT NULL,
    "ie" TEXT,
    "endereco" JSONB,
    "contatos" JSONB,
    "status" "StatusFornecedor" NOT NULL DEFAULT 'EM_ANALISE',
    "homologado_em" TIMESTAMPTZ(3),
    "homologacao_valida_ate" TIMESTAMPTZ(3),
    "score" DECIMAL(5,2),
    "condicao_padrao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedor_documentos" (
    "id" TEXT NOT NULL,
    "fornecedor_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT,
    "vencimento" TIMESTAMPTZ(3),
    "anexo_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "fornecedor_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "solicitante_id" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "criticidade" "Criticidade" NOT NULL,
    "origem_demanda" TEXT NOT NULL,
    "data_limite" TIMESTAMPTZ(3) NOT NULL,
    "status" "StatusSolicitacao" NOT NULL DEFAULT 'ABERTA',
    "lote_id" TEXT,
    "motivo_devolucao" TEXT,
    "motivo_cancelamento" TEXT,
    "cancelada_por" TEXT,
    "cancelada_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "solicitacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacao_itens" (
    "id" TEXT NOT NULL,
    "solicitacao_id" TEXT NOT NULL,
    "item_id" TEXT,
    "descricao_livre" TEXT,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade_medida" TEXT NOT NULL,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitacao_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "comprador_id" TEXT NOT NULL,
    "status" "StatusLote" NOT NULL DEFAULT 'TRIAGEM',
    "valor_estimado" DECIMAL(14,2),
    "valor_fechado" DECIMAL(14,2),
    "criticidade" "Criticidade" NOT NULL,
    "sla_vence_em" TIMESTAMPTZ(3),
    "sla_suspenso_em" TIMESTAMPTZ(3),
    "aprovador_id" TEXT,
    "aprovado_em" TIMESTAMPTZ(3),
    "nivel_alcada" INTEGER,
    "savings" DECIMAL(14,2),
    "motivo_cancelamento" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote_transicoes" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "de" "StatusLote" NOT NULL,
    "para" "StatusLote" NOT NULL,
    "motivo" TEXT,
    "usuario_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lote_transicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotacoes" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "fornecedor_id" TEXT NOT NULL,
    "enviada_em" TIMESTAMPTZ(3),
    "respondida_em" TIMESTAMPTZ(3),
    "recusada" BOOLEAN NOT NULL DEFAULT false,
    "motivo_recusa" TEXT,
    "condicao_pagamento" TEXT,
    "prazo_dias" INTEGER,
    "desconto_avista" DECIMAL(14,2),
    "frete_tipo" "TipoFrete",
    "frete_valor" DECIMAL(14,2),
    "prazo_entrega_dias" INTEGER,
    "valor_total" DECIMAL(14,2),
    "valor_presente" DECIMAL(14,2),
    "token_publico" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "cotacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotacao_itens" (
    "id" TEXT NOT NULL,
    "cotacao_id" TEXT NOT NULL,
    "solicitacao_item_id" TEXT NOT NULL,
    "preco_unitario" DECIMAL(14,4) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "marca_ofertada" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cotacao_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapas_cotacao" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "cotacao_recomendada_id" TEXT,
    "cotacao_escolhida_id" TEXT,
    "taxa_mensal" DECIMAL(9,6) NOT NULL,
    "gerado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_anexo_id" TEXT,
    "divergente_menor_preco" BOOLEAN NOT NULL DEFAULT false,
    "justificativa" TEXT,
    "memoria_calculo" JSONB NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "mapas_cotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aprovacoes" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "aprovador_id" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "decisao" "DecisaoAprovacao" NOT NULL,
    "ressalva" TEXT,
    "motivo" TEXT,
    "autoaprovacao" BOOLEAN NOT NULL DEFAULT false,
    "decidido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "aprovacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "fornecedor_id" TEXT NOT NULL,
    "valor_total" DECIMAL(14,2) NOT NULL,
    "condicao_pagamento" TEXT,
    "data_prometida" TIMESTAMPTZ(3) NOT NULL,
    "data_prometida_original" TIMESTAMPTZ(3) NOT NULL,
    "data_reprogramada" TIMESTAMPTZ(3),
    "motivo_reprogramacao" TEXT,
    "confirmado_fornecedor_em" TIMESTAMPTZ(3),
    "status" "StatusPedido" NOT NULL DEFAULT 'EMITIDO',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_itens" (
    "id" TEXT NOT NULL,
    "pedido_id" TEXT NOT NULL,
    "item_id" TEXT,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "preco_unitario" DECIMAL(14,4) NOT NULL,
    "quantidade_recebida" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "itens_codigo_key" ON "itens"("codigo");

-- CreateIndex
CREATE INDEX "itens_familia_id_idx" ON "itens"("familia_id");

-- CreateIndex
CREATE INDEX "itens_status_homologacao_idx" ON "itens"("status_homologacao");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_cnpj_key" ON "fornecedores"("cnpj");

-- CreateIndex
CREATE INDEX "fornecedores_status_idx" ON "fornecedores"("status");

-- CreateIndex
CREATE INDEX "fornecedor_documentos_fornecedor_id_idx" ON "fornecedor_documentos"("fornecedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "solicitacoes_numero_key" ON "solicitacoes"("numero");

-- CreateIndex
CREATE INDEX "solicitacoes_status_created_at_idx" ON "solicitacoes"("status", "created_at");

-- CreateIndex
CREATE INDEX "solicitacoes_solicitante_id_idx" ON "solicitacoes"("solicitante_id");

-- CreateIndex
CREATE INDEX "solicitacoes_lote_id_idx" ON "solicitacoes"("lote_id");

-- CreateIndex
CREATE INDEX "solicitacao_itens_solicitacao_id_idx" ON "solicitacao_itens"("solicitacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_numero_key" ON "lotes"("numero");

-- CreateIndex
CREATE INDEX "lotes_status_created_at_idx" ON "lotes"("status", "created_at");

-- CreateIndex
CREATE INDEX "lotes_comprador_id_idx" ON "lotes"("comprador_id");

-- CreateIndex
CREATE INDEX "lote_transicoes_lote_id_created_at_idx" ON "lote_transicoes"("lote_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cotacoes_token_publico_key" ON "cotacoes"("token_publico");

-- CreateIndex
CREATE INDEX "cotacoes_lote_id_idx" ON "cotacoes"("lote_id");

-- CreateIndex
CREATE UNIQUE INDEX "cotacoes_lote_id_fornecedor_id_key" ON "cotacoes"("lote_id", "fornecedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "cotacao_itens_cotacao_id_solicitacao_item_id_key" ON "cotacao_itens"("cotacao_id", "solicitacao_item_id");

-- CreateIndex
CREATE INDEX "mapas_cotacao_lote_id_idx" ON "mapas_cotacao"("lote_id");

-- CreateIndex
CREATE INDEX "aprovacoes_lote_id_idx" ON "aprovacoes"("lote_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_numero_key" ON "pedidos"("numero");

-- CreateIndex
CREATE INDEX "pedidos_lote_id_idx" ON "pedidos"("lote_id");

-- CreateIndex
CREATE INDEX "pedidos_status_idx" ON "pedidos"("status");

-- CreateIndex
CREATE INDEX "pedido_itens_pedido_id_idx" ON "pedido_itens"("pedido_id");

-- AddForeignKey
ALTER TABLE "familias" ADD CONSTRAINT "familias_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "familias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens" ADD CONSTRAINT "itens_familia_id_fkey" FOREIGN KEY ("familia_id") REFERENCES "familias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fornecedor_documentos" ADD CONSTRAINT "fornecedor_documentos_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_solicitante_id_fkey" FOREIGN KEY ("solicitante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacao_itens" ADD CONSTRAINT "solicitacao_itens_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacao_itens" ADD CONSTRAINT "solicitacao_itens_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_comprador_id_fkey" FOREIGN KEY ("comprador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_transicoes" ADD CONSTRAINT "lote_transicoes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotacoes" ADD CONSTRAINT "cotacoes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotacoes" ADD CONSTRAINT "cotacoes_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotacao_itens" ADD CONSTRAINT "cotacao_itens_cotacao_id_fkey" FOREIGN KEY ("cotacao_id") REFERENCES "cotacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotacao_itens" ADD CONSTRAINT "cotacao_itens_solicitacao_item_id_fkey" FOREIGN KEY ("solicitacao_item_id") REFERENCES "solicitacao_itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapas_cotacao" ADD CONSTRAINT "mapas_cotacao_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapas_cotacao" ADD CONSTRAINT "mapas_cotacao_cotacao_recomendada_id_fkey" FOREIGN KEY ("cotacao_recomendada_id") REFERENCES "cotacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprovacoes" ADD CONSTRAINT "aprovacoes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprovacoes" ADD CONSTRAINT "aprovacoes_aprovador_id_fkey" FOREIGN KEY ("aprovador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

