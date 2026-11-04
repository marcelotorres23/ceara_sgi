# ADR 0025 — Perfis válidos por construção

- **Status**: aceito
- **Data**: 2026-08-21
- **Contexto**: seções 5.1, 5.2 e 5.3 do documento mestre; regra de ouro 5.

## Contexto

Uma revisão dos 12 perfis padrão contra o catálogo de permissões e contra as rotas que de fato
as exigem encontrou quatro divergências. Nenhuma aparecia como erro: o sistema subia, o seed
rodava e as telas funcionavam. É o tipo de defeito que só se manifesta no dia em que alguém usa
a credencial que não deveria ter.

1. **`abastecimento:registrar` virou duas coisas.** Quando o módulo de tanque e a entrada de
   combustível por XML foram escritos, reusaram a permissão do abastecimento. O Motorista tem
   exatamente uma permissão — essa. Na prática, a credencial que registra o próprio abastecimento
   também lançava entrada de combustível no tanque do pátio, transferia entre tanques e aferia a
   régua. É o controle se anulando: quem consome lança o volume que cobre o consumo.

2. **A vedação do Administrador barrava três permissões de doze.** `lote:aprovar`,
   `recebimento:registrar` e `nota_fiscal:lancar` saíam do perfil, mas `cotacao:gerenciar`,
   `mapa:gerar`, `pedido:emitir`, `lote:criar`, `solicitacao:triar`, `movimentacao:registrar`,
   `inventario:gerenciar` e `titulo:gerenciar` ficavam. `CONFLITOS_DE_PERFIL` proíbe que um mesmo
   usuário acumule Administrador e Comprador — e o perfil Administrador continha o Comprador
   inteiro. A matriz proibia entre perfis o que ela mesma semeava dentro de um.

3. **O Auditor não alcançava a rede.** A lista dele é derivada por sufixo (`:listar`,
   `:consultar`). `unidade:todas` não termina em nenhum dos dois, então caía fora — e o auditor
   ficava preso à unidade onde estivesse lotado, o oposto do que a descrição do perfil promete.

4. **`colaborador:gerenciar` não pertencia a nenhum perfil operacional.** A tela de cadastro de
   colaboradores, entregue com o painel de pessoas, só era alcançável pelo Administrador.

5. **O board de compras dava aprovação de graça.** `POST /compras/painel/mover` — e a irmã
   `POST /compras/lotes/:id/transicao` — exigiam apenas `lote:consultar` e chamavam a máquina de
   estados direto. A máquina de estados só sabe se o caminho existe; não sabe quem está
   empurrando o card nem se o valor cabe na alçada de quem empurra. Resultado: o Comprador
   arrastava o card para "Aprovado" e pulava, de uma vez, a permissão `lote:aprovar`, a faixa de
   alçada e a SoD que impede quem cotou de aprovar o próprio lote. O mesmo atalho alcançava
   `PEDIDO_EMITIDO` sem `pedido:emitir`, `RECEBIDO` sem three-way match e `NF_LANCADA` sem
   entrada fiscal. Encontrado pelo usuário arrastando um card na tela.

A causa comum das quatro primeiras: **o seed nunca passou pela validação que a tela aplica.**
`validarPermissoesDoPerfil` existia e era chamada em `PATCH /perfis/:id`, mas o seed montava os
vínculos direto. Regra que só vale numa das duas portas não é regra.

## Decisão

1. **`tanque:operar` é permissão própria.** Entrada de combustível, leitura de XML da NF-e,
   transferência entre tanques, saída de acerto e aferição passam a exigi-la.
   `abastecimento:registrar` continua abrindo o abastecimento e as **consultas** de tanque e
   produto, que o motorista precisa para trabalhar. Concedida ao Gestor de Frota.

