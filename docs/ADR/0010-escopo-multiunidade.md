# ADR 0010 — Escopo de dados por unidade (multiunidade)

- **Status**: aceito
- **Data**: 03 de agosto de 2026
- **Contexto do documento mestre**: seção 5.1 (RBAC + ABAC), seção 5.6 (nova), seção 10.2 (relatórios por unidade)

## Contexto

A operação da Ceará Alimentos acontece em **mais de uma unidade**. Até a F6 o sistema tratava a
unidade como um dado de cadastro do usuário, sem consequência: qualquer pessoa com a permissão
`veiculo:gerenciar` via a frota inteira da rede, e os relatórios somavam tudo num número só.

Isso produz dois problemas concretos:

1. **Operacional** — o almoxarife de uma filial enxerga e movimenta o estoque de outra.
2. **Gerencial** — custo por km, CPK e consumo somados entre unidades escondem a unidade que está fora da meta.

## Decisão

**1. A unidade é declarada no login.** O usuário informa em qual unidade está operacionalizando.
Quando ele alcança mais de uma, o login responde `{ selecionarUnidade: true, unidades: [...] }`
sem abrir sessão, e a tela pede a escolha. Com uma unidade só, a escolha é automática.
A unidade em operação pode ser trocada sem novo login em `POST /auth/unidade-ativa`, com registro na trilha.

**2. A unidade viaja nas claims do access token** (`unidades`, `unidadeAtivaId`) e é **revalidada**
a cada renovação contra os perfis vigentes. O cookie `sgi_un` só carrega a preferência — nunca é
fonte de autorização.

**3. Quem vê a rede inteira é quem tem a permissão `unidade:todas`.** No seed, isso é o
**Comprador** (a compra é centralizada e atende todas as unidades) e o **Administrador**.
Os demais perfis ficam presos à unidade em operação.

> Diretoria, Auditor e Fiscal/Financeiro constam como "Global" na seção 5.2 do documento mestre.
> Como perfis são editáveis em tela, `unidade:todas` pode ser concedida a eles sem deploy.
> O seed não concede por padrão, seguindo a regra operacional definida para esta fase.

**4. `unidade_id` é coluna de primeira classe** em `veiculos`, `motoristas`, `pneus`,
`ordens_servico`, `solicitacoes` e `lotes` — além de `centros_custo` e `almoxarifados`, que já a tinham.
Em `solicitacoes` e `lotes` o campo é **denormalizado** do centro de custo: filtrar Kanban e
relatório por unidade sem `JOIN` é o caso de uso mais frequente do sistema.

**5. Um lote não mistura unidades.** Agrupar solicitações de unidades diferentes é recusado com 422.
Alçada, pedido e rateio de custo são por unidade.

**6. O filtro é aplicado no servidor, sempre**, por `core/rbac/escopo.ts`:
- `filtroUnidade(claims, unidadePedida?)` → fragmento `where` de toda listagem;
- `filtroUnidadeEm(claims, relacao)` → para tabelas que herdam a unidade (abastecimento, checklist);
- `unidadeDeEscrita(claims, informada?)` → destino de todo registro novo, com 403 em unidade fora do alcance;
- `unidadesConsultadas(claims, pedida?)` → vai no cabeçalho do relatório, junto da memória de cálculo.

**7. Acesso a registro de outra unidade responde 404, não 403.** Quem não alcança o registro não
precisa saber que ele existe.

## Consequências

- Toda rota nova de listagem precisa do fragmento de `filtroUnidade`; toda rota de escrita, de `unidadeDeEscrita`.
  A revisão de código passa a checar isso como checa permissão e auditoria.
- A migração retrocarrega `unidade_id` a partir do vínculo existente (centro de custo, veículo padrão,
  solicitações do lote) e só então aplica `NOT NULL`. O resto cai na unidade mais antiga cadastrada.
- Trocar a unidade em operação recarrega a aplicação: manter listagens em cache da unidade anterior
  seria pior que o custo do reload.
- O job diário de documentos e o de estoque continuam varrendo a rede inteira — são jobs de sistema,
  não sessão de usuário. A notificação é enviada por permissão, como antes.

## Alternativas descartadas

- **Um banco por unidade**: inviabilizaria o painel consolidado do comprador e da diretoria, que é
  requisito da seção 10.1.
- **Filtro só no frontend**: viola a regra "regra de negócio no frontend sem contraparte no backend" (seção 13).
- **Row Level Security no Postgres**: seria mais forte, mas exigiria conexão por usuário e conflitaria
  com o pool do Prisma. Fica registrado como evolução possível caso o número de unidades cresça.
