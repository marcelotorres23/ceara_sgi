# ADR 0019 — Leitura do QR Code da cabine no checklist

- **Status**: aceito
- **Data**: 09 de agosto de 2026
- **Contexto do documento mestre**: seção 7.3 (checklist), seção 3 (PWA offline)

## Contexto

A seção 7.3 promete desde o início que o checklist "abre pelo QR Code colado no veículo", e
o texto de ajuda da tela dizia isso ao motorista — mas só havia o campo de digitação. Placa
digitada em teclado de celular, com luva, às 5h da manhã, é a origem mais barata de
checklist lançado no caminhão errado.

## Decisões

### 1. Duas estratégias de decodificação, na ordem do que o aparelho oferece

`BarcodeDetector` quando existe (Android/Chrome, decodifica no próprio hardware) e **jsQR**
quando não (iOS/Safari, que não implementa a API). Sem o fallback, metade da frota ficaria
sem leitor — e é justamente a metade que não dá para prever no cadastro.

### 2. jsQR empacotado, e por import dinâmico

Empacotado porque **o pátio não tem sinal**: CDN não serve a um app que precisa ler offline.
Por import dinâmico porque só o motorista escaneia — não faz sentido todo usuário do
sistema baixar 130 kB de decodificador. O chunk entra no precache do service worker, então
a partir da primeira carga ele funciona sem rede.

### 3. O parser aceita quatro formatos de adesivo

Placa crua (`ABC1D23`, `ABC-1234`), com prefixo (`VEICULO:ABC1D23`), URL
(`.../checklist?placa=ABC1D23`) e JSON de etiquetadora (`{"placa":"ABC1D23"}`). Parte da
frota já tem adesivo impresso e reimprimir tudo custa mais que aceitar os quatro. O módulo
é puro, sem câmera e sem DOM, com 33 testes.

QR que não contém placa — crachá de visitante, etiqueta de estoque — é **recusado com a
razão dita**, não ignorado em silêncio.

### 4. Divergência avisa, não sobrescreve

Se a placa já estava digitada e o adesivo lido é outro, a tela mostra as duas e pede
conferência, mantendo a leitura. Sobrescrever calado transformaria um erro de cabine em
registro errado sem ninguém perceber; bloquear seria pior, porque às vezes quem errou foi a
digitação.

### 5. A leitura preenche o motorista quando dá

Se a placa lida é o veículo padrão de um motorista e o campo ainda está vazio, ele é
selecionado. É o dado que o sistema já tem — pedir de novo é fazer o motorista trabalhar
para o cadastro.

## Consequências

- O checklist passa a cumprir o que a tela já prometia.
- **Não coberto**: a geração do adesivo. O sistema lê o QR, mas não imprime o que vai colado
  na cabine — hoje o adesivo vem de fora. Gerar a etiqueta no cadastro de veículos exige um
  encoder de QR e é trabalho próprio.
- **Não verificado em aparelho**: o painel de navegação desta sessão bloqueia a câmera, então
  foi verificado o parser (33 testes), o empacotamento (chunk separado e precacheado) e o
  caminho degradado — permissão negada mostra a mensagem e devolve para a digitação. A
  decodificação com câmera real precisa de um celular.
