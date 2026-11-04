# SGI Ceará — Sistema de Gestão Integrada

Suprimentos, Transporte, Almoxarifado e Pessoas — Ceará Alimentos.

O documento mestre é [`eloforte.md`](eloforte.md). **Leia-o antes de qualquer alteração**:
nenhuma decisão de arquitetura, cor, nomenclatura ou regra de negócio pode divergir dele.
Decisões técnicas tomadas ficam em [`docs/ADR/`](docs/ADR/).

## Estado atual

**F0 — Fundação**, **F1 — Compras núcleo**, **F2 — Kanban + follow-up**, **F3 — Recebimento e
fiscal**, **F4 — Almoxarifado** e **F5 — Transporte base**: concluídas e verificadas com banco real.

**F6 — Checklist: concluída.** O app do motorista existe e opera offline: preenche sem rede,
enfileira no IndexedDB e sincroniza sozinho quando a conexão volta.

**Telas entregues:** app do motorista (`/checklist`), alertas de estoque (`/almoxarifado`),
painel CCO da frota (`/frota`), painel Kanban do comprador (`/compras`) e os cinco cadastros
(`/cadastros`: veículo, motorista, item, fornecedor, almoxarifado). O restante do fluxo de
compras continua só por API — ver "Verificação pendente".

O **ciclo P2P está fechado**: `solicitação → triagem → lote → cotação → mapa por valor presente
→ alçada → aprovação → pedido → recebimento com three-way match → entrada fiscal → título →
encerramento`. O comprador acompanha pelo painel Kanban em `/compras`.

> O gesto de arrastar-e-soltar não foi verificado por automação — ver "Verificação pendente".

| Entregue em F0 | Onde |
|---|---|
| Monorepo npm workspaces + Docker Compose (postgres, redis, minio, api, web) | `docker-compose.yml` |
| Schema Prisma do M0 (governança) | `apps/api/prisma/schema.prisma` |
| Auth JWT (access 15min + refresh 7d, httpOnly, rotação) + Argon2id | `apps/api/src/core/auth/` |
| RBAC `recurso:ação` validado no servidor | `apps/api/src/core/rbac/` |
| Segregação de funções (SoD) em runtime + matriz de conflitos | `apps/api/src/core/rbac/sod.ts` |
| Auditoria append-only com cadeia de hash + verificação de integridade | `apps/api/src/core/audit/` |
| Seed: 45 permissões, 11 perfis, 4 faixas de alçada, 14 parâmetros | `apps/api/src/db/seed.ts` |
| Design system com os tokens da marca | `apps/web/src/design-system/` |
| Login + shell (sidebar, topbar, painel) | `apps/web/src/modules/` |

| Entregue em F1 (backend) | Onde |
|---|---|
| Schema do M1: 15 tabelas, de `familias` a `pedido_itens` | `apps/api/prisma/schema.prisma` |
| Mapa de cotação por **valor presente** + savings + divergência | `modules/compras/valor-presente.ts` |
| Máquina de estados do lote, 17 estados, motivo obrigatório | `modules/compras/state-machine.ts` |
| Matriz de alçadas + elevação por escolha divergente | `modules/compras/alcada.ts` |
| SLA em **horas úteis** com feriados e suspensão | `modules/compras/horas-uteis.ts` |
| Ciclo completo com SoD e auditoria em cada passo | `modules/compras/service.ts` |
| 25 rotas: catálogo, fornecedores, solicitações, lotes, cotações, mapa, aprovação, pedidos | `modules/compras/routes.ts` |
| Seed de demonstração com um usuário por papel | `apps/api/src/db/seed-demo.ts` |

| Entregue em F2 | Onde |
|---|---|
| Painel Kanban: colunas por perfil, KPIs ao vivo, filtros e swimlanes | `web/src/modules/compras/PainelKanban.tsx` |
| Card com barra de criticidade, consumo de SLA, aging e cadeado | `web/src/modules/compras/CardLote.tsx` |
| Drag & drop `@dnd-kit` ligado à máquina de estados, com modal de motivo | idem |
| Regras do painel (SLA, aging, colunas, raias, KPIs) | `api/src/modules/compras/kanban.ts` |
| Jobs de SLA vencendo e alerta D-2 (BullMQ) | `api/src/modules/compras/jobs.ts` |
| Notificações in-app e sino na topbar | `api/src/core/notifications/`, `web/src/modules/shell/Notificacoes.tsx` |
| Ações rápidas: nota, cobrar fornecedor, reatribuir | `api/src/modules/compras/routes.ts` |

