-- AlterTable
-- Registros usuais do cadastro do colaborador (secao 9.1). A foto ja existia na tabela.
ALTER TABLE "colaboradores" ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "telefone" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "data_nascimento" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_cpf_key" ON "colaboradores"("cpf");
