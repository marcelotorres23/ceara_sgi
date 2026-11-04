-- CreateTable
CREATE TABLE "lote_notas" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lote_notas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lote_notas_lote_id_created_at_idx" ON "lote_notas"("lote_id", "created_at");

-- AddForeignKey
ALTER TABLE "lote_notas" ADD CONSTRAINT "lote_notas_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_notas" ADD CONSTRAINT "lote_notas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

