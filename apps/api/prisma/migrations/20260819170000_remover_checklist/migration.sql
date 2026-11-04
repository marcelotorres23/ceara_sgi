-- Remocao do modulo de checklist (ADR 0024).
--
-- Decisao do dono do produto, tomada com o alcance na mesa: 23 checklists, 489 respostas,
-- 24 fotos e 4 modelos deixam de existir. Contraria a regra de ouro 2 (nada se exclui) de
-- forma consciente e registrada. Um dump dos dados foi tirado antes da execucao.

-- A leitura de medidor sobrevive ao checklist: o valor lido e historico de hodometro, e
-- nao dado de checklist. So o vinculo com o documento de origem cai, porque o documento
-- deixou de existir.
ALTER TABLE "leituras" DROP COLUMN IF EXISTS "checklist_id";

-- As fotos apontam para respostas, que apontam para checklists: a ordem importa.
DROP TABLE IF EXISTS "checklist_fotos";
DROP TABLE IF EXISTS "checklist_respostas";
DROP TABLE IF EXISTS "checklists";
DROP TABLE IF EXISTS "checklist_itens_modelo";
DROP TABLE IF EXISTS "checklist_grupos";
DROP TABLE IF EXISTS "checklist_modelos";

DROP TYPE IF EXISTS "StatusChecklist";
DROP TYPE IF EXISTS "TipoChecklist";
DROP TYPE IF EXISTS "TipoRespostaItem";
DROP TYPE IF EXISTS "ExigenciaFoto";

-- A sequencia de numeracao do checklist nao serve mais a ninguem.
DELETE FROM "sequencias" WHERE "chave" = 'CHK';

-- Criterios de pontuacao que so existiam por causa do checklist saem de circulacao.
-- Nao se apagam: ocorrencias ja lancadas neles continuam valendo (secao 9.2).
UPDATE "criterios_pontuacao" SET "ativo" = false
 WHERE "codigo" IN ('CHECKLIST_INTEGRAL', 'CHECKLIST_NAO_REALIZADO', 'CHECKLIST_SEM_FOTO');
