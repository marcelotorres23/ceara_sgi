-- F10: fila de saida das notificacoes (secao 5.5).
-- E-mail e WhatsApp deixam de ficar eternamente pendentes: passam a ter tentativa,
-- backoff e erro visivel. WhatsApp continua sendo canal de SAIDA apenas.

-- AlterTable
ALTER TABLE "notificacoes" ADD COLUMN     "descartada_em" TIMESTAMPTZ(3),
ADD COLUMN     "proxima_tentativa_em" TIMESTAMPTZ(3),
ADD COLUMN     "referencia_externa" TEXT,
ADD COLUMN     "tentativas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimo_erro" TEXT;

-- CreateIndex
CREATE INDEX "notificacoes_enviada_em_descartada_em_proxima_tentativa_em_idx" ON "notificacoes"("enviada_em", "descartada_em", "proxima_tentativa_em");

