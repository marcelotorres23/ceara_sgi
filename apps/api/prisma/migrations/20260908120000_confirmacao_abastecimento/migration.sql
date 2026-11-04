-- Agenda do dia (secao 7.2): o gestor de frota confere os abastecimentos lancados
-- no dia e marca cada um como confirmado. Sem isso o abastecimento fica valendo
-- so pela palavra de quem lancou, sem segundo olho.
ALTER TABLE "abastecimentos"
  ADD COLUMN "confirmado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "confirmado_em" TIMESTAMPTZ(3),
  ADD COLUMN "confirmado_por" TEXT;

CREATE INDEX IF NOT EXISTS "abastecimentos_data_hora_confirmado_idx"
  ON "abastecimentos" ("data_hora", "confirmado");
