# ADR 0011 — F7: pneus, CPK e manutenção com baixa de estoque

- **Status**: aceito
- **Data**: 03 de agosto de 2026
- **Contexto do documento mestre**: seções 7.4 (pneus), 7.5 (manutenção), 7.8 (relatórios), 8.2 (movimentação de estoque)

## Decisões

### 1. O pneu tem máquina de estados, como o lote

`EM_ESTOQUE → EM_USO → EM_ESTOQUE → EM_RECAPAGEM → …`, com `SUCATA` como estado terminal.
As transições vivem em `modules/transporte/pneus.ts` (módulo puro, testado) e transição inválida
responde **409 com a lista de movimentações possíveis** — nunca um `UPDATE status` silencioso.
É o mesmo padrão da seção 6.2 aplicado ao ativo físico.

### 2. Cada movimentação fecha o período anterior

Na instalação grava-se `hodometro_instalacao`. Na remoção, rodízio ou envio à recapagem, o sistema
apura `km = hodômetro atual − hodômetro da instalação`, soma ao `km_acumulado` do pneu e **recalcula o CPK**.
Sem isso, o CPK seria estimativa; com isso, é medição.

`CPK = (aquisição + recapagens + reparos) ÷ km rodados`. Pneu que ainda não rodou tem CPK **nulo**,
não zero: zero afirmaria que o pneu não custa nada por km.

### 3. CPK consolidado soma antes de dividir

Para comparar marcas (seção 7.8), somam-se custos e quilometragens do grupo e **depois** divide.
A média aritmética dos CPKs individuais daria o mesmo peso a um pneu de 5.000 km e a outro de 120.000 km —
e é justamente essa comparação que decide compra de pneu.

### 4. Sulco abaixo do limite legal bloqueia e notifica

Faixas parametrizáveis (`frota.sulco_alerta_mm`): verde ≥ 6 mm, dourado 4–6 mm, vermelho < 4 mm,
limite legal 1,6 mm. **Pneu sem medição é tratado como vermelho** — a ausência de dado não pode
passar por conformidade. Inspeção abaixo do limite legal notifica quem tem `pneu:gerenciar` na hora.

### 5. Peça da OS sai do estoque pela mesma porta de sempre

`adicionarItem` chama `almoxarifado.movimentar` com `SAIDA_REQUISICAO`, dentro da mesma transação,
vinculada a **veículo + OS** (regra da seção 8.2). O custo da peça é o **custo médio ponderado móvel
do estoque**, não um valor digitado — senão o custo do ativo viraria opinião.

Consequência assumida: **OS que já consumiu peça não pode ser cancelada** direto. Exige estorno das
movimentações antes, porque o cancelamento silencioso deixaria o saldo errado.

### 6. Plano preventivo alerta na unidade do gatilho

Gatilho por `KM`, `HORAS` ou `DIAS`, com antecedência na mesma unidade. Plano sem execução anterior
conta a partir da leitura atual — é o único ponto de referência honesto quando o veículo entra no
sistema com o hodômetro já rodado. Concluir uma OS ligada a um plano **avança o marcador do plano**,
senão o alerta ficaria vencido para sempre.

### 7. Disponibilidade arredonda o dia parado para cima

Uma OS de 30 horas tira o veículo de **dois** dias, não de um. A disponibilidade é calculada por
veículo e depois média — calcular sobre a frota agregada diluiria uma carreta parada dez dias.

### 8. Depreciação fica fora do custo por veículo, e isso é declarado

O relatório de custo soma combustível + manutenção + pneus. Depreciação exige valor de aquisição do
veículo, que ainda não é cadastrado. A ausência está escrita na **memória de cálculo** que acompanha
o relatório (seção 10.3) — número incompleto e declarado é melhor que número inventado.

## Fora do escopo desta fase

- **Multas (seção 7.6)**: o modelo `multas` ainda não existe. Entra junto com a F8, que consome o
  ranking de infrações na pontuação do colaborador.
- **PDF do prontuário do ativo**: a geração via Puppeteer entra com o pacote de relatórios da F9.
- **Abertura automática de OS por anomalia de abastecimento**: `abrirCorretivaPorEvento` já atende
  a origem, mas o gancho ainda não foi ligado no fluxo de abastecimento. O gancho do **checklist**
  foi ligado nesta fase: item crítico reprovado bloqueia a saída **e** abre a OS corretiva,
  fechando a pendência que a F6 havia declarado.
