-- F9 · BI: views materializadas (secao 10.3).
--
-- Relatorio nao roda calculo pesado em request sincrono. Estas views sao
-- atualizadas por job (BullMQ) e consultadas direto pelas rotas de relatorio.
--
-- Todas trazem `unidade_id`: o recorte por unidade da secao 5.6 vale tambem no BI.
-- Todas tem indice UNICO, exigencia do REFRESH MATERIALIZED VIEW CONCURRENTLY,
-- que atualiza sem bloquear a leitura.

-- ---------------------------------------------------------------- spend analysis
-- Gasto por unidade, competencia, categoria e fornecedor (secao 10.2).
-- A base e o PEDIDO EMITIDO, nao o titulo: o compromisso nasce na emissao,
-- e e nele que a gestao de suprimentos consegue agir.
CREATE MATERIALIZED VIEW mv_spend_mensal AS
SELECT
  l.unidade_id,
  to_char(p.created_at AT TIME ZONE 'America/Fortaleza', 'YYYY-MM') AS competencia,
  COALESCE(f.nome, 'Sem familia')                                   AS categoria,
  p.fornecedor_id,
  forn.razao_social                                                 AS fornecedor,
  COUNT(DISTINCT p.id)                                              AS pedidos,
  SUM(pi.quantidade * pi.preco_unitario)                            AS valor
FROM pedidos p
JOIN lotes l          ON l.id = p.lote_id
JOIN pedido_itens pi  ON pi.pedido_id = p.id
JOIN fornecedores forn ON forn.id = p.fornecedor_id
LEFT JOIN itens i     ON i.id = pi.item_id
LEFT JOIN familias f  ON f.id = i.familia_id
WHERE p.deleted_at IS NULL
  AND p.status <> 'CANCELADO'
GROUP BY l.unidade_id, competencia, categoria, p.fornecedor_id, forn.razao_social;

CREATE UNIQUE INDEX mv_spend_mensal_chave
  ON mv_spend_mensal (unidade_id, competencia, categoria, fornecedor_id);

CREATE INDEX mv_spend_mensal_competencia ON mv_spend_mensal (competencia);

-- ---------------------------------------------------------------- KPIs de compras
-- Os 13 KPIs do POP (secao 6.6) que dependem de agregacao pesada.
-- Lead time em DIAS CORRIDOS aqui; o SLA em horas uteis continua no modulo puro,
-- porque expediente e feriado sao parametro e nao cabem na view.
CREATE MATERIALIZED VIEW mv_kpis_compras AS
WITH cotacoes_por_lote AS (
  SELECT lote_id, COUNT(*) FILTER (WHERE respondida_em IS NOT NULL) AS propostas
  FROM cotacoes
  WHERE deleted_at IS NULL
  GROUP BY lote_id
)
SELECT
  l.unidade_id,
  to_char(l.created_at AT TIME ZONE 'America/Fortaleza', 'YYYY-MM') AS competencia,
  COUNT(*)                                                          AS lotes,
  COUNT(*) FILTER (WHERE l.status = 'ENCERRADO')                    AS lotes_encerrados,
  COUNT(*) FILTER (WHERE l.status = 'CANCELADO')                    AS lotes_cancelados,
  COUNT(*) FILTER (WHERE l.criticidade = 'P1')                      AS lotes_emergenciais,
  COUNT(*) FILTER (WHERE COALESCE(c.propostas, 0) >= 3)             AS lotes_com_tres_propostas,
  COUNT(*) FILTER (WHERE l.valor_estimado > 1000)                   AS lotes_acima_de_mil,
  -- dentro do SLA: aprovado antes do vencimento. Lote sem aprovacao nao entra na conta
  COUNT(*) FILTER (WHERE l.aprovado_em IS NOT NULL AND l.sla_vence_em IS NOT NULL
                     AND l.aprovado_em <= l.sla_vence_em)           AS lotes_no_sla,
  COUNT(*) FILTER (WHERE l.aprovado_em IS NOT NULL AND l.sla_vence_em IS NOT NULL) AS lotes_com_sla,
  AVG(EXTRACT(EPOCH FROM (l.aprovado_em - l.created_at)) / 86400)
    FILTER (WHERE l.aprovado_em IS NOT NULL)                        AS lead_time_ate_aprovacao_dias,
  SUM(COALESCE(l.savings, 0))                                       AS savings,
  SUM(COALESCE(l.valor_fechado, l.valor_estimado, 0))               AS valor_negociado
