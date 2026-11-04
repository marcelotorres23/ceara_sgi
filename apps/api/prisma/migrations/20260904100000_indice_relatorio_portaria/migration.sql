-- Relatorio de movimento da portaria recorta por unidade e periodo (secao 14.5).
-- Os indices existentes cobrem status e placa; nenhum cobre a janela de datas,
-- e sem este o relatorio de um mes varre a tabela inteira conforme ela cresce.
CREATE INDEX IF NOT EXISTS "acessos_portaria_unidade_id_created_at_idx"
  ON "acessos_portaria" ("unidade_id", "created_at");
