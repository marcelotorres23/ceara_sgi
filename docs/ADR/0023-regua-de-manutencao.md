# ADR 0023 — Régua de manutenção da frota

- **Status**: aceito
- **Data**: 18 de agosto de 2026 (revisado em 28 de agosto de 2026)
- **Contexto do documento mestre**: seção 7.10 (serviços periódicos), 7.2 (abastecimento), 7.5 (manutenção), 7.7 (painel de frota)

## Contexto

Chegou uma especificação-mestra do **Painel de Manutenção Preventiva da Frota** (documento
`plano de manutenção.md`), derivada de um protótipo HTML de página única já validado em campo,
com a frota real embutida no código e o KM atualizado por colagem manual.

O documento pede um projeto novo, `sgi-frota-manutencao/`, com `Veiculo`, `Abastecimento`,
`PlanoManutencao` e `Execucao` próprios. **Isso não vai acontecer**, e o próprio documento diz o
porquê: a stack é "alinhada ao restante do SGI Ceará". Criar um segundo `Veiculo` e um segundo
`Abastecimento` daria duas verdades sobre a mesma placa — exatamente o problema que o SGI existe
para acabar.

O que o SGI já tem, e que cobre boa parte do pedido:

| Pedido do documento | Onde já vive no SGI |
|---|---|
| `Veiculo`, `EquipamentoFrio` | `veiculos`, `equipamentos_frio` (ADR 0022) |
| `PlanoManutencao` / `ItemPlano` (regra do tipo) | `planos_servico_periodico` (7.10) |
| `Execucao` | `servicos_periodicos`, append-only |
| `Abastecimento` com odômetro, custo, posto, motorista | `abastecimentos` (F5/F11) |
| Motor de regras (última + intervalo vs. atual) | `manutencao-periodica.ts` |
| Painel do pátio | `PainelPeriodico.tsx` |
| Import manual por colagem | `db:importar-periodicos` |

E o que **não** existe, que é o valor real da especificação:

1. A régua de **severidade com percentual do ciclo** (75% atenção, 90% crítico) — hoje há só
   `EM_DIA / PROXIMA / VENCIDA / SEM_REGISTRO`, com faixa de aviso em valor absoluto.
2. O **limite por calendário** por tipo (180 / 365 / 730 dias). Óleo envelhece parado.
3. O **score de fila da oficina**, que junta os serviços que a mesma parada resolve.
4. A proteção contra **medidor invertido** (reset de horímetro do frio, regressão de odômetro).
5. **km/dia, previsão em dias, custo/km** e alerta de queda de rendimento.

### Sobre a integração com o CTASmart

A especificação dedicava metade do texto a consumir a **Sync API do CTASmart** (fila de
abastecimentos, token, lock, rate limit), para que o hodômetro deixasse de ser digitado.
**Isso saiu do projeto por decisão de negócio.**

O que a decisão custa, dito com clareza para quem reabrir este documento: o KM continua entrando
pela mão de alguém — abastecimento registrado no SGI, checklist, portaria ou digitação. A promessa
de "confiar que o KM está atualizado porque veio sozinho" não se cumpre, e o painel depende da
disciplina de registro da operação. Toda a régua abaixo **funciona igual**: ela consome o medidor
do cadastro do ativo, e não se importa com quem o alimentou.

O que a decisão **não** custa: nada foi implementado e nada foi jogado fora. A entidade `Leitura`,
com origem e suspeita, continua de pé e é o que torna a fonte do número auditável — inclusive sem
automação nenhuma. O [ADR 0015](0015-abastecimento-interno-f11.md) segue valendo integralmente:
não temos credencial do CTASmart, e agora também não queremos.

## Decisões

### 1. A régua é uma camada sobre o motor existente, não um motor novo

`posicaoPeriodica` continua respondendo **o que falta** — é a conta da planilha, validada, e os
testes dela ficam de pé. A severidade, o percentual do ciclo, o calendário e o score entram em
`regua-manutencao.ts`, que consome aquela posição. Uma conta, duas leituras: quanto falta, e o
quanto isso importa hoje.

`avisarCom` (valor absoluto) e a régua percentual **coexistem e não competem**: `avisarCom` é a
antecedência que o gestor cadastrou para o aviso operacional; a régua percentual é a escala
comparável entre itens de intervalo diferente, que é o que permite ordenar a fila. Comparar
"faltam 555 km do motor" com "faltam 47 h do Thermo King" só é possível em fração de ciclo.

### 2. O que vencer primeiro manda — inclusive o calendário

Cada tipo ganha um `limiteDias`. Passado o limite desde a última execução, o item **vence por
tempo** ainda que o hodômetro não tenha andado, com motivo textual explícito
(`"212 dias desde a última (limite 180)"`). A 90% do limite, vira crítico. Motivo de existir:
caminhão parado em Açailândia por três meses não teve o óleo preservado — ele oxidou.

`LUBRIFICACAO` fica com `limiteDias` nulo: sua base **já é** o calendário, e somar uma segunda
régua de tempo sobre ela seria contar o mesmo prazo duas vezes.

### 3. Medidor que anda para trás é falta de base, nunca vencimento

A base real tem reset de equipamento de frio (última troca em 18.195 h, horímetro atual em 21 h).
Tratar isso como atraso jogaria o item em VENCIDO por um defeito de leitura. A régua devolve
**`SEM_BASE` com alerta textual**, exigindo confirmação humana. Mesma proteção para odômetro.

O que **não** fazemos: corrigir o número sozinhos. Um horímetro zerado pode ser troca de aparelho,
reset de placa ou digitação errada — três histórias diferentes, e só quem está no pátio sabe qual.

