# ADR 0024 — Remoção do módulo de checklist

- **Status**: aceito
- **Data**: 19 de agosto de 2026
- **Contexto do documento mestre**: seção 7.3 (checklist), 7.2 (abastecimento), 9.1 (pontuação), 10.1 (painel executivo)
- **Revoga**: F6 inteira, e as partes das seções 7.2, 9.1 e 10.1 que dependiam dela

## Contexto

O checklist digital era a F6: modelo versionado com grupos e itens, execução offline no PWA do
motorista, foto com marca d'água, assinatura, bloqueio de saída por item crítico e abertura
automática de OS corretiva. Estava em produção com **23 checklists, 489 respostas, 24 fotos e
4 modelos**.

O dono do produto determinou a remoção do módulo. A decisão foi tomada com o alcance na mesa —
inclusive o aviso de que apagar os dados **contraria a regra de ouro 2** do documento mestre
("nada se exclui"), e de que outras seis regras dependiam do checklist para existir.

## Decisão

Remover o módulo por inteiro: código da API e da web, permissões, telas, tabelas e dados.

**Antes de executar**, um dump dos dados foi tirado (`--data-only` das seis tabelas). Ele não vive
no repositório; é o único caminho de volta se a decisão for revista.

### O que aconteceu com cada regra que dependia do checklist

| Regra | Antes | Agora |
|---|---|---|
| Inativar veículo | recusada com checklist em execução | recusada com **OS em aberto** no veículo |
| Inativar motorista | recusada com checklist em execução | recusada com **viagem em andamento** na portaria |
| Anomalia de abastecimento | `SEM_CHECKLIST_NO_DIA` | anomalia extinta; restam as quatro que não dependem dela |
| Pontuação (9.1) | 3 critérios automáticos de checklist | critérios **inativados, não apagados** — as 13 ocorrências já lançadas continuam valendo |
| OS corretiva | nascia de item crítico reprovado | segue nascendo de inspeção de pneu, anomalia de abastecimento e plano; a OS já aberta por checklist permanece |
| Painel executivo | "checklists bloqueando saída" | indicador removido |
| Painel do CCO | "veículos sem checklist hoje" | indicador removido, **sem substituto inventado** |
| Leituras de medidor | 10 vinham do checklist | as leituras **ficam** — valor de hodômetro é histórico de medidor, não dado de checklist; só o vínculo com o documento caiu |
| Perfil Motorista | `checklist:executar` + `abastecimento:registrar` | resta `abastecimento:registrar` |

O que **não** foi feito: inventar um substituto para os indicadores que sumiram. Trocar "veículos
sem checklist hoje" por um número parecido daria a impressão de que a verificação diária continua
existindo. Ela não existe mais, e a tela precisa dizer isso pelo silêncio.

## Consequências

- **A conferência diária de saída deixa de existir como registro.** Não há mais prova documental de
  que o veículo foi verificado antes de rodar — nem foto, nem assinatura, nem hora. Em caso de
  sinistro ou autuação, essa prova não estará disponível para os períodos posteriores a esta data.
- **O bloqueio de saída por item crítico some.** Nada no sistema impede um veículo com defeito
  conhecido de sair; a decisão volta a ser da pessoa no pátio, sem trilha.
- **A pontuação perde três critérios automáticos**, dois deles negativos. O peso relativo dos
  critérios restantes aumenta sem que ninguém tenha mudado nenhum peso — vale revisar a seção 9.1.
- **O PWA offline perde seu único uso.** A fila de sincronização e o armazenamento local continuam
  no código da web, sem nada que os alimente hoje.
- **O plano de manutenção (7.10) passa a ser a única fonte de "o que precisa entrar no box"**, com
  a régua de severidade e a fila por score. Ele responde por vencimento planejado, e não por
  defeito observado no dia — são coisas diferentes, e a segunda ficou descoberta.

Reverter exige restaurar o dump **e** refazer o código, com as regras dependentes voltando ao
estado anterior. Quanto mais tempo passar, mais divergente o banco estará do dump.
