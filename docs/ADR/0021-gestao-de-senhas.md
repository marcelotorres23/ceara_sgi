# ADR 0021 — Gestão de senhas pelo administrador

- **Status**: aceito
- **Data**: 09 de agosto de 2026
- **Contexto do documento mestre**: seção 5.1 (RBAC e credenciais), seção 5.4 (auditoria)

## Contexto

Pedido: o administrador precisa gerenciar a senha de todos os usuários.

O reset já existia (ADR 0020), mas com **dois furos**:

1. A tela dizia "a troca acontece no primeiro acesso" e **nada impunha isso**. Não havia
   campo, não havia bloqueio: a senha temporária virava a senha definitiva da pessoa, e o
   administrador continuava conhecendo a credencial de quem quisesse.
2. **Não havia troca de senha pelo próprio usuário** — nem rota, nem tela. A pessoa não
   tinha como deixar de usar a senha que outro alguém escolheu.

Ou seja: o sistema tinha reset, mas não tinha gestão de senha.

## Decisões

### 1. Duas formas de redefinir, o mesmo efeito

Gerada pelo sistema (padrão) ou **definida pelo administrador**. A segunda existe porque a
entrega costuma ser por telefone, e ditar `Ceara@YRCBWXXD87` letra a letra é pior que
combinar uma senha de passagem. A senha definida passa pela mesma política da senha
escolhida pelo dono — o administrador não pode gravar `123456` para ninguém.

### 2. Senha definida por terceiro nasce marcada para troca

`deve_trocar_senha` na tabela de usuários. Enquanto estiver marcado, a aplicação inteira é
substituída pela tela de troca: sem menu, sem navegação, sem rota alcançável. Só o dono
desmarca, trocando.

É o que separa "o administrador **redefine** a senha" de "o administrador **conhece** a
senha". Sem isso, quem administra teria acesso permanente à conta de qualquer pessoa — e a
trilha de auditoria registraria a ação do dono, não a de quem entrou por ele.

### 3. Todo reset derruba as sessões abertas

Redefinir sem encerrar sessão não tira o acesso de ninguém: quem já estava dentro continua.
Como o reset costuma vir de desligamento ou suspeita, encerrar é o comportamento esperado.

### 4. A troca pelo dono exige a senha atual — e também derruba tudo

Mesmo com sessão aberta, trocar exige a senha atual: sessão esquecida em máquina de
terceiro não pode virar troca de dono da conta. E a troca encerra **todas** as sessões,
inclusive a de quem trocou — se a troca veio de suspeita de acesso indevido, manter
qualquer sessão viva anularia o motivo. A tela avisa e pede novo login.

### 5. Política que barra o que quebra primeiro

10 caracteres, sem o próprio nome ou e-mail (o primeiro palpite de quem tenta entrar), sem
sequência conhecida — incluindo as em português, que listas em inglês ignoram: `senha`,
`mudar123`, `ceara` — e diferente da anterior. Módulo puro com 23 testes.

Não exige símbolo nem maiúscula obrigatórios: essa regra produz senha em papel colado no
monitor, não segurança.

### 6. A senha nunca entra na trilha

A auditoria registra o fato, o alvo, a origem (`GERADA_PELO_SISTEMA` ou
`DEFINIDA_PELO_ADMINISTRADOR`) e a consequência — nunca o valor. Tentativa de troca com
senha atual errada vira registro com severidade `ALERTA`.

## Consequências

- O administrador gerencia a senha de todos, sem passar a conhecer a senha de ninguém.
- Usuários existentes não foram marcados: a coluna nasce `false`, e a exigência só vale a
  partir do próximo reset ou cadastro. Marcar todo mundo travaria a operação inteira num
  dia comum.
- **Não coberto**: expiração periódica de senha, histórico de senhas anteriores (só a atual
  é comparada), MFA — o campo `mfa_secret` existe no schema desde a F0 e continua sem uso —
  e autoatendimento de "esqueci minha senha", que hoje depende de pedir ao administrador.
