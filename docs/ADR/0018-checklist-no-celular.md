# ADR 0018 — Checklist no celular: shell responsivo e app instalável

- **Status**: aceito
- **Data**: 05 de agosto de 2026
- **Contexto do documento mestre**: seção 7.3 (checklist), seção 3 (PWA offline), seção 5.1 (permissões)

## Contexto

Pedido: o módulo de checklist tem que funcionar no celular.

A tela do checklist já era desenhada para o pátio — controles de 48px, câmera traseira,
rascunho em IndexedDB, fila de sincronização, assinatura em canvas — e o PWA já estava
configurado desde a F0. **O que faltava não era a tela: era chegar até ela.**

Duas falhas concretas, verificadas em viewport de 375px:

1. A barra lateral do shell é `hidden md:flex`. Abaixo de 768px **não havia navegação
   nenhuma** — nem menu, nem botão de sair. O motorista só chegaria ao checklist digitando
   a URL.
2. O seletor de motorista da tela vinha **vazio para o próprio motorista**: ele carregava
   de `GET /transporte/motoristas`, que exige `motorista:gerenciar`. O perfil Motorista tem
   apenas `checklist:executar` e `abastecimento:registrar` — ou seja, o fluxo estava
   quebrado para exatamente quem deveria usá-lo.

## Decisões

### 1. Gaveta em vez de barra lateral, abaixo de `md`

Mesmo menu, mesma marca, mesma filtragem por permissão — só a forma muda. Fecha ao navegar
(senão cobre a tela que o usuário acabou de abrir), ao tocar no fundo e com `Esc`.

Descartei a barra de abas inferior: o menu varia por perfil (o motorista vê 3 itens, o
administrador vê 15) e uma barra fixa ou ficaria vazia ou estouraria. A gaveta acomoda os
dois extremos sem decisão arbitrária sobre quais 4 itens "cabem".

### 2. Rota de leitura no próprio módulo, em vez de ampliar o perfil

`GET /checklists/motoristas` devolve id, nome e placa padrão, sob `checklist:executar`. A
alternativa — dar `motorista:gerenciar` ao Motorista — daria a ele o cadastro inteiro,
incluindo edição. É o mesmo padrão já adotado em `GET /portaria/frota` ([ADR 0017](0017-portaria-controle-de-acesso-f12.md)):
quem precisa consultar para operar não deve herdar a permissão de administrar.

### 3. Alvo de toque mínimo de 44px

Os controles do checklist já estavam em 48px, mas o sino de notificações tinha 34px. No
pátio se opera de luva, com o celular numa mão — alvo pequeno vira toque errado, e toque
errado no checklist vira resposta errada num item crítico.

### 4. Área segura e instalação

`viewport-fit=cover` mais `env(safe-area-inset-bottom)` na barra "Finalizar e enviar": sem
isso, no iPhone o botão fica sob a barra de gestos. No manifesto, ícone **maskable** com
zona segura (sem ele o Android recorta o símbolo no ícone redondo), `orientation: portrait`
e atalho direto para `/checklist` — o motorista instala e o checklist fica a um toque.

## Consequências

- O motorista chega ao checklist pelo celular, e consegue abri-lo — os dois estavam quebrados.
- O desktop não muda: acima de `md` a barra lateral continua igual, e o botão de menu some.
- Ícones PNG (192 e 180) foram gerados a partir do SVG da marca; o maskable é SVG com a
  logo em 70% da área, o que Chrome e Android aceitam.
- **Não coberto**: leitura do QR Code da cabine pela câmera (a tela pede a placa digitada,
  e o texto de ajuda já promete o QR); notificação push; e teste em aparelho físico — a
  verificação foi feita em viewport emulado de 375x812.
