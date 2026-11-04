-- Remove as origens de leitura do CTASmart (ADR 0023).
--
-- A integracao com a Sync API saiu do projeto: o hodometro continua vindo do abastecimento
-- registrado no proprio SGI, e leitura digitada continua sendo DIGITACAO. Nenhuma das duas
-- origens chegou a ser usada — a integracao nunca foi implementada.
--
-- Postgres nao remove valor de enum; o tipo e recriado sem eles.

ALTER TYPE "OrigemLeitura" RENAME TO "OrigemLeitura_old";

CREATE TYPE "OrigemLeitura" AS ENUM (
  'ABASTECIMENTO',
  'EXECUCAO_OFICINA',
  'CHECKLIST',
  'PORTARIA',
  'DIGITACAO',
  'IMPORTACAO_LEGADO'
);

ALTER TABLE "leituras"
  ALTER COLUMN "origem" TYPE "OrigemLeitura"
  USING ("origem"::text::"OrigemLeitura");

DROP TYPE "OrigemLeitura_old";
