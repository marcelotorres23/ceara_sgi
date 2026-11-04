# ADR 0007 — Checklist (F6)

- **Data:** 2026-08-03
- **Status:** Aceito
- **Contexto:** Modelos versionados, execução com fotos, bloqueio por item crítico e storage
  S3 (seção 7.3).

## Decisões

### 1. Checklist bloqueado ainda pode ser finalizado
Bloqueio impede a **saída do caminhão**, não o registro. Se o checklist não pudesse ser
finalizado, o motivo pelo qual o veículo não saiu ficaria sem documento — exatamente o buraco
que o POP quer fechar. `podeFinalizar` cobra itens respondidos, fotos obrigatórias e assinatura;
o bloqueio entra em `status`, e quem consulta a liberação de saída é `situacaoDeSaida`.

### 2. `NA` não reprova, mesmo em item crítico
Um truck sem baú refrigerado não pode ser bloqueado por um item de baú. "Não se aplica" é
resposta legítima e distinta de "não conforme".

### 3. Idempotência pela chave do dispositivo
`checklists.idempotencia_chave` é única. O PWA gera a chave ao abrir o checklist offline; quando
a fila sincroniza — possivelmente várias vezes, em rede instável — o servidor devolve **o mesmo
registro** com 200 em vez de criar duplicatas com 201.

A mesma ideia vale para fotos: a chave no S3 embute o `sha256` do conteúdo, e reenviar a mesma
imagem devolve o registro existente.

### 4. Marca d'água: pixels no cliente, dados no servidor
A gravação visual acontece no dispositivo, antes do upload — é o que permite operar offline.
O servidor guarda os **mesmos dados** em `checklist_fotos.marca_dagua` (placa, motorista,
data/hora, coordenadas), ligados ao hash do arquivo.

Se a imagem for questionada depois, o que deveria estar nela está no banco, numa tabela
append-only. Confiar apenas nos pixels seria confiar no cliente.

### 5. GPS ausente é registrado, não inventado
Dentro de galpão não há sinal. A marca d'água escreve "GPS indisponível" e `coordenadas` fica
`null`. Preencher com `0,0` produziria evidência falsa apontando para o Golfo da Guiné.

### 6. O comparativo pareia por grupo + descrição, não por id
Descoberto na execução: Saída e Retorno são **modelos diferentes**, com ids de item distintos.
Comparar por `itemModeloId` nunca casaria nada — e o erro aparecia como falha genérica.

O pareamento agora é por `grupo|descrição` normalizado, e `itensComparados` informa quantos
itens realmente casaram. Item que existe só em um dos lados fica de fora, sem quebrar.

## Defeito encontrado: `RangeError` dos módulos puros virava 500

Responder um item com valor fora de `OK/NAO_OK/NA` devolvia **500 "Falha interna"**. Os módulos
de regra pura sinalizam entrada inválida com `RangeError` — eles não conhecem HTTP — e o tratador
não traduzia.

Isso valia para **todos** os módulos puros: estoque (saldo insuficiente já era tratado no
service, mas quantidade negativa não), abastecimento, valor presente, alçadas.
`core/errors/handler.ts` agora mapeia `RangeError` para 400 `VALIDATION_ERROR` com a mensagem
original — que já era escrita para o usuário final.

É o segundo defeito da mesma família encontrado em duas fases (o primeiro foi unicidade → 500,
na F5). O padrão: **erro que não é `AppError` cai no ramo genérico e vira 500.** Vale revisar,
antes de produção, se sobrou alguma outra classe de erro nessa situação.

## Ganchos da F5 fechados
- `houveChecklistNoDia` ligado: a anomalia `SEM_CHECKLIST_NO_DIA` do abastecimento agora consulta
  o checklist de verdade, em vez de ficar indefinida.
- Painel CCO passou a contar `veiculosSemChecklistHoje`, que era `null`.
- `situacaoDeSaida` junta o bloqueio do checklist com os documentos vencidos da F5.
  **Autorização excepcional cobre o checklist, não o documento vencido** — liberar um caminhão
  com CRLV vencido é decisão de outra natureza, e o sistema não a oferece.

## O que F6 não entrega

### O aplicativo do motorista (PWA offline) — a parte mais visível
O backend está inteiro e **foi desenhado para a fila offline**: chave de idempotência, foto em
base64 (o cliente comprime antes de enfileirar), dedup por hash, `sincronizadoEm`. O PWA já está
configurado desde a F0 com service worker.

Mas **a tela de execução no celular não existe**. Sem ela, "checklist em produção no pátio" —
o entregável que o roadmap descreve — não está cumprido. É o maior item em aberto do projeto
hoje, e depende de: IndexedDB para a fila, captura de câmera com compressão e marca d'água em
canvas, assinatura em canvas, e leitura do QR Code do veículo.

### Outros
- **PDF do checklist** (digital e impresso, seção 7.3): depende do Puppeteer, ainda não integrado.
  Sem ele não há o espelho preenchido nem a via impressa com QR de rastreio.
- **Ocorrência de manutenção automática**: item crítico reprovado deveria abrir OS (seção 7.3).
  A resposta declara `ocorrenciaManutencao: { pendente: true, fase: 'F7' }` em vez de fingir que
  abriu. Ordens de serviço são F7.
- Assinatura é aceita como URL/data-URI e não é validada como imagem.
