# ADR 0002 — Compras núcleo (F1)

- **Data:** 2026-08-02
- **Status:** Aceito
- **Contexto:** Ciclo P2P do M1: solicitação → triagem → lote → cotação → mapa por valor
  presente → alçada → aprovação eletrônica → pedido. Recebimento e fiscal ficam para F3.

## Decisões

### 1. Regra de negócio pura, em arquivo sem `db` nem `env`
Seguindo a regra fixada no [ADR 0001](0001-fundacao-f0.md): `valor-presente.ts`, `alcada.ts`,
`state-machine.ts` e `horas-uteis.ts` não importam banco nem configuração. Os 85 testes do módulo
rodam sem Postgres. A taxa, as faixas e o calendário chegam por parâmetro, vindos do banco.

### 2. Divergência do menor preço: quem diverge, o sistema ou o comprador?
A regra de ouro 3 exige justificativa para escolha divergente do menor preço. Mas o critério de
comparação que o próprio spec manda usar (seção 6.1.6) é **valor presente**, e o melhor VP
frequentemente **não** é o menor preço de face — foi exatamente o caso do teste de ciclo:
Beta vence com R$ 10.250,00 em 60 dias contra Alfa com R$ 10.000,00 à vista.

Exigir justificativa humana para a recomendação automática travaria o fluxo normal.
Decisão adotada:

- Escolha **é** a recomendação por VP → o sistema redige a justificativa, citando os dois VPs,
  os prazos e a taxa aplicada. Fica registrada e auditável como qualquer outra.
- Comprador **sobrepõe** a recomendação → justificativa humana obrigatória, mínimo 10 caracteres.
- **Nos dois casos** `divergenteMenorPreco = true` e a alçada sobe um nível. Nisso o spec é
  categórico e não abrimos exceção.

**Ponto para validação do negócio:** se a intenção da seção 6.4 for escalar apenas a divergência
*humana*, a elevação automática no primeiro caso deve sair. Como escrito, o spec não distingue,
e escolhemos a leitura mais conservadora.

### 3. `ehEscolhaDivergente` compara valor de face, não posição no ranking
Divergência é medida contra o **menor valor líquido**, não contra o primeiro colocado em VP.
Assim, escolher o melhor VP com maior preço de face continua sendo sinalizado ao aprovador —
que é justamente a informação que ele precisa enxergar.

### 4. Resposta de cotação é registro único
Sobrescrever uma proposta apagaria os preços originais, e apagar linha de negócio é proibido
(regra de ouro 2). Segunda resposta do mesmo fornecedor retorna 409; correção exige nova rodada.
A primeira versão deste serviço fazia `deleteMany` nos itens da cotação — removido.

### 5. Numeração por `INSERT ... ON CONFLICT DO UPDATE RETURNING`
Tabela `sequencias(chave, ano, ultimo)`. O incremento roda dentro da transação de criação do
documento e serializa concorrentes na própria linha. Não usamos sequences do Postgres porque
o número reinicia por ano e o formato (`SOL-2026-0001`) é de negócio, não técnico.

### 6. Horas úteis calculadas no fuso, não no relógio do servidor
`horas-uteis.ts` projeta cada instante em `America/Fortaleza` via `Intl.DateTimeFormat` antes de
medir. O servidor pode rodar em UTC, em contêiner, em qualquer lugar — o expediente é o da
operação. Fortaleza não observa horário de verão, o que elimina a classe de bugs de transição.

### 7. Faixa de alçada arredonda para centavos antes de enquadrar
A matriz da seção 6.4 é escrita em centavos (teto 1.000,00 / piso 1.000,01). O total do lote nasce
de `quantidade(14,4) × preço(14,4)` e pode produzir frações abaixo do centavo, que cairiam no vão
entre duas faixas e ficariam sem aprovador. Descoberto por teste, não em produção.

### 8. SQL de trigger virou migration
O script `prisma/sql/001_auditoria_append_only.sql` era um passo manual pós-migration. Isso
criava drift: o índice que ele cria fazia o `prisma migrate dev` querer resetar o banco,
e um ambiente novo poderia esquecer de rodá-lo.

Agora é a migration `20260802180457_auditoria_append_only`, idempotente, aplicada por
`migrate deploy` como qualquer outra. Ganhou também os gatilhos de `aprovacoes` e
`lote_transicoes` — o histórico de quem moveu o lote e por quê não pode ser reescrito.

**Cuidado com o nome das migrations:** o Prisma carimba em UTC. Pastas criadas à mão com hora
local ficam fora de ordem e um `migrate reset` tenta criar `lotes` antes de `usuarios`.

### 9. Emissão de pedido usa a cotação escolhida no mapa
O pedido não recebe fornecedor nem preço por parâmetro — puxa tudo de `mapas_cotacao.
cotacaoEscolhidaId`. Não existe caminho para emitir pedido divergente do que foi aprovado.
`dataPrometidaOriginal` nunca muda; a repactuação grava `dataReprogramada` e preserva o atraso
original para o OTIF (seção 6.1.9).

## O que F1 não entrega
- Telas do módulo de compras: o painel Kanban é o entregável da F2 e é onde essa UI faz sentido.
- Envio real de RFQ por e-mail/WhatsApp e o link público do fornecedor: hoje o comprador registra
  a proposta recebida. O portal do fornecedor depende de notificações (F2) e storage (F6).
- PDF do mapa e do pedido: depende do Puppeteer, ainda não integrado.
- Jobs de SLA vencido e alerta D-2: BullMQ entra na F2.
- Avaliação de fornecedor (6.1.12) e contratos (6.1.13): dependem de dados de recebimento (F3).
