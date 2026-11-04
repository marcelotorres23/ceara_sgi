# CLAUDE.md — SGI CEARÁ | Sistema de Gestão Integrada Ceará Alimentos

> **Documento mestre de desenvolvimento.** Este arquivo é a fonte única de verdade para o Claude Code.
> Antes de escrever qualquer linha de código, leia este documento inteiro. Nenhuma decisão de arquitetura,
> nomenclatura, cor, regra de negócio ou schema pode divergir do que está aqui sem atualizar este arquivo.

| Campo | Conteúdo |
|---|---|
| Produto | **SGI Ceará** — Suprimentos, Transporte, Almoxarifado e Pessoas |
| Versão do spec | 1.0 |
| Empresa | Ceará Alimentos — *Distribuindo Qualidade* |
| Base normativa | POP-COM-001 (Processo de Compras) + GUIA-MARCA-001 (Identidade Visual) |
| Autor | Alan Silva Martins — Suprimentos / DevTech Gestão |
| Data | 02 de agosto de 2026 |
| Stack | Node.js + PostgreSQL |

---

## 1. Contexto e problema a resolver

O diagnóstico do processo de compras (POP-COM-001) identificou **14 fragilidades, 5 delas críticas**.
O sistema existe para eliminá-las por construção — não por disciplina humana. Cada regra abaixo é
consequência direta de um risco mapeado e **não é negociável**:

| Risco identificado | Como o sistema resolve |
|---|---|
| Aprovação por WhatsApp | Aprovação eletrônica nativa com alçada, log imutável, hash e carimbo de tempo |
| Comprador exclui solicitação | `DELETE` proibido em todo o domínio. Apenas `soft delete` + cancelamento com motivo + notificação |
| Cadastro livre de produtos | Catálogo curado. Item novo entra por fila de homologação |
| Canal duplo (WhatsApp) | WhatsApp vira canal de **notificação de saída**, nunca de entrada |
| Ruptura pós-aprovação | Painel Kanban com estados explícitos + jobs de alerta por vencimento de prazo |
| Sem three-way match | Título só é liberado com aceite de recebimento vinculado ao pedido |
| Sem alçada | Matriz de alçadas parametrizável em banco, com escalonamento automático por SLA |
| Sem indicadores | 13 KPIs calculados por *views* materializadas |
| Escolha divergente sem justificativa | Campo obrigatório + sobe automaticamente 1 nível de alçada |
| Priorização informal | Criticidade P1–P4 com SLA associado, cravada na abertura |

**Regras de ouro do sistema (hard rules, valem para todo o código):**

1. Pedido que não está no sistema não existe.
2. Nada se exclui — cancela-se com motivo, notificação e trilha preservada.
3. Escolha divergente do menor preço exige justificativa registrada.
4. Nenhum título vai para contas a pagar sem aceite de recebimento vinculado ao pedido.
5. **Quem solicita não cota; quem cota não aprova; quem aprova não recebe.** (segregação de funções aplicada no middleware de autorização, não só na UI)

---

## 2. Stack técnica obrigatória

### Backend
- **Node.js 20 LTS** + **TypeScript** (strict mode, `noImplicitAny`)
- **Fastify** (preferido a Express: schema validation nativo via JSON Schema + performance)
- **PostgreSQL 16**
- **Prisma** como ORM principal + SQL puro (`$queryRaw`) para relatórios e views analíticas
- **Zod** para validação de payloads na borda
- **BullMQ + Redis** para jobs assíncronos (alertas de SLA, D-2 de entrega, estoque mínimo, fechamento mensal de pontuação)
- **Pino** para logging estruturado
- Autenticação: **JWT (access 15min + refresh 7d)** com `httpOnly cookie`, senha em **Argon2id**
- Upload de fotos: **S3-compatible** (MinIO local / Cloudflare R2 em produção), nunca base64 no banco
- PDF: **Puppeteer** (mapa de cotação, pedido de compra, folha da OS, relatórios)
- **Não usar** `nodemon` em produção; usar `tsx watch` em dev e build com `tsup`

### Frontend
- **React 18 + TypeScript + Vite**
- **TailwindCSS** com tokens da marca (seção 4)
- **TanStack Query** (server state) + **Zustand** (UI state) — nunca Redux
- **@dnd-kit/core** para o Kanban (não usar react-beautiful-dnd, deprecado)
- **Recharts** para gráficos
- **React Hook Form + Zod**
- **lucide-react** para ícones
- PWA com service worker: a fila de sincronização offline segue no código, hoje **sem uso** — nasceu para o checklist (removido, ADR 0024)

### Infra
- Docker Compose: `api`, `web`, `postgres`, `redis`, `minio`
- Migrations versionadas via Prisma Migrate — nunca alterar o banco à mão
- `.env.example` sempre atualizado; nenhum segredo no repositório

### Estrutura de pastas
```
/apps
  /api          → Fastify + Prisma
    /src
      /modules  → compras, transporte, almoxarifado, pessoas, governanca
        /<mod>/routes.ts | service.ts | repository.ts | schemas.ts | jobs.ts
      /core     → auth, rbac, audit, storage, notifications, errors
      /db       → prisma/schema.prisma, seeds
  /web          → React + Vite
    /src
      /modules  → espelha a API
      /design-system → tokens, componentes base
/docs           → este arquivo, POP, manual de marca, ADRs
```

---

## 3. Arquitetura de módulos

```
┌──────────────────────── SGI CEARÁ ────────────────────────┐
│  M0 · GOVERNANÇA (base de todos)                          │
│     usuários · perfis · permissões · alçadas · auditoria   │
├───────────────────────────────────────────────────────────┤
│  M1 · COMPRAS (P2P)      │  M2 · TRANSPORTE (Frota)       │
│  solicitação → cotação   │  caminhões · motoristas        │
│  → aprovação → pedido    │  abastecimento · manutenção    │
│  → recebimento → fiscal  │  pneus · manutenção · multas   │
│  ▸ PAINEL KANBAN         │  ▸ CHECK-LIST COM FOTOS        │
├───────────────────────────────────────────────────────────┤
│  M3 · ALMOXARIFADO       │  M4 · PESSOAS                  │
│  entrada/saída de peças  │  pontuação +/− mensal          │
│  estoque mínimo · alerta │  ranking · histórico · PDI     │
├───────────────────────────────────────────────────────────┤
│  M5 · BI / RELATÓRIOS ESTRATÉGICOS (transversal)          │
└───────────────────────────────────────────────────────────┘
```

**Fluxos de integração entre módulos (obrigatórios):**
- Requisição de peça no Almoxarifado sem saldo → gera automaticamente **solicitação de compra** (origem = "Reposição de estoque mínimo", criticidade P4).
- Recebimento aprovado em Compras → gera **entrada** no Almoxarifado (não existe entrada manual sem pedido, exceto devolução com motivo).
- Saída de peça do Almoxarifado → sempre vinculada a **um veículo + uma OS/ocorrência** (rastreia custo por ativo).
- Ocorrência de pessoas (positiva/negativa) pode ser **gerada por evento do sistema**: abastecimento fora do padrão, solicitação cancelada por especificação inválida, multa com condutor identificado.

---

## 4. Design System — Identidade Ceará Alimentos

Fonte: GUIA-MARCA-001. **Nenhuma cor fora desta paleta.**

### 4.1 Tokens

```css
:root {
  /* Principais */
  --ceara-azul:        #16469D;  /* base: títulos, headers, séries principais */
  --ceara-ouro:        #F3AE00;  /* acento apenas — nunca fundo de texto corrido */
  --ceara-branco:      #FFFFFF;

  /* Apoio */
  --ceara-azul-fundo:  #09409D;  /* fundos cheios, sidebar, capas */
  --ceara-texto:       #141414;
  --ceara-texto-2:     #5A5A5A;
  --ceara-nevoa:       #F2F4F8;  /* fundo de app, linhas alternadas, cards */
  --ceara-verde:       #1E7A44;  /* dentro da meta */
  --ceara-vermelho:    #C0392B;  /* fora da meta, risco alto, bloqueio */

  /* Derivados permitidos (apenas opacidade/tint da paleta) */
  --ceara-azul-10:     rgba(22,70,157,0.10);
  --ceara-ouro-15:     rgba(243,174,0,0.15);
  --borda:             #E3E7EE;
}
```

Tailwind (`tailwind.config.js`):
```js
colors: {
  ceara: {
    azul: '#16469D', ouro: '#F3AE00', fundo: '#09409D',
    texto: '#141414', texto2: '#5A5A5A', nevoa: '#F2F4F8',
    verde: '#1E7A44', vermelho: '#C0392B', borda: '#E3E7EE'
  }
}
```

### 4.2 Proporção cromática
**60% branco (respiro) · 30% azul (estrutura) · 10% dourado (acento).**
O dourado aparece como: filete inferior de título de seção, borda esquerda de card em destaque,
badge de status ativo, linha de destaque em gráfico. **Nunca** como fundo de bloco de texto.

### 4.3 Tipografia
- Família única: **Inter** (fallback: Segoe UI, Calibri, Arial). Segunda família permitida apenas para capa/relatórios: **Poppins**. Máximo 2 famílias por tela.
- Código/fluxos/números de série: **JetBrains Mono** sobre fundo `--ceara-nevoa`.

| Nível | Tamanho | Peso | Cor |
|---|---|---|---|
| H1 tela | 24px | 700 | azul |
| H2 seção | 18px | 700 | azul + filete dourado 2px abaixo |
| H3 | 15px | 600 | texto |
| Corpo | 14px | 400 | texto, line-height 1.5 |
| Legenda | 12px | 400 italic | texto2 |
| Tabela | 13px | header branco sobre azul, zebra em névoa |

### 4.4 Componentes base
- **Sidebar**: fundo `--ceara-azul-fundo`, logomarca **vertical negativa com detalhe amarelo** no topo, item ativo com barra dourada de 3px à esquerda.
- **Topbar**: branca, filete azul inferior 1px, breadcrumb + busca global + sino de notificações + avatar.
- **Card**: fundo branco, borda `--borda`, radius 10px, sombra suave. Variante "destaque" com borda esquerda de 4px (dourado = regra/atenção; vermelho = risco; verde = ok).
- **Badges de status**: pill, fundo tint 10% da cor + texto na cor cheia.
- **Tabelas**: cabeçalho azul/texto branco, zebra névoa, bordas finas, sticky header, densidade compacta.
- **Botão primário**: azul cheio; **secundário**: outline azul; **destrutivo/cancelar**: outline vermelho. Ação irreversível sempre exige modal de confirmação com motivo.
- **Estados vazios**: ilustração simples em traço azul + frase objetiva (tom de voz: direto, sem adjetivo vago).

### 4.5 Tom de voz na interface
Frases curtas e afirmativas. Dados concretos e prazos explícitos. Sem emoji, sem exclamação,
sem "ótimo/excelente". Erro descreve o que fazer: *"Informe o motivo do cancelamento para prosseguir."*

---

## 5. M0 · Governança, usuários e permissões

### 5.1 Modelo RBAC + ABAC
Permissão é composta por **`recurso:ação`** (ex.: `solicitacao:aprovar`) e restringida por
**escopo de dados** (unidade, centro de custo, carteira). Perfis são conjuntos de permissões
**editáveis em tela** — nada hardcoded no frontend. O backend valida sempre; a UI apenas esconde.

### 5.2 Perfis padrão (seed)

| Perfil | Escopo | Principais permissões |
|---|---|---|
| **Solicitante** | Seu centro de custo | abrir/consultar solicitação, anexar, receber notificações |
| **Comprador** | Sua carteira (técnica ou consumo) | triar, agrupar em lote, cotar, mapa, emitir pedido, follow-up |
| **Coordenador de Suprimentos** | Todas as carteiras | tudo do comprador + aprovar até faixa 2 + reatribuir carteira |
| **Gerência** | Unidade | aprovar até faixa 3, relatórios gerenciais |
| **Diretoria** | Global | aprovar sem limite, painel executivo, parametrizar alçadas |
| **Almoxarife** | Seu almoxarifado | receber, three-way match, entrada/saída, inventário |
| **Fiscal/Financeiro** | Global | entrada de NF-e, contas a pagar, bloqueio por divergência |
| **Gestor de Frota** | Frota | veículos, motoristas, pneus, abastecimento, manutenção, **tanque** (entrada, transferência, aferição) |
| **Motorista** | Só o próprio veículo/dia | registrar abastecimento, anexar fotos. **Não movimenta o tanque do pátio** |
| **Porteiro** | Guarita da unidade | entrada, saída e ocorrência. Não decide lista restritiva |
| **Auditor** | Global (`unidade:todas`) | somente leitura + acesso total à trilha de auditoria |
| **Administrador** | Global | usuários, perfis, parâmetros. **Não opera compras, não recebe material, não paga** |

