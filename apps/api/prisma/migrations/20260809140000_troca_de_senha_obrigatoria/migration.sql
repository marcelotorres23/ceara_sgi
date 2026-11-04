-- AlterTable: senha definida por terceiro exige troca no primeiro acesso (secao 5.1)
ALTER TABLE "usuarios" ADD COLUMN "deve_trocar_senha" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "usuarios" ADD COLUMN "senha_trocada_em" TIMESTAMPTZ(3);