-- F10: idempotencia da importacao por arquivo. Reenviar o mesmo CSV do posto
-- interno nao pode duplicar abastecimento - e arquivo de posto vem repetido.

-- AlterTable
ALTER TABLE "abastecimentos" ADD COLUMN     "chave_importacao" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "abastecimentos_chave_importacao_key" ON "abastecimentos"("chave_importacao");

