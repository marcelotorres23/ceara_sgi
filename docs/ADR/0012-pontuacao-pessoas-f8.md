# ADR 0012 — F8: pontuação de colaboradores e multas

- **Status**: aceito
- **Data**: 03 de agosto de 2026
- **Contexto do documento mestre**: seção 9 (M4 · Pessoas), seção 7.6 (multas), seção 5.3 (SoD)

## Contexto

A seção 9 existe para substituir avaliação por percepção por medição documentada. Isso só se sustenta
se o sistema tornar difícil pontuar mal: sem evidência, sem prazo de defesa, ou apagando o que
incomoda. As decisões abaixo protegem essa promessa.

## Decisões

### 1. Ocorrência exige evidência e descrição factual

Lançamento manual sem `evidenciaId` nem `anexoId` é recusado com 400. A descrição tem mínimo de
10 caracteres. Sem isso, a ocorrência é opinião com aparência de dado.

### 2. Os pontos são congelados no lançamento

`ocorrencias.pontos` guarda o valor **com sinal**, calculado do critério no momento do lançamento.
Editar o peso do critério depois muda o futuro, nunca o passado — caso contrário, um ajuste de peso
em dezembro reescreveria a competência de março, e o extrato deixaria de ser auditável.

O peso no cadastro é sempre positivo; o sinal vem do `tipo` (`POSITIVO`/`NEGATIVO`).

### 3. Ocorrência sugerida pelo sistema não pontua

Evento do sistema cria a ocorrência com status `SUGERIDA`, que **não entra na conta**. Só passa a
valer após validação humana com justificativa, e é nesse momento que o prazo de defesa começa a
correr. É a regra da seção 9.2 aplicada literalmente.

### 4. Contestação aberta **não** suspende os pontos

`CONTESTADA` continua contando. Zerar os pontos na abertura da defesa transformaria "contestar" em
estratégia para escapar do mês — bastaria contestar tudo perto do fechamento. O que a contestação
suspende é o **fechamento da competência**, não o número.

### 5. Reverter não apaga

`REVERTIDA` sai da conta de pontos e permanece no histórico, com a defesa e a justificativa da
decisão visíveis. Vale a regra de ouro 2 do sistema.

### 6. Quem lança não decide a própria contestação

Mesma lógica da segregação de funções da seção 5.3. A tentativa é registrada na auditoria com
severidade `SOD_VIOLATION`, como nas demais violações de SoD.

### 7. Só o próprio colaborador contesta, e dentro do prazo

O prazo é de **5 dias úteis** (parametrizável), calculado com o mesmo calendário do SLA de compras:
feriado do Maranhão não pode consumir prazo de defesa. Contestação por terceiro responde 403;
fora do prazo, 409 informando a data de vencimento.

### 8. A pontuação final tem piso zero

Pontuação negativa não existe como número. O extrato precisa ser legível numa conversa de feedback,
e "−35 pontos" não descreve uma pessoa.

### 9. O painel traz média **e** mediana

Com equipes pequenas, uma ocorrência grave desloca a média e some com o quadro real do time.
As duas aparecem juntas, com a distribuição por faixa.

### 10. Fechamento congela e bloqueia

O fechamento consolida a competência em `pontuacao_mensal`, e a partir daí:
- novo lançamento naquela competência é recusado com 409, orientando a lançar na competência aberta
  citando a data do fato;
- o extrato passa a devolver o número **congelado**, não o recalculado;
- competência em curso não pode ser fechada;
- **contestação ou sugestão pendente bloqueia o fechamento** — fechar por cima de uma defesa aberta
  tornaria o direito de contestar decorativo.

### 11. Multa indicada sugere a ocorrência, não a aplica

Indicar o condutor cria a ocorrência como `SUGERIDA`, com o AIT como evidência. A gravidade define o
peso (−10 padrão, −15 grave, −20 gravíssima), a partir do peso base do critério. A escala é da
tabela de critérios, não do valor pago: infração cara não é necessariamente a mais perigosa.

Motorista sem ficha de colaborador não gera ocorrência — a multa continua registrada do mesmo jeito.

## Fora do escopo desta fase

- **Extrato individual em PDF** (seção 9.3): a geração via Puppeteer entra com o pacote de relatórios
  da F9. O extrato já é calculado e devolvido pela API; falta a renderização com a marca.
- **Job do 1º dia útil do mês** (seção 9.3): o fechamento existe como rota, disparada pela gestão.
  Agendá-lo no BullMQ é a próxima etapa natural — foi deixado manual de propósito enquanto o
  bloqueio por contestação pendente ainda não tem tela de resolução em lote.
- **Critérios automáticos de fechamento** (`ZERO_MULTA`, `CHECKLIST_INTEGRAL`,
  `ZERO_ANOMALIA_ABASTECIMENTO`): os critérios estão semeados com o gatilho declarado, mas a varredura
  que os sugere ao fim do mês ainda não roda. Hoje só `MULTA_INFRACAO` sugere de fato, pela indicação
  de condutor.
