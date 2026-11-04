# ADR 0022 — Frota real importada e equipamento de frio como ativo próprio

- **Status**: aceito
- **Data**: 11 de agosto de 2026
- **Contexto do documento mestre**: seção 7.1 (cadastros de frota), seção 8.1 (custo por equipamento)

## Contexto

O cadastro de veículos foi construído com dados de demonstração: 20 placas de teste, tipos
genéricos, sem os campos que a operação de fato controla. A planilha em uso na distribuidora
("Frota Distribuidora Veículos-Ano-Modelo-Uso.xlsx") trouxe **65 veículos e 25 colunas** —
e mostrou o que faltava.

Três descobertas mudaram a modelagem:

1. **A frota opera bens de mais de um CNPJ** — "DIST. MAR." e "P E F LOG". Sem isso, o custo
   por veículo não sabe de quem é o ativo.
2. **A coluna STATUS mistura duas perguntas**: se o veículo roda ("ATIVO", "SINISTRO") e onde
   ele está ou a quem serve ("AÇAILÂNDIA", "CHASSIS", "REAL FRUITY", "VENDIDO - AINDA ESTÁ
   DIST"). Um enum sozinho perderia metade da informação.
3. **O equipamento de frio migra entre caminhões**: várias linhas trazem "APARELHO FOI PRO
   SNH3B02". Um aparelho que anda entre veículos não é atributo de veículo.

## Decisões

### 1. Equipamento de refrigeração é entidade, não coluna

`EquipamentoFrio` com marca, modelo, número de série, acionamento, ano, **horímetro próprio**,
status e vínculo (opcional) ao veículo atual. O mesmo raciocínio do pneu: ativo que se move
precisa de identidade e histórico seus.

O horímetro é a razão mais forte: a vida útil do aparelho se conta em horas de operação, não
nos quilômetros do caminhão que o carrega hoje. Guardar como coluna do veículo faria o
horímetro voltar a zero toda vez que o aparelho trocasse de placa.

**Ainda não implementado**: a movimentação do aparelho entre veículos (como
`PneuMovimentacao`). Hoje o vínculo é sobrescrito; a transferência não deixa rastro.

### 2. `status` e `situacaoDescrita` convivem

O enum responde "roda ou não roda" — é o que o checklist e a portaria consultam. O texto
original fica em `situacaoDescrita`, porque "AÇAILÂNDIA" é informação operacional real que
nenhum enum deveria engolir.

Mapeamento: SINISTRO/INCÊNDIO → `INATIVO`; VENDIDO → `VENDIDO`; o resto → `ATIVO`.

### 3. O que não se entende não vira palpite

O módulo de tradução (`importacao-frota.ts`, 47 testes) devolve **avisos** em vez de adivinhar:
tipo em branco ou desconhecido cai em `UTILITARIO` **com aviso** — chutar `TRUCK` falsearia o
mapa de rodagem. "NÃO POSSUI", "NÃO TEM" e "S/N" viram nulo, nunca zero: horímetro zerado
mente sobre uso.

A importação real gerou **16 avisos**, todos legítimos: 5 tipos em branco (picapes e caminhões
leves) e 11 linhas com observação de equipamento sem marca — justamente os aparelhos
transferidos.

### 4. Cronotacógrafo e licenciamento entram como documento

Não viraram colunas: foram para `VeiculoDocumento`, que já tem alerta D-30/15/7. O
licenciamento, que na planilha é só o ano, vira vencimento em 31/12 daquele ano.

### 5. Veículo fora da planilha é inativado, nunca excluído

Os 20 veículos de demonstração saíram de circulação com motivo registrado ("Não consta na
planilha de frota importada"). Eles respondem por checklists, OS e acessos de portaria já
gravados — apagá-los quebraria o histórico (regra de ouro 2).

### 6. A unidade de destino é escolhida, não adivinhada

O script aceita `--unidade=CODIGO` e usa `MATRIZ` por padrão. Na primeira versão eu ordenava
por código e pegava a primeira — mandava a frota inteira para a filial de Teresina, porque
"FILIAL-TE" vem antes de "MATRIZ" no alfabeto. O ensaio pegou isso antes de gravar.

## Consequências

- 65 veículos e 38 equipamentos de frio cadastrados; 23 registros de demonstração inativados.
- O script roda em **ensaio por padrão** (`--aplicar` para gravar) e é idempotente: casa
  veículo por placa e equipamento por número de série.
- O hodômetro **só avança** na importação: se o sistema já registrou km maior que a planilha,
  o do sistema prevalece — abastecimento é fonte mais recente que planilha.
- **Não coberto**: colunas MODELO BAÚ e ANO BAÚ (vazias em toda a planilha, o baú ainda não é
  cadastrado); tela dedicada para o equipamento de frio (hoje só a listagem pela API);
  histórico de transferência do aparelho entre veículos.
