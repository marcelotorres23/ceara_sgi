# ADR 0008 — Telas: app do motorista, alertas de estoque e painel CCO

- **Data:** 2026-08-03
- **Status:** Aceito
- **Contexto:** O sistema tinha API completa até a F6 e quase nenhuma interface. A dívida maior
  era o app do motorista, que fecha o entregável da F6 ("checklist em produção no pátio").

## Decisões

### 1. Fila de saída (outbox), não "modo offline"
O app não tem dois modos. **Toda** ação vira operação na fila do IndexedDB e é enviada depois —
com ou sem rede. Isso elimina a classe de bug em que o comportamento online e o offline divergem,
porque só existe um caminho.

A fila é FIFO e **para na primeira falha**: enviar "finalizar" antes de "responder" corromperia
o checklist. Falha 4xx (fora 401/408/429) é permanente e fica marcada com o motivo, em vez de
repetir para sempre.

### 2. IndexedDB à mão, sem biblioteca
São ~80 linhas para a superfície usada (put/get/getAll/delete). Uma dependência a mais no bundle
do PWA custa mais do que isso, e o app do motorista roda em celular no pátio.

### 3. Marca d'água gravada no cliente
`prepararFoto` redimensiona para 1600px, desenha a faixa com placa, data/hora, motorista e
coordenadas, e exporta JPEG 75%. É o que permite a foto sair marcada mesmo sem rede.

O servidor guarda os mesmos dados em `checklist_fotos.marca_dagua` contra o hash do arquivo —
confiar só nos pixels seria confiar no cliente.

### 4. Sem GPS a foto continua válida
Dentro de galpão não há sinal. `obterLocalizacao` resolve com `null` em vez de rejeitar, e a
marca escreve "GPS indisponivel". Bloquear a foto por falta de GPS impediria o checklist
justamente onde ele mais acontece.

### 5. Bloqueio explicado, não só sinalizado
Quando um item crítico é reprovado, o card fica vermelho e o texto diz o que fazer:
*"O checklist deve ser finalizado mesmo assim — a liberação é do Gestor de Frota."*
Sem isso o motorista tende a abandonar o preenchimento, e o registro do motivo se perde.

O rodapé fixo lista o que falta para concluir, em vez de só desabilitar o botão.

## Dois defeitos de formatação encontrados na tela

Ambos da mesma família: **número decimal exibido cru para leitor brasileiro**.

1. **Painel CCO** mostrava `Consumo medio 2.802 km/L`. A API devolve `"2.802"` com ponto
   decimal; em pt-BR o ponto é separador de milhar, então lia-se **2802 km/L** — três ordens de
   grandeza de erro num indicador de consumo.

2. **Alertas de estoque** mostravam `Saldo 30.00 abaixo do minimo 50.00`, mensagem montada no
   backend.

Correções: `consumoFormatado` na tela, e `emPtBr()` em `core/money.ts` para números embutidos em
mensagem destinada ao usuário. A regra da seção 13 é "formatação pt-BR só na apresentação" — e
mensagem de alerta **é** apresentação, ainda que montada no servidor. O que não pode é persistir
ou transportar formatado; para isso continua existindo `paraBanco`.

## Um defeito de conteúdo

O painel de alertas listava o mesmo item duas vezes sem dizer **de qual almoxarifado** era cada
linha — o operador não tinha como saber onde repor. `LinhaEstoque` e `AlertaEstoque` ganharam o
campo, a listagem ganhou a coluna, e o alerta consolidado do job das 06:00 passou a prefixar o
almoxarifado em cada linha.

## Verificado no navegador
- Login, painel CCO com dados reais, alertas com semáforo.
- Checklist aberto pela placa, modelo de 38 itens carregado.
- Item crítico reprovado: card vermelho, aviso de bloqueio, foto obrigatória aparecendo.
- Fila: 1 envio → "Enviar" → sincronizado; confirmado no servidor que a resposta foi gravada.
- **Offline simulado**: barra dourada, 3 envios retidos, botão de envio oculto, preenchimento
  seguindo normalmente. Ao voltar a conexão, a fila drenou sozinha.

## O que ainda não existe
- **Telas de compras** além do Kanban: solicitação, cotação, mapa, recebimento e contas a pagar
  seguem só por API.
- **Leitura de QR Code** por câmera: a placa é digitada. O campo já aceita o valor que o QR
  entregaria.
- **PDF do checklist** (seção 7.3): depende do Puppeteer.
- Assinatura é gravada como data-URI no campo de texto, não como arquivo no storage.

## Adendo — telas de cadastro (mesma entrega)

### Definição declarativa em vez de cinco telas
As cinco telas (veículo, motorista, item, fornecedor, almoxarifado) compartilham a mesma
estrutura: listar com busca, criar por formulário, e uma ou outra ação sobre o registro.
Cada uma é um objeto `DefinicaoCadastro` — colunas, campos, validações e ações — consumido por
uma `PaginaCadastro` genérica.

**Motivo:** cinco cópias da mesma tela divergem com o tempo. Uma correção de acessibilidade ou
de formatação passaria a exigir cinco edições, e quatro seriam esquecidas.

**Custo aceito:** casos muito específicos vão precisar de tela própria em vez de forçar a
abstração. A linha é: se a definição precisar de um campo "escape hatch" para renderizar JSX
arbitrário no formulário, é sinal de que aquela tela deve sair do genérico.

### As abas seguem a permissão de leitura
O Gestor de Frota vê veículos, motoristas e almoxarifados; o Comprador vê itens, fornecedores e
almoxarifados. A aba some quando falta a permissão — e o servidor recusa de novo. Sem nenhuma
permissão, a página explica isso em vez de mostrar abas vazias.

### O formulário aceita como a pessoa digita
- **Vírgula decimal**: "600,5" vira `600.5` antes de enviar. Exigir ponto seria exigir que o
  usuário brasileiro digite errado.
- **CNPJ e CPF pontuados**: a máscara que a pessoa conhece é aceita e os dígitos são extraídos.
- **Placa em minúscula** vira maiúscula.

A validação roda no `blur` e de novo no envio; o servidor valida sempre.

### Campo vazio vira ausência, não string vazia
`limpar()` converte `''` em `null` antes de enviar. O backend distingue "não informado" de
"informado como vazio", e um `''` num campo opcional passaria pelo Zod e gravaria lixo.

### O que ficou de fora
Os cadastros **criam e homologam, mas não editam nem inativam** — a API não expõe `PATCH` nem
inativação para esses recursos. Como a regra de ouro 2 proíbe exclusão, a inativação precisa ser
desenhada com motivo registrado, e isso é decisão de negócio, não de tela.
