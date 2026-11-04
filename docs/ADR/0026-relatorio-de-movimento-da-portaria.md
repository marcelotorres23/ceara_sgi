# ADR 0026 — relatório de movimento de veículos da portaria

- **Status**: aceito
- **Data**: 04 de setembro de 2026
- **Contexto do documento mestre**: seção 14.5 (indicadores e relatório), seção 10.3 (implementação
  de relatórios), seção 13 (regras)

## Contexto

Pedido: a portaria registra entrada e saída de veículos e isso precisa virar **relatório emitido por
período**, com placa, rota e motorista tanto no registro quanto no relatório.

O registro já existia desde F12 (ADR 0017) e já guardava os três campos — `veiculo`/`placaExterna`,
`rota` e `motorista`. O que faltava era a saída: o histórico do portão é uma listagem paginada por
cursor, feita para procurar um movimento específico, não para fechar um mês e mandar para alguém.

## Decisões

### 1. O período recorta pelo registro na guarita

`created_at`, e não o evento de fechamento. O porteiro registra no instante em que o veículo cruza o
portão, então o registro **é** o evento. A alternativa — recortar pelo fechamento — deixaria de fora
o caminhão que saiu no dia 31 e voltou em setembro, que é justamente o movimento que a operação quer
ver no mês da saída. Ele aparece pela saída, com o retorno exibido mesmo fora do período.

Isso também mantém coerência com o filtro `de`/`ate` que o histórico já usava: dois relatórios da
mesma tela que recortassem por datas diferentes dariam números diferentes para a mesma pergunta.

### 2. Só veículo

Pessoa a pé tem o próprio histórico. Misturar visitante no relatório de frota faria o total de
"movimentos" responder a duas perguntas ao mesmo tempo, e nenhuma delas bem.

### 3. A apuração é módulo puro, e não fica na rota

`relatorio.ts` recebe as linhas do banco e devolve linha e totais. A mesma conta vale na tela, no
XLSX e no teste — relatório que calcula diferente em cada saída não serve como prova documental, que
é o princípio do módulo (seção 14).

A inversão dos eventos do caminhão da casa (abre na saída, fecha no retorno) vive aí dentro, testada:
é a regra que mais confunde quem lê o relatório, e a que mais erra se for reescrita em cada lugar.

### 4. Média só do que fechou, e nulo em vez de zero

Movimento em aberto tem permanência ainda correndo; entrar na média a puxaria para baixo. Sem
movimento encerrado no recorte, o indicador é **nulo** e a tela diz "sem base" — zero afirmaria que se
mediu e deu zero (seção 10.3).

### 5. Teto de 5.000 linhas, declarado

Relatório não varre a tabela inteira em request síncrono (seção 13). Acima do teto a resposta marca
`truncado` e a tela pede para dividir o período. Preferiu-se truncar dizendo a truncar calado — total
pela metade apresentado como total é pior que recorte recusado.

Um índice `(unidade_id, created_at)` acompanha a decisão: os índices existentes cobriam status e
placa, nenhum cobria a janela de datas.

### 6. Exportação auditada

`portaria:consultar` emite e exporta; `portaria:operar` continua sendo só registrar. A exportação
grava auditoria com período, unidades e número de linhas — arquivo de portaria responde por quem
estava onde, e precisa constar quem levou.

## Consequências

- A gestão fecha o mês do portão sem pedir consulta ao banco.
- O XLSX sai com a marca e com a memória de cálculo, como todo relatório do sistema.
- **Fora de escopo por ora**: agrupamento por rota ou por motorista no próprio relatório (hoje se faz
  filtrando), e agendamento de envio por e-mail.
