# ADR 0004 — Recebimento e fiscal (F3)

- **Data:** 2026-08-02
- **Status:** Aceito
- **Contexto:** Three-way match, divergências, entrada fiscal, títulos e encerramento do lote —
  o que fecha o ciclo P2P (seções 6.1.10 a 6.1.11 e 6.2).

## Decisões

### 1. Divergência retém o item, não o pedido
A seção 6.1.10 diz que "divergência retém pagamento do item". O cálculo é por linha:
cada `RecebimentoItem` carrega `pagamentoRetido`, e o título nasce apenas com a soma do que
ficou liberado. Um pedido com dois itens, um avariado, gera título do item bom e retém o outro.

### 2. Entrega parcial não retém pagamento
`QUANTIDADE_MENOR` é a única divergência que **não** retém: o que chegou, chegou conforme, e
segurar o pagamento puniria o fornecedor por uma entrega que ainda vai completar. As demais
(cobrança a maior, quantidade maior, avaria, especificação, documentação) retêm.

### 3. Preço abaixo do pedido não é divergência
A tolerância é comparada só para cima. NF-e mais barata que o pedido é desconto a favor da
empresa — bloquear seria criar trabalho para o comprador sem nenhum risco associado.

### 4. Precedência entre divergências
Quando mais de uma se aplica ao mesmo item, vale: divergência apontada pelo conferente
(avaria, especificação, documentação) → preço → quantidade. A observação física do almoxarife
é a informação mais específica e não deve ser ofuscada por uma diferença de quantidade.

### 5. Só divergência de PREÇO bloqueia a entrada fiscal
A seção 6.1.11 fala em bloqueio por divergência de preço acima da tolerância, e é só isso que
`bloqueiaEntradaFiscal` liga — levando o lote a `BLOQUEADO_DIVERGENCIA` e notificando o comprador.
Avaria retém o pagamento do item mas não impede o lançamento fiscal do restante.

### 6. As três condições de encerramento são conferidas no banco
`encerrarLote` não aceita a palavra do chamador: relê os recebimentos, o `fiscalEm` e os títulos
antes de permitir a transição, e a mensagem de erro nomeia o que falta.
`podeEncerrar` (state-machine, F1) continua como regra pura para uso da UI.

### 7. Prazo físico → fiscal em horas corridas
O indicador da seção 6.1.11 fala em 48h. Ao contrário do SLA de compras, aqui **não** usamos horas
úteis: a nota fiscal tem prazo legal em dias corridos, e o indicador do POP acompanha a mesma régua.
O lançamento fora do prazo grava auditoria com severidade `ALERTA`.

## Descoberta: a regra "quem aprova não recebe" era inalcançável
O primeiro teste tentou provar a SoD com a Gerência recebendo, e recebeu `FORBIDDEN` do RBAC —
não do SoD. Nenhum perfil aprovador tem `recebimento:registrar`, então a regra nunca chegava a
ser avaliada.

Isso **não** é defeito: é defesa em profundidade funcionando na camada de fora. Mas significa que
a SoD de recebimento só tem efeito prático sobre quem **acumula** perfis — exatamente o conflito
que `CONFLITOS_DE_PERFIL` sinaliza (`Gerencia + Almoxarife`).

O seed de demonstração ganhou esse usuário, e o teste agora exerce o caminho de verdade:
ele aprova o lote, tenta receber, e leva `SOD_VIOLATION` com a regra `APROVADOR_NAO_RECEBE`.

**Lição para as próximas fases:** um teste de SoD que passa por um usuário sem a permissão RBAC
não prova nada sobre SoD. Sempre montar o caso com quem tem a permissão.

## Também nesta fase
`LimiteDeErro` (error boundary) envolvendo o painel de compras — lacuna que a F2 deixou
registrada. Uma exceção em um card agora fica contida, com mensagem que diz que os dados não
foram alterados, em vez de apagar a tela inteira.

## O que F3 não entrega
- **Foto da divergência**: `recebimento_itens.anexo_id` existe e é aceito na API, mas o upload
  depende do storage S3, que entra na F6. Hoje o campo só guarda a referência.
- **Baixa automática no almoxarifado**: a integração "recebimento aprovado → entrada no estoque"
  (seção 3) depende do M3, que é a F4.
- Telas de recebimento e de contas a pagar: a API está completa, a UI vem depois do Kanban.
- Consulta de NF-e na SEFAZ por chave: F10.
- Avaliação de fornecedor (6.1.12): agora há dado de OTIF e divergência para calcular, mas o
  score em si continua fora do escopo até a F9.