Duas separações que a tabela esconde e o RBAC não pode perder:

- **Abastecer ≠ movimentar o tanque.** Tirar 200 litros para um caminhão tem placa e hodômetro
  respondendo pelo volume; lançar entrada de combustível, transferir entre tanques ou aferir a
  régua não tem contraparte. São `abastecimento:registrar` e `tanque:operar`, permissões
  distintas — senão a única credencial do motorista lança a entrada que cobre o próprio consumo.
- **A ficha do colaborador é da Gerência**, e não do Administrador: `colaborador:gerenciar` mora
  em quem responde pela equipe.

### 5.3 Segregação de funções (SoD) — validação obrigatória
Regras implementadas em `core/rbac/sod.ts`, avaliadas em runtime:
- O usuário que criou a solicitação **não pode** cotá-la nem aprová-la.
- O comprador do lote **não pode** aprovar o lote (exceto autoaprovação na faixa 1, e ainda assim registrada como tal).
- O aprovador **não pode** registrar o recebimento do mesmo pedido.
- Toda tentativa bloqueada gera registro em `auditoria` com severidade `SOD_VIOLATION`.
- Tela de administração exibe **matriz de conflitos** e **bloqueia** — não apenas alerta — a atribuição de perfis incompatíveis ao mesmo usuário. Acúmulos herdados de antes aparecem sinalizados na lista de usuários.
- A vedação do Administrador cobre a **cadeia inteira**, e não só o ato de aprovar: `solicitacao:triar`, `lote:criar`, `lote:reatribuir`, `lote:aprovar`, `cotacao:gerenciar`, `mapa:gerar`, `pedido:emitir`, `recebimento:registrar`, `nota_fiscal:lancar`, `movimentacao:registrar`, `inventario:gerenciar`, `titulo:gerenciar`. Barrar só `lote:aprovar` não segrega nada — quem cota e emite pedido precisa apenas de um aprovador de fachada. É a mesma combinação que a matriz proíbe entre os perfis Administrador e Comprador; permiti-la **dentro** de um perfil tornaria a matriz decoração. A lista mora em `modules/governanca/regras.ts`, usada pelo seed e pela edição.
- **Arrastar o card no painel cobra a mesma permissão que a tela do lote.** `lote:consultar` abre o board; não move nada nele. Aprovar, reprovar, emitir pedido, receber e lançar NF **não se alcançam arrastando** — cada um tem tela própria, porque cada um tem uma conferência que o arrasto não faz (a faixa de alçada, a SoD, a data prometida, o three-way match). As tabelas moram em `compras/state-machine.ts` e valem para as duas rotas de transição; a negativa é auditada com severidade `ALERTA`.
- **O seed passa pela mesma validação da tela.** Os perfis padrão moram em `modules/governanca/perfis-padrao.ts` — fora do script, para poderem ser conferidos por teste sem banco — e cada um é submetido a `validarPermissoesDoPerfil` antes de gravar. Sem isso as duas portas divergem em silêncio: a tela recusa um perfil que o seed acabou de criar. Guardado por `perfis-padrao.test.ts` (definição) e `npm run smoke:perfis` (o servidor devolvendo 403 de fato).

### 5.4 Auditoria
Tabela `auditoria` append-only (sem UPDATE/DELETE, garantido por trigger e por `REVOKE`):
`id, timestamp, usuario_id, ip, user_agent, entidade, entidade_id, acao, valor_anterior JSONB, valor_novo JSONB, hash_anterior, hash`.
Encadeamento por hash (`sha256(registro || hash_anterior)`) para detectar adulteração.
Retenção mínima: **5 anos** (conforme seção 7.8 do POP).

**Tela** (`/governanca`): usuários (criar, editar perfis, inativar com motivo, gerenciar senha), perfis e permissões (matriz por recurso), alçadas, parâmetros e trilha de auditoria com verificação da cadeia de hash. Cada aba aparece conforme a permissão; toda escrita entra na auditoria com valor anterior e novo.

**Senhas** (seção 5.1): o Administrador redefine a senha de **qualquer** usuário — gerada pelo sistema ou definida por ele, quando a entrega é por telefone. Nos dois casos a senha nasce **marcada para troca**, as sessões abertas caem na hora, e a aplicação fica bloqueada para a pessoa até que ela escolha uma senha própria. O administrador nunca conhece a senha definitiva de ninguém: ele entrega uma de passagem. A troca pelo dono exige a senha atual mesmo com sessão aberta e encerra todas as sessões. Política mínima: 10 caracteres, sem o próprio nome ou e-mail, sem sequência conhecida, diferente da anterior. A senha em si nunca entra na trilha — só o fato, o alvo e a consequência.

### 5.5 Parâmetros do sistema (tela de configuração, sem deploy)
**Canais de notificação** (seção 5.5): `IN_APP` já nasce entregue — a notificação *é* a linha no banco.
`EMAIL` e `WHATSAPP` entram numa **fila de saída** com tentativa, backoff exponencial e erro visível;
canal sem configuração não consome tentativa, e nada é marcado como enviado sem ter saído.
WhatsApp é canal de **saída apenas**. Detalhes em `docs/ADR/0014-integracoes-f10.md`.

Alçadas e faixas · SLAs por criticidade · nº mínimo de propostas por faixa · **exigência de evidência na cotação** · dias de alerta pré-entrega (D-2) ·
percentual de tolerância de divergência de preço na NF-e · pesos da pontuação de colaboradores ·
canais de notificação ativos.

### 5.6 Operação multiunidade — escopo de dados por unidade

A operação acontece em **várias unidades**. A unidade não é um dado decorativo do cadastro:
é o recorte de tudo que se vê e de tudo que se grava.

**Regras (detalhamento em `docs/ADR/0010-escopo-multiunidade.md`):**

1. **O usuário declara a unidade que está operacionalizando ao entrar.** Quem alcança mais de uma
   escolhe no login; quem alcança uma só entra direto. A troca de unidade sem novo login existe
   (`POST /auth/unidade-ativa`) e **é auditada** — saber em que unidade cada ação foi feita é parte da trilha.
2. **O alcance de cada pessoa é configurável na tela de usuários.** Marque quantas unidades ela
   precisar gerir — matriz, filial, quantas houver — e o login passa a oferecer a escolha. Grava no
   `escopo` do vínculo usuário-perfil (`{ unidades: [...] }`), que é o que o login já unia para
   apurar o alcance; a **lotação entra sempre**, mesmo desmarcada, e unidade inexistente ou inativa
   é recusada na hora de gravar — escopo com id morto vira acesso que some sem explicação. Isso é
   diferente de `unidade:todas`: aqui a lista é fechada e explícita, e a pessoa segue com **uma
   unidade ativa por vez**, que é a que recebe tudo que ela grava.
3. **Acesso a todas as unidades é permissão, não perfil**: `unidade:todas`. No seed, pertence ao
   **Comprador** (compra centralizada, atende toda a rede) e ao **Administrador**. Como perfis são
   editáveis em tela, a Diretoria e o Auditor podem recebê-la sem deploy.
4. **Todo registro nasce na unidade em operação.** Gravar em unidade fora do alcance é 403;
   consultar registro de outra unidade é **404** — quem não alcança não precisa saber que existe.
5. **`unidade_id` é coluna de primeira classe** em `veiculos`, `motoristas`, `pneus`, `ordens_servico`,
   `solicitacoes`, `lotes`, `centros_custo` e `almoxarifados`. Em `solicitacoes` e `lotes` ela é
   denormalizada do centro de custo, para filtrar Kanban e relatório sem `JOIN`.
6. **Um lote não mistura unidades.** Alçada, pedido e rateio de custo são por unidade.
7. **Todo relatório aceita filtro por unidade** e devolve, junto do número, quais unidades foram
   consideradas — ao lado da memória de cálculo (seção 10.3).

**Um lote não mistura material e serviço**, pelo mesmo motivo que não mistura unidades: o lote vira um pedido, e um pedido fecha com um documento fiscal. Misturar obrigaria dois documentos no mesmo pedido, e o three-way match não teria contra o que conferir.

O filtro é aplicado **no servidor**, por `core/rbac/escopo.ts`. A UI apenas esconde o que o
backend já recusaria.


---

## 6. M1 · Módulo de Compras (Procure-to-Pay)

Inspiração de mercado: SAP Ariba (compra guiada, catálogo curado, three-way match, avaliação de fornecedor) e
Coupa (workflow com detecção de anomalia, gestão de performance de fornecedor), adaptados à realidade da operação.

### 6.1 Submódulos

| Submódulo | Conteúdo |
|---|---|
| **6.1.1 Catálogo de itens** | Cadastro curado, código interno, código do fabricante, UM, família, curva ABC, item crítico, preço médio histórico, estoque mínimo vinculado. Fila de homologação de item novo com anexo (foto/spec) |
| **6.1.2 Cadastro de fornecedores** | Dados fiscais, homologação com validade, documentos com vencimento, categorias fornecidas, condições padrão, score de performance, status (homologado / em análise / bloqueado) |
| **6.1.3 Solicitação de compra ou de serviço** | Quem abre escolhe **o que precisa**: compra de material ou contratação de serviço. Não é rótulo — material entra no estoque e fecha com NF-e; serviço não entra no estoque e fecha com NFS-e municipal, que **não tem chave de acesso**. Demais campos: item (do catálogo), quantidade, UM, data-limite, centro de custo, criticidade P1–P4, origem da demanda, anexos. **Sem exclusão** — apenas cancelamento com motivo + notificação |
| **6.1.4 Triagem e lote** | Comprador analisa em ≤4h úteis, valida especificação, devolve com motivo (SLA suspenso), agrupa por família/fornecedor |
| **6.1.5 Cotação (RFQ)** | Envio por e-mail/WhatsApp. Registro obrigatório: preço unit., total, condição de pagamento, prazo em dias, desconto à vista, frete (CIF/FOB + valor), prazo de entrega. Registro de recusa/não resposta. **Toda proposta exige evidência anexada** — print, e-mail ou PDF do orçamento do fornecedor (parâmetro `compras.exigir_evidencia_cotacao`). Preço digitado sem comprovante é a palavra do comprador. *Link público do fornecedor: token gerado, portal ainda não construído* |
| **6.1.6 Mapa de cotação** | Comparativo por **valor presente** (não valor de face). Fórmula: `VP = valor_liquido / (1 + taxa_mensal)^(prazo_dias/30)`. Taxa parametrizável. Ranking automático + recomendação. PDF vinculado ao lote |
| **6.1.7 Aprovação por alçada** | Eletrônica, com identificação, data/hora, IP. Ações: aprovar · aprovar com ressalva · devolver para renegociação · reprovar (motivo obrigatório). Escalonamento automático por SLA vencido. **Mesa do aprovador**: fila do que espera decisão, com valor, faixa, SLA em horas úteis e o centro de custo onerado; ao selecionar o lote abre o **histórico de compras daquele centro de custo — a placa** (total pedido, em andamento, gasto do mês contra orçamento, série mensal, itens recorrentes e lista de compras). Lote que mistura centros tem o valor rateado pela quantidade de itens de cada solicitação, e a linha sai marcada como rateada |
| **6.1.8 Pedido de compra** | Numerado, PDF com marca, envio ao fornecedor, confirmação de recebimento, **data prometida** (alimenta OTIF) |
| **6.1.9 Follow-up** | Alerta automático D-2 da data prometida. Repactuação registra nova data + motivo, **mantendo o atraso original no histórico** |
| **6.1.10 Recebimento (three-way match)** | Pedido × NF-e × físico. Conferência item a item, com foto da divergência. Aceite total, parcial ou recusa. Divergência retém pagamento do item |
| **6.1.11 Entrada fiscal e contas a pagar** | Só habilita após aceite. Divergência de preço acima da tolerância **bloqueia** e devolve ao comprador. Prazo máximo 48h entre físico e fiscal (indicador). O documento cobrado é o do tipo do lote: **NF-e** para material (chave de 44 dígitos conferida contra o CNPJ do fornecedor) e **NFS-e** para serviço (só número — chave informada em serviço é recusada, não ignorada). **O arquivo da nota fica anexado ao recebimento** — PDF, XML ou foto da nota em papel: número e chave já ficavam gravados, mas o documento morava no e-mail de alguém. Lançada a nota, o lote **encerra sozinho** se as três condições do encerramento já se cumpriram — trabalho terminado não fica pedindo atenção no painel |
| **6.1.12 Avaliação de fornecedor** | OTIF, índice de divergência, aderência ao preço cotado, tempo de resposta a cotação, taxa de recusa. Score 0–100 recalculado a cada encerramento de ciclo |
| **6.1.13 Contratos e preços negociados** | Contratos com vigência, tabela de preço acordada, alerta de vencimento, aplicação automática do preço na cotação |

