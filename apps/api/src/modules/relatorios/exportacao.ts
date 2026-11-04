import ExcelJS from 'exceljs';

/**
 * Exportacao XLSX com a marca (secao 10.3).
 *
 * Toda planilha sai com tres blocos: cabecalho identificado (quem gerou, quando,
 * qual recorte), os dados, e a **memoria de calculo**. Numero exportado que nao
 * carrega a memoria vira numero orfao na caixa de entrada de alguem.
 */

/** Paleta da secao 4.1, em ARGB para o ExcelJS. */
const AZUL = 'FF16469D';
const OURO = 'FFF3AE00';
const NEVOA = 'FFF2F4F8';
const BORDA = 'FFE3E7EE';
const TEXTO2 = 'FF5A5A5A';

export interface Coluna {
  cabecalho: string;
  chave: string;
  largura?: number;
  /** formato numerico do Excel; dinheiro usa o padrao pt-BR */
  formato?: 'dinheiro' | 'decimal' | 'percentual' | 'inteiro' | 'texto';
}

export interface PlanilhaParaExportar {
  titulo: string;
  subtitulo?: string;
  /** o que estava filtrado: unidade, competencia, periodo */
  recorte: Record<string, string>;
  colunas: Coluna[];
  /** interfaces nomeadas nao casam com Record<string, unknown>; a leitura por chave e feita com cast unico em `gerarXlsx` */
  linhas: readonly object[];
  memoriaDeCalculo: Record<string, string>;
  geradoPor: string;
}

const FORMATOS: Record<NonNullable<Coluna['formato']>, string> = {
  dinheiro: 'R$ #,##0.00',
  decimal: '#,##0.000',
  percentual: '0.0%',
  inteiro: '#,##0',
  texto: '@',
};

export async function gerarXlsx(planilha: PlanilhaParaExportar): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SGI Ceara';
  wb.created = new Date();

  const ws = wb.addWorksheet(planilha.titulo.slice(0, 30), {
    views: [{ state: 'frozen', ySplit: 6 }],
  });

  const colunas = planilha.colunas.length;

  // ---------------------------------------------------------------- cabecalho da marca
  ws.mergeCells(1, 1, 1, colunas);
  const titulo = ws.getCell(1, 1);
  titulo.value = `CEARA ALIMENTOS · ${planilha.titulo}`;
  titulo.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  titulo.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 26;

  // filete dourado sob o titulo, como na tela (secao 4.3)
  ws.mergeCells(2, 1, 2, colunas);
  ws.getRow(2).height = 4;
  ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OURO } };

  ws.mergeCells(3, 1, 3, colunas);
  const sub = ws.getCell(3, 1);
  sub.value = planilha.subtitulo ?? 'Sistema de Gestao Integrada';
  sub.font = { name: 'Calibri', size: 10, italic: true, color: { argb: TEXTO2 } };

  ws.mergeCells(4, 1, 4, colunas);
  const recorte = ws.getCell(4, 1);
  recorte.value = [
    ...Object.entries(planilha.recorte).map(([k, v]) => `${k}: ${v}`),
    `gerado por: ${planilha.geradoPor}`,
    `em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}`,
  ].join(' · ');
  recorte.font = { name: 'Calibri', size: 9, color: { argb: TEXTO2 } };

  ws.addRow([]);

  // ---------------------------------------------------------------- dados
  const linhaCabecalho = ws.addRow(planilha.colunas.map((c) => c.cabecalho));
  linhaCabecalho.eachCell((celula) => {
    celula.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    celula.alignment = { vertical: 'middle', wrapText: true };
  });
  linhaCabecalho.height = 20;

  planilha.colunas.forEach((coluna, i) => {
    ws.getColumn(i + 1).width = coluna.largura ?? Math.max(coluna.cabecalho.length + 4, 14);
  });

  planilha.linhas.forEach((registro, indice) => {
    const dados = registro as Record<string, unknown>;
    const linha = ws.addRow(
      planilha.colunas.map((c) => {
        const valor = dados[c.chave];
        if (valor === null || valor === undefined) return null;
        // decimal chega como string do banco; sem Number() o Excel trata como texto
        if (c.formato && c.formato !== 'texto') {
          const numero = Number(valor);
          return Number.isNaN(numero) ? valor : numero;
        }
        return valor as ExcelJS.CellValue;
      }),
    );

    linha.eachCell((celula, coluna) => {
      const formato = planilha.colunas[coluna - 1]?.formato;
      if (formato && formato !== 'texto') celula.numFmt = FORMATOS[formato];
      celula.font = { name: 'Calibri', size: 11 };
      celula.border = { bottom: { style: 'thin', color: { argb: BORDA } } };
      // zebra em nevoa, como na tabela da tela (secao 4.4)
      if (indice % 2 === 1) celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEVOA } };
    });
  });

  if (planilha.linhas.length === 0) {
    ws.addRow(['Nenhum registro para o recorte informado.']);
  }

  ws.autoFilter = {
    from: { row: 6, column: 1 },
    to: { row: 6, column: colunas },
  };

  // ---------------------------------------------------------------- memoria de calculo
  const memoria = wb.addWorksheet('Memoria de calculo');
  memoria.columns = [
    { header: 'Indicador', key: 'indicador', width: 28 },
    { header: 'Como o numero e apurado', key: 'formula', width: 110 },
  ];
  memoria.getRow(1).eachCell((celula) => {
    celula.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  });

  for (const [indicador, formula] of Object.entries(planilha.memoriaDeCalculo)) {
    const linha = memoria.addRow({ indicador, formula });
    linha.getCell('formula').alignment = { wrapText: true, vertical: 'top' };
  }

  memoria.addRow({});
  memoria.addRow({
    indicador: 'Fonte',
    formula:
      'SGI Ceara - views materializadas atualizadas por job. O numero exportado reflete a ultima ' +
      'atualizacao, informada no painel de origem.',
  });

  const arquivo = await wb.xlsx.writeBuffer();
  return Buffer.from(arquivo);
}

/** Nome de arquivo previsivel, sem acento nem espaco. */
export const nomeDoArquivo = (relatorio: string, recorte: string): string =>
  `sgi-${relatorio}-${recorte}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-');