2. **A vedação do Administrador cobre a cadeia inteira** de compras, o recebimento, a
   movimentação de estoque, o inventário e o contas a pagar — doze permissões, listadas em
   `PERMISSOES_VEDADAS_AO_ADMIN`. Consultar continua liberado: administrar inclui enxergar.

3. **`unidade:todas` entra explicitamente no Auditor.** Ela amplia o alcance da leitura sem
   conceder escrita (seção 5.6).

4. **`colaborador:gerenciar` vai para a Gerência**, junto de `preventiva:consultar`.

5. **Arrastar cobra a mesma permissão que a tela.** `state-machine.ts` ganha duas tabelas puras:
   `DESTINOS_COM_ATO_PROPRIO` (aprovar, reprovar, emitir pedido, receber, lançar NF, encerrar —
   recusados no arrasto, com a mensagem apontando a tela certa) e `PERMISSAO_POR_DESTINO` (a
   permissão que cada destino restante cobra). Destino novo na máquina de estados entra
   **fechado** até ganhar dono explícito, para que um estado futuro não vire atalho por
   esquecimento. As duas rotas de transição passam por `garantirArrasto`, que audita a negativa
   com severidade de alerta — tentar aprovar arrastando é exatamente o que a trilha precisa
   registrar. A checagem mora no handler, e não no `preHandler`, porque depende do corpo: só
   lendo `para` se sabe se o movimento é "mandar cotar" ou "aprovar".

6. **Os perfis padrão saem do seed** para `modules/governanca/perfis-padrao.ts`, e **o seed
   valida cada um** com `validarPermissoesDoPerfil` antes de gravar, falhando com erro se algum
   não passar. Enquanto eram constante local de um script que se executa no import, nenhum teste
   conseguia olhar para eles.

## Consequências

- O Administrador **deixa de conseguir operar compras e almoxarifado**. Isso é a decisão, não um
  efeito colateral: em produção, quem administra o sistema não monta lote nem dá baixa em
  estoque. Em desenvolvimento, `seed-demo.ts` já cria um usuário por perfil, e os smokes de
  compras já criavam os próprios operadores — nenhum deles dependia do admin para isso.
- Rodar `npm run db:seed` é obrigatório para que as mudanças cheguem ao banco: os vínculos de
  perfil são reescritos a cada seed.
- Um perfil inválido agora **quebra o seed** em vez de entrar calado no banco.
- Duas frentes de guarda: `perfis-padrao.test.ts` prova que a definição é coerente (incluindo
  "nenhuma permissão do catálogo fica sem dono"); `npm run smoke:perfis` cria um usuário
  descartável por perfil e prova que o servidor devolve 403 no que a definição proíbe.

## Alternativas consideradas

- **Matriz de conflitos entre pares de permissões**, proibindo por exemplo `cotacao:gerenciar` +
  `lote:aprovar` no mesmo perfil. Descartada: o Coordenador de Suprimentos tem os dois de
  propósito, e o que impede o abuso é a checagem em runtime por documento (`avaliarSod`), que já
  recusa o comprador aprovar o próprio lote. Proibir o par no perfil quebraria um desenho
  deliberado sem fechar nenhum buraco real.
- **Deixar o Administrador como está e apenas documentar.** Descartada: CLAUDE.md e a seção 5.3
  são explícitos em que a segregação vale inclusive para o Administrador.

## Em aberto

- **`movimentacao:registrar` + `inventario:gerenciar` no mesmo perfil Almoxarife.** Quem
  movimenta o estoque também fecha a contagem que revelaria a diferença, e não há checagem de
  runtime para esse par. Separar é decisão de negócio — em operação pequena costuma ser a mesma
  pessoa mesmo. Fica registrado, não alterado.
- **`veiculo:gerenciar` ainda governa o cadastro de tanques e bicos**, o que é semanticamente
  torto (tanque não é veículo). Não é brecha — quem tem uma tem a outra —, mas merece um nome
  próprio quando o módulo de tanque for mexido de novo.
