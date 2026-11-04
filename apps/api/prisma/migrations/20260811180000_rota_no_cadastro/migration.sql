-- AlterTable
ALTER TABLE "rotas" ADD COLUMN     "inativado_em" TIMESTAMPTZ(3),
ADD COLUMN     "inativado_por" TEXT,
ADD COLUMN     "motivo_inativacao" TEXT;

-- Rota ja inativada pela importacao ganha a trilha que o cadastro exige.
UPDATE "rotas"
   SET "inativado_em" = COALESCE("inativado_em", "updated_at"),
       "motivo_inativacao" = COALESCE("motivo_inativacao", "observacao", 'Inativada antes do cadastro em tela.')
 WHERE "ativo" = false;
