-- Solicitacao de material ou servico (secoes 6.1.1 e 6.1.11).
--
-- Quem abre a demanda diz o que esta pedindo. Nao e rotulo: material fecha com NF-e, que
-- tem chave de 44 digitos conferida contra o CNPJ do emitente; servico fecha com NFS-e
-- municipal, que nao tem chave nenhuma. Sem o tipo, a entrada fiscal do servico esbarrava
-- numa validacao de chave que a nota dele nunca vai ter.
--
-- Tudo que existe hoje e material: e o unico fluxo que o sistema tinha ate agora.

CREATE TYPE "TipoDemanda" AS ENUM ('MATERIAL', 'SERVICO');

ALTER TABLE "solicitacoes" ADD COLUMN "tipo" "TipoDemanda" NOT NULL DEFAULT 'MATERIAL';

-- Denormalizado das solicitacoes, como `unidade_id`: o lote nao mistura os dois, e a
-- entrada fiscal precisa saber qual documento esperar sem varrer as solicitacoes.
ALTER TABLE "lotes" ADD COLUMN "tipo" "TipoDemanda" NOT NULL DEFAULT 'MATERIAL';

CREATE INDEX "solicitacoes_tipo_status_idx" ON "solicitacoes" ("tipo", "status");
