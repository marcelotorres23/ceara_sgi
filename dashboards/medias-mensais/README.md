# Dashboard — Médias Mensais da Frota

Consolida as abas mensais de `REL.  MEN. DAS MÉDIAS MENSAL.xlsx` (pasta `Ronald 2026`)
em uma base única e publica um dashboard estático.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `gerar.js` | Lê o xlsx e escreve `dados.json` + `base-consolidada.csv` |
| `site/dados.json` | Base consolidada que o dashboard consome (2.256 viagens, jul/2025 → ago/2026) |
| `site/base-consolidada.csv` | Mesma base em CSV `;` com decimal vírgula, para abrir no Excel |
| `site/` | **Pasta publicada na Netlify** — só o que o navegador precisa |
| `site/index.html` | Dashboard — busca `dados.json` no mesmo diretório |
| `dashboard-standalone.html` | Mesmo dashboard com os dados embutidos, arquivo único |
| `artifact.html` | Versão publicada como Artifact (gerada pelo `build.js`) |
| `site/logo-ceara.png` | Logomarca horizontal negativa, fundo transparente, extraída do GUIA-MARCA-001 |
| `build.js` | Regera o standalone e o artifact a partir do `index.html` |
| `site/netlify.toml` | Publica a pasta inteira, com `dados.json` sem cache |

## Atualizar os dados

```bash
node dashboards/medias-mensais/gerar.js "A:/Ronald 2026/REL.  MEN. DAS MÉDIAS MENSAL.xlsx"
```

Se `exceljs` não estiver resolvendo, aponte o caminho:

```bash
EXCELJS_PATH=C:/eloforte_app/node_modules/exceljs node dashboards/medias-mensais/gerar.js
```

Regerar o arquivo único e o artifact depois de atualizar a base:

```bash
node dashboards/medias-mensais/build.js
```

## Regras de consolidação

- Uma linha por viagem, vinda das abas mensais (`JULHO` … `AGOSTO2026`). As abas
  `Planilha2` e `Planilha3` são ignoradas — são extratos de abastecimento, não médias.
- Placa, motorista e rota são normalizados (maiúsculas, sem acento, espaço único), então
  `APICUM-AÇU`, `APICUM ACU` e `APICUM-ACU` viram a mesma rota.
- `km` usa a coluna `KM PERCORRIDO`; se estiver vazia, cai para `KM FINAL - KM INICIAL`.
- **A média nunca é média de médias**: em qualquer recorte é `km total ÷ litros totais`.
  O objetivo segue a mesma lógica ponderada (`km ÷ Σ(km/média ideal)`).
- Descartadas as linhas sem litros, sem km, ou com média fora da faixa 0,5–15 km/L
  (hodômetro trocado, abastecimento de equipamento de frio lançado como viagem).
  A contagem de descarte aparece no rodapé do dashboard.

## Publicar na Netlify

A pasta já está pronta para deploy. Pelo painel:

1. app.netlify.com → **Add new site** → **Deploy manually**
2. Arraste a pasta `dashboards/medias-mensais/site` (só ela — os scripts ficam de fora).

Ou pela CLI:

```bash
npx netlify-cli login
npx netlify-cli deploy --dir dashboards/medias-mensais/site --prod
```

Depois de cada atualização da planilha, rode `gerar.js` e refaça o deploy — o
`netlify.toml` já marca `dados.json` como `no-cache`, então a equipe vê o dado novo
sem limpar o navegador.

## Identidade visual

Cores e logomarca seguem o **GUIA-MARCA-001 — Manual de Identidade Visual Ceará Alimentos**:
Azul Ceará `#16469D` como base, Azul Institucional `#09409D` nos fundos, Amarelo-Ouro `#F3AE00`
somente como acento (filetes e linha de objetivo), Verde `#1E7A44` dentro da meta e Vermelho
`#C0392B` fora dela. Sobre o fundo escuro, verde e vermelho usam os tints `#35A55F` e `#E0614F`
para manter contraste legível — o par institucional permanece intacto.

A logomarca é a **versão horizontal negativa com detalhe amarelo**, que o manual indica para
fundos azuis e escuros. O fundo azul chapado do arquivo original foi tornado transparente para
não criar a moldura que o manual proíbe.
