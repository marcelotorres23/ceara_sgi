# ADR 0027 — ficha de largada em PDF e envio ao WhatsApp do motorista

- **Status**: aceito
- **Data**: 08 de setembro de 2026
- **Contexto do documento mestre**: seção 14.7 (ficha de largada), seção 14.2 (ciclo do acesso),
  seção 5.5 (notificações e canais), seção 10.3 (documentos com a marca), seção 13 (regras)

## Contexto

Pedido: **registrada a largada do caminhão, emitir um formulário em PDF e poder mandá-lo para o
WhatsApp do motorista, no número que está no cadastro dele.**

O registro da saída existe desde a F12 (ADR 0017) e já guarda rota, veículo, motorista, nota fiscal,
descrição da carga e a leitura do hodômetro. O que não existia era **saída documental**: o motorista
deixava o pátio com o que lembrava da conversa na guarita, e o mesmo dado que estava gravado no banco
não acompanhava a viagem.

Dois obstáculos concretos apareceram no caminho, e as decisões abaixo são a resposta a eles: o
cadastro de motorista **não tinha telefone**, e a fila de saída da F10 (`notificacoes`) exige
`usuario_id` — o motorista não tem login.

## Decisões

### 1. `motoristas.telefone`, e não o telefone do usuário vinculado

O motorista pode ter usuário no sistema (`usuario_id`), mas quase nunca tem: quem dirige raramente
tem login. Usar `usuarios.telefone` faria a ficha chegar só a uma parte da frota, e faria o número de
contato da operação depender de um vínculo administrativo que existe por outro motivo.

O campo entra no cadastro com validação de DDD **no formulário e no backend**, com a mesma regra que
monta o E.164 no adaptador. Cadastro que aceita "ramal 42" só falha quando a ficha precisa sair, com
o caminhão já na saída.

### 2. Fila de saída própria (`mensagens_externas`), e não `usuario_id` opcional em `notificacoes`

A alternativa considerada foi afrouxar `notificacoes.usuario_id` para nulo e adicionar campos de
destinatário. Ela foi descartada: `notificacoes` é também **caixa de entrada dentro do sistema** —
`lida_em`, contagem de não lidas, a rota `marcarComoLida`. Linha sem dono nessa tabela contamina
todas as consultas que hoje assumem o usuário, e a alternativa a isso seria criar usuário fantasma
para cada motorista, sujando o cadastro de gente para caber num modelo.

`mensagens_externas` reaproveita **integralmente** a política de entrega da F10 (`entrega.ts`:
tentativa, backoff exponencial, descarte explícito, erro visível) e é drenada pelo mesmo job. O que
muda é a origem do destinatário: aqui ele fica **congelado na linha** no momento do envio. Mensagem
tem de provar para onde foi no dia em que saiu, e não para onde iria hoje — telefone de cadastro
muda.

### 3. O documento vai como anexo, por link assinado gerado no despacho

O adaptador de WhatsApp passa a aceitar `documento: { url, nome }` e o provedor busca o arquivo. As
alternativas eram mandar o link no corpo do texto — a ficha ficaria a um toque de distância de ser
ignorada — ou trafegar o binário pelo adaptador, o que obrigaria a fila a carregar megabytes por
tentativa.

O link é assinado com **sete dias**: o destinatário não tem login para pedir outro, e o link precisa
continuar abrindo depois do fim de semana e da viagem. O bucket segue fechado.

### 4. A ficha é arquivada, e não só gerada sob demanda

Cada emissão vira `anexo` do acesso. A folha que o motorista levou **é** o comprovante: quem conferir
a viagem seis meses depois precisa dela, e não de uma reimpressão com dados que já mudaram de lugar.
O hash no nome da chave deduplica reemissão idêntica.

O download avulso (`GET /portaria/acessos/:id/ficha-largada.pdf`) gera na hora sem arquivar — é
consulta, e exige `portaria:consultar`. Enviar exige `portaria:operar`: mandar mensagem em nome da
casa é ato de guarita, não de quem só consulta o movimento.

### 5. A emissão nunca derruba o registro do portão

`emitirFichaDaLargada` é chamada dentro de `registrarAcesso`, mas com o erro contido: o caminhão já
cruzou o portão, e MinIO fora do ar não apaga o evento. O que falha volta em `fichaLargada.avisos`,
com o botão de reemitir ao lado na tela.

Ela roda **depois** da conferência de hodômetro, de propósito, para que a ficha já saia com a
ocorrência daquela saída impressa nela.

### 6. Envio automático nasce desligado

`portaria.enviar_ficha_largada_whatsapp`, padrão `false`. O pedido foi "possa ser enviado", e mensagem
para fora da casa disparada sozinha, sem ninguém olhando, é o tipo de automação que se descobre pelo
erro. Com o motorista ainda no balcão, o botão custa um clique; ligar o automático é decisão de
operação, não default de implantação.

### 7. Layout puro, separado da consulta

`ficha-largada.ts` recebe a ficha montada e devolve o PDF, sem Prisma e sem I/O — mesma separação do
pedido de compra (6.1.8). A folha se confere sem banco, e a consulta se confere sem abrir PDF. O
teste conta as páginas lidas do próprio arquivo: **a ficha é uma folha**, e continua sendo com carga
longa, observação longa e ocorrências.

## Consequências

- Motorista sem telefone não recebe a ficha, e o formulário avisa disso **antes** do registro. O
  campo é opcional de propósito: exigir telefone quebraria o cadastro da frota já importada.
- Toda largada passa a escrever no storage. Falha ali degrada para aviso, nunca para erro de registro.
- `mensagens_externas` é uma segunda fila para operar. Ela aparece no mesmo job e usa a mesma
  política; a tela de falhas da governança ainda mostra só `notificacoes` — pendência conhecida.
- O provedor de WhatsApp precisa aceitar o campo `documento` no payload. Sem isso, a mensagem sai
  como texto e a ficha não chega; o canal não configurado continua devolvendo `NAO_CONFIGURADO`, e
  não `ENTREGUE`.

## Alternativas descartadas

- **Puppeteer**, como o documento mestre prevê para relatórios: a ficha é uma folha de campos, e a
  dependência de navegador headless na guarita não se paga. `pdfkit` já emite o pedido de compra.
- **Link público com token** em vez de anexo: mais uma superfície pública para manter e revogar,
  para entregar o que a URL assinada já entrega com prazo.
- **Gerar a ficha só no botão**, sem emitir no registro: deixaria a saída sem comprovante arquivado
  sempre que ninguém clicasse — que é exatamente o cenário que o módulo existe para eliminar.
