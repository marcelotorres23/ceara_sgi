# ADR 0009 — Edição e inativação nos cadastros

- **Data:** 2026-08-03
- **Status:** Aceito
- **Contexto:** Os cadastros criavam e homologavam, mas não editavam nem inativavam. Na prática,
  um veículo cadastrado com a placa errada não tinha correção pela interface.

## Decisões

### 1. Inativar, nunca excluir — com motivo, autor e data no próprio registro
A regra de ouro 2 proíbe `DELETE`. Os cinco cadastros ganharam `inativado_em`, `inativado_por` e
`motivo_inativacao`, o mesmo trio que `solicitacoes` e `lotes` já usavam. O registro continua
consultável, aparece na listagem sob "Mostrar inativos" e exibe o motivo.

Inativar não é um estado novo paralelo: reaproveita o campo que cada recurso já tinha —
veículo e motorista vão para `INATIVO`, fornecedor para `BLOQUEADO`, almoxarifado para
`ativo: false`. O item não tem status próprio, então volta para `REPROVADO` na homologação.

### 2. Lista branca de campos editáveis, no servidor
`CONFIG[recurso].editaveis` define o que pode mudar. Qualquer outro campo no corpo é
**descartado em silêncio** — não recusado, porque o cliente não deveria conseguir influenciar o
que não lhe pertence, e recusar exporia quais campos existem.

Isso bloqueia escalonamento por PATCH: mandar `{ status: 'VENDIDO' }` ou
`{ hodometroAtual: 999999 }` não tem efeito. Verificado em teste.

### 3. Só o que mudou vai para a trilha
`editar` compara valor atual e novo campo a campo, grava apenas os diferentes, e recusa com 409
quando nada mudou. Sem isso, abrir e salvar o formulário sem tocar em nada geraria um registro de
auditoria dizendo que tudo foi alterado para o mesmo valor — ruído que atrapalha quem audita.

A trilha guarda `valorAnterior` **e** `valorNovo`, só dos campos alterados, com severidade
`ALERTA`.

### 4. Inativação recusada quando o registro está em uso
Cada recurso declara sua checagem:

| Recurso | Recusa quando |
|---|---|
| Veículo | há checklist em execução |
| Motorista | há checklist em execução |
| Item | há saldo em estoque, ou solicitação em andamento |
| Fornecedor | há pedido em aberto |
| Almoxarifado | há saldo em estoque |

A mensagem nomeia o documento que impede (`Ha pedido em aberto (PC-2026-0014)...`), porque
"não é possível inativar" sem dizer o porquê obriga o usuário a adivinhar.

**Consequência aceita:** a checagem é uma leitura antes da escrita, sem lock. Uma corrida entre
inativar e abrir checklist é teoricamente possível. O dano é pequeno e reversível (reativar), e
travar por transação encareceria uma operação rara.

### 5. Hodômetro não é editável
O hodômetro avança pelo abastecimento e alimenta o cálculo de consumo. Editar à mão corromperia
o km/L apurado de todos os registros seguintes. O campo aparece no formulário de edição
desabilitado, com a explicação — some do formulário seria pior, porque o usuário procuraria.

### 6. Reativar limpa o registro, mas não a história
`reativar` zera `inativado_em`, `inativado_por` e `motivo_inativacao`. O motivo da inativação
anterior **permanece na trilha**, que é append-only — o registro mostra o estado atual, a
auditoria mostra o histórico.

## Defeito encontrado: `updated_by` faltava em três tabelas

A seção 11 do spec exige `created_by`/`updated_by` **em todas as tabelas**. `veiculos`,
`motoristas` e `almoxarifados` não tinham, e o primeiro `PATCH` quebrou com 500.

Corrigido para esses três. **A lacuna é maior**: `usuario_perfis`, `mapas_cotacao`, `pedidos`,
`recebimentos`, `titulos`, `inventarios`, `abastecimentos`, `checklist_modelos` e `checklists`
também estão sem `updated_by`. Não foram alterados aqui porque não são editáveis por esta
funcionalidade — adicionar coluna sem uso seria especulação. Vale uma migration de saneamento
antes de produção.

## Verificado
30 asserções end-to-end: correção de placa, 409 quando nada muda, campo não editável ignorado sem
efeito colateral, permissão por perfil, motivo obrigatório, registro inativo consultável com o
motivo, não inativa duas vezes, reativação, e as cinco recusas por uso. Trilha com o
antes-e-depois (`ERR2A79 -> CER2A79`) e cadeia de hash íntegra.

Na tela: formulário pré-preenchido, hodômetro desabilitado com explicação, modal com o aviso
específico do recurso, linha inativa esmaecida com o motivo e apenas "Reativar" disponível.

## O que continua fora
- **Exclusão** não existe e não deve existir.
- **Histórico de alterações na tela**: os dados estão na trilha, mas não há visualização por
  registro. Hoje só o Administrador e o Auditor veem, na tela de auditoria.
