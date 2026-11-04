# ADR 0001 — Fundação F0

- **Data:** 2026-08-02
- **Status:** Aceito
- **Contexto:** Início do SGI Ceará. Nenhum código existia; apenas o spec mestre.

## Decisões

### 1. Monorepo com npm workspaces
Não usamos Turborepo/Nx nesta fase. Dois apps (`api`, `web`) não justificam a camada extra.
Reavaliar quando surgir um pacote compartilhado de tipos entre API e Web (provável em F1).

### 2. `DELETE` bloqueado em três camadas
O spec proíbe DELETE físico (regra de ouro 2). Aplicado em profundidade:
1. Extensão do Prisma Client (`core/db.ts`) — aborta `delete`/`deleteMany` em qualquer modelo.
2. Trigger de banco em `auditoria` (`prisma/sql/001_auditoria_append_only.sql`).
3. `REVOKE UPDATE, DELETE` para o role da aplicação.

Uma camada só não basta: a extensão do Prisma não protege contra SQL puro, e o trigger
não protege contra um `prisma migrate` que o recrie.

### 3. Cadeia de hash da auditoria serializada por advisory lock
O encadeamento (`hash = sha256(conteúdo || hash_anterior)`) exige ler o último elo e gravar o
próximo sem intercalação. Sob concorrência, dois inserts leriam o mesmo `hash_anterior` e a
cadeia bifurcaria. Usamos `pg_advisory_xact_lock` dentro da transação.

**Custo aceito:** a escrita de auditoria é serializada globalmente. Se virar gargalo, a saída é
particionar a cadeia por entidade (uma cadeia por domínio), não remover o lock.

### 4. Lógica pura separada em arquivo próprio, não só em função própria
`avaliarSod()` (em `sod.ts`) não faz I/O; `garantirSod()` (em `sod.enforce.ts`) aplica, audita a
tentativa com severidade `SOD_VIOLATION` e lança. Mesma separação em `audit/hash.ts` (puro) e
`audit/index.ts` (com banco).

Separar apenas as *funções*, deixando-as no mesmo arquivo, não bastou: o teste importava o módulo
inteiro e arrastava `audit → db → env`, que exige `DATABASE_URL` e derruba a suíte sem banco.
Em ESM, o limite de dependência é o **arquivo**. Regra para as próximas fases: cálculo puro
(valor presente, SLA em horas úteis, CPK, pontuação) mora em arquivo sem import de `db` ou `env`.

### 5. Perfis no seed, permissões no código
O catálogo de permissões (`recurso:ação`) é código — é o universo do que o sistema sabe fazer.
O vínculo perfil→permissão é dado, editável em tela. O seed reescreve os vínculos dos perfis
de sistema a cada execução, para acompanhar o catálogo.

**Consequência:** customização feita em tela nos 11 perfis `sistema: true` é sobrescrita por um
novo seed. Perfis criados pela gestão não são tocados. Documentar isso na tela de perfis.

### 6. Administrador sem permissão de aprovar nem receber
`PERMISSOES_VEDADAS_AO_ADMIN` remove `lote:aprovar`, `recebimento:registrar` e
`nota_fiscal:lancar` do perfil Administrador (seção 5.2), mesmo ele tendo "tudo o mais".

**Ponto em aberto:** "tudo o mais" hoje são 42 das 45 permissões, o que inclui coisas como
`veiculo:gerenciar` e `pneu:gerenciar`. A seção 5.2 descreve o escopo do Administrador como
"usuários, perfis, parâmetros" — mais estreito do que isso. A restrição de SoD do spec é
explícita apenas sobre aprovar e receber, então mantivemos o conjunto amplo, mas vale decidir
em F1 se o Administrador deve ficar limitado ao domínio de governança.

### 7. Rotação de refresh token
Cada `/auth/refresh` revoga a sessão usada e emite outra. Reuso de um refresh já rotacionado
falha na conferência do `refreshHash`. Só o sha256 do token é persistido.

### 8. PWA configurado já em F0
O service worker entra agora, mesmo sem o checklist (F6), para que o comportamento offline
seja exercitado desde cedo em vez de ser encaixado no fim.

## Escopo do schema Prisma nesta fase
Só M0 (governança). Os módulos M1–M4 do modelo de dados (seção 11 do spec) entram nas
migrations das respectivas fases, para que `prisma/migrations/` reflita o estado real do banco.

### 9. Um único `.env` na raiz do monorepo
`core/env.ts` carrega `<raiz>/.env` com `dotenv` (silencioso quando o arquivo não existe, que é o
caso em produção, onde as variáveis vêm do ambiente). O CLI do Prisma não passa por esse código,
então os scripts `db:*` usam `dotenv-cli` apontando para o mesmo arquivo.

**Alternativa descartada:** um `.env` por app. Evita o `dotenv-cli`, mas duplica `DATABASE_URL`
entre `apps/api/.env` e a raiz que o Docker Compose lê — duas fontes de verdade para o mesmo segredo.

A localização do arquivo é feita por **busca ascendente**, não por contagem de níveis
(`../../../..`). O código roda de `src/core/` em dev e de `dist/` depois do `tsup`, e a
profundidade até a raiz muda — o caminho fixo funcionava em dev e quebrava o bundle.

## Pendências assumidas de F0
- Tela de Governança ainda é placeholder; os endpoints já existem e estão protegidos.
- BullMQ/Redis declarados na infra, sem worker ainda (primeiros jobs chegam em F2).
- Storage S3 previsto no `.env`, cliente ainda não implementado (necessário em F6).
