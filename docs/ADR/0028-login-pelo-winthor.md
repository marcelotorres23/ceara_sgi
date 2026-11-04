# ADR 0028 — login com usuário e senha do WinThor

- **Status**: aceito
- **Data**: 31 de outubro de 2026
- **Contexto do documento mestre**: seção 5.1 (usuários, senhas e sessões), seção 5.4 (auditoria)

## Contexto

Pedido: **o login do SGI deve usar o mesmo usuário e senha do WinThor, como o BI de comissão já faz.**
O funcionário já tem credencial no ERP; uma segunda senha só para o SGI vira senha anotada em papel.

## Decisão

- A tela de login aceita **nome de guerra do WinThor** ou **e-mail**. Com `@` é conta local
  (senha do SGI, como antes); sem `@` a senha é conferida no Oracle do WinThor.
- A conferência é a mesma do BI de comissão: `PCEMPR` ativa, sem demissão, e
  `RTRIM(decrypt(senhabd, NVL(usuariobd, nome_guerra))) = :senha` **no WHERE** — a senha clara
  nunca volta em coluna nem passa por log (`core/auth/winthor.ts`).
- **Basta ser válido no WinThor para entrar.** No primeiro acesso a conta do SGI nasce sozinha,
  vinculada pela coluna `usuarios.login_winthor` (nome de guerra, maiúsculas, único), com o perfil
  de menor alcance (**Solicitante**), a unidade quando só existe uma, e o e-mail da `PCEMPR` quando
  houver (senão `winthor.<matricula>@sem-email.invalid`). A criação é auditada com `origem: WINTHOR`.
- **O alcance continua sendo decidido no SGI.** Perfis, unidades e SoD vêm do cadastro; mais
  acesso é o administrador quem dá, em Governança › Usuários, com trilha. Inativar a conta no SGI
  bloqueia o acesso mesmo com a senha do WinThor certa.
- **Uma credencial por pessoa.** Conta vinculada ao WinThor não entra com a senha local, e a
  marca `deveTrocarSenha` não se aplica a ela: a senha é trocada no WinThor.
- Auditoria: `LOGIN` e `LOGIN_FALHA` passam a registrar `origem` (`WINTHOR` ou `LOCAL`).
- Oracle fora do ar ou sem configuração (`ORACLE_*` vazias): o login pelo WinThor falha fechado;
  o administrador continua entrando pelo e-mail.

## Consequências

- O e-mail continua obrigatório no cadastro; conta criada sem e-mail no WinThor fica com um endereço
  que nunca entrega até o administrador corrigir.
- Todo empregado ativo do WinThor alcança o SGI como Solicitante. Se isso for largo demais, o
  caminho é trocar o perfil padrão (`PERFIL_PADRAO_WINTHOR`) ou voltar a exigir vínculo prévio.
- Demissão ou inativação no WinThor corta o acesso no próximo login; sessões já abertas seguem
  até o refresh token vencer (7 dias) ou o usuário ser inativado no SGI.
- O SGI passa a depender do Oracle do WinThor para o login do dia a dia.