| Entregue em F3 | Onde |
|---|---|
| Three-way match pedido × NF-e × físico, item a item | `api/src/modules/compras/three-way-match.ts` |
| Retenção de pagamento por item divergente | idem |
| Bloqueio por divergência de preço acima da tolerância | idem |
| Entrada fiscal, títulos, bloqueio e liberação com motivo | `api/src/modules/compras/recebimento.service.ts` |
| Encerramento conferindo as três condições no banco | idem |
| Indicador de 48h entre recebimento físico e fiscal | `three-way-match.ts` |
| Error boundary no painel (lacuna deixada pela F2) | `web/src/design-system/components/LimiteDeErro.tsx` |

| Entregue em F4 | Onde |
|---|---|
| Custo médio ponderado móvel, saldo nunca negativo | `api/src/modules/almoxarifado/estoque.ts` |
| Ponto de pedido sugerido, cobertura e semáforo de alertas | idem |
| Acuracidade de inventário e impacto financeiro | idem |
| Movimentações com lock de linha; estorno em vez de exclusão | `api/src/modules/almoxarifado/service.ts` |
| Integração recebimento → entrada no estoque | idem |
| Painel de alertas + job diário consolidado das 06:00 | `api/src/modules/almoxarifado/alertas.service.ts` |
| Inventário cíclico com contagem cega e ajuste aprovado | `api/src/modules/almoxarifado/inventario.service.ts` |

| Entregue em F5 | Onde |
|---|---|
| Consumo km/L, custo por km e desvio da média histórica | `api/src/modules/transporte/abastecimento.ts` |
| Cinco anomalias de abastecimento apuradas automaticamente | idem |
| Vencimento de documentos com janelas D-30/D-15/D-7 | `api/src/modules/transporte/documentos.ts` |
| Veículos, mapa de rodagem, motoristas e abastecimento | `api/src/modules/transporte/routes.ts` |
| Painel CCO + job diário de documentos vencendo | `api/src/modules/transporte/service.ts` |
| Erros de unicidade e FK traduzidos para 409/404 | `api/src/core/errors/handler.ts` |

| Entregue em F6 (backend) | Onde |
|---|---|
| Avaliação do checklist e bloqueio por item crítico | `api/src/modules/checklist/avaliacao.ts` |
| Marca d'água auditável (placa, motorista, data/hora, GPS) | `api/src/modules/checklist/marca-dagua.ts` |
| Storage S3/MinIO com dedup por hash | `api/src/core/storage/index.ts` |
| Modelos versionados, idempotência de fila offline, liberação excepcional | `api/src/modules/checklist/service.ts` |
| Modelo "Saída de Caminhão": 9 grupos, 38 itens, 23 críticos | `api/src/db/seed-checklist.ts` |
| `RangeError` dos módulos puros traduzido para 400 | `api/src/core/errors/handler.ts` |

| Telas entregues | Onde |
|---|---|
| App do motorista: offline-first, foto com marca d'água, assinatura | `web/src/modules/checklist/ExecutarChecklist.tsx` |
| Fila de saída em IndexedDB com sincronização automática | `web/src/lib/fila-sincronizacao.ts`, `armazenamento-local.ts` |
| Compressão + marca d'água em canvas, GPS tolerante a falha | `web/src/modules/checklist/foto.ts` |
| Alertas de estoque com semáforo e sugestão de reposição | `web/src/modules/almoxarifado/PainelAlertas.tsx` |
| Painel CCO: frota, documentos a vencer, consumo do mês | `web/src/modules/transporte/PainelCco.tsx` |
| Cadastros (veículo, motorista, item, fornecedor, almoxarifado) | `web/src/modules/cadastros/` |
| Edição e inativação com motivo, autor e trilha do antes-e-depois | `api/src/modules/cadastros/service.ts` |

## O que já foi verificado

| Verificação | Resultado |
|---|---|
| `npm install` (raiz, workspaces) | OK |
| `prisma generate` — schema válido | OK |
| `tsc --noEmit` na API (strict) | OK, sem erros |
| `tsc --noEmit` na Web (strict) | OK, sem erros |
| `vitest run` — SoD, hash, valor presente, alçadas, estados, horas úteis, painel, three-way match, estoque, frota, checklist | 281/281 passando |
| `vite build` — bundle + service worker PWA | OK, 7 entradas em precache |
| `tsup` — bundle da API para node20 | OK |
| API sobe (dev e bundle de produção) e responde | OK — 401 sem sessão, 400 com payload inválido, 404 fora de rota |
| Argon2id nativo com os parâmetros OWASP | OK — hash e verificação corretos |
| Tela de login renderiza com os tokens da marca | OK |

