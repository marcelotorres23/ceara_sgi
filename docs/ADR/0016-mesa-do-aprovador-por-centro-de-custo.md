# ADR 0016 — Mesa do aprovador com histórico por centro de custo (placa)

- **Status**: aceito
- **Data**: 05 de agosto de 2026
- **Contexto do documento mestre**: seção 6.1.7 (aprovação por alçada), seção 6.4 (alçadas e SoD),
  seção 5.4 (centros de custo), seção 7.1 (veículos)

## Contexto

A API já decidia aprovação (`POST /compras/lotes/:id/aprovacao`), mas **não havia tela do
aprovador**: a decisão só era alcançável pelo detalhe do lote, uma aba pensada para o trabalho do
comprador. Quem aprova não navega pelo funil de cotação — ele quer a fila do que está parado nele.

E faltava o contexto que sustenta a decisão. Na operação de frota, **cada placa é um centro de
custo**: aprovar R$ 2.300 de pneu não significa nada isolado; significa muito se aquela placa já
consumiu R$ 49.350 em pneus nos últimos meses. O aprovador enxergava o valor do lote e nada do
gasto acumulado do caminhão.

O vínculo placa → centro de custo já existia no schema (`veiculos.centro_custo_id`) e nunca fora
usado em tela. Nenhuma mudança de schema foi necessária.

## Decisões

### 1. Uma tela dedicada, com a fila e a decisão no mesmo lugar

`/aprovacoes` lista os lotes em `AGUARDANDO_APROVACAO` do escopo do usuário, com valor, faixa de
alçada, centro de custo com a placa, e **SLA em horas úteis** (não corridas — lote submetido na
sexta à tarde não "atrasa" no domingo). Ao selecionar um lote, abre-se o histórico da placa e, logo
abaixo, as quatro decisões da seção 6.1.7.

A permissão da tela e da rota de fila é `lote:aprovar`. A decisão continua em
`service.decidirAprovacao` — alçada, SoD e máquina de estados seguem no servidor, e a tela apenas
avisa quando o usuário é o comprador ou solicitante do lote, sem travar: quem decide isso é a SoD.

### 2. Histórico é do centro de custo, não do lote

`GET /compras/centros-custo/:id/historico` devolve, na janela pedida (padrão 12 meses): total
pedido, total em andamento, ticket médio, gasto do mês contra o orçamento mensal, série por
competência, os dez itens que mais consomem a placa e a lista de compras.

Entram **duas situações**: o que já virou pedido (valor apurado) e o que está em andamento (lote
sem pedido, valor estimado). Negar um lote sem saber que há outros três abertos para a mesma placa
é decidir no escuro. Lote sem valor apurado aparece com traço, nunca R$ 0,00 — zero se lê como
"sem custo".

### 3. Lote misto é rateado, e a tela diz que é rateio

Um lote pode agrupar solicitações de placas diferentes — foi para isso que a triagem existe. Regra
(módulo puro `rateio-centro-custo.ts`, com teste): lote de um único centro entra pelo valor cheio;
lote misto rateia pela quantidade de itens de cada solicitação, e a parcela sai marcada como
`rateado` para a tela não apresentar estimativa como gasto apurado. A sobra de centavos da divisão
vai para a maior parcela — um centavo perdido por lote desalinharia o histórico do centro do total
comprado.

O rateio por itens é um *proxy*: não há vínculo entre `pedido_itens` e `solicitacao_itens` que
permita rateio por valor real. Quando esse vínculo existir, troca-se o peso sem mexer no resto.

## Consequências

- O aprovador vê o gasto do caminhão antes de decidir, e não depois no relatório de spend.
- O campo `veiculos.centro_custo_id` deixa de ser decorativo: **sem ele preenchido, a tela mostra o
  código do centro sem placa**. Cadastrar veículo sem centro de custo passa a ter custo visível.
- O convite operacional é um centro de custo por placa. O modelo não força 1:1 — a tela lista todas
  as placas do centro — mas é com 1:1 que o número responde "quanto este caminhão custou".
- Nada de exclusão ou alteração de dado existente: as duas rotas novas são de leitura.
