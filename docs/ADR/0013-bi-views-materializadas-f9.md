# ADR 0013 — F9: BI com views materializadas e exportação

- **Status**: aceito
- **Data**: 03 de agosto de 2026
- **Contexto do documento mestre**: seção 10 (BI), seção 6.6 (KPIs do POP), seção 8.5 (relatórios de estoque), seção 5.6 (multiunidade)

## Decisões

### 1. Agregação em view materializada, atualizada por job

Quatro views: `mv_spend_mensal`, `mv_kpis_compras`, `mv_estoque_posicao`, `mv_otif_fornecedor`.
Todas com `unidade_id` — o recorte da seção 5.6 vale no BI — e todas com **índice único**, exigência
do `REFRESH MATERIALIZED VIEW CONCURRENTLY`, que atualiza sem bloquear quem está lendo o painel.

O job roda de hora em hora **aos 10 minutos**, para não concorrer com a varredura de SLA que roda
na virada da hora. Há rota manual (`POST /relatorios/atualizar`) para quando alguém precisa do número
logo após um lançamento; ela é auditada.

O painel devolve `dadosAtualizadosEm`. Número de BI sem carimbo de data leva alguém a decidir sobre
um dado de ontem achando que é de agora.

### 2. Sem base devolve `null`, nunca zero

Regra do módulo de indicadores inteiro. Zero afirma "medi e deu zero"; `null` afirma "não há o que
medir". Um painel de savings mostrando 0% num mês sem compras é uma afirmação falsa sobre a operação.
A UI traduz `null` como "sem base".

### 3. Cada KPI carrega a própria fórmula e a própria meta

`{ valor, meta, dentroDaMeta, formula }`. A seção 10.3 exige memória de cálculo visível; deixá-la
junto do número, e não numa página de ajuda, é o que garante que ela chegue à pessoa que decide.
Onde menor é melhor (taxa de emergencial), `dentroDaMeta` inverte a comparação.

### 4. Concentração de fornecedores usa HHI, não só "o maior fornecedor"

Duas carteiras com o mesmo líder de 40% podem ter riscos bem diferentes: 40/30/30 não é
40/2/2/2/… O índice Herfindahl-Hirschman (soma dos quadrados das participações) separa os dois casos,
e a classificação de risco sai dele. Fonte única é sinalizada explicitamente.

### 5. A curva ABC é calculada sobre o universo consultado, não na view

A faixa de um item depende de com quem ele está sendo comparado: o mesmo item pode ser A na filial e
C na rede. Congelar a curva na view daria a resposta errada para metade dos recortes.

O corte usa comparação em `Decimal`, não em `float`: subtrair percentuais em ponto flutuante
produzia `0,95 − 0,15 = 0,7999…`, e o item que fecha a faixa A caía em B. O teste que pegou isso
ficou no repositório.

### 6. Base zero não vira "aumento de 100%"

No comparativo mês a mês, sair de zero para qualquer coisa é variação infinita — e infinito não é
informação. O percentual sai `null` e a diferença absoluta continua sendo mostrada.

### 7. Unidade inexistente é 404, não relatório zerado

Quem tem `unidade:todas` alcança qualquer unidade — inclusive um id que não existe, e aí o relatório
sairia todo zerado *como se aquele fosse o número da unidade*. `core/rbac/unidades.ts` confere a
existência antes de consultar. Zero apurado e zero por erro de digitação são coisas diferentes.

### 8. Exportação XLSX com marca e memória de cálculo em aba separada

Toda planilha sai com três blocos: cabeçalho identificado (título, recorte, quem gerou, quando),
os dados formatados (dinheiro, percentual, decimal — o Excel precisa receber número, não texto), e a
**aba "Memoria de calculo"**. Número exportado que não carrega a memória vira número órfão na caixa
de entrada de alguém.

As cores são as da seção 4.1: cabeçalho azul, filete dourado, zebra em névoa.
Toda exportação é auditada, com o recorte e a quantidade de linhas.

## Fora do escopo desta fase

- **PDF com a marca**: a seção 10.3 pede XLSX **e** PDF. Só o XLSX foi entregue. O PDF depende do
  Puppeteer, que baixa um Chromium de algumas centenas de MB — instalá-lo é uma decisão de infra que
  cabe a você, não uma escolha a tomar em silêncio. Vale para os PDFs pendentes das outras fases
  (checklist impresso, mapa de cotação, pedido, extrato individual do colaborador).
- **Gráficos no painel executivo**: os números estão na tela; a série visual com Recharts (evolução
  de 12 meses já é devolvida por `/relatorios/compras/kpis`) ainda não foi montada.
- **Gasto versus orçado** (seção 10.1): `centros_custo.orcamento_mensal` existe no schema, mas não há
  tela de orçamento nem lançamento; comparar contra um campo que ninguém preenche daria falsa precisão.