### 6.2 Máquina de estados do lote (e colunas do Kanban)

```
RASCUNHO → TRIAGEM → EM_COTAÇÃO → MAPA_PRONTO → AGUARDANDO_APROVAÇÃO
   → APROVADO → PEDIDO_EMITIDO → AGUARDANDO_ENTREGA → RECEBIDO_PARCIAL
   → RECEBIDO → NF_LANÇADA → ENCERRADO

Estados laterais: DEVOLVIDO_AO_SOLICITANTE · EM_RENEGOCIAÇÃO · REPROVADO · CANCELADO · BLOQUEADO_DIVERGÊNCIA
```
Transições válidas ficam em `modules/compras/state-machine.ts`. Transição inválida = erro 422, jamais silenciosa.
**Encerramento só é permitido com: material recebido + NF-e lançada + título provisionado.**

### 6.3 PAINEL KANBAN DO COMPRADOR (requisito central)

Tela principal do perfil Comprador. Objetivo: visão e controle das próprias atividades.

**Layout**
- Colunas = estados do fluxo (configuráveis por perfil: o comprador vê da Triagem ao Encerramento; o aprovador vê só a raia de aprovação).
- Drag & drop com `@dnd-kit`; o *drop* dispara a transição da máquina de estados — **se a transição exigir dados (ex.: justificativa), abre modal e só conclui após preenchimento**.
- Swimlanes alternáveis: por **criticidade (P1–P4)**, por **comprador**, por **centro de custo**.

**Anatomia do card**
```
┌──────────────────────────────────────┐
│ ▌ LOTE-2026-0481          [P1]  🔴   │  ← barra lateral colorida = criticidade
│ 12 itens · R$ 8.430,00               │
│ Solicitante: Manutenção · CC 3021    │
│ ⏱ SLA: vence em 3h  ▓▓▓▓▓░░░ 68%     │  ← barra de consumo de SLA
│ 🏷 Técnica  📎3  💬2                  │
│ Fornecedor: — · Aprovador: Gerência  │
└──────────────────────────────────────┘
```
- Cor da barra lateral: P1 vermelho · P2 dourado · P3 azul · P4 cinza.
- Borda pulsante vermelha quando SLA vencido. Ícone de cadeado quando bloqueado por divergência.
- Contador de aging (dias em aberto) visível a partir de 5 dias.

**Cabeçalho do painel (KPIs ao vivo)**
`Lotes em aberto` · `Valor em negociação` · `% dentro do SLA` · `Aging > 10 dias` · `Savings do mês` · `Pedidos sem NF-e`.

**Filtros**: criticidade, centro de custo, fornecedor, faixa de valor, período, "só os meus", "só atrasados".
**Ações rápidas no card**: abrir detalhe, cobrar fornecedor (dispara notificação), reatribuir, adicionar nota.
**Regras**: nenhum card pode ser arrastado para trás sem motivo registrado; card cancelado sai do board mas permanece no histórico.

### 6.4 Matriz de alçadas (seed inicial, parametrizável)

| Faixa | Valor por lote | Aprovador | Propostas mín. | SLA |
|---|---|---|---|---|
| 1 | até R$ 1.000 | Comprador (autoaprovação) | 2 | Imediato |
| 2 | R$ 1.000,01 – 5.000 | Coordenador de Suprimentos | 3 | 8h úteis |
| 3 | R$ 5.000,01 – 20.000 | Gerência | 3 | 24h úteis |
| 4 | acima de R$ 20.000 | Diretoria | 3 + parecer técnico | 48h úteis |
| E | Emergência P1 | Verbal + regularização em 24h | 1 (excepcional) | Imediato |

Regra complementar codificada: **escolha divergente do menor preço sobe automaticamente 1 nível.**

**A faixa manda em quem decide.** `lote:aprovar` diz que a pessoa aprova alguma coisa; a matriz diz *o quê*. `aprovadorHabilitado` (em `compras/alcada.ts`) confere o perfil contra a faixa, e `decidirAprovacao` recusa com 403 quem não a alcança — sem isso a Gerência, cujo teto é a faixa 3, decidia um lote de R$ 51.000 que a matriz manda para a Diretoria. Faixa maior alcança faixa menor; o contrário não, que é justamente o teto que a matriz existe para impor.

**O pedido sai em PDF** (`GET /compras/pedidos/:id/pdf`, permissão `pedido:consultar`, download auditado). O fornecedor não entra no sistema: o que chega nele é esse anexo. O documento traz fornecedor, entrega com centro de custo e placa, tabela de itens, totais com frete e desconto, campos de aceite e conferência — e, acima de tudo, **a prova da aprovação**: quem aprovou, quando, em que faixa e o hash da assinatura eletrônica. É o que separa a folha de uma cotação bonita: o almoxarife confere o recebimento contra o mesmo papel. Pedido sem decisão gravada sai com tarja vermelha declarando a falta, em vez de omitir o bloco.

**A decisão mora na tela do lote**, ao lado das propostas que a fundamentam, e não só na fila do aprovador — quem decide acabou de ler as cotações na aba anterior. O `GET /compras/lotes/:id` devolve `aprovacaoDisponivel` (permissão + faixa + SoD já resolvidos) para a tela habilitar o botão em vez de deixá-lo falhar no clique; quando não pode, o motivo aparece no lugar do botão.

### 6.5 Criticidade e SLA

| Nível | Situação | SLA (solicitação → pedido) | Regra |
|---|---|---|---|
| P1 | Parada de operação | 4h úteis | Cotação simplificada + regularização 24h |
| P2 | Risco iminente | 24h úteis | Mín. 2 propostas |
| P3 | Programada | 5 dias úteis | 3 propostas |
| P4 | Reposição/projeto | 10 dias úteis | 3 propostas + análise de consumo |

Cálculo de SLA em **horas úteis** (calendário de expediente + feriados de Maranhão parametrizáveis), com
**suspensão** enquanto a solicitação estiver devolvida ao solicitante.

### 6.6 Indicadores do módulo (13 KPIs do POP)

| KPI | Fórmula | Meta | Freq. |
|---|---|---|---|
| Lead time de compras | média(dias abertura → pedido aprovado) | ≤5 dias (P3/P4) | Semanal |
| Lead time total | abertura → recebimento conferido | ≤15 dias | Mensal |
| Savings | (base − fechado) ÷ base | ≥5% | Mensal |
| Lotes atendidos/dia | encerrados ÷ dias úteis | baseline | Semanal |
| Aging da fila | % em aberto >10 dias | ≤5% | Semanal |
| Aderência ao SLA | dentro do SLA ÷ total | ≥90% | Mensal |
| Taxa de compra emergencial | P1 ÷ total | ≤10% | Mensal |
| % com 3 propostas | lotes com 3 ÷ lotes >R$1.000 | ≥95% | Mensal |
| % escolha divergente | divergentes ÷ total | monitorar | Mensal |
| OTIF do fornecedor | entregas no prazo e completas ÷ total | ≥90% | Mensal |
| Divergência no recebimento | com divergência ÷ total | ≤3% | Mensal |
| Pedidos pendentes de NF-e | recebidos sem entrada >5 dias | zero | Semanal |
| Taxa de cancelamento | canceladas ÷ abertas | monitorar | Mensal |

> **Advertência de produto (registrar como tooltip na tela):** "Lotes atendidos/dia" é métrica de esforço.
> Nunca exibir isoladamente — sempre ao lado de valor comprado e aging.

---

## 7. M2 · Módulo de Transporte / Frota

Referências de mercado incorporadas: TOTVS Gestão de Frotas, GIFT ERPO (CCO, abastecimento, pneus, multas, documentos), Prolog (gestão de pneus com número de fogo e CPK), CRTI ERP (custo por equipamento).

### 7.1 Cadastros base
- **Veículos**: placa, RENAVAM, chassi, frota (nº interno), tipo, marca/modelo/ano, configuração de eixos e **layout de posições de pneu** (mapa de rodagem), capacidade do tanque, hodômetro/horímetro atual, centro de custo, status (ativo/manutenção/inativo/vendido).
  - **Tipos**: truck · toco · truck 3/4 · 3/4 · carreta · semi-reboque · caçamba · utilitário · van · moto.
  - **Dados da frota real**: propriedade e CNPJ do proprietário (a frota opera bens de mais de um CNPJ do grupo), capacidade de carga em kg, finalidade (entrega, coleta, passeio) e **situação descrita** — o texto como a operação escreve ("AÇAILÂNDIA", "CHASSIS", "VENDIDO - AINDA ESTÁ DIST"). O `status` diz se o veículo roda; a situação descrita diz o resto, e as duas coisas não cabem no mesmo campo.
- **Equipamento de refrigeração**: **ativo próprio**, não coluna do veículo. Marca, modelo, número de série, acionamento (diesel · diesel/elétrico · acoplado/elétrico · inoperante), ano, **horímetro** e status, com vínculo ao veículo onde está agora. É entidade separada porque o aparelho migra entre caminhões — a planilha da frota registra "aparelho foi pro SNH3B02" — e porque a vida útil dele se conta em horas, não nos km do veículo que o carrega hoje. **Cada placa é um centro de custo**: é esse vínculo que faz o gasto de compras responder por caminhão — na mesa do aprovador (6.1.7) e no custo por equipamento (8.1). Veículo sem centro de custo aparece sem placa no histórico de compras.
- **Hodômetro do veículo é o valor de referência do sistema**. Quem lê o painel é a **portaria** (saída e retorno do caminhão da casa), a **oficina** (execução de serviço) e o **abastecimento** — todos leem do cadastro e escrevem de volta nele, sempre deixando leitura registrada (7.10). Duas regras valem em qualquer uma das origens:
  - **Leitura menor que a registrada alerta e não baixa o cadastro.** Erro de digitação ou troca de painel acontece; o que não pode é a quilometragem do caminhão cair sozinha e levar junto consumo, CPK e plano de manutenção. Na portaria o alerta vira **ocorrência** do acesso; nas demais origens, **notificação** para quem tem `veiculo:gerenciar`. Corrigir hodômetro para menos é ato do cadastro do veículo, com trilha própria.
  - **Salto acima de 5.000 km entre leituras também alerta** — é a assinatura do dígito a mais.
  - Leitura que avança atualiza o cadastro na hora, para a próxima comparação valer contra o valor certo. No abastecimento a regra é mais dura e já existia: hodômetro retrocedido **bloqueia** sem justificativa (7.2).
- **Documentos do veículo**: CRLV, seguro, ANTT, tacógrafo, licenças — com data de vencimento e **alerta em D-30/D-15/D-7**.
- **Motoristas**: dados pessoais, CNH (categoria, vencimento, alerta), exames toxicológico e ocupacional com vencimento, vínculo com veículo padrão, status, foto.
- **Componentes**: além de pneus — baterias, filtros, lonas — com vida útil esperada.

### 7.2 Abastecimento
Registro: data/hora, veículo, motorista, posto (interno/externo), litros, valor unitário, valor total,
hodômetro/horímetro, tipo de combustível, **foto obrigatória do painel (odômetro) e do cupom**, forma de pagamento, nº do cartão/ticket.

**Cálculos automáticos**: consumo (km/l) do intervalo, custo por km, desvio percentual em relação à média histórica do veículo.
**Anomalias sinalizadas automaticamente**:
- Consumo fora de ±15% da média do veículo (parâmetro configurável)
- Litragem acima da capacidade do tanque
- Hodômetro menor que o do último registro (bloqueia com justificativa)

