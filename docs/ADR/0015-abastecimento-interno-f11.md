# ADR 0015 — F11: abastecimento interno com controle de tanque

- **Status**: aceito
- **Data**: 04 de agosto de 2026
- **Contexto do documento mestre**: seção 7.2 (abastecimento), seção 7.9 (nova), seção 8.1 (custo médio), seção 5.6 (multiunidade)

## Contexto

Pedido: incluir a gestão de abastecimento "conforme os módulos existentes no CTA"
(ctasmart.com.br). O sistema deles fica **inteiro atrás de login**, e não temos credencial —
o levantamento veio da documentação pública do produto, não de dentro do sistema.

O que ela descreve, e que serviu de referência funcional:

- abastecimento **interno**: tanque próprio com bombas (CTA Pedestal) e caminhão comboio (CTA Mobile);
- a promessa central: "controlar a entrada e a saída de cada gota";
- produtos além do diesel: **Arla 32 e lubrificantes**;
- recortes operacionais: centro de custo, obra/local, rota, linha, operação, turno, OS;
- relatórios de média por modelo, motorista, categoria e turno.

Comparando com o que existia: a F5 media o **consumo do veículo** (km/L, custo/km, anomalias),
mas não sabia quanto combustível havia no tanque. Comprava-se 5.000 litros, abastecia-se 4.200,
e os 800 restantes eram fé. **É exatamente esse buraco que a F11 fecha.**

Nada de código, layout ou texto do CTA foi copiado — o que se espelhou foi o domínio funcional,
que é do setor, não do produto.

## Decisões

### 1. O tanque é estoque, com a mesma matemática do almoxarifado

Saldo em litros e **custo médio ponderado móvel**: combustível de notas diferentes se mistura
fisicamente no tanque, e valorizar a saída de outra forma seria arbitrário. A movimentação roda
em transação com `SELECT ... FOR UPDATE` na linha do tanque — dois abastecimentos simultâneos
no mesmo bico não podem ler o mesmo saldo e ambos passarem na checagem.

### 2. O abastecimento baixa o tanque na mesma transação

Registro gravado com o tanque intacto seria litro sumindo do controle. E, no tanque próprio,
**o custo do litro vem do custo médio do estoque, não de um valor digitado** — o preço já foi
definido na compra; digitá-lo de novo só criaria divergência.

Abastecimento em posto externo continua como antes, com preço de bomba: são dois mundos, e
misturá-los distorceria o custo por km.

### 3. O encerrante da bomba confere o volume digitado

A diferença entre a leitura final e a inicial **é** o volume que passou pelo bico. Volume
informado que não bate com ela é recusado. Encerrante que retrocede também: contador mecânico
não anda para trás, e aceitar isso apagaria litros do controle.

### 4. Aferição mede; ajustar é outra decisão

A régua contra o sistema. Perda pequena é evaporação, imprecisão da régua e folga da bomba —
a tolerância (parâmetro `frota.tolerancia_afericao_tanque`, 0,5%) separa isso de "alguém levou".
**Diferença acima da tolerância exige justificativa e notifica a gestão de frota**; nunca vira
ajuste silencioso. Foi isso que a planilha fazia.

O acerto do saldo é opcional e explícito, com a movimentação registrada e vinculada à aferição.
Sobra também é divergência, não boa notícia.

### 5. Comboio é tanque móvel, não um caso especial

O CTA Mobile atende quem leva combustível à frente de serviço. Aqui isso é um `Tanque` do tipo
`MOVEL` vinculado a um veículo, e abastecê-lo é uma **transferência** entre tanques: sai de um,
entra no outro, com o custo da origem. O combustível não muda de valor por mudar de tanque.

Transferir entre produtos diferentes é recusado — misturar diesel com Arla contamina os dois.

### 6. O turno sai do horário, não da digitação

Recorte de relatório não deve depender de alguém lembrar de preencher. O turno da noite atravessa
a meia-noite, e é justamente nele que a maior parte do desvio acontece: ele não pode cair fora da
classificação.

### 7. Média por recorte soma antes de dividir

`/transporte/tanques/consumo/:recorte` responde por veículo, motorista, modelo, categoria, turno,
obra ou rota — o mesmo número, agrupado pela pergunta que se faz. Média de médias daria o mesmo
peso a um caminhão que rodou 200 km e a outro que rodou 4.000.

## Fora do escopo desta fase

- **Integração com o equipamento IoT**: o CTA coleta o abastecimento na bomba e envia à nuvem.
  Aqui o lançamento é manual ou por importação CSV (F10). Um endpoint de ingestão autenticado por
  chave de equipamento é o próximo passo natural — e é o que elimina a digitação de vez.
- **Estoque de Arla e lubrificante em uso**: o produto e o tanque já existem, mas o consumo de
  lubrificante costuma ser por OS, não por veículo/hodômetro. Precisa de decisão de negócio antes
  de virar código.
- **Peso e linha** entre os recortes operacionais: `obra/local` e `rota` foram implementados;
  os demais campos que o CTA oferece por versão dependem de saber quais fazem sentido aqui.
- **Cadastro de tanque e bico pela tela**: hoje responde pela API; a tela lista, movimenta e afere,
  mas o cadastro inicial ainda é por rota.
