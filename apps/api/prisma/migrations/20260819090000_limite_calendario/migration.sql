-- AlterTable
-- Limite de calendario por tipo (ADR 0023): oleo envelhece parado, e o que vencer primeiro manda.
ALTER TABLE "planos_servico_periodico" ADD COLUMN "limite_dias" INTEGER;

-- Padroes que a especificacao do painel da oficina trouxe, ja validados em campo.
UPDATE "planos_servico_periodico" SET "limite_dias" = 180 WHERE "tipo" IN ('OLEO_MOTOR', 'ALINHAMENTO', 'BALANCEAMENTO');
UPDATE "planos_servico_periodico" SET "limite_dias" = 730 WHERE "tipo" IN ('OLEO_DIFERENCIAL', 'OLEO_CAIXA_MARCHA');
UPDATE "planos_servico_periodico" SET "limite_dias" = 365 WHERE "tipo" = 'OLEO_THERMO_KING';
-- LUBRIFICACAO fica nula: a base dela ja e o calendario.