**Entrada de combustível no tanque, com leitura da NF-e**: o XML da nota da distribuidora
preenche litros, custo do litro, número da nota e fornecedor — os quatro campos onde um dígito
trocado desalinha o custo médio de todo o estoque. O arquivo **propõe, nunca grava**: volume
faturado e volume recebido divergem por temperatura e sobra de mangueira, e quem sabe o que desceu
do caminhão-tanque é quem estava no pátio com a régua. A tela mostra os itens separados entre o que
vai para o tanque e o que não vai (frete, lubrificante em balde vêm na mesma nota), casa o
fornecedor pelo CNPJ e **avisa quando aquela nota já foi lançada** — relançar duplicaria o estoque.
O custo do litro é ponderado pelo volume, porque nota com o mesmo produto em dois preços é comum
quando há desconto por faixa.

**Inclusão em tela**: o abastecimento é registrado direto no módulo — veículo, motorista, data, posto
(rua ou tanque próprio), combustível, litros, preço e hodômetro. O que o sistema apura — km
percorridos, consumo, custo por km e as anomalias — **volta na hora do registro, na tela**, porque
anomalia descoberta no relatório do fim do mês já perdeu a chance de ser corrigida. O hodômetro do
cadastro entra como sugestão: corrigir é mais rápido que digitar seis dígitos do zero.

**Relatório com filtros combináveis**: período, veículo, motorista, onde abasteceu (rua ou tanque
próprio), combustível, com ou sem anomalia, e busca livre por placa, frota, posto ou motorista.
Traz os totais do recorte (litros, gasto, km, consumo médio, custo por km, preço médio do litro) e
o agrupamento por veículo, motorista, posto e combustível — **ordenado por gasto**, porque a
pergunta que se faz a um relatório de abastecimento é onde está indo o dinheiro. Exporta em CSV com
separador `;` e BOM, que é o que o Excel em pt-BR abre sem pedir importação.

Duas sutilezas da apuração, que a média simples erra:
- **Consumo do período é km total ÷ litros totais**, e não a média dos consumos de cada
  abastecimento — somar km/L e dividir pela quantidade daria o mesmo peso a um registro de 30 litros
  e a um de 300, e o resultado não bateria com o que o tanque gastou.
- **Registro sem km apurado fica fora do consumo**, mas entra no gasto. É o primeiro abastecimento
  do veículo, ou o que veio depois de hodômetro retrocedido: tem combustível sem distância
  conhecida, e misturar os dois inventaria rendimento. A tela diz quantos são.
- Dois abastecimentos do mesmo veículo em janela < 2h

Anomalia gera ocorrência e pode alimentar a pontuação do colaborador (M4).

### 7.3 Checklist de saída — **removido** (ADR 0024)

O módulo de checklist digital foi **eliminado a pedido do dono do produto em 19/08/2026**, com os
dados apagados. O que ele fazia — conferência de saída com foto e assinatura, bloqueio por item
crítico e abertura automática de OS corretiva — **não tem substituto no sistema**. O plano de
manutenção (7.10) responde por vencimento planejado, que é outra pergunta.

As consequências, inclusive a perda da prova documental de verificação diária, estão registradas em
[ADR 0024](docs/ADR/0024-remocao-do-modulo-de-checklist.md).

### 7.4 Gestão de pneus
- Cadastro individual: **número de fogo** (identificação gravada), série do fabricante, marca, modelo, medida, DOT, tipo (novo/recapado, com nº da recapagem), custo de aquisição.
- **Ciclo de vida**: estoque → em uso (veículo + posição) → rodízio → recapagem → sucata. Cada movimentação registra data, hodômetro, sulco medido (mm) e motivo.
- **Mapa de rodagem visual**: representação gráfica do caminhão com as posições clicáveis; cor por estado do sulco (verde ≥ 6mm · dourado 4–6mm · vermelho < 4mm, parametrizável).
- **CPK (Custo Por Quilômetro)** por pneu, por veículo, por marca e por modelo:
  `CPK = (custo aquisição + custos de recapagem e reparo) ÷ km rodados no pneu`
- Inspeções periódicas com registro de sulco e pressão, **com foto**.
- Alertas: sulco abaixo do limite legal, pneu acima da vida útil esperada, pneu candidato a rodízio.
- **Folha de checagem de sulcos** (impressa pelo navegador, A4): o caminhão visto de cima, uma caixa
  por posição, gerada do mapa de rodagem do veículo — sai o número certo de eixos, e posição vazia
  vem marcada como vazia em vez de virar caixa em branco que ninguém sabe se é "sem pneu" ou
  "esqueci de medir". Placa e km do cadastro vêm impressos; data e quem mediu, em branco.
  **Não há campo de identificação do pneu**: o pneu já é marcado no costado e roda entre posições no
  rodízio — pedir o número de fogo na prancheta é pedir para alguém transcrever errado, e quem sabe
  qual pneu está em cada posição é o sistema. A caixa de medida vem em branco de propósito: imprimir
  a última medição ao lado ancora quem mede, porque é mais fácil confirmar o número anterior do que
  encostar o paquímetro. O limite legal e as faixas vêm no rodapé, porque tirar o pneu de operação é
  decisão da regra, e não da memória de quem está com a prancheta.

### 7.5 Manutenção
- Preventiva por **plano** (gatilho por km, horas ou data) com alerta antecipado.
- Corretiva por ocorrência (origem: motorista, inspeção de pneu, anomalia de abastecimento).
- Ordem de Serviço: itens de serviço, peças requisitadas ao almoxarifado (**baixa automática de estoque**), mão de obra, terceiro, custo total, tempo de veículo parado.
- **Folha da OS para a bancada**: impressa pelo navegador (A4, sem dependência de gerador de PDF), com dados do veículo, serviço solicitado, itens já lançados, **linhas em branco para o mecânico anotar** e campos de assinatura. O mecânico não vai ao computador a cada parafuso.
- **Fechamento com o relato de quem executou**: quem foi o mecânico, o que ele anotou na folha e se a conclusão foi **total ou parcial**. A parcial exige descrever a pendência e, por padrão, **abre a OS de retorno** que a carrega (origem `OS_PARCIAL`, vinculada à original nos dois sentidos) — pendência sem OS vira frase que ninguém consulta. OS sem nenhum item lançado não conclui: não alimentaria custo por veículo.
- **Abertura e lançamento em tela**: o gestor abre a OS pela tela de Manutenção (veículo, tipo, defeito, oficina, hodômetro) e lança os itens ali mesmo — peça do catálogo, que sai do estoque pelo custo médio do almoxarifado escolhido, ou mão de obra/serviço pelo valor combinado. Antes disso, OS só nascia por evento automático ou pela API.
- Histórico completo por veículo — "prontuário do ativo".

### 7.6 Multas e ocorrências
Registro de infração (AIT, data, local, valor, pontos), identificação do condutor, prazo de indicação e de recurso com alerta, status, anexo do auto. Ranking de infrações por motorista → alimenta M4.

### 7.7 Painel de frota (CCO)
Cards de status por veículo (em rota / pátio / manutenção / bloqueado), documentos a vencer,
CNHs a vencer, itens de plano vencidos no pátio, pneus em estado crítico, planos de manutenção vencendo,
consumo médio da frota no mês vs. mês anterior.

### 7.9 Abastecimento interno (tanque próprio)

Referência funcional: sistemas de automação de abastecimento interno (CTA Smart e similares).
A F5 media o **consumo do veículo**; esta seção controla o **estoque do combustível** — sem ela,
compra-se 5.000 litros, abastece-se 4.200, e os 800 restantes são fé.

- **Produtos**: diesel S10/S500, gasolina, etanol, **Arla 32** e **lubrificantes**.
- **Tanques**: `FIXO` (pátio) e `MOVEL` (caminhão comboio, vinculado a um veículo). Saldo em litros
  com **custo médio ponderado móvel** — a mesma matemática do almoxarifado (seção 8.1).
- **Bicos**: ponto de abastecimento com **encerrante** (contador da bomba). A diferença entre leitura
  final e inicial confere o volume digitado; encerrante que retrocede é recusado.
- **Movimentações**: entrada por compra (**nota fiscal obrigatória**), transferência entre tanques,
  saída por abastecimento e acerto. Nada se exclui.
- **O abastecimento do veículo baixa o tanque na mesma transação**, e o custo do litro vem do custo
  médio do estoque — não de valor digitado. Posto externo segue com preço de bomba.
- **Aferição**: régua contra sistema. Perda dentro da tolerância (`frota.tolerancia_afericao_tanque`,
  0,5%) é evaporação; **acima dela exige justificativa e notifica a gestão** — nunca vira ajuste
  silencioso. Sobra também é divergência.
- **Recortes operacionais** no abastecimento: obra/local, rota, turno e OS. O **turno sai do horário**
  quando não informado, e atravessa a meia-noite.
- **Médias por recorte**: veículo, motorista, modelo, categoria, turno e obra — somando litros e km
  antes de dividir.

Detalhes e limites em `docs/ADR/0015-abastecimento-interno-f11.md`.

### 7.10 Controle de óleo, lubrificação e serviços periódicos

