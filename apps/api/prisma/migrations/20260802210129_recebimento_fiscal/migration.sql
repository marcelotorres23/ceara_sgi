-- CreateEnum
CREATE TYPE "StatusRecebimento" AS ENUM ('EM_CONFERENCIA', 'ACEITE_TOTAL', 'ACEITE_PARCIAL', 'RECUSADO');

-- CreateEnum
CREATE TYPE "TipoDivergencia" AS ENUM ('QUANTIDADE_MENOR', 'QUANTIDADE_MAIOR', 'PRECO_ACIMA_TOLERANCIA', 'ESPECIFICACAO', 'AVARIA', 'DOCUMENTACAO');

-- CreateEnum
CREATE TYPE "StatusTitulo" AS ENUM ('PROVISIONADO', 'LIBERADO', 'PAGO', 'BLOQUEADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "recebimentos" (
    "id" TEXT NOT NULL,
    "pedido_id" TEXT NOT NULL,
    "almoxarife_id" TEXT NOT NULL,
    "nf_numero" TEXT,
    "nf_chave" TEXT,
    "nf_valor" DECIMAL(14,2),
    "nf_emitida_em" TIMESTAMPTZ(3),
    "recebido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusRecebimento" NOT NULL DEFAULT 'EM_CONFERENCIA',
    "three_way_ok" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "fiscal_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,

    CONSTRAINT "recebimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recebimento_itens" (
    "id" TEXT NOT NULL,
    "recebimento_id" TEXT NOT NULL,
    "pedido_item_id" TEXT NOT NULL,
    "quantidade_recebida" DECIMAL(14,4) NOT NULL,
    "preco_nota_fiscal" DECIMAL(14,4),
    "conforme" BOOLEAN NOT NULL DEFAULT true,
    "tipo_divergencia" "TipoDivergencia",
    "pagamento_retido" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "anexo_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recebimento_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "titulos" (
    "id" TEXT NOT NULL,
    "recebimento_id" TEXT NOT NULL,
    "fornecedor_id" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "valor_retido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vencimento" TIMESTAMPTZ(3) NOT NULL,
    "condicao" TEXT,
    "status" "StatusTitulo" NOT NULL DEFAULT 'PROVISIONADO',
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "motivo_bloqueio" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,

    CONSTRAINT "titulos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recebimentos_pedido_id_idx" ON "recebimentos"("pedido_id");

-- CreateIndex
CREATE INDEX "recebimentos_status_idx" ON "recebimentos"("status");

-- CreateIndex
CREATE UNIQUE INDEX "recebimento_itens_recebimento_id_pedido_item_id_key" ON "recebimento_itens"("recebimento_id", "pedido_item_id");

-- CreateIndex
CREATE INDEX "titulos_fornecedor_id_idx" ON "titulos"("fornecedor_id");

-- CreateIndex
CREATE INDEX "titulos_status_idx" ON "titulos"("status");

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_almoxarife_id_fkey" FOREIGN KEY ("almoxarife_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimento_itens" ADD CONSTRAINT "recebimento_itens_recebimento_id_fkey" FOREIGN KEY ("recebimento_id") REFERENCES "recebimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimento_itens" ADD CONSTRAINT "recebimento_itens_pedido_item_id_fkey" FOREIGN KEY ("pedido_item_id") REFERENCES "pedido_itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_recebimento_id_fkey" FOREIGN KEY ("recebimento_id") REFERENCES "recebimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

