# ADR 0003 — Painel Kanban e follow-up (F2)

- **Data:** 2026-08-02
- **Status:** Aceito
- **Contexto:** Painel do comprador (seção 6.3), jobs de SLA e D-2 (seção 6.1.9) e notificações.

## Decisões

### 1. O drop no board é só um atalho para a máquina de estados
`POST /compras/painel/mover` chama a mesma `transicionarLote` usada pelo restante do sistema.
O frontend tem uma cópia da tabela de transições apenas para dar retorno imediato — pintar a
coluna válida e recusar o drop óbvio. **A decisão é sempre do servidor**: se as duas divergirem,
vale a do backend, e a UI mostra o erro que ele devolveu.

Duplicar a tabela é um custo aceito conscientemente. A alternativa — expor as transições por API
e carregá-las no board — evita a duplicação, mas troca um dado estável por uma chamada extra a
cada abertura de painel. Se a máquina de estados passar a mudar com frequência, vale reavaliar.

### 2. Motivo obrigatório é decidido nos dois lados, com a mesma regra
Movimento para estado lateral (devolvido, renegociação, reprovado, cancelado, bloqueado) **ou**
qualquer retrocesso no fluxo abre modal e só conclui com o texto preenchido — exatamente o que a
seção 6.3 exige. O backend recusa de novo se o motivo não vier: a UI é conveniência, não guarda.

### 3. Valor não apurado é `—`, não `R$ 0,00`
Lote antes do mapa de cotação não tem valor. Exibir zero faz o comprador ler "lote sem custo" e
subverte o KPI de valor em negociação. O card mostra `— (nao cotado)`.
Descoberto olhando a tela, não em teste.

### 4. Sensor de teclado além do ponteiro
`@dnd-kit` recebeu `KeyboardSensor` junto do `PointerSensor`, e o card ganhou `tabIndex` e
`aria-roledescription`. Mover lote não pode depender de mouse.

### 5. "Lida" só existe para o canal IN_APP
`notificar()` grava uma linha por canal ativo. Como só o in-app é entregue hoje, marcar tudo como
lido apagaria a fila pendente de e-mail assim que o adaptador existir. `marcarTodasComoLidas`
filtra por `canal: 'IN_APP'`.

Descoberto por um teste que comparava o contador do sino com o retorno da marcação: o sino contava
1 e a marcação devolvia 2.

### 6. A API sobe sem Redis, com os jobs desligados e aviso no log
`registrarJobsDeCompras` testa a conexão antes de criar workers. Sem Redis, loga um `warn` e
devolve `false`; `/health` passa a responder `"jobs":"desligados"`. Nunca falha em silêncio,
e nunca derruba a API por causa de uma dependência de trabalho assíncrono.

**Nome de fila não pode conter `:`** — o BullMQ usa dois-pontos nas próprias chaves do Redis e
rejeita na criação do worker. As filas se chamam `compras-sla-vencendo` e `compras-entrega-d2`.

### 7. Índices criados em SQL precisam existir no datamodel
`idx_auditoria_cadeia` foi criado pela migration de append-only, fora do schema Prisma. Consequência:
**todo `migrate diff` seguinte gerava um `DROP INDEX`** para ele — a migration de `lote_notas` já
vinha com o drop embutido. Um deploy teria removido, em silêncio, o índice que sustenta a
verificação de integridade da trilha.

Agora o índice está declarado em `Auditoria` com `@@index([timestamp, id], map: "idx_auditoria_cadeia")`.
Regra para as próximas fases: **objeto de banco criado por SQL cru e não representável no schema
tem que ser conferido em todo diff**; se for representável, declare no schema.

## O que F2 não entrega
- **Detalhe do lote em tela**: o card abre por duplo clique, mas a rota de detalhe ainda não existe.
  A API já devolve tudo em `GET /compras/lotes/:id`.
- Telas de cadastro (itens, fornecedores, solicitação, cotação, mapa): a F2 entrega o painel de
  acompanhamento; a captura de dados continua pela API.
- Anexos no card: contador fixo em zero até o storage entrar (F6).
- Sem *error boundary* no board — uma exceção em um card derruba o painel inteiro. Vale corrigir
  antes de colocar o comprador para operar de verdade.

## Verificação pendente
O **arrastar-e-soltar não foi exercitado por mim**. Nem o ponteiro nem o teclado completaram o
movimento através da automação de navegador disponível, e não consegui distinguir limitação do
harness de defeito real. O contrato do servidor está provado (422 em transição inválida, recusa
sem motivo, aceite com motivo), e o board renderiza com os cards nas colunas certas — mas o gesto
em si precisa de conferência manual.
