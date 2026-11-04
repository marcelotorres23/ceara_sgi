# ADR 0021 — Folha da OS para a bancada e fechamento com relato do mecânico

- **Status**: aceito
- **Data**: 10 de agosto de 2026
- **Contexto do documento mestre**: seção 7.5 (manutenção), seção 8.2 (custo por ativo)

## Contexto

A OS registrava o que foi **previsto** — peças requisitadas, mão de obra lançada — e fechava
sem nenhum relato de quem executou. O mecânico, que é quem menos olha para uma tela,
não tinha nada em papel para levar à bancada. E "concluída" era um estado único: uma OS
fechada com metade do serviço feito ficava indistinguível de uma resolvida.

## Decisões

### 1. Impressão pelo navegador, não PDF gerado no servidor

Resolve o mecânico agora, sem dependência nova. Uma folha de estilo `@media print` (A4
retrato, margem de 12mm) esconde a barra lateral, o topo e os botões, e imprime só a folha
em preto no branco.

A alternativa — PDF no servidor — continua válida e melhor a prazo: arquivo estável,
anexável, idêntico em qualquer máquina, e reaproveitável para o pedido de compra e o
checklist impresso que a seção 7.3 também promete. Fica para quando essas três telas
justificarem a dependência de uma vez.

**Não incluído**: QR Code na folha. Precisaria de um gerador, e sem ele o número da OS em
fonte grande resolve a identificação a olho.

### 2. A folha tem tanto espaço em branco quanto dado preenchido

Oito linhas pontilhadas para anotação, caixas de conclusão total/parcial, campos de
hodômetro e horário, e duas assinaturas — mecânico e quem liberou o veículo. Uma folha só
com dados impressos seria um relatório; o que a bancada precisa é de um formulário.

O rodapé diz o que precisa ser dito: *a via impressa não substitui o registro no sistema*.

### 3. Total e parcial são estados diferentes, com consequência diferente

`conclusaoTipo` (`TOTAL` | `PARCIAL`) entra na OS junto com `mecanico`, `anotacoesMecanico`
e `pendencia`. A validação é módulo puro com 14 testes:

- parcial **exige** descrever a pendência (menos de 5 caracteres não vale);
- total **com** pendência descrita é contradição, e é recusada;
- quem executou é obrigatório — texto livre, porque pode ser oficina de terceiro;
- OS **sem nenhum item lançado não conclui**: não alimentaria custo por veículo, e quase
  sempre significa que ninguém lançou o que foi feito.

### 4. A pendência vira OS, não um campo de texto

Na conclusão parcial, o servidor abre automaticamente uma OS de retorno com origem
`OS_PARCIAL`, descrição `"Pendencia da OS-xxxx: ..."` e vínculo nos dois sentidos
(`osRetornoId` / `osOrigem`). O administrador pode desmarcar, mas o padrão é abrir.

Pendência guardada só como texto é pendência que reaparece como quebra na estrada, com
alguém dizendo "mas a gente já sabia disso".

## Consequências

- O custo por veículo passa a distinguir serviço resolvido de serviço adiado.
- A auditoria registra `CONCLUIR:TOTAL` ou `CONCLUIR:PARCIAL`, com mecânico, pendência e o
  número da OS de retorno.
- A folha impressa depende do navegador do usuário para margens e cabeçalho — Chrome e Edge
  respeitam o `@page`; navegadores antigos podem imprimir cabeçalho e rodapé próprios.
- **Continua pendente** (registrado no código): o cancelamento de OS não estorna peças já
  baixadas do estoque.