### 4. Os três medidores não se misturam

`ODOMETRO`, `HORIMETRO_VEICULO` e `HORIMETRO_FRIO` são grandezas diferentes de ativos diferentes.
O horímetro do veículo **não** serve ao plano do aparelho de frio: quem conta as horas do Thermo
King é o display do próprio aparelho, lido na oficina. Misturar os dois erraria o plano de frio
inteiro, e o erro seria silencioso — o número existe, só não é daquele ativo.

### 5. Score de fila: `(vencidos × 100) + (críticos × 10) + peso(pior)`

Não é ranking estético. Um caminhão com três itens vencidos sobe na fila porque **a mesma parada
resolve os três** — o ganho é não perder a viagem ao box. O peso do pior status desempata entre
ativos com a mesma contagem.

`SEM_BASE` não pontua: falta de leitura não é falta de manutenção, e deixar a ausência de dado
empurrar caminhão para o box enche a oficina de serviço que talvez nem esteja vencido.

### 6. Toda alteração de medidor gera rastro

Odômetro que muda sem registro de onde veio transforma o painel em opinião. Cada leitura guarda
origem (abastecimento, execução na oficina, checklist, portaria, digitação, importação legada) e
suspeita (`REGRESSAO`, `SALTO`).

Sem automação, isso vale **mais**, e não menos: quando todo número é digitado por alguém, saber
qual tela o produziu e a que fato ele estava preso é a única defesa contra o dígito trocado.
Leitura digitada avulsa pesa menos na média de km/dia do que a que veio presa a um abastecimento.

## Consequências

- O painel periódico passa a ordenar por score e a mostrar severidade em cinco faixas; a tela
  precisa de **rótulo textual junto da cor** — a oficina é usada sob luz de galpão e há quem não
  distinga verde de laranja.
- `SEM_BASE` aparece onde antes aparecia "em dia" por falta de leitura. É regressão aparente e
  ganho real: silêncio sobre falta de dado é o pior modo de falha.
- **O KM depende de disciplina de registro.** Sem automação, o indicador "veículo sem leitura há
  N dias" deixa de ser um alerta acessório e passa a ser o termômetro de confiabilidade do painel
  inteiro. Ele precisa estar na tela principal, não num relatório.

## Pendência de design

A especificação define `#D97706` (laranja) para o status crítico. Essa cor está **fora da paleta da
seção 4**, que não tem laranja e é explícita: nenhuma cor fora dela. Antes de a régua chegar à
tela, a escolha precisa ser feita: ampliar a paleta da marca ou distinguir crítico por forma, e não
por cor.

## Frota de teste

A frota real tem 89 veículos, mas ela mostra o que a operação viveu — não o que a régua precisa
provar. Faltam justamente as bordas: o item exatamente em 75%, o que vence por calendário com o
hodômetro parado, o aparelho de frio que resetou, o caminhão com três itens vencidos de uma vez.
Esperar esses casos aparecerem sozinhos é esperar o ano que vem.

```bash
pnpm db:seed-teste-regua   # monta os 10 casos de borda
pnpm smoke:regua           # roda a régua sobre eles e confere
```

Os casos vivem em `casos-teste-regua.ts`, com a severidade e o score esperados como **dado
estruturado** — o seed monta, o smoke confere. Expectativa escrita em prosa e conferida por busca
de palavra acha "vencido" até na explicação de por que algo não pode vencer; foi o que aconteceu na
primeira versão.

Os ativos nascem na MATRIZ, com placa no prefixo `TST` e status `INATIVO`, para não entrarem em
relatório de operação nem em fila de oficina de verdade. O seed roda por upsert e **não apaga
linha**: a rodada anterior é inativada, não excluída.

## Ordem de implementação

1. **Régua de severidade, calendário, score e medidor invertido** — com testes. *(pronta)*
2. **Leitura como entidade rastreável**, com origem e suspeita. *(pronta)*
3. Painel do pátio e programação da semana consumindo a régua; CSV da programação. *(pronta)*
4. Inteligência: km/dia, previsão em dias, custo/km, alerta de rendimento, ativo sem leitura.

### O que a programação decidiu, além do pátio

O pátio responde **quem está pior**. A programação (`programacao-semana.ts`, aba *Programação*)
responde a pergunta seguinte, que é a que monta o dia da oficina: **quem entra no box esta
semana, e o que se faz nele quando estiver lá dentro**. Duas regras vêm do item 6 do plano de
manutenção preventiva da frota:

- **Programa-se pelos vencidos**, e o crítico entra junto — o ciclo dele acaba dentro da semana
  que está sendo montada, e deixar para a próxima é programar o vencimento.
- **Encaixa-se o que estiver na mesma faixa.** Com o caminhão no elevador, o item em atenção
  custa a peça e não custa a parada. Ele entra marcado como *encaixe*, para o encarregado
  distinguir a razão da parada da carona — e para o CSV virar lista de peça a separar.

Sem nada vencido ou crítico, a faixa vem da previsão do próprio ritmo do veículo; sem ritmo
apurado, o veículo simplesmente não entra na semana. **`SEM_BASE` não programa nada**: sai na
lista *sem leitura para programar*, na mesma tela — enquanto ninguém ler aquele hodômetro, a
placa não pode ser programada nem descartada.

Não há segunda conta de vencimento: a programação consome as linhas do pátio e só decide
**quando** e **junto com o quê**. Duas contas sobre a mesma placa dariam duas verdades, que é o
que este ADR recusou na origem.