Tudo acima no **Node 20.20.2**.

### Com banco (verificado)

| Verificação | Resultado |
|---|---|
| `docker compose up` — postgres, redis, minio | os três `healthy` |
| `prisma migrate dev` | migration `20260802173606_init` aplicada |
| SQL de append-only | função, gatilho e índice criados |
| **`UPDATE` na `auditoria` via psql** | **recusado pelo gatilho** |
| **`DELETE` na `auditoria` via psql** | **recusado pelo gatilho** |
| `db:seed` | 45 permissões · 11 perfis · 126 vínculos · 4 alçadas · 14 parâmetros · 1 admin |
| Administrador sem `lote:aprovar`, `recebimento:registrar`, `nota_fiscal:lancar` | confirmado no banco e nas claims |
| Ciclo de autenticação e governança (23 asserções) | 23/23 |
| Login pela interface | entra e renderiza o shell |

O ciclo de 23 asserções cobre: senha errada recusada sem revelar cadastro, login, cookies
httpOnly, claims com 42 permissões, `/me`, listagem com cursor, matriz de alçadas (faixa 1 até
R$ 1.000 com autoaprovação do Comprador; faixa 4 sem teto, Diretoria, SLA 48h), matriz de
conflitos de SoD, integridade da cadeia de hash, `LOGIN` e `LOGIN_FALHA` na trilha, rotação de
refresh com rejeição do token anterior, logout e bloqueio subsequente.

### Ciclo de compras F1 (44 asserções, banco real, um usuário por papel)

Cobre o caminho inteiro e as recusas que importam:

- **SoD em duas camadas** — o Solicitante é barrado pelo RBAC (`FORBIDDEN`, não tem `lote:criar`);
  um usuário que acumula Solicitante + Comprador **tem** a permissão e ainda assim é bloqueado
  pelo SoD (`SOD_VIOLATION`, regra `SOLICITANTE_NAO_COTA`), com a tentativa na trilha.
- **Valor presente decide** — Beta vence com R$ 10.250,00 em 60 dias (VP R$ 9.949,28) contra Alfa
  com R$ 10.000,00 à vista. O vencedor tem preço de face **maior**.
- **Divergência escala a alçada** — faixa 3 → 4, aprovador passa de Gerência para Diretoria.
- **Comprador não aprova o próprio lote**; reprovação sem motivo é recusada; a aprovação sai
  carimbada com hash sha256 e IP.
- **Pedido** `PC-2026-0001` emitido da cotação escolhida; reprogramação preserva a data prometida
  original.
- **Transição inválida** devolve 422; cancelamento sem motivo é recusado; solicitação cancelada
  continua consultável com o motivo.
- Cadeia de hash da auditoria **íntegra ao fim de tudo**.

## Subindo o ambiente

```bash
npm run infra:up
npm run db:deploy -w @sgi/api
npm run db:seed
npm run dev
```

Os gatilhos de append-only fazem parte das migrations — não há passo manual.

Para exercitar o ciclo de compras com um usuário por papel (nunca em produção):

```bash
npm run db:seed-demo -w @sgi/api
npm run db:seed-checklist -w @sgi/api
```

O segundo comando cria o modelo "Saída de Caminhão" (9 grupos, 38 itens, 23 críticos) e o
"Retorno de Caminhão" com os mesmos itens, para o comparativo.

Cria Solicitante, Comprador, Coordenador, Gerência, Almoxarife, Fiscal/Financeiro, Gestor de
Frota, Motorista e **dois usuários com perfis acumulados** — `Solicitante + Comprador` e
`Gerencia + Almoxarife` — que existem para demonstrar os bloqueios de SoD que só são alcançáveis
quando o RBAC já permitiu. Senha de todos: `Demo@12345`.

