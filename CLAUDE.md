# Instruções do repositório

O documento mestre deste produto é **[`eloforte.md`](eloforte.md)** — leia-o inteiro antes de
escrever código. Ele é a fonte única de verdade para arquitetura, nomenclatura, cores, regras de
negócio e schema. Se uma tarefa exigir decisão nova, **proponha a atualização do documento primeiro**.

Antes de propor mudanças de schema, verifique:
- `docs/ADR/` — decisões técnicas já tomadas e suas consequências.
- `apps/api/prisma/migrations/` — estado real do banco.

Resumo operacional das regras (o detalhe está na seção 13 do documento mestre):

**Sempre**
- Teste junto com a regra de negócio: máquina de estados, alçadas, SoD, valor presente, SLA em horas úteis, CPK, consumo, pontuação.
- Toda rota: schema de entrada/saída validado, verificação de permissão, registro de auditoria.
- Toda listagem: paginação por cursor, filtros e ordenação no servidor.
- Toda transição de estado passa pela máquina de estados — nunca `UPDATE status` direto.
- UI e mensagens de banco em pt-BR; código, variáveis e commits em inglês (Conventional Commits).
- Dinheiro com `decimal.js` no backend; formatação `pt-BR` só na apresentação.

**Nunca**
- `DELETE` físico em tabela de negócio.
- Cor, fonte ou espaçamento fora dos tokens da seção 4.
- Regra de negócio no frontend sem contraparte no backend.
- Violar segregação de funções — nem para o perfil Administrador.
- Cálculo pesado de relatório em request síncrono.
- Segredo, chave ou credencial no repositório.
