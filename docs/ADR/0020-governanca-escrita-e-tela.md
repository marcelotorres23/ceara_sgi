# ADR 0020 — Governança: escrita das regras e tela de administração

- **Status**: aceito
- **Data**: 09 de agosto de 2026
- **Contexto do documento mestre**: seções 5.1 a 5.5 (RBAC, perfis, SoD, auditoria, parâmetros), seção 6.4 (alçadas)

## Contexto

A governança era o último módulo sem tela — `/governanca` mostrava um placeholder. E a API,
apesar de responder desde a F0, **só lia**: havia `usuario:editar`, `perfil:editar`,
`alcada:editar` e `parametro:editar` no catálogo de permissões, sem nenhuma rota que as
exercesse.

Isso deixava duas promessas do documento mestre por cumprir: perfis "editáveis em tela,
nada hardcoded" (5.1) e parâmetros em "tela de configuração, sem deploy" (5.5). Na prática,
mudar uma alçada exigia SQL no banco — sem validação, sem auditoria, sem quem.

## Decisões

### 1. A matriz de alçadas é salva inteira, nunca faixa a faixa

`PUT /alcadas` substitui o conjunto. Editar uma faixa isolada abre vão ou sobreposição no
meio do caminho, e o defeito só aparece no dia em que alguém submete um lote de R$ 5.000,01
e recebe `RangeError: Nenhuma faixa de alcada cobre o valor` — um erro que não é dele.

A validação é módulo puro (`validarMatrizDeAlcadas`, 14 testes): primeira faixa começa em 0,
última sem teto, e entre uma e outra o piso é exatamente o teto anterior mais um centavo. A
mensagem diz qual intervalo ficaria órfão, não apenas que "há um vão".

**Consequência aceita**: substituir a matriz apaga as linhas anteriores de `alcadas`. É uma
tabela de parametrização, não um livro de registro, e `nivel` é `UNIQUE` — manter as antigas
exigiria versionamento de schema. O estado anterior fica **inteiro na auditoria**, no
`valor_anterior` do `SALVAR_MATRIZ`.

### 2. A vedação do Administrador vira regra de servidor, não convenção de seed

Antes, `PERMISSOES_VEDADAS_AO_ADMIN` existia só no seed: bastava a tela de perfis para o
administrador conceder `lote:aprovar` a si mesmo. Agora a lista mora em
`governanca/regras.ts`, e tanto o seed quanto o `PATCH /perfis/:id` a consultam. Sem isso, a
regra de ouro "nem para o perfil Administrador" seria apenas um comentário.

### 3. Conflito de SoD bloqueia no cadastro, além de bloquear em runtime

A matriz de conflitos já barrava a **ação** (comprador não aprova o próprio lote). Agora
barra também o **acúmulo de perfis** ao criar ou editar usuário. Acúmulos que já existem no
banco não são apagados — aparecem sinalizados na lista, porque corrigi-los é decisão de quem
administra, não efeito colateral de uma migração.

### 4. Senha temporária gerada pelo servidor, exibida uma vez

Criar usuário não pede senha em tela: o servidor gera uma temporária e a devolve **uma única
vez**, para ser entregue à pessoa. Assim a senha definitiva nunca passa pelas mãos de quem
cadastra, e nada precisa ser digitado num campo de senha por um terceiro. O mesmo vale para
o reset, que ainda encerra as sessões abertas da pessoa.

### 5. Inativar, nunca excluir

Usuário responde por lotes aprovados, checklists assinados e acessos de portaria. Inativar
tira do login (e derruba as sessões) mantendo o histórico de pé — regra de ouro 2.

### 6. O tipo do parâmetro é imutável

A edição troca o valor, não a natureza: gravar texto onde o código espera número derrubaria
o cálculo adiante, sem aviso. `validarParametro` compara o tipo com o valor atual e recusa a
troca.

## Consequências

- Alçadas, perfis e parâmetros passam a ser configuráveis sem deploy e **com trilha**: toda
  escrita registra valor anterior e novo, com IP e hash encadeado.
- Não há mais nenhum módulo em placeholder — o componente `EmConstrucao` foi removido.
- O seed de demonstração ganhou `admin.demo@cearaalimentos.com.br` (perfil Administrador),
  para exercitar a governança sem usar a conta do seed de produção, que tem senha própria
  em `.env`.
- **Não coberto**: criação e remoção de perfis (só edição dos existentes), escopo ABAC por
  centro de custo na tela de usuários, e exportação da trilha de auditoria.
