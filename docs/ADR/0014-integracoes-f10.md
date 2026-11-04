# ADR 0014 — F10: integrações de saída, chave de NF-e e importação

- **Status**: aceito
- **Data**: 03 de agosto de 2026
- **Contexto do documento mestre**: seção 5.5 (canais de notificação), seção 6.1.11 (entrada fiscal), seção 12 (F10 — "fim da redigitação")

## Princípio que atravessa a fase

**O que não está configurado diz que não está.** Nenhuma integração devolve sucesso sem ter
acontecido, e nenhuma devolve dado inventado. Isso decide o desenho de cada item abaixo.

## Decisões

### 1. Notificação tem fila de saída, não "enviada" otimista

Até aqui, `EMAIL` e `WHATSAPP` viravam linha no banco com `enviada_em` nulo — e ficavam ali para
sempre. Agora existe `tentativas`, `proxima_tentativa_em`, `ultimo_erro`, `descartada_em` e
`referencia_externa`, com job a cada 5 minutos.

- **Backoff exponencial**: 1, 2, 4, 8, 16 minutos; cinco tentativas e desiste.
- **Erro permanente não é reprocessado**: e-mail inválido não melhora na quinta tentativa.
- **Canal não configurado não consome tentativa.** A culpa é da infraestrutura, não do
  destinatário — e quando alguém configurar o SMTP, a fila inteira sai sozinha, sem intervenção.
- **Desistir de avisar alguém é evento de governança**, não detalhe técnico: vai para a trilha
  com severidade `ALERTA` e aparece em `/governanca/notificacoes/falhas`.

WhatsApp segue como canal de **saída apenas** (seção 5.5) — foi o canal duplo que o POP apontou
como fragilidade. O adaptador só despacha; nada entra por ele.

### 2. A chave da NF-e passa a ser validada de verdade

Antes: `/^\d{44}$/`. Agora: UF do IBGE, mês de emissão, modelo (55 ou 65) e **dígito verificador
mod-11**. Erro de digitação era descoberto só no confronto com a SEFAZ, depois do título provisionado.

A chave carrega o CNPJ do emitente, então o lançamento fiscal passou a **confrontá-lo com o
fornecedor do pedido**. Isso pega a nota lançada contra o pedido errado — que o three-way match não
pegaria quando valor e quantidade coincidem.

O módulo puro lança erro próprio; a borda traduz para 400 **com o motivo exato** ("termina em 7 e
deveria terminar em 3"). Um smoke pegou esse caminho respondendo 500, o que teria escondido a causa
de quem está com a nota na mão.

### 3. Consulta à SEFAZ fica declarada, não simulada

`GET /integracoes/nfe/:chave` devolve a chave destrinchada e, junto, o estado da consulta:
`{ disponivel: false, motivo: "defina SEFAZ_URL e SEFAZ_CERTIFICADO" }`. A consulta real exige
certificado digital A1 da empresa — decisão de infra, não algo a improvisar.

### 4. Importação confere antes de gravar, e não duplica

`POST /integracoes/abastecimentos/importar` roda em **`dryRun` por padrão**: devolve todos os erros
de uma vez, com número de linha e nome da coluna. Importação que aborta na linha 3 de um arquivo de
400 faz o operador corrigir um erro por vez — e ele desiste antes do terceiro.

**Idempotência por hash do evento** (placa + data/hora + litros + hodômetro), não pelo número da
linha: o mesmo abastecimento vem em posição diferente no arquivo seguinte. Arquivo de posto costuma
ser reenviado com o mês inteiro.

O leitor de CSV assume o mundo real do arquivo de terceiro: BOM do Excel, `;` ou `,`, decimal com
vírgula, acento no cabeçalho, aspas com separador dentro. Nada disso pode virar erro de importação —
o operador não tem como consertar o gerador do arquivo.

### 5. A importação passa pelo mesmo serviço da tela

`registrarAbastecimento` é o mesmo: consumo, detecção de anomalia, atualização de hodômetro e
trilha valem igual para o que entra por arquivo. Importar por um atalho criaria dado de segunda
classe — e o CPK e o consumo médio passariam a depender de por onde o dado entrou.

Consequência assumida: linha que dispara regra de negócio (hodômetro retrocedido, veículo inativo)
é **rejeitada individualmente**, com o motivo, sem derrubar o lote inteiro.

## Fora do escopo desta fase

- **Consulta real à SEFAZ** e **envio real por SMTP/WhatsApp**: o código está pronto e testado com
  adaptadores injetados; falta credencial. Preencha o `.env` (`SMTP_HOST`, `WHATSAPP_URL`,
  `SEFAZ_URL`) e `POST /governanca/notificacoes/despachar` esvazia a fila acumulada.
- **Importação do Fleetcom/ERP legado além de abastecimentos**: o leitor de CSV e a conferência são
  genéricos, mas só o mapeamento de abastecimento existe. Os demais dependem de conhecer o layout
  do arquivo do legado.
- **Tela de importação e de falhas de entrega**: ambas respondem pela API; a interface ainda não foi
  montada. Hoje o operador precisaria chamar a rota direto.
- **PDF com a marca**: segue pendente desde a F9, pelo mesmo motivo (Puppeteer).
