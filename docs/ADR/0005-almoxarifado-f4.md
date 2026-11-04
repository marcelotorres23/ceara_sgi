# ADR 0005 — Almoxarifado (F4)

- **Data:** 2026-08-02
- **Status:** Aceito
- **Contexto:** M3 — saldos, movimentações, custo médio móvel, painel de alertas e inventário
  cíclico, mais a integração "recebimento aprovado → entrada no estoque" (seções 3 e 8).

## Decisões

### 1. Custo médio ponderado móvel só se move na entrada
`aplicarEntrada` recalcula `(saldo × custo_atual + entrada × custo_entrada) / novo_saldo`;
`aplicarSaida` consome pelo custo vigente e **não** mexe na média. É o comportamento do CMPM:
saída não cria nem destrói valor unitário.

Quando o saldo anterior é zero, a média recomeça pelo custo da entrada — sem isso, um item que
zerou carregaria para sempre a média de uma compra antiga.

### 2. Concorrência: `SELECT ... FOR UPDATE` na linha de saldo
Duas saídas simultâneas do mesmo item leriam o mesmo saldo e ambas passariam na checagem de
disponibilidade, deixando o estoque negativo. A movimentação inteira roda em transação com lock
na linha de `saldos`. O custo é serializar movimentações do mesmo item — aceitável, e é
exatamente o ponto onde a corretude importa.

### 3. Saldo negativo é conflito de negócio, não erro de programação
`aplicarSaida` lança `RangeError` (módulo puro, sem dependência de HTTP); o serviço traduz para
`ConflictError` → 409. A mensagem diz o disponível e o solicitado.

### 4. Gatilho de `movimentacoes` bloqueia DELETE, mas não UPDATE
Diferente de `auditoria`, que bloqueia os dois. O estorno precisa gravar `estornadaPor` na linha
original para ligar os dois lançamentos — bloquear `UPDATE` impediria o próprio mecanismo que
substitui a exclusão. O que a regra de ouro 2 exige é que **nada desapareça**, e o `DELETE`
bloqueado garante isso.

### 5. Item com pagamento retido não vira saldo disponível
`entradaPorRecebimento` filtra `pagamentoRetido`. Material avariado ou com divergência de preço
está fisicamente no pátio, mas não pode ser requisitado como estoque bom antes da tratativa.

**Consequência aceita:** quando *todos* os itens estão retidos, a rota responde 409 — não há
entrada a fazer. A mensagem poderia ser mais específica sobre o motivo; hoje diz apenas que não
há item conforme vinculado ao catálogo.

### 6. Saída por requisição exige veículo e OS, ainda sem FK
A seção 8.2 exige o vínculo para rastrear custo por ativo. `veiculos` e `ordens_servico` só
existem a partir da F5/F7, então os campos são texto validado como obrigatório, sem chave
estrangeira. **Pendência explícita para a F7:** transformar em FK e migrar os valores existentes.

### 7. O sistema sugere, o gestor confirma
`saldos.ponto_pedido_manual` marca a linha quando alguém fixa o valor em tela. `recalcularConsumo`
atualiza o consumo médio de todos, mas só sobrescreve o ponto de pedido das linhas não fixadas —
literalmente o que a seção 8.3 pede.

### 8. Contagem cega de verdade
`abrirInventario` congela `saldo_sistema` no banco e **devolve ao contador uma lista sem esse
campo**. Não adianta esconder na tela se a API entrega o número.

### 9. Alerta consolidado, um por varredura
O job das 06:00 envia **uma** notificação com o resumo por nível e as dez primeiras linhas, não
uma notificação por item. Caixa de entrada inundada deixa de ser alerta e vira ruído.

## Precedência do semáforo
Ruptura de item crítico → abaixo do mínimo → ponto de pedido → cobertura baixa → excesso →
sem giro → normal. A ordem importa: um item pode se enquadrar em vários, e o pior caso é o que
o almoxarife precisa ver.

Item **não crítico** com saldo zero cai em "abaixo do mínimo", não em "ruptura" — a seção 8.3
reserva ruptura para item crítico.

## O que F4 não entrega
- **Telas do módulo**: a API está completa; a UI de almoxarifado ainda não existe.
- **Botão "Gerar solicitação de compra"** do painel de alertas (seção 8.3): a rota de solicitação
  já aceita tudo que o alerta calcula (item, quantidade sugerida, origem, criticidade P4), mas o
  atalho que junta as duas coisas é de tela, não de API.
- **Endereçamento**: a tabela e o QR existem no schema; não há rota de movimentação por endereço.
- Curva ABC ainda é campo manual do item — o cálculo automático depende de histórico de consumo
  que só a F9 vai consolidar.
