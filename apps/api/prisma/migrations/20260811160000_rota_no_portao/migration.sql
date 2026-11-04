-- CreateTable
CREATE TABLE "rotas" (
    "id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "vendedores" INTEGER,
    "dias_pre_venda" INTEGER,
    "fechamento" TEXT,
    "largada" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "rotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rotas_unidade_id_ativo_idx" ON "rotas"("unidade_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "rotas_unidade_id_codigo_key" ON "rotas"("unidade_id", "codigo");

-- AlterTable
ALTER TABLE "acessos_portaria" ADD COLUMN     "rota_id" TEXT;

-- CreateIndex
CREATE INDEX "acessos_portaria_rota_id_idx" ON "acessos_portaria"("rota_id");

-- AddForeignKey
ALTER TABLE "rotas" ADD CONSTRAINT "rotas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_portaria" ADD CONSTRAINT "acessos_portaria_rota_id_fkey" FOREIGN KEY ("rota_id") REFERENCES "rotas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