Substitui a planilha de cinco abas que a operação mantinha ("TROCAS DE ÓLEO DIFERENCIAL, MOTOR,
THERMO KING E CAIXA DE MARCHA"). Todas as abas faziam **a mesma conta** — medição da última
execução + intervalo, comparada com a medição de hoje. O que mudava era o intervalo e a unidade de
medida. Aqui a conta existe uma vez só, e o que muda é **plano cadastrado**, não coluna oculta.

**Uma regra por tipo** (o padrão que a planilha praticava, editável em tela por quem tem
`preventiva:parametrizar`):

| Tipo | Base | Intervalo | Avisa com | Onde aparece |
|---|---|---|---|---|
| **Lubrificação** (engraxamento do chassi) | **dias de calendário** | **10 dias** | 2 dias | Óleo e lubrificação → Lubrificação |
| Óleo do motor | hodômetro do veículo | 20.000 km | 2.000 km | Óleo → Motor |
| Óleo do Thermo King | **horímetro do equipamento** | 1.000 h (CARRIER) · 2.000 h (THERMO KING) | 100 h | Óleo → Thermo King |
| Óleo do diferencial | hodômetro do veículo | 60.000 km | 5.000 km | Óleo → Diferencial |
| Óleo da caixa de marcha | hodômetro do veículo | 60.000 km | 5.000 km | Óleo → Caixa de marcha |
| Alinhamento | hodômetro do veículo | 10.000 km | 1.000 km | Pneus → Alinhamento e balanceamento |
| Balanceamento | hodômetro do veículo | 10.000 km | 1.000 km | Pneus → Alinhamento e balanceamento |

**A base é do plano, e não do tipo.** Lubrificação nasce em dias porque é assim que a operação faz
hoje — de 10 em 10 — mas o gestor troca para quilometragem na própria tela (`Intervalos → lembrar
por`), e o contrário também vale: qualquer serviço pode passar a lembrar por calendário. A única
restrição é física: **horímetro só existe no aparelho de frio**, então essa base não aparece para
serviço de veículo. Trocar a base não reescreve o passado — a execução já registrada guarda o
intervalo e a base da época.

O **plano do modelo ganha do plano geral** do tipo: é o que separa o CARRIER de 1.000 h do THERMO
KING de 2.000 h sem precisar de duas listas. Alinhamento e balanceamento vinham juntos numa aba só;
aqui têm vencimento próprio, porque um pneu pode ser balanceado sem que o veículo precise alinhar.

**Como o vencimento por dias conta** (mesmo desenho do gatilho `DIAS` do plano preventivo, 7.5):
próxima = dia da última execução + intervalo; o que falta é dia inteiro, porque meio dia de atraso
não é atraso para quem agenda engraxamento. **Plano por dias não exige leitura de painel** — quem
engraxa anota o dia, não o hodômetro —, mas a leitura corrente do ativo entra no registro quando
existe, e é isso que permite voltar o plano para quilometragem sem perder o histórico. Veículo que
nunca foi lubrificado aparece como `sem registro`, e não como "em dia": dizer que está em dia o que
nunca foi feito é o erro que a planilha permitia.

**O que o sistema faz e a planilha não fazia**
- **A posição é calculada na abertura da tela**, a partir do hodômetro do cadastro do veículo (7.1)
  e do horímetro do equipamento de frio. Nada envelhece por falta de alguém arrastar fórmula.
- **A leitura da troca vale como leitura do ativo** e só avança — mesma regra da portaria e do
  registro de leitura (7.1). Leitura menor que a da última execução do mesmo tipo é **recusada**: não daria
  para calcular vencimento nenhum a partir dela.
- **Histórico não se sobrescreve.** A linha da planilha era substituída a cada troca; aqui cada
  execução é um registro com litros, custo, oficina e OS vinculada, e a posição atual é a última.
- **Intervalo aplicado fica congelado na execução.** Mudar o plano hoje não reescreve o que já foi
  feito, nem faz o histórico mudar de sentido.
- **Ativo sem nenhum registro e com mais de um ciclo rodado aparece como `sem registro`**, e não
  como "vencido há 421.553 km". Verdade aritmética que ninguém pode acionar é ruído: o que falta ali
  é histórico, e a tela precisa dizer isso. Já o caminhão novo que ainda não trocou vence no primeiro
  intervalo, contado do zero — era o que a planilha mostrava na linha sem data.

**A régua de severidade e a fila da oficina** (ADR 0023). Saber "faltam 555 km" só resolve metade do
problema: a outra metade é decidir **quem entra no box primeiro**, e para isso os itens precisam ser
comparáveis entre si. Faltar 555 km de motor e faltar 47 h de Thermo King não se comparam em número
absoluto — em **fração do ciclo consumida**, sim.

| Condição | Status | Peso |
|---|---|---|
| não falta mais nada | **Vencido** | 4 |
| 90% ou mais do ciclo gasto | **Crítico** | 3 |
| 75% ou mais do ciclo gasto | **Atenção** | 2 |
| demais | **Em dia** | 1 |
| sem leitura, sem execução ou medidor invertido | **Sem registro** | 0 |

`avisarCom` e a régua percentual **não competem**: aquele é a antecedência que o gestor cadastrou
para o aviso operacional; esta é a escala comparável que ordena a fila.

**O que vencer primeiro manda — inclusive o calendário.** Cada tipo tem um prazo máximo entre
execuções, ainda que o medidor não ande: motor, alinhamento e balanceamento **180 dias**; Thermo King
**365**; diferencial e caixa de marcha **730**. Caminhão três meses parado em Açailândia não teve o
óleo preservado — ele oxidou. Passado o limite o item vence por tempo, com motivo escrito
(`"212 dias desde a última (limite 180)"`); a 90% do limite, vira crítico. **O calendário só agrava,
nunca abranda**: item vencido por quilometragem não volta a crítico porque a troca foi recente.
Lubrificação fica de fora dessa régua — a base dela **já é** o calendário, e somar um segundo prazo
contaria o mesmo tempo duas vezes.

**O pátio: a frota inteira na ordem em que entra no box.** As abas por tipo respondem "como está o
óleo de motor da frota"; o pátio responde a pergunta que o encarregado faz de manhã: **"quem entra
hoje, e o que aproveito na mesma parada"**. Uma linha por veículo, os itens do plano lado a lado com
a barra enchendo conforme o ciclo é gasto, e a ordem dada pelo score
`(vencidos × 100) + (críticos × 10) + peso(pior)`. Caminhão com três itens vencidos sobe na fila
porque **uma viagem ao box resolve os três** — não perder a viagem é o ganho operacional inteiro.

O item de frio sai do **aparelho instalado no caminhão**, com o horímetro dele; veículo sem aparelho
simplesmente não tem essa coluna, em vez de mostrar um item vazio que ninguém sabe ler. Cada barra
leva o rótulo textual junto da cor, e a linha abre mostrando data da última execução, próximo
vencimento, o motivo (quando o vencimento veio do calendário) e o alerta (quando o medidor não
fecha) — a oficina é usada sob luz de galpão, e há quem não distinga verde de laranja.

O `limiteDias` de cada plano é **coluna do cadastro**, não constante de código: a unidade que rodar
com outro prazo ajusta na tela de intervalos, e o padrão da seção vale enquanto ninguém mexer.

**Todo medidor deixa rastro** (ADR 0023, decisão 6). Antes, cinco lugares mexiam no hodômetro do
jeito deles — portaria, execução de serviço, oficina e abastecimento — e nenhum guardava
de onde o número veio. Painel alimentado por número sem procedência é opinião com aparência de dado.
Agora todos passam por um caminho só, que grava a leitura (`leituras`) com **origem** (portaria ·
oficina · abastecimento · portaria · digitação · automação · importação) e **suspeita**
(`REGRESSAO` quando o medidor voltou, `SALTO` quando pulou demais). A leitura entra sempre; o
cadastro do ativo **só avança**. Confirmar uma leitura suspeita é ato humano, registrado com autor e
data — e só a confirmação aceita um medidor que voltou.

**"Vence em X dias" — a coluna que monta a semana.** Com histórico de leitura dá para apurar o
**km/dia** de cada veículo (média móvel de 30 dias) e converter o que falta em dias de operação.
"Faltam 1.200 km" obriga o encarregado a fazer conta de cabeça sobre quanto aquele caminhão roda;
"vence em 6 dias" já decide. Três cuidados na média:

- **Leitura manual pesa menos** que a da automação (peso 0,4 contra 1) — é a que costuma trazer
  dígito trocado —, mas entra: descartá-la perderia o dado de quem abastece fora da automação.
- **Trecho impossível é descartado**, como o negativo. Caminhão de distribuição não faz 240.000
  km/dia; acima de **1.500 km/dia** o que existe ali são duas leituras de procedências diferentes
  sobre a mesma placa, e não rodagem.
- **Sem base, a tela diz "sem base"**, e não um número. Menos de duas leituras na janela não
  autoriza previsão nenhuma; veículo há mais de 10 dias sem leitura aparece avisado, porque ou está
  parado ou parou de dar sinal.

A previsão vale só para o que se mede em quilometragem: horímetro de aparelho de frio tem ritmo
próprio (hora de compressor, não de estrada), e plano por dias já é calendário.

**Medidor que anda para trás é falta de base, nunca vencimento.** A frota tem caso real de aparelho
de frio trocado: última troca registrada em 18.195 h, aparelho novo marcando 21 h. Tratar isso como
atraso jogaria o item em vencido por defeito de leitura. O sistema devolve `sem registro` **com
alerta textual** e para: não corrige o número sozinho, porque reset de placa, troca de aparelho e
dígito errado são três histórias diferentes e só quem está no pátio sabe qual. Mesma proteção para o
hodômetro.

**Ordem da fila**: `(vencidos × 100) + (críticos × 10) + peso(pior status)`. Não é ranking estético —
um caminhão com três itens vencidos sobe porque **a mesma parada resolve os três**, e o ganho
operacional do painel é não perder a viagem ao box. `Sem registro` não pontua: falta de leitura não é
falta de manutenção, e deixar ausência de dado empurrar caminhão para a oficina enche o box de
serviço que talvez nem esteja vencido.

**Status nunca só por cor.** Toda faixa vai com rótulo textual ao lado (`Vencido`, `Crítico`,
`Atenção`, `Em dia`, `Sem registro`). A tela é usada sob luz de galpão, por gente que nem sempre
distingue verde de laranja.

**Diferença para `planos_manutencao` (7.5)**: aquele é o plano **de um veículo** (descrição livre,
gatilho próprio, gera OS). Este é a regra **do tipo de serviço**, que vale para todo ativo da frota
que se encaixa nela. Um não substitui o outro.

**Permissões**: `preventiva:consultar` · `preventiva:registrar` · `preventiva:parametrizar`.

**Carga inicial**: `db:importar-periodicos` lê as cinco abas da planilha e importa apenas ativo,
medição e data da última execução — as colunas derivadas ficam de fora porque o sistema as refaz.

### 7.11 Controle de baterias

A bateria não avisa que vai morrer — ela morre no pátio às 4h da manhã, com a carga em cima. O
módulo existe para que o ponto de troca seja decidido antes disso, e não depois.

**Bateria é ativo próprio**, como o pneu e o aparelho de frio: ela troca de caminhão, volta para o
estoque, vai para garantia, e o histórico de medição precisa sobreviver a tudo isso. Cadastro:
identificação escrita na carcaça (chave por unidade), marca, modelo, amperagem, tensão nominal,
data da compra, custo, **garantia em meses** e **vida útil em meses** (padrão 18, editável por
bateria). Status: em estoque · em uso · em análise de garantia · sucata.

**O ponto de troca é o encontro de três leituras** — vale a pior delas:

| Leitura | Em dia | Atenção | Trocar |
|---|---|---|---|
| **Tensão em repouso** | ≥ 12,5 V | 12,0 a 12,5 V | < 12,0 V |
| **Tempo de uso** | dentro da vida útil | faltam ≤ 2 meses | passou da vida útil |
| **Garantia** | — | — | informa se ainda está vigente |

As faixas são parametrizáveis porque banco de 24 V é outro número. Bateria com tensão crítica troca
hoje, mesmo nova; bateria velha entra na fila mesmo medindo bem — o que se compra é a viagem que ela
não interrompe, e não o volt que ela ainda entrega hoje. E **trocar no dia 361 de uma garantia de 12
meses é jogar dinheiro fora**: quando a bateria chega ao ponto de troca com garantia viva, o painel
diz isso antes de alguém comprar outra.

**Duas regras que o papel não tinha**
- **Medição feita logo após rodar entra marcada e não decide nada.** Com o alternador tendo acabado
  de carregar, qualquer bateria mede bem — a leitura fica no histórico, mas o ponto de troca usa a
  última medição **em repouso**. É a diferença entre medir a bateria e medir o alternador.
- **Bateria nunca medida aparece como `sem medição`, e não como "em dia"**, à frente das que estão
  em dia na ordenação do painel. O que não se mede é o que costuma parar o caminhão.

Bateria em estoque não conta vida útil: o relógio começa na instalação. A retirada exige **motivo e
destino** (estoque · garantia · sucata) — nada se apaga, e o destino conta o que aconteceu com ela.

**Permissão**: `bateria:gerenciar`.

### 7.8 Relatórios do módulo
Custo total por veículo (combustível + peças + manutenção + pneus + multas + depreciação) ·
Custo por km rodado · Ranking de consumo por veículo e por motorista · Evolução mensal do CPK ·
Disponibilidade da frota (% de dias operacionais) · Tempo médio de reparo (MTTR) e entre falhas (MTBF) ·
Vida útil média de pneus por marca · Multas por motorista e por tipo.

---

## 8. M3 · Módulo Almoxarifado de Transporte

### 8.1 Estrutura
- **Almoxarifados** e **endereçamento** (rua/prateleira/nível/posição), com etiqueta QR.
- **Itens** herdados do catálogo de Compras — item é único no sistema, sem duplicidade.
- Saldos por almoxarifado, com **custo médio ponderado móvel** recalculado a cada entrada.

### 8.2 Movimentações
| Tipo | Origem | Regra |
|---|---|---|
| Entrada por compra | Recebimento aprovado (M1) | Automática, vinculada ao pedido |
| Entrada por devolução | Requisição não utilizada | Exige motivo e conferência |
| Saída por requisição | OS de manutenção / veículo | **Obrigatório vincular veículo + OS** |
| Transferência | Entre almoxarifados | Dupla confirmação (envio e recebimento) |
| Ajuste de inventário | Contagem cíclica | Exige aprovação do gestor + motivo |
| Descarte | Item avariado/vencido | Exige foto e aprovação |

Nenhuma movimentação pode ser excluída — apenas **estornada com motivo**, gerando lançamento contrário e mantendo os dois registros.

### 8.3 Estoque mínimo e painel de alertas
Parâmetros por item **e por almoxarifado**: `estoque_minimo`, `estoque_maximo`, `ponto_de_pedido`,
`lote_economico`, `lead_time_dias`, `consumo_medio_mensal` (calculado dos últimos 3/6/12 meses).

Sugestão automática de ponto de pedido: `PP = (consumo_medio_diario × lead_time_dias) + estoque_seguranca`.
O sistema **sugere**; o gestor **confirma** — nunca sobrescreve parâmetro definido manualmente.

**Painel de Alertas** (tela dedicada + widget no dashboard), semáforo:
- 🔴 **Ruptura** — saldo zero em item crítico
- 🔴 **Abaixo do mínimo** — saldo < estoque_minimo
- 🟡 **No ponto de pedido** — saldo ≤ ponto_de_pedido
- 🟡 **Cobertura baixa** — dias de cobertura < lead time (`cobertura = saldo ÷ consumo_medio_diario`)
- 🔵 **Excesso** — saldo > estoque_maximo (capital parado)
- ⚫ **Sem giro** — sem movimentação há mais de 180 dias (obsolescência)

Cada linha do painel traz botão **"Gerar solicitação de compra"**, que abre a solicitação já preenchida
(item, quantidade sugerida = lote econômico, origem = "Reposição de estoque mínimo", criticidade P4).
Job diário às 06:00 dispara notificação consolidada ao comprador e ao almoxarife.

### 8.4 Inventário cíclico
Contagem por curva ABC (A: mensal · B: trimestral · C: semestral), contagem cega (o contador não vê o saldo),
registro de divergência com foto, cálculo de **acuracidade de estoque** (`itens corretos ÷ itens contados`)
e impacto financeiro da divergência. Meta padrão: ≥ 95%.

### 8.5 Relatórios
Posição de estoque valorizada · Curva ABC (quantidade e valor) · Giro e cobertura por item ·
Consumo por veículo/centro de custo · Itens sem giro · Acuracidade por período e por almoxarifado ·
Ruptura (nº de vezes e duração) · Divergências de inventário.

---

## 9. M4 · Módulo Gestão de Colaboradores do Setor

Objetivo: mensurar desempenho mensal com critérios objetivos, documentados e auditáveis — nunca por percepção.

### 9.1 Modelo de pontuação
Cada colaborador inicia o mês com **100 pontos base**. Ocorrências somam ou subtraem.

**Critérios (parametrizáveis em tela — peso e descrição editáveis pela gestão):**

| Tipo | Critério | Peso padrão |
|---|---|---|
| ➕ | Zero ocorrência de anomalia de abastecimento no mês | +8 |
| ➕ | Zero multa no mês | +8 |
| ➕ | Sugestão de melhoria implantada | +10 |
| ➕ | Identificação preventiva de falha (evitou parada) | +12 |
| ➕ | Cumprimento de SLA acima da meta (compradores) | +10 |
| ➕ | Substituição/cobertura de colega | +5 |
| ➖ | Anomalia de abastecimento não justificada | −8 |
| ➖ | Multa por infração | −10 (grave −15, gravíssima −20) |
| ➖ | Avaria por má operação | −15 |
| ➖ | Requisição de peça sem vínculo a veículo/OS | −5 |
| ➖ | Atraso na entrada fiscal (>48h) | −8 |
| ➖ | Descumprimento do POP (compra fora do sistema) | −20 |

### 9.2 Regras de justiça e governança
- Toda ocorrência exige **evidência** (registro do sistema, foto ou documento) e **descrição factual**.
- Ocorrência lançada **notifica o colaborador**, que tem **5 dias úteis para contestar** com texto e anexo.
- Contestação vai ao gestor imediato; decisão registrada com justificativa. Ocorrência revertida permanece no histórico marcada como *revertida* (nunca apagada).
- Ocorrência gerada automaticamente pelo sistema nasce com status `SUGERIDA` e **só vale após validação humana** — o prazo de defesa começa a correr na validação, não na sugestão.
- **Contestação aberta não suspende os pontos**, e sim o fechamento da competência: zerar o número na abertura da defesa transformaria contestar em rota de fuga do mês.
- Os pontos ficam **congelados no lançamento**. Editar o peso de um critério muda o futuro, nunca competência já lançada.
- **Quem lança não decide a própria contestação** (mesma lógica da SoD, seção 5.3). A tentativa é auditada como `SOD_VIOLATION`.
- A pontuação final tem **piso zero**: número negativo não descreve uma pessoa e não cabe numa conversa de feedback.
- Pontuação é insumo de gestão e desenvolvimento — a tela deve exibir esse aviso e **não** deve ser exposta como ranking público sem consentimento da gestão (configurável: ranking visível / apenas gestor / anonimizado).

### 9.3 Telas
- **Cadastro do colaborador**: matrícula, nome, CPF, cargo, setor, admissão, nascimento, telefone,
  e-mail, gestor e **foto**. Vive em `Cadastros → Colaboradores`, com tela própria — o formulário
  declarativo dos demais cadastros monta campos de texto, e foto é outro fluxo: captura, recorte
  quadrado e redimensionamento para 480 px **no próprio navegador** antes do upload. Retrato de
  cadastro não precisa de 4 MB, e o pátio nem sempre tem sinal bom. O bucket não é público: guarda-se
  a chave, e a tela recebe URL assinada de leitura. Desligar exige motivo e é recusado enquanto
  houver contestação aguardando decisão — nada se apaga, e a ficha continua consultável.
- **Painel de classificação** (tela principal de Pessoas): a colocação do mês, com **navegação mês a
  mês** (‹ anterior · seletor de competência · próximo ›, sem passar do mês corrente). Cada linha
  traz posição, **foto**, nome, cargo e setor, e os **dois lados da pontuação separados** — positivos
  em verde com 👍, negativos em vermelho com 👎 — além do total. Mostrar só o saldo esconde o
  colaborador que soma muito e perde muito, que é justamente quem o gestor precisa ver.
- **Ficha do colaborador**: retrato, extrato da competência (base, positivos, negativos, final),
  histórico de pontuação de 12 meses e a lista de ocorrências. No histórico, **cada fato aparece com
  o sinal antes do número**: polegar para cima em verde no aspecto positivo, polegar para baixo em
  vermelho no negativo. O gestor lê a coluna em diagonal e já sabe o que aconteceu no mês.
- **Lançamento de ocorrência**: seleção de critério, evidência, descrição, data.
- **Fechamento mensal**: job no 1º dia útil do mês consolida, congela o período e gera o extrato em PDF.
- **Extrato individual em PDF** com a marca — usado em feedback um a um.

**O que a visibilidade do ranking continua mandando** (9.2): com `APENAS_GESTOR`, a classificação não
aparece para quem não decide contestação; com `ANONIMIZADO`, os nomes viram "Colaborador 1, 2, 3…"
**e as fotos somem junto** — anonimizar mantendo o retrato seria teatro, porque a cara identifica
mais que o nome. O aviso de uso da pontuação acompanha o painel em qualquer configuração.


---

## 10. M5 · Relatórios estratégicos e BI

### 10.1 Painel Executivo (Diretoria)
Gasto total do mês vs. orçado · Savings acumulados no ano · Custo total da frota e custo por km ·
Valor imobilizado em estoque e % sem giro · Aderência ao SLA de compras · OTIF consolidado ·
Top 10 fornecedores por volume e por risco · Alertas críticos abertos.

### 10.2 Relatórios por domínio

**Compras (estratégicos)**
- *Spend analysis*: gasto por categoria, centro de custo, fornecedor e unidade, com comparativo mês a mês e YTD
- Concentração de fornecedores (índice de dependência) e risco de fonte única
- Savings por comprador, por categoria e por lote, com memória de cálculo
- Análise de preço histórico por item (variação, tendência, alerta de inflação acima do índice)
- *Maverick buying*: compras realizadas fora do processo padrão
- Aging da fila e produtividade por comprador (esforço × valor × complexidade)
- Scorecard de fornecedores com evolução trimestral

**Transporte**
- Custo total de propriedade (TCO) por veículo e por km
- Comparativo de consumo entre veículos da mesma família
- CPK e vida útil de pneus por marca/modelo (base para decisão de compra)
- Disponibilidade da frota, MTTR, MTBF
- Custo de manutenção corretiva vs. preventiva (indicador de maturidade)

**Almoxarifado**
- Posição valorizada, curva ABC, giro, cobertura
- Ruptura e impacto operacional (paradas causadas por falta de peça)
- Acuracidade de inventário por período

**Pessoas**
- Evolução da pontuação por colaborador e média do setor
- Correlação entre pontuação e indicadores operacionais do setor

### 10.3 Implementação
- Views materializadas em Postgres com `REFRESH` agendado (BullMQ), nunca cálculo pesado em request.
  Implementadas: `mv_spend_mensal`, `mv_kpis_compras`, `mv_estoque_posicao`, `mv_otif_fornecedor` —
  todas com `unidade_id` e índice único (exigência do `REFRESH ... CONCURRENTLY`). Job de hora em hora,
  aos 10 minutos, mais atualização manual auditada. Detalhes em `docs/ADR/0013-bi-views-materializadas-f9.md`.
- **Sem base, o indicador é nulo — nunca zero.** Zero afirma "medi e deu zero"; nulo afirma "não há o
  que medir". A tela mostra "sem base".
- Todo KPI carrega a **própria fórmula e a própria meta** junto do número, e todo painel informa
  **de quando é o dado** que está exibindo.
- Toda tela de relatório: filtro de período, exportação **XLSX e PDF com a marca**, e **memória de cálculo visível** (o usuário precisa poder auditar o número).
- Gráficos seguem a regra da marca: série principal azul, destaque dourado, demais em cinza, **máximo 4 cores**;
  verde = dentro da meta, vermelho = fora, azul = neutro.

---

## 11. Modelo de dados (núcleo)

Convenções: `snake_case`, PK `id` (UUID v7), `created_at`/`updated_at`/`deleted_at` em todas as tabelas,
`created_by`/`updated_by`, soft delete universal, `NUMERIC(14,2)` para dinheiro (**nunca float**),
`NUMERIC(14,4)` para quantidade, timestamps em `timestamptz` (America/Fortaleza).

```sql
-- ============ M0 GOVERNANÇA ============
usuarios(id, nome, email UNIQUE, senha_hash, telefone, foto_url, ativo,
         unidade_id, centro_custo_id, mfa_secret, ultimo_login_em)
perfis(id, nome, descricao, sistema BOOLEAN)
permissoes(id, recurso, acao, descricao)            -- ex.: ('solicitacao','aprovar')
perfil_permissoes(perfil_id, permissao_id)
usuario_perfis(usuario_id, perfil_id, escopo JSONB) -- {unidades:[], centros_custo:[], carteira:'TECNICA'}
alcadas(id, nivel, valor_min, valor_max, perfil_aprovador_id, propostas_minimas, sla_horas, ativo)
parametros(id, chave UNIQUE, valor JSONB, descricao, editavel_por_perfil_id)
auditoria(id, timestamp, usuario_id, ip, user_agent, entidade, entidade_id, acao,
          valor_anterior JSONB, valor_novo JSONB, severidade, hash_anterior, hash)
notificacoes(id, usuario_id, canal, titulo, corpo, entidade, entidade_id, lida_em, enviada_em,
             tentativas, proxima_tentativa_em, ultimo_erro, descartada_em, referencia_externa)
mensagens_externas(id, canal, titulo, corpo, destinatario_nome, destinatario_telefone,
                   destinatario_email, entidade, entidade_id, anexo_id,
                   tentativas, enviada_em, proxima_tentativa_em, ultimo_erro,
                   descartada_em, referencia_externa, created_at, created_by)
                                             -- fila de saída para quem não tem login (14.7)
anexos(id, entidade, entidade_id, nome, mime, tamanho, url, hash_sha256, usuario_id)

-- ============ M1 COMPRAS ============
familias(id, nome, pai_id)
itens(id, codigo UNIQUE, descricao, especificacao, familia_id, unidade_medida,
      codigo_fabricante, curva_abc, critico BOOLEAN, preco_medio, status_homologacao)
fornecedores(id, razao_social, nome_fantasia, cnpj UNIQUE, ie, endereco JSONB, contatos JSONB,
             status, homologado_em, homologacao_valida_ate, score, condicao_padrao)
fornecedor_documentos(id, fornecedor_id, tipo, numero, vencimento, anexo_id)
centros_custo(id, codigo, nome, unidade_id, responsavel_id, orcamento_mensal)
solicitacoes(id, numero UNIQUE, solicitante_id, unidade_id, centro_custo_id, criticidade, origem_demanda,
             data_limite, status, lote_id, motivo_cancelamento, cancelada_por, cancelada_em)
solicitacao_itens(id, solicitacao_id, item_id, descricao_livre, quantidade, unidade_medida, observacao)
lotes(id, numero UNIQUE, comprador_id, unidade_id, status, valor_estimado, valor_fechado, criticidade,
      sla_vence_em, sla_suspenso_em, aprovador_id, aprovado_em, nivel_alcada, savings)
cotacoes(id, lote_id, fornecedor_id, enviada_em, respondida_em, recusada, motivo_recusa,
         condicao_pagamento, prazo_dias, desconto_avista, frete_tipo, frete_valor,
         prazo_entrega_dias, valor_total, valor_presente, token_publico)
cotacao_itens(id, cotacao_id, solicitacao_item_id, preco_unitario, quantidade, marca_ofertada)
mapas_cotacao(id, lote_id, cotacao_recomendada_id, gerado_em, pdf_anexo_id,
              divergente_menor_preco BOOLEAN, motivo_divergencia, justificativa)
aprovacoes(id, lote_id, aprovador_id, nivel, decisao, ressalva, motivo, decidido_em, ip, hash)
pedidos(id, numero UNIQUE, lote_id, fornecedor_id, valor_total, condicao_pagamento,
        data_prometida, data_reprogramada, motivo_reprogramacao, confirmado_fornecedor_em, status)
pedido_itens(id, pedido_id, item_id, quantidade, preco_unitario, quantidade_recebida)
recebimentos(id, pedido_id, almoxarife_id, nf_numero, nf_chave, nf_valor, recebido_em,
             status, three_way_ok BOOLEAN, observacao)
recebimento_itens(id, recebimento_id, pedido_item_id, quantidade_recebida, conforme,
                  tipo_divergencia, observacao, anexo_id)
titulos(id, recebimento_id, fornecedor_id, valor, vencimento, condicao, status, bloqueado, motivo_bloqueio)
avaliacoes_fornecedor(id, fornecedor_id, periodo, otif, indice_divergencia, aderencia_preco,
                      tempo_resposta_medio, score, calculado_em)

-- ============ M2 TRANSPORTE ============
veiculos(id, unidade_id, placa UNIQUE, frota_numero, renavam, chassi, tipo, marca, modelo, ano,
         config_eixos, capacidade_tanque, hodometro_atual, horimetro_atual,
         centro_custo_id, status, foto_url)
veiculo_documentos(id, veiculo_id, tipo, numero, emissao, vencimento, anexo_id)
posicoes_pneu(id, veiculo_id, codigo, eixo, lado, ordem)      -- mapa de rodagem
motoristas(id, unidade_id, usuario_id, nome, cpf, telefone, cnh_numero, cnh_categoria,
           cnh_vencimento, toxicologico_vencimento, aso_vencimento, veiculo_padrao_id,
           status, foto_url)                                   -- telefone = WhatsApp da ficha (14.7)
abastecimentos(id, veiculo_id, motorista_id, data_hora, posto, tipo_combustivel, litros,
               valor_unitario, valor_total, hodometro, horimetro, forma_pagamento,
               km_percorridos, consumo_kml, desvio_percentual, anomalia, anomalia_tipo,
               foto_painel_id, foto_cupom_id, chave_importacao,
               tanque_id, bico_id, produto_id, encerrante_inicial, encerrante_final,
               obra_local, rota, turno, os_id)

-- ---- F11 abastecimento interno (seção 7.9)
produtos_combustivel(id, codigo UNIQUE, nome, tipo, unidade_medida, densidade, ativo)
tanques(id, unidade_id, codigo UNIQUE, nome, tipo, produto_id, capacidade_litros,
        saldo_litros, custo_medio, veiculo_id, ativo, ultima_afericao_em)
bicos(id, tanque_id, codigo, descricao, encerrante_atual, ativo)
movimentacoes_tanque(id, tanque_id, tipo, litros, custo_unitario, custo_medio_apos, saldo_apos,
                     nota_fiscal, fornecedor_id, tanque_destino_id, abastecimento_id,
                     afericao_id, motivo, usuario_id, data)
afericoes_tanque(id, tanque_id, data, saldo_sistema, saldo_medido, diferenca, percentual,
                 dentro_da_tolerancia, motivo, anexo_id, aferido_por, aprovado_por, aprovado_em)
pneus(id, unidade_id, numero_fogo UNIQUE, serie, marca, modelo, medida, dot, tipo, recapagens,
      custo_aquisicao, custo_acumulado, km_acumulado, cpk, sulco_inicial_mm, sulco_atual_mm,
      vida_util_km, status, veiculo_id, posicao_id, hodometro_instalacao)
pneu_movimentacoes(id, pneu_id, tipo, veiculo_id, posicao_id, data, hodometro, km_rodados,
                   sulco_mm, custo, motivo, usuario_id)
pneu_inspecoes(id, pneu_id, data, sulco_mm, pressao_psi, avaria, anexo_id, inspetor_id)
baterias(id, unidade_id, identificacao, marca, modelo, numero_serie, amperagem, tensao_nominal,
         data_compra, custo, garantia_meses, vida_util_meses, status,
         veiculo_id, posicao, instalada_em, hodometro_instalacao, retirada_em, motivo_retirada)
         -- UNIQUE (unidade_id, identificacao) · CHECK: EM_USO exige veiculo e data
medicoes_bateria(id, bateria_id, medido_em, tensao_v, densidade, apos_rodar, hodometro, observacao)
                 -- append-only; apos_rodar nao decide ponto de troca
leituras(id, unidade_id, tipo, valor, medido_em, origem, veiculo_id, equipamento_frio_id,
         abastecimento_id, servico_periodico_id, acesso_portaria_id,
         suspeita, observacao, confirmada_por, confirmada_em, avancou_ativo)
         -- append-only; CHECK: veiculo_id XOR equipamento_frio_id
planos_servico_periodico(id, unidade_id, tipo, base, intervalo, avisar_com, limite_dias, modelo, ativo,
                         observacao)                          -- UNIQUE (unidade_id, tipo, modelo)
                         -- base: HODOMETRO | HORIMETRO | DIAS, escolhida pelo gestor
servicos_periodicos(id, unidade_id, tipo, base, veiculo_id, equipamento_frio_id, plano_id,
                    executado_em, medicao, intervalo, proxima,
                    item_id, quantidade, custo, oficina, ordem_servico_id, observacao)
                    -- CHECK: veiculo_id XOR equipamento_frio_id · append-only
planos_manutencao(id, veiculo_id, descricao, gatilho_tipo, gatilho_valor, antecedencia,
                  ultimo_valor, ultimo_em, proximo_valor, proximo_em, ativo)
ordens_servico(id, numero UNIQUE, unidade_id, veiculo_id, tipo, origem, origem_id, plano_id,
               descricao, oficina, terceiro, aberta_em, iniciada_em, fechada_em, hodometro,
               custo_pecas, custo_mao_obra, custo_total, tempo_parado_horas, status)
os_itens(id, os_id, descricao, item_id, quantidade, custo_unitario, custo, mao_de_obra, movimentacao_id)
multas(id, unidade_id, veiculo_id, motorista_id, ait UNIQUE, data_infracao, local, descricao,
       gravidade, valor, pontos, prazo_indicacao, prazo_recurso, status, anexo_id)

-- ============ M3 ALMOXARIFADO ============
almoxarifados(id, nome, unidade_id, responsavel_id)
enderecos(id, almoxarifado_id, rua, prateleira, nivel, posicao, codigo_qr)
saldos(id, almoxarifado_id, item_id, quantidade, custo_medio, endereco_id,
       estoque_minimo, estoque_maximo, ponto_pedido, lote_economico, lead_time_dias,
       consumo_medio_mensal, ultima_movimentacao_em)
movimentacoes(id, almoxarifado_id, item_id, tipo, quantidade, custo_unitario, saldo_apos,
              documento_tipo, documento_id, veiculo_id, os_id, motivo, usuario_id,
              estornada_por, estorno_de)
inventarios(id, almoxarifado_id, tipo, curva, iniciado_em, finalizado_em, status, acuracidade)
inventario_itens(id, inventario_id, item_id, saldo_sistema, saldo_contado, divergencia,
                 valor_divergencia, motivo, anexo_id, contador_id, aprovado_por)

-- ============ M4 PESSOAS ============
colaboradores(id, unidade_id, usuario_id, matricula, nome, cargo, setor, admissao, gestor_id, status,
              cpf UNIQUE, telefone, email, data_nascimento, foto_url,
              inativado_em, inativado_por, motivo_inativacao)
criterios_pontuacao(id, codigo UNIQUE, tipo, descricao, peso, automatico BOOLEAN, evento_gatilho, ativo)
ocorrencias(id, colaborador_id, criterio_id, competencia, pontos, descricao, evidencia_tipo,
            evidencia_id, anexo_id, status, lancado_por, lancado_em, contestar_ate,
            contestada_em, contestacao_texto, contestacao_anexo_id, decisao, decidido_por, decidido_em)
pontuacao_mensal(id, colaborador_id, competencia, pontos_base, pontos_positivos,
                 pontos_negativos, pontos_final, ocorrencias, fechado_em, fechado_por, pdf_anexo_id)

-- ============ M6 PORTARIA (seção 14) ============
pontos_acesso(id, unidade_id, codigo, nome, ativo)            -- UNIQUE (unidade_id, codigo)
rotas(id, unidade_id, codigo, nome, vendedores, dias_pre_venda,
      fechamento, largada, ativo, observacao,
      inativado_em, inativado_por, motivo_inativacao)          -- UNIQUE (unidade_id, codigo)
pessoas_externas(id, unidade_id, nome, documento UNIQUE, tipo, empresa, telefone, foto_url,
                 cnh_numero, cnh_vencimento, observacao,
                 bloqueado, motivo_bloqueio, bloqueado_em, bloqueado_por)
acessos_portaria(id, unidade_id, ponto_acesso_id, tipo, status,
                 pessoa_externa_id, motorista_id, veiculo_id, placa_externa, transportadora,
                 destino, responsavel_id, autorizado_por_id, motivo,
                 previsto_para, entrada_em, saida_em,
                 cracha, cracha_devolvido, rota_id, nota_fiscal, carga_descricao,
                 hodometro_saida, hodometro_retorno,
                 observacao_entrada, observacao_saida, motivo_encerramento,
                 registrado_entrada_por, registrado_saida_por)
acesso_transicoes(id, acesso_id, de, para, motivo, usuario_id, created_at)  -- append-only
ocorrencias_portaria(id, unidade_id, ponto_acesso_id, acesso_id, gravidade, descricao,
                     ocorrido_em, anexo_id, registrado_por)
```

**Constraints e triggers obrigatórios**
- `REVOKE DELETE` para o usuário da aplicação nas tabelas `auditoria`, `movimentacoes`, `aprovacoes`.
- Trigger de auditoria em todas as tabelas de negócio (`AFTER INSERT/UPDATE`).
- `CHECK` de máquina de estados nas transições de `lotes`, `pedidos`, `ordens_servico`.
- Índices: todos os FKs, `status + created_at` nas tabelas de fluxo, `GIN` em campos `JSONB` consultados,
  índice de texto (`pg_trgm`) em `itens.descricao` e `fornecedores.razao_social`.
- `saldos.quantidade >= 0` — saída que zeraria o saldo abaixo de zero é rejeitada.

---

## 12. Roadmap de implementação (fases para o Claude Code)

| Fase | Escopo | Entregável |
|---|---|---|
| **F0 — Fundação** | Monorepo, Docker, Prisma, auth, RBAC, SoD, auditoria, design system, layout base, seeds | Login funcional + shell da aplicação com a marca |
| **F1 — Compras núcleo** | Catálogo, fornecedores, solicitação, triagem, lote, cotação, mapa por valor presente, alçadas, aprovação eletrônica, pedido | Ciclo solicitação→pedido rodando |
| **F2 — Kanban + follow-up** | Painel Kanban, drag&drop com máquina de estados, SLA em horas úteis, jobs de alerta, notificações | Comprador operando pelo painel |
| **F3 — Recebimento e fiscal** | Three-way match, divergências com foto, entrada de NF-e, títulos, bloqueios | Ciclo P2P completo e fechado |
| **F4 — Almoxarifado** | Almoxarifados, saldos, movimentações, estoque mínimo, painel de alertas, integração com compras e OS | Estoque integrado |
| **F5 — Transporte base** | Veículos, motoristas, documentos com alerta, abastecimento com anomalias, painel CCO | Frota cadastrada e abastecimento controlado |
| **F7 — Pneus e manutenção** | Mapa de rodagem, ciclo de vida, CPK, inspeções, planos preventivos, OS com baixa de estoque, **escopo multiunidade transversal** | Custo de frota rastreável por unidade |
| **F8 — Pessoas** | Critérios, ocorrências, contestação, fechamento mensal, extrato PDF, multas (7.6) | Avaliação mensal operando |
| **F9 — BI** | Views materializadas, painel executivo, exportação XLSX com marca, memória de cálculo. *PDF pendente: depende do Puppeteer* | Relatórios estratégicos |
| **F11 — Abastecimento interno** | Tanques fixos e comboio, bicos com encerrante, entrada por nota, transferência, baixa automática no abastecimento, aferição com tolerância e médias por recorte | Cada litro com origem e destino |
| **F12 — Portaria e controle de acesso** | Pontos de acesso, cadastro de pessoas externas com lista restritiva, entrada e saída de visitantes, clientes, prestadores e motoristas de terceiros, trânsito dos caminhões da frota com hodômetro e rota, painel do pátio, ocorrências e indicadores (seção 14) | Quem está no site agora, e quem passou pelo portão |
| **F13 — Governança em tela** | Usuários com senha temporária e inativação, edição de perfis e permissões, matriz de alçadas validada como conjunto, parâmetros com tipo imutável, trilha de auditoria com verificação da cadeia de hash (seções 5.1 a 5.5) | Regras do sistema mudam sem deploy e com trilha |
| **F15 — Controle de baterias** | Bateria como ativo próprio, instalação e retirada com destino, medição de tensão em repouso e ponto de troca por tensão, tempo de uso e garantia (seção 7.11) | A bateria não deixa o caminhão no pátio |
| **F14 — Óleo, lubrificação e serviços periódicos** | Trocas de óleo (motor, Thermo King, diferencial, caixa de marcha), serviços de rodagem (alinhamento, balanceamento) e lubrificação do chassi, com plano por tipo, base editável (km · horas · dias), painel de vencimento calculado na hora e histórico por ativo (seção 7.10) | O que vence antes de quebrar |
| **F10 — Integrações** | Fila de saída com retentativa (e-mail e WhatsApp), chave de NF-e validada com DV mod-11, importação CSV de abastecimentos com conferência e idempotência. *Credenciais de SMTP, WhatsApp e SEFAZ ficam no `.env`; sem elas o canal se declara não configurado* | Fim da redigitação |

---

## 13. Regras para o Claude Code

**Sempre**
- Ler este arquivo antes de qualquer tarefa; se a tarefa exigir decisão nova, **propor a atualização deste arquivo primeiro**.
- Escrever testes junto com a regra de negócio. Cobertura obrigatória: máquina de estados, alçadas, SoD, cálculo de valor presente, SLA em horas úteis, CPK, consumo, pontuação.
- Toda rota: schema de entrada e saída validado, verificação de permissão, registro de auditoria.
- Toda listagem: paginação por cursor, filtros e ordenação no servidor.
- Toda transição de estado: passar pela máquina de estados, nunca `UPDATE status` direto.
- Mensagens de UI e do banco em **português do Brasil**; código, nomes de variáveis e commits em **inglês** (Conventional Commits).
- Valores monetários com `decimal.js` no backend; formatação `pt-BR` só na apresentação.

**Nunca**
- `DELETE` físico em tabela de negócio.
- Cor, fonte ou espaçamento fora dos tokens da seção 4.
- Regra de negócio no frontend sem contraparte no backend.
- Permitir aprovar, cotar ou receber violando a segregação de funções — nem para o perfil Administrador.
- Cálculo pesado de relatório em request síncrono.
- Segredo, chave ou credencial no repositório.

**Ao iniciar uma sessão**: verificar `docs/ADR/` para decisões já tomadas e `prisma/migrations/` para o estado real do banco antes de propor mudanças de schema.

---

## 14. M6 · Portaria e controle de acesso

Referência funcional: levantamento de mercado de portaria e controle de acesso corporativo
(fluxos de pessoas, veículos e prestadores; integração de guarita, cancela e CFTV; procedimentos
centralizados e registro de ocorrências). Nada de código, layout ou texto de terceiros foi copiado —
o que se espelhou foi o domínio, que é do setor.

O princípio do módulo: **a portaria é prova documental, não caderno de anotação**. Todo movimento
pelo portão vira registro com quem, quando, por onde e por quem foi liberado. Nada se apaga, e o
estado do acesso só muda pela máquina de estados.

### 14.1 Cadastros base

- **Pontos de acesso**: guarita ou cancela, por unidade (código, nome, ativo). O movimento sai por
  ponto — sem isso o relatório não sabe por onde a pessoa entrou.
- **Pessoas externas**: nome, **documento (chave única, normalizado)**, tipo (visitante · motorista
  externo · cliente · fornecedor · prestador), empresa, telefone, foto, CNH com vencimento para quem
  dirige, observação. O documento é a chave para a segunda visita reaproveitar a ficha em vez de
  partir o histórico em duas.
- **Lista restritiva**: bloqueio com motivo, autor e data. Bloqueio e desbloqueio são atos
  administrativos (`portaria:gerenciar`), nunca decisão de guarita.
- **Rotas**: código, nome, nº de vendedores, dias de pré-venda, dia de fechamento e dia de largada,
  por unidade (`UNIQUE (unidade_id, codigo)`). É o roteiro que o comercial opera, e é dele que a
  guarita escolhe na saída do caminhão (14.2). Vive em `Cadastros → Rotas`, com a mesma regra dos
  demais cadastros: editar e **inativar com motivo**, nunca excluir. Inativação é recusada enquanto
  houver caminhão em viagem na rota. A carga inicial vem da planilha comercial, reimportável
  (`db:importar-rotas`) — reimportar corrige pelo código e não duplica.

### 14.2 Ciclo do acesso

Três fluxos pelo mesmo portão, uma tabela:

| Tipo | Nasce em | Fecha em |
|---|---|---|
| **Pessoa a pé** | `NO_PATIO` (ou `AGENDADO`, se visita marcada) | `ENCERRADO` na saída |
| **Veículo de terceiro** | `NO_PATIO` | `ENCERRADO` na saída |
| **Caminhão da frota** | `EM_TRANSITO` — ele começa dentro, e o registro é a **saída para a rota** | `ENCERRADO` no retorno |

`entrada_em` e `saida_em` são literalmente os eventos do portão. Para o caminhão da casa a ordem se
inverte (primeiro sai, depois volta) — por isso ele fica `EM_TRANSITO`, e não `NO_PATIO`.

Transições: `AGENDADO → NO_PATIO | CANCELADO | RECUSADO` · `NO_PATIO → ENCERRADO` ·
`EM_TRANSITO → ENCERRADO`. **Registro fechado não reabre**: quem voltou de novo gera outro acesso.
Recusa e cancelamento exigem motivo; a recusa nasce como ocorrência.

Campos do caminhão da frota: motorista, hodômetro de saída e de retorno (que apura o **km da
viagem** e atualiza o hodômetro do veículo), **rota**, nota fiscal e descrição da carga. A leitura do
hodômetro é confrontada com o cadastro do veículo (7.1): menor que a registrada abre **ocorrência**
e o cadastro segue com o valor maior.

A rota vem do **cadastro de rotas** (`rotas`), importado da planilha comercial: na guarita ela é
escolhida, nunca digitada, para que o movimento do portão case com o roteiro que o comercial opera.
Rota que sai do roteiro é **inativada**, nunca apagada — ela responde por saídas já registradas, e
saída nova em rota inativa é recusada. O campo `lacre` foi substituído pela rota; a coluna
permanece apenas pelos registros anteriores à mudança.

### 14.3 Regras da guarita

O porteiro não decide sozinho quem entra, nem responde por isso depois. Quem barra é a regra:

| Impedimento | Liberável na guarita? |
|---|---|
| Pessoa na lista restritiva | **Não** — depende de desbloqueio registrado |
| Já existe acesso aberto sem saída | **Não** — dois registros abertos fazem o pátio mentir |
| Entrada sem motivo ou sem documento | **Não** |
| CNH vencida de quem vai dirigir | **Sim**, com autorização e justificativa registradas |

Na saída: **crachá entregue e não devolvido trava o fechamento** — ou se registra a devolução, ou
se libera abrindo ocorrência automática. Hodômetro de retorno menor que o de saída é recusado.

**Painel do pátio**: quem está dentro agora, quais caminhões estão na rua e as visitas agendadas.
É a tela que fica aberta na guarita o dia inteiro — em emergência, ela responde quantas pessoas há
no site e quem são. Permanência acima do limite (`portaria.limite_permanencia_horas`, padrão 12h)
vira alerta: quase sempre é saída que ninguém registrou.

### 14.4 Ocorrências

Registro de gravidade baixa, média ou alta: tentativa barrada, avaria, crachá não devolvido, recusa
de entrada. Gravidade **alta notifica na hora** quem responde por segurança. Duas ocorrências nascem
sozinhas do evento — crachá não devolvido e entrada recusada — porque evento de segurança não pode
depender de alguém lembrar de registrar.

### 14.5 Indicadores

Movimento por tipo e por tipo de pessoa · permanência média dos acessos encerrados · acessos ainda
abertos · entradas recusadas · ocorrências por gravidade. Toda saída traz a memória de cálculo.

**Relatório de movimento de veículos por período** (`GET /portaria/relatorio/movimentos`): uma linha
por movimento de veículo — frota e terceiro —, com **placa, rota e motorista**, as mesmas informações
do registro na guarita, para o relatório ser conferível contra o movimento. Traz ainda início, fim,
permanência, km da viagem, guarita e situação; e os totais de movimentos, permanência média, km
rodados e movimentos em aberto.

O período **recorta pelo registro na guarita**, e não pelo evento de fechamento: o porteiro registra
no instante em que o veículo cruza o portão, e quem pede "o movimento de agosto" quer o que passou no
portão em agosto — inclusive o caminhão que saiu no dia 31 e voltou em setembro, que aparece pela
saída com o retorno exibido. Pessoa a pé fica fora: tem o próprio histórico e polui o relatório de
frota.

Saída em **XLSX com a marca e a memória de cálculo** (seção 10.3), e impressão em PDF pela tela. A
exportação é **auditada** — arquivo de portaria responde por quem estava onde, então precisa constar
quem levou. A consulta é limitada a 5.000 linhas por recorte; passando disso a resposta diz que
truncou, em vez de entregar número pela metade como se fosse o total.

### 14.6 Perfil e segregação

**Porteiro** (`portaria:operar`, `portaria:consultar`) registra o movimento e abre ocorrência, mas
não cadastra ponto de acesso nem mexe na lista restritiva. **Gestor de Frota** e **Gerência**
recebem `portaria:consultar` e `portaria:gerenciar` — consultam o trânsito e administram o cadastro,
sem operar a guarita. A guarita consulta placas e motoristas por rota própria da portaria, para o
porteiro não precisar de `veiculo:gerenciar` só para achar uma placa.

### 14.7 Ficha de largada

A saída para a rota já era registro desde a F12, mas quem sai com o caminhão não leva o banco na
mão. O que o motorista levava era o que lembrava — rota, nota e hodômetro combinados de viva voz na
guarita. "Eu não sabia que era essa rota" e divergência de carga nascem exatamente aí.

**Registrada a largada, o sistema emite a ficha em PDF** e a arquiva como anexo do acesso. Ela traz
o mesmo que ficou gravado: rota com a cadência, placa e número de frota, motorista com CNH e
telefone, nota fiscal, descrição da carga, finalidade, a leitura do hodômetro e quem registrou — e
as ocorrências abertas naquela saída, hodômetro fora do cadastro à frente delas. Fecha com assinatura
do motorista e do porteiro, e com o quadro do retorno **em branco de propósito**: a conferência da
volta é feita contra o mesmo papel que saiu.

A ficha vai ao **WhatsApp do motorista, no número do cadastro** (`motoristas.telefone`), como
documento anexo — não como resumo em texto do que estava no PDF. O envio é ato de guarita
(`portaria:operar`); baixar é `portaria:consultar` e fica na trilha, porque documento que sai da casa
responde por quem o levou. O parâmetro `portaria.enviar_ficha_largada_whatsapp` (padrão **desligado**)
manda a ficha sozinha no ato do registro; desligado, ela sai pelo botão, com o motorista ainda no
balcão.

Três recusas antes de qualquer envio, porque mensagem para o número errado é pior que mensagem não
enviada: precisa ser caminhão da frota, precisa ter motorista identificado, e o telefone do cadastro
precisa formar número brasileiro válido. O formulário da guarita avisa **antes** de registrar quando
o motorista escolhido está sem número.

O destinatário não tem login, e por isso não cabe em `notificacoes`, que exige `usuario_id`. A fila
de saída dele é `mensagens_externas`, com a mesma política da F10 — tentativa, backoff exponencial,
descarte explícito e erro visível —, drenada pelo mesmo job. O destinatário fica **congelado na
linha**: a mensagem prova para onde foi no dia em que saiu, não para onde iria hoje. O anexo viaja
como link assinado de sete dias, gerado na hora do despacho; o bucket segue fechado.

**A emissão nunca derruba o registro.** O caminhão já cruzou o portão, e storage fora do ar não
apaga o evento: o que falhar volta como aviso na tela da guarita, com o botão de reemitir ao lado.
O painel do pátio reimprime e reenvia a ficha de qualquer caminhão na rua — ficha perdida no caminho
é caso comum, e a alternativa ao botão é o motorista voltar sem documento nenhum.
