# ADR 0017 — F12: portaria e controle de acesso

- **Status**: aceito
- **Data**: 05 de agosto de 2026
- **Contexto do documento mestre**: seção 14 (nova), seção 5.1 (permissões), seção 5.6 (multiunidade),
  seção 7.1 (veículos e motoristas)

## Contexto

Pedido: controlar entrada e saída de motoristas externos, visitantes, clientes e o tráfego dos
caminhões da empresa, usando como inspiração o site de uma consultoria de segurança corporativa
(triellobr.com.br).

**O site é uma landing page de captação de leads, não um produto com telas.** Não há interface a
espelhar, e não se copiaria de qualquer forma. O que ele descreve, e que serviu de referência de
domínio: fluxos de pessoas, veículos e prestadores; integração entre guarita, cancela, catraca e
CFTV; procedimentos centralizados em vez de descentralizados; e o diagnóstico de que "controle de
pessoas, veículos e prestadores depende excessivamente de procedimentos manuais". É esse último
ponto que o módulo ataca.

O sistema já tinha o veículo, o motorista e o checklist de saída, mas não sabia **quem estava dentro
do site agora**. Em emergência, essa pergunta não tem resposta em caderno de guarita.

## Decisões

### 1. Um registro por movimento, com três fluxos no mesmo portão

`acessos_portaria` cobre pessoa a pé, veículo de terceiro e caminhão da frota. `entrada_em` e
`saida_em` são literalmente os eventos do portão — e, para o caminhão da casa, que **começa dentro**,
a ordem se inverte: primeiro a saída para a rota, depois o retorno. Por isso ele fica `EM_TRANSITO`
e não `NO_PATIO`, e por isso a tela do histórico rotula as colunas como "início" e "fim", com a
legenda explicando qual evento é qual em cada caso.

A alternativa — duas tabelas, uma para visita e outra para viagem — foi descartada: o portão é o
mesmo, a guarita é a mesma, e o painel do pátio precisaria unir as duas em toda leitura.

Registro fechado **não reabre**. Quem voltou de novo gera outro acesso, com outro horário. Reabrir
apagaria a permanência já apurada.

### 2. A regra barra, não o porteiro

`regras.ts` é módulo puro e decide o que impede a entrada. A distinção que importa é entre
impedimento **liberável** e **não liberável**:

- lista restritiva e acesso duplicado em aberto **não são liberáveis na guarita** — o primeiro
  depende de desbloqueio registrado, o segundo faria o pátio mentir;
- CNH vencida de quem vai dirigir **é liberável**, mas só com autorização e justificativa gravadas.

Isso existe para o porteiro não ter que decidir sozinho quem entra, nem responder por isso depois.
Pela mesma razão, `portaria:operar` e `portaria:gerenciar` são permissões distintas: quem registra o
movimento não administra a lista restritiva.

### 3. Crachá não devolvido trava a saída

Ou se registra a devolução, ou se libera abrindo **ocorrência automática**. Crachá que some vira
observação esquecida em qualquer sistema que o trate como campo opcional. Entrada recusada nasce
como ocorrência pelo mesmo motivo — evento de segurança não pode depender de alguém lembrar de
registrar.

### 4. Permanência longa é alerta, não erro

Acesso aberto além de `portaria.limite_permanencia_horas` (padrão 12h, parametrizável) aparece
destacado no pátio. Quase sempre não é alguém que passou a noite: é saída que ninguém registrou — e
um pátio com registros fantasma deixa de valer para o que ele existe.

### 5. A guarita consulta a frota por rota própria

`GET /portaria/frota` devolve placa, número de frota e nome do motorista, e nada mais. Existe para o
porteiro não precisar de `veiculo:gerenciar` só para achar uma placa. Isso motivou também um
`exigirQualquerPermissao` no plugin de RBAC — leitura compartilhada por papéis diferentes, com a
negativa auditada igual.

## Consequências

- O sistema responde "quem está no site agora" e "quais caminhões estão na rua", em tempo real.
- O hodômetro do retorno atualiza o veículo: a portaria vira mais uma fonte de leitura confiável
  para consumo e CPK, sem digitação extra.
- Perfil novo **Porteiro** no seed, e `portaria:consultar`/`portaria:gerenciar` somados a Gestor de
  Frota e Gerência.
- Nenhuma exclusão física: bloqueio, recusa e cancelamento são estados com motivo e trilha
  (`acesso_transicoes` é append-only).
- **Fora de escopo por ora**: integração com catraca, cancela e CFTV; leitura de QR code do crachá;
  agendamento de visita pelo próprio anfitrião. O campo `previsto_para` e o estado `AGENDADO` já
  suportam o terceiro item quando a tela existir.
