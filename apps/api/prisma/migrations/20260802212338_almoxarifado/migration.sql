-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('ENTRADA_COMPRA', 'ENTRADA_DEVOLUCAO', 'ENTRADA_TRANSFERENCIA', 'ENTRADA_AJUSTE', 'ENTRADA_ESTORNO', 'SAIDA_REQUISICAO', 'SAIDA_TRANSFERENCIA', 'SAIDA_AJUSTE', 'SAIDA_DESCARTE', 'SAIDA_ESTORNO');

-- CreateEnum
CREATE TYPE "StatusInventario" AS ENUM ('EM_CONTAGEM', 'AGUARDANDO_APROVACAO', 'APROVADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "almoxarifados" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "responsavel_id" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "almoxarifados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enderecos" (
    "id" TEXT NOT NULL,
    "almoxarifado_id" TEXT NOT NULL,
    "rua" TEXT NOT NULL,
    "prateleira" TEXT NOT NULL,
    "nivel" TEXT NOT NULL,
    "posicao" TEXT NOT NULL,
    "codigo_qr" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "enderecos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldos" (
    "id" TEXT NOT NULL,
    "almoxarifado_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "custo_medio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "endereco_id" TEXT,
    "estoque_minimo" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "estoque_maximo" DECIMAL(14,4),
    "ponto_pedido" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "lote_economico" DECIMAL(14,4),
    "lead_time_dias" INTEGER NOT NULL DEFAULT 7,
    "consumo_medio_mensal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "ponto_pedido_manual" BOOLEAN NOT NULL DEFAULT false,
    "ultima_movimentacao_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saldos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes" (
    "id" TEXT NOT NULL,
    "almoxarifado_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "saldo_apos" DECIMAL(14,4) NOT NULL,
    "custo_medio_apos" DECIMAL(14,4) NOT NULL,
    "documento_tipo" TEXT,
    "documento_id" TEXT,
    "veiculo_id" TEXT,
    "os_id" TEXT,
    "motivo" TEXT,
    "usuario_id" TEXT NOT NULL,
    "estornada_por" TEXT,
    "estorno_de" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventarios" (
    "id" TEXT NOT NULL,
    "almoxarifado_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "curva" "CurvaABC",
    "iniciado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizado_em" TIMESTAMPTZ(3),
    "status" "StatusInventario" NOT NULL DEFAULT 'EM_CONTAGEM',
    "acuracidade" DECIMAL(5,4),
    "created_by" TEXT,

    CONSTRAINT "inventarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_itens" (
    "id" TEXT NOT NULL,
    "inventario_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "saldo_sistema" DECIMAL(14,4) NOT NULL,
    "saldo_contado" DECIMAL(14,4),
    "divergencia" DECIMAL(14,4),
    "valor_divergencia" DECIMAL(14,2),
    "motivo" TEXT,
    "anexo_id" TEXT,
    "contador_id" TEXT,
    "aprovado_por" TEXT,
    "contado_em" TIMESTAMPTZ(3),

    CONSTRAINT "inventario_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "almoxarifados_codigo_key" ON "almoxarifados"("codigo");

-- CreateIndex
CREATE INDEX "almoxarifados_unidade_id_idx" ON "almoxarifados"("unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "enderecos_codigo_qr_key" ON "enderecos"("codigo_qr");

-- CreateIndex
CREATE UNIQUE INDEX "enderecos_almoxarifado_id_rua_prateleira_nivel_posicao_key" ON "enderecos"("almoxarifado_id", "rua", "prateleira", "nivel", "posicao");

-- CreateIndex
CREATE INDEX "saldos_item_id_idx" ON "saldos"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "saldos_almoxarifado_id_item_id_key" ON "saldos"("almoxarifado_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimentacoes_estorno_de_key" ON "movimentacoes"("estorno_de");

-- CreateIndex
CREATE INDEX "movimentacoes_almoxarifado_id_item_id_created_at_idx" ON "movimentacoes"("almoxarifado_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "movimentacoes_documento_tipo_documento_id_idx" ON "movimentacoes"("documento_tipo", "documento_id");

-- CreateIndex
CREATE INDEX "inventarios_almoxarifado_id_idx" ON "inventarios"("almoxarifado_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_itens_inventario_id_item_id_key" ON "inventario_itens"("inventario_id", "item_id");

-- AddForeignKey
ALTER TABLE "almoxarifados" ADD CONSTRAINT "almoxarifados_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "almoxarifados" ADD CONSTRAINT "almoxarifados_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enderecos" ADD CONSTRAINT "enderecos_almoxarifado_id_fkey" FOREIGN KEY ("almoxarifado_id") REFERENCES "almoxarifados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos" ADD CONSTRAINT "saldos_almoxarifado_id_fkey" FOREIGN KEY ("almoxarifado_id") REFERENCES "almoxarifados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos" ADD CONSTRAINT "saldos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos" ADD CONSTRAINT "saldos_endereco_id_fkey" FOREIGN KEY ("endereco_id") REFERENCES "enderecos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_almoxarifado_id_fkey" FOREIGN KEY ("almoxarifado_id") REFERENCES "almoxarifados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_estorno_de_fkey" FOREIGN KEY ("estorno_de") REFERENCES "movimentacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_almoxarifado_id_fkey" FOREIGN KEY ("almoxarifado_id") REFERENCES "almoxarifados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_itens" ADD CONSTRAINT "inventario_itens_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_itens" ADD CONSTRAINT "inventario_itens_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- `movimentacoes` e append-only (secao 11): nada se exclui, apenas se estorna com
-- lancamento contrario. Reutiliza a funcao criada na migration de auditoria.
DROP TRIGGER IF EXISTS trg_movimentacoes_append_only ON movimentacoes;
CREATE TRIGGER trg_movimentacoes_append_only
  BEFORE DELETE ON movimentacoes
  FOR EACH ROW EXECUTE FUNCTION auditoria_append_only();

DO $$
BEGIN
  EXECUTE format('REVOKE DELETE, TRUNCATE ON TABLE movimentacoes FROM %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem privilegio para revogar.';
END;
$$;