FROM lotes l
LEFT JOIN cotacoes_por_lote c ON c.lote_id = l.id
WHERE l.deleted_at IS NULL
GROUP BY l.unidade_id, competencia;

CREATE UNIQUE INDEX mv_kpis_compras_chave ON mv_kpis_compras (unidade_id, competencia);

-- ---------------------------------------------------------------- posicao de estoque
-- Posicao valorizada por item e almoxarifado (secao 8.5), com dias sem giro.
-- A curva ABC NAO e calculada aqui: ela depende do universo consultado
-- (unidade ou rede) e sai no modulo puro, sobre estas linhas.
CREATE MATERIALIZED VIEW mv_estoque_posicao AS
SELECT
  a.unidade_id,
  s.almoxarifado_id,
  a.codigo                                    AS almoxarifado,
  s.item_id,
  i.codigo                                    AS item_codigo,
  i.descricao                                 AS item_descricao,
  i.critico,
  s.quantidade,
  s.custo_medio,
  ROUND(s.quantidade * s.custo_medio, 2)      AS valor,
  s.consumo_medio_mensal,
  s.ultima_movimentacao_em,
  CASE
    WHEN s.ultima_movimentacao_em IS NULL THEN NULL
    ELSE EXTRACT(DAY FROM (now() - s.ultima_movimentacao_em))::int
  END                                         AS dias_sem_giro
FROM saldos s
JOIN almoxarifados a ON a.id = s.almoxarifado_id
JOIN itens i         ON i.id = s.item_id
WHERE a.deleted_at IS NULL
  AND i.deleted_at IS NULL;

CREATE UNIQUE INDEX mv_estoque_posicao_chave ON mv_estoque_posicao (almoxarifado_id, item_id);
CREATE INDEX mv_estoque_posicao_unidade ON mv_estoque_posicao (unidade_id);

-- ---------------------------------------------------------------- OTIF do fornecedor
-- Entrega no prazo E completa (secao 6.1.12). "No prazo" compara o recebimento
-- com a data PROMETIDA original; reprogramacao nao apaga o atraso (secao 6.1.9).
CREATE MATERIALIZED VIEW mv_otif_fornecedor AS
SELECT
  l.unidade_id,
  p.fornecedor_id,
  f.razao_social                                                     AS fornecedor,
  to_char(p.created_at AT TIME ZONE 'America/Fortaleza', 'YYYY-MM')  AS competencia,
  COUNT(*)                                                           AS pedidos,
  COUNT(*) FILTER (WHERE r.recebido_em IS NOT NULL)                  AS entregues,
  COUNT(*) FILTER (
    WHERE r.recebido_em IS NOT NULL
      AND p.data_prometida IS NOT NULL
      AND r.recebido_em <= p.data_prometida
      AND r.status = 'ACEITE_TOTAL'
  )                                                                  AS otif,
  COUNT(*) FILTER (WHERE r.status IN ('ACEITE_PARCIAL', 'RECUSADO'))  AS com_divergencia
FROM pedidos p
JOIN lotes l         ON l.id = p.lote_id
JOIN fornecedores f  ON f.id = p.fornecedor_id
LEFT JOIN recebimentos r ON r.pedido_id = p.id AND r.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND p.status <> 'CANCELADO'
GROUP BY l.unidade_id, p.fornecedor_id, f.razao_social, competencia;

CREATE UNIQUE INDEX mv_otif_fornecedor_chave
  ON mv_otif_fornecedor (unidade_id, fornecedor_id, competencia);
