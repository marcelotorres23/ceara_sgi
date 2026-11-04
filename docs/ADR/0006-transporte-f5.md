# ADR 0006 — Transporte base (F5)

- **Data:** 2026-08-03
- **Status:** Aceito
- **Contexto:** M2 — veículos, motoristas, documentos com alerta, abastecimento com detecção
  de anomalias e painel CCO (seções 7.1, 7.2 e 7.7).

## Decisões

### 1. Anomalia não impede o registro
Um abastecimento anômalo **precisa** existir no sistema para ser analisado. Se o registro fosse
recusado, o dado sumiria — e a fragilidade que o POP quer eliminar é justamente o gasto que não
aparece. O registro entra marcado, notifica o Gestor de Frota e pode ser justificado depois.

**Exceção única:** hodômetro menor que o do último abastecimento exige justificativa na hora
(seção 7.2 é explícita: "bloqueia com justificativa").

### 2. O hodômetro do cadastro nunca retrocede
Quando o hodômetro informado é menor que o atual do veículo — painel trocado, leitura errada —
o abastecimento é gravado com o valor informado, mas `veiculos.hodometro_atual` **não** é
rebaixado. Rebaixar produziria km negativo no próximo registro e contaminaria todo o consumo
seguinte.

### 3. Primeiro abastecimento não inventa consumo
Sem registro anterior não há quilometragem de referência. `consumoKml` fica `null` em vez de
receber um número arbitrário, e o registro fica fora do cálculo da média histórica.
Isso também evita que o primeiro abastecimento de um veículo seja acusado de anomalia.

### 4. Desvio de consumo é bidirecional
Consumo **muito acima** da média é tão suspeito quanto muito abaixo — costuma indicar hodômetro
adulterado ou litragem registrada a menor. A comparação usa valor absoluto do desvio.

### 5. A regra do checklist fica indefinida, não falsa
A seção 7.2 lista "abastecimento em dia sem checklist de saída" como anomalia. O checklist é F6.
`houveChecklistNoDia` aceita `null` explicitamente, e `null` **não** dispara a anomalia — se
usássemos `false` como padrão, todo abastecimento seria acusado até a F6 existir, e o alerta
viraria ruído que ninguém lê.

O painel CCO devolve `pendentes.checklistsDoDia: null` pelo mesmo motivo: declarar a pendência
é mais honesto do que exibir zero.

### 6. Vencimento comparado por dia no fuso, não por milissegundo
`diasAte` projeta os dois instantes em `America/Fortaleza` e compara datas. Um documento que
vence hoje às 23h não pode aparecer como vencido às 8h da manhã por diferença de horas.

A janela escolhida é a **menor** que ainda cobre o prazo: 5 dias cai em D-7, não em D-30.
Assim o alerta comunica urgência real.

## Defeito encontrado: violação de unicidade virava 500

Cadastrar um veículo com placa já existente respondia **500 "Falha interna. Tente novamente em
instantes."** — mensagem que manda o usuário repetir uma ação que nunca vai funcionar.

O `PrismaClientKnownRequestError` não é `AppError`, então caía no ramo genérico do tratador.
O bug era **latente desde a F1** e valia para todo campo único do sistema: CNPJ de fornecedor,
código de item, e-mail de usuário, CPF de motorista, código de almoxarifado.

`core/errors/handler.ts` passou a traduzir:

| Código Prisma | Resposta |
|---|---|
| `P2002` (unicidade) | 409 `DUPLICADO`, nomeando o campo |
| `P2003` (chave estrangeira) | 409 `REFERENCIA_INVALIDA` |
| `P2025` (registro ausente) | 404 `NOT_FOUND` |

Códigos não traduzidos continuam 500, mas agora com `code` do Prisma no log — antes a informação
se perdia.

**Lição:** um teste que roda uma vez em banco limpo não exercita colisão de unicidade. Foi a
segunda execução do teste de ciclo que revelou.

## O que F5 não entrega
- **Telas do módulo**: a API está completa; a UI de frota não existe.
- **Foto obrigatória do painel e do cupom** (seção 7.2): os campos `foto_painel_id` e
  `foto_cupom_id` existem e são aceitos, mas a obrigatoriedade só faz sentido com o storage
  da F6. Hoje são opcionais.
- **Pneus, manutenção e multas**: F7 e adiante. `posicoes_pneu` já existe porque é configuração
  do veículo, não do pneu.
- **Bloqueio de saída por documento vencido**: `impedimentos()` já apura, mas quem bloqueia a
  saída é o checklist (F6).
- Consumo por motorista e ranking: dependem de mais massa de dados; entram na F9.