API em `http://localhost:3333` · Web em `http://localhost:5173`.
Credenciais do seed: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` do `.env`. Troque no primeiro acesso.

### Painel Kanban F2 (23 asserções, banco real)

Seis lotes montados em estágios diferentes e verificados no painel: distribuição nas colunas,
KPIs (lotes em aberto, valor em negociação, aderência ao SLA, aging, savings, pedidos sem NF-e),
filtro de criticidade e swimlane aplicados no servidor, colunas restritas por perfil (o aprovador
vê 4, o comprador vê 10), drop em coluna inválida recusado com 422, movimento que exige motivo
recusado sem ele e aceito com ele, nota no card, cobrança de fornecedor, sino de notificações e
reatribuição barrada por permissão.

### Ciclo P2P fechado — F3 (37 asserções, banco real)

Aceite total com three-way ok; entrega parcial que paga o que chegou e mantém o saldo pendente;
segunda entrega fechando o pedido; divergência de preço de 30% bloqueando a entrada fiscal e
levando o lote a `BLOQUEADO_DIVERGENCIA`; avaria retendo o item sem bloquear o lançamento;
título só nascendo com aceite, sem duplicidade; bloqueio e liberação de título com motivo;
encerramento recusado enquanto falta entrada fiscal ou título, e aceito quando as três condições
existem; lote encerrado não volta.

**Segregação de funções no recebimento:** o RBAC barra comprador e gerência antes do SoD (nenhum
perfil aprovador tem `recebimento:registrar`). A regra "quem aprova não recebe" só é alcançável
por quem acumula perfis — o teste usa um usuário `Gerencia + Almoxarife`, que aprova o lote e
leva `SOD_VIOLATION` / `APROVADOR_NAO_RECEBE` ao tentar receber.

### Almoxarifado — F4 (39 asserções, banco real)

Custo médio móvel (100 a R$ 10 + 100 a R$ 20 = média R$ 15, e a saída não altera a média);
saída por requisição recusada sem vínculo a veículo e OS; saída acima do saldo recusada com 409;
estorno gerando lançamento contrário e restaurando o saldo, sem apagar nada e sem estornar duas
vezes; ponto de pedido fixado pelo gestor não sobrescrito pela sugestão automática; semáforo
classificando abaixo do mínimo e sugerindo o lote econômico; recebimento gerando entrada com o
custo da NF-e e rastreio ao documento, sem duplicar; **item avariado não virando saldo
disponível**; inventário com contagem cega (a API não devolve o saldo do sistema ao contador),
acuracidade de 50% abaixo da meta e ajuste aplicado ao estoque.

No banco: `DELETE` em `movimentacoes` recusado pelo gatilho, `UPDATE` permitido (necessário para
o vínculo do estorno), zero saldos negativos.

### Frota — F5 (36 asserções, banco real)

Consumo de 3 km/L apurado a partir do segundo abastecimento (o primeiro não inventa número);
custo de R$ 2,00/km; **consumo 33% abaixo da média marcado como anomalia**; 450 L num tanque de
400 L; dois abastecimentos em 30 minutos; hodômetro retrocedido recusado sem justificativa e
aceito com ela — **sem rebaixar o hodômetro do cadastro**; documentos classificados nas janelas
certas (20 dias → D-30, 5 dias → D-7, vencido → vermelho); CNH, toxicológico e ASO do motorista
no mesmo painel; painel CCO com frota por status, documentos vencidos e consumo do mês.

**Placa duplicada devolve 409 `DUPLICADO` nomeando o campo** — antes era 500 "Falha interna".

### Checklist — F6 (46 asserções, banco e storage reais)

Modelo com 9 grupos / 38 itens / 23 críticos; abertura pela placa do QR; **reenvio da fila
offline devolve o mesmo checklist em vez de duplicar**; resposta fora do domínio recusada com a
mensagem certa; foto enviada ao MinIO com hash sha256 e marca d'água contendo placa, motorista e
coordenadas; foto idêntica reenviada não duplica; finalização recusada sem foto obrigatória e
sem assinatura; **item crítico reprovado deixa o checklist BLOQUEADO mas ainda finalizável**;
motorista não pode liberar; liberação excepcional exige justificativa de 10+ caracteres, registra
quem/quando/porquê e não acontece duas vezes; comparativo Saída × Retorno detectando a piora.

**Ganchos da F5 fechados:** abastecimento em veículo sem checklist do dia agora acusa
`SEM_CHECKLIST_NO_DIA` de verdade, e o painel CCO conta os veículos pendentes.

No banco: `DELETE` em `checklist_fotos` recusado pelo gatilho. No MinIO: objetos gravados
sob `checklists/CHK-2026-XXXX/`.

### Telas — verificado no navegador

Login; painel CCO com dados reais; alertas com semáforo; checklist aberto pela placa carregando
os 38 itens do modelo; item crítico reprovado deixando o card vermelho com o aviso de bloqueio e
a foto obrigatória; fila de 1 envio sincronizada e **confirmada no servidor**; **offline
simulado** retendo 3 envios com o preenchimento seguindo normalmente, e a fila drenando sozinha
quando a conexão voltou.

### Cadastros — verificado no navegador

Abas filtradas por perfil (o Gestor de Frota vê veículos/motoristas/almoxarifados, o Comprador vê
itens/fornecedores/almoxarifados); placa inválida barrada com `aria-invalid`; CNH com data passada
recusada; **"600,5" digitado com vírgula gravado como `600.5`**; CNPJ digitado com pontuação
gravado só com dígitos; campo de referência carregando placas de outro recurso; homologação de
fornecedor por modal de confirmação, com validade de um ano gravada.

### Edição e inativação — verificado (30 asserções + navegador)

Correção de placa gravada com o antes-e-depois na trilha; 409 quando nada muda; campo fora da
lista de editáveis descartado **sem efeito** (`hodometroAtual` e `status` intactos); permissão
por perfil; motivo obrigatório; registro inativo continua consultável com o motivo; não inativa
duas vezes; reativação. As cinco recusas por uso: veículo e motorista com checklist em execução,
fornecedor com pedido em aberto, item e almoxarifado com saldo — cada uma nomeando o documento
que impede.

Na tela: formulário pré-preenchido, hodômetro desabilitado com explicação, modal com aviso
específico do recurso, linha inativa esmaecida mostrando o motivo e só "Reativar".

## Verificação pendente

**Telas que ainda não existem:** o fluxo de compras além do Kanban — solicitação, cotação, mapa,
recebimento e contas a pagar. Tudo isso funciona por API.

**`updated_by` ainda falta em nove tabelas** (`usuario_perfis`, `mapas_cotacao`, `pedidos`,
`recebimentos`, `titulos`, `inventarios`, `abastecimentos`, `checklist_modelos`, `checklists`),
contrariando a seção 11 do spec. Foi corrigido só nas três que a edição toca; vale uma migration
de saneamento antes de produção.

**Não há histórico de alterações por registro na tela** — o dado está na trilha, visível apenas
para Administrador e Auditor.

**Leitura de QR Code por câmera** não foi implementada — a placa é digitada no campo que
receberia o valor do QR.

**O arrastar-e-soltar do Kanban não foi exercitado.** Nem ponteiro nem teclado completaram o movimento
através da automação de navegador, e não foi possível distinguir limitação da ferramenta de
defeito real. O contrato do servidor está provado e o board renderiza corretamente, mas o gesto
precisa de conferência manual antes de colocar o comprador para operar.

## Ambiente de desenvolvimento

A versão do Node é gerenciada por **nvm-windows**, com o **20.20.2** ativo (o pin `>=20 <21` do
`engines`). O 24.18.1 continua instalado como versão alternativa do nvm.

```bash
nvm list
nvm use 20.20.2
```

Trocar de versão exige **reinstalar `node_modules`**: o `argon2` é um módulo nativo e o binário
é específico do ABI de cada linha do Node.

```bash
rm -rf node_modules && npm install
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API e Web em watch |
| `npm run test` | Testes de todos os workspaces |
| `npm run typecheck` | TypeScript strict em todos os workspaces |
| `npm run db:migrate` | Prisma Migrate (dev) |
| `npm run db:seed` | Seed idempotente |
| `npm run infra:up` / `infra:down` | Sobe/derruba Postgres, Redis e MinIO |

## Regras que o código faz cumprir

1. `DELETE` físico é bloqueado na extensão do Prisma, em trigger e por `REVOKE`.
2. Toda rota valida permissão no servidor; a UI apenas esconde.
3. Tentativa bloqueada por SoD vira registro `SOD_VIOLATION` na auditoria — inclusive do Administrador.
4. A trilha de auditoria é encadeada por hash; `GET /api/v1/auditoria/integridade` aponta adulteração.
5. Mensagens de UI e de erro em pt-BR; código, variáveis e commits em inglês.

## Roadmap

F0 fundação → F1 compras núcleo → F2 Kanban → F3 recebimento/fiscal → F4 almoxarifado →
F5 frota → F6 checklist *(backend)* → **F7 pneus/manutenção** → F8 pessoas → F9 BI → F10 integrações.

Dívida a decidir antes de seguir: o **restante do fluxo de compras** em tela — solicitação,
cotação, mapa, recebimento e contas a pagar. A API de todos está pronta.
Detalhe na seção 12 de [`eloforte.md`](eloforte.md).
