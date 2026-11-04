import PDFDocument from 'pdfkit';
import { dinheiro, somar, type ValorMonetario } from '../../core/money.js';

/**
 * Pedido de compra em PDF (secoes 6.1.8 e 10.3).
 *
 * O pedido existe no banco desde sempre, mas o fornecedor nao tem acesso ao sistema: o que
 * chega nele e um anexo de e-mail. Sem um documento proprio, o comprador remontava o pedido
 * a mao no corpo da mensagem — e a divergencia entre o que foi combinado e o que o
 * recebimento espera nasce exatamente ai.
 *
 * O documento carrega **a prova da aprovacao**: quem aprovou, quando, em que faixa da
 * alcada e o hash da assinatura eletronica. E o que transforma a folha em comprovacao, e
 * nao em pedido de orcamento — quem recebe a mercadoria e o fiscal que lanca a nota
 * conferem contra o mesmo papel.
 *
 * Layout puro: recebe o pedido ja montado e devolve o PDF. Sem I/O e sem Prisma, para poder
 * ser testado sem banco.
 */

/** Paleta da secao 4.1. */
const AZUL = '#16469D';
const OURO = '#F3AE00';
const TEXTO = '#1A1A1A';
const TEXTO2 = '#5A5A5A';
const BORDA = '#E3E7EE';
const NEVOA = '#F2F4F8';

const MARGEM = 40;
const LARGURA_UTIL = 595.28 - MARGEM * 2; // A4 retrato

export interface ItemDoPedidoImpresso {
  codigo: string | null;
  descricao: string;
  quantidade: ValorMonetario;
  unidadeMedida: string;
  precoUnitario: ValorMonetario;
}

export interface AprovacaoImpressa {
  aprovador: string;
  decididoEm: Date;
  nivel: number;
  /** hash da assinatura eletronica (secao 6.1.7) */
  hash: string;
  ressalva: string | null;
  autoaprovacao: boolean;
}

export interface PedidoParaImprimir {
  numero: string;
  emitidoEm: Date;
  emitidoPor: string;
  loteNumero: string;
  unidade: { nome: string; cnpj: string | null; endereco: string | null };
  fornecedor: { razaoSocial: string; cnpj: string | null; email: string | null; telefone: string | null };
  condicaoPagamento: string | null;
  dataPrometida: Date;
  entrega: { local: string | null; centrosCusto: string[]; placas: string[] };
  itens: ItemDoPedidoImpresso[];
  freteValor: ValorMonetario | null;
  descontoAvista: ValorMonetario | null;
  valorTotal: ValorMonetario;
  /** null quando o lote chegou a "aprovado" sem decisao registrada — o PDF diz isso em vez de omitir */
  aprovacao: AprovacaoImpressa | null;
  observacoes: string | null;
}

const brl = (v: ValorMonetario): string =>
  `R$ ${dinheiro(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

const data = (d: Date): string => d.toLocaleDateString('pt-BR');
const dataHora = (d: Date): string => d.toLocaleString('pt-BR');

/** Quantidade sai sem zeros a direita: "10" e nao "10,0000". */
const quantidade = (v: ValorMonetario): string => {
  const s = dinheiro(v).toDecimalPlaces(4).toString();
  return s.replace('.', ',');
};

/**
 * Monta o PDF e resolve com o arquivo inteiro em memoria.
 *
 * Um pedido tem dezenas de itens, nao milhares: o buffer cabe de sobra e evita expor um
 * stream que o handler teria que fechar na mao.
 */
export function gerarPdfDoPedido(pedido: PedidoParaImprimir): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true });
  const pedacos: Buffer[] = [];
  doc.on('data', (p: Buffer) => pedacos.push(p));

  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  cabecalho(doc, pedido);
  partes(doc, pedido);
  condicoes(doc, pedido);
  tabelaDeItens(doc, pedido);
  totais(doc, pedido);
  provaDaAprovacao(doc, pedido);
  if (pedido.observacoes) observacoes(doc, pedido.observacoes);
  assinaturas(doc);
  rodape(doc, pedido);

  doc.end();
  return pronto;
}

function cabecalho(doc: PDFKit.PDFDocument, p: PedidoParaImprimir): void {
  doc.rect(0, 0, 595.28, 76).fill(AZUL);
  doc.rect(0, 76, 595.28, 3).fill(OURO);

  doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text(p.unidade.nome, MARGEM, 22, { width: 330 });
  doc.fontSize(8).font('Helvetica').fillColor('#D6DEEE');
  const identificacao = [p.unidade.cnpj ? `CNPJ ${p.unidade.cnpj}` : null, p.unidade.endereco]
    .filter(Boolean)
    .join(' · ');
  if (identificacao) doc.text(identificacao, MARGEM, 44, { width: 330 });

  doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica').text('PEDIDO DE COMPRA', 380, 20, { width: 175, align: 'right' });
  doc.fontSize(17).font('Helvetica-Bold').text(p.numero, 380, 32, { width: 175, align: 'right' });
  doc.fontSize(8).font('Helvetica').fillColor('#D6DEEE')
    .text(`Emitido em ${data(p.emitidoEm)} · Lote ${p.loteNumero}`, 380, 54, { width: 175, align: 'right' });

  doc.y = 96;
  doc.fillColor(TEXTO);
}

/** Fornecedor e destino, lado a lado: quem recebe o papel confere os dois de uma olhada. */
function partes(doc: PDFKit.PDFDocument, p: PedidoParaImprimir): void {
  const topo = doc.y;
  const largura = (LARGURA_UTIL - 12) / 2;

  caixa(doc, MARGEM, topo, largura, 'FORNECEDOR', [
    p.fornecedor.razaoSocial,
    p.fornecedor.cnpj ? `CNPJ ${p.fornecedor.cnpj}` : null,
    p.fornecedor.email,
    p.fornecedor.telefone,
  ]);

  caixa(doc, MARGEM + largura + 12, topo, largura, 'ENTREGA', [
    p.entrega.local ?? p.unidade.nome,
    p.entrega.centrosCusto.length > 0 ? `Centro de custo: ${p.entrega.centrosCusto.join(', ')}` : null,
    p.entrega.placas.length > 0 ? `Aplicacao: ${p.entrega.placas.join(', ')}` : null,
  ]);

  doc.y = topo + 78;
}

function caixa(doc: PDFKit.PDFDocument, x: number, y: number, largura: number, titulo: string, linhas: Array<string | null>): void {
  doc.roundedRect(x, y, largura, 70, 4).fillAndStroke(NEVOA, BORDA);
  doc.fillColor(TEXTO2).fontSize(7).font('Helvetica-Bold').text(titulo, x + 10, y + 9, { width: largura - 20 });

  let cursor = y + 22;
  const visiveis = linhas.filter((l): l is string => Boolean(l));
  visiveis.forEach((linha, i) => {
    doc.fillColor(i === 0 ? TEXTO : TEXTO2)
      .fontSize(i === 0 ? 10 : 8)
      .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
      .text(linha, x + 10, cursor, { width: largura - 20, ellipsis: true, height: i === 0 ? 24 : 11 });
    cursor += i === 0 ? 15 : 11;
  });
}

function condicoes(doc: PDFKit.PDFDocument, p: PedidoParaImprimir): void {
  const y = doc.y;
  const colunas: Array<[string, string]> = [
    ['CONDICAO DE PAGAMENTO', p.condicaoPagamento ?? 'a combinar'],
    ['ENTREGA PROMETIDA', data(p.dataPrometida)],
    ['COMPRADOR', p.emitidoPor],
  ];
  const largura = LARGURA_UTIL / colunas.length;

  colunas.forEach(([rotulo, valor], i) => {
    const x = MARGEM + largura * i;
    doc.fillColor(TEXTO2).fontSize(7).font('Helvetica-Bold').text(rotulo, x, y, { width: largura - 8 });
    doc.fillColor(TEXTO).fontSize(10).font('Helvetica').text(valor, x, y + 11, { width: largura - 8, ellipsis: true, height: 13 });
  });

  doc.y = y + 32;
  doc.moveTo(MARGEM, doc.y).lineTo(MARGEM + LARGURA_UTIL, doc.y).lineWidth(0.5).stroke(BORDA);
}

function tabelaDeItens(doc: PDFKit.PDFDocument, p: PedidoParaImprimir): void {
  // larguras somam LARGURA_UTIL; descricao absorve a sobra
  const col = { codigo: 62, descricao: 213, qtd: 52, un: 32, unitario: 78, total: 78 };
  const x = {
    codigo: MARGEM,
    descricao: MARGEM + col.codigo,
    qtd: MARGEM + col.codigo + col.descricao,
    un: MARGEM + col.codigo + col.descricao + col.qtd,
    unitario: MARGEM + col.codigo + col.descricao + col.qtd + col.un,
    total: MARGEM + col.codigo + col.descricao + col.qtd + col.un + col.unitario,
  };

  const cabecalhoDaTabela = (y: number): number => {
    doc.rect(MARGEM, y, LARGURA_UTIL, 18).fill(AZUL);
    doc.fillColor('#FFFFFF').fontSize(7.5).font('Helvetica-Bold');
    doc.text('CODIGO', x.codigo + 6, y + 6, { width: col.codigo - 8 });
    doc.text('DESCRICAO', x.descricao + 4, y + 6, { width: col.descricao - 8 });
    doc.text('QTD', x.qtd, y + 6, { width: col.qtd - 6, align: 'right' });
    doc.text('UN', x.un + 6, y + 6, { width: col.un - 8 });
    doc.text('UNITARIO', x.unitario, y + 6, { width: col.unitario - 6, align: 'right' });
    doc.text('TOTAL', x.total, y + 6, { width: col.total - 6, align: 'right' });
    return y + 18;
  };

  let y = cabecalhoDaTabela(doc.y + 6);

  p.itens.forEach((item, i) => {
    const altura = Math.max(16, doc.heightOfString(item.descricao, { width: col.descricao - 8 }) + 8);

    // item nao se parte entre paginas: linha cortada ao meio e leitura ambigua na conferencia
    if (y + altura > 720) {
      doc.addPage();
      y = cabecalhoDaTabela(MARGEM);
    }

    if (i % 2 === 1) doc.rect(MARGEM, y, LARGURA_UTIL, altura).fill(NEVOA);

    const total = dinheiro(item.quantidade).times(dinheiro(item.precoUnitario));
    doc.fillColor(TEXTO).fontSize(8).font('Helvetica');
    doc.text(item.codigo ?? '—', x.codigo + 6, y + 5, { width: col.codigo - 8, ellipsis: true, height: 10 });
    doc.text(item.descricao, x.descricao + 4, y + 5, { width: col.descricao - 8 });
    doc.text(quantidade(item.quantidade), x.qtd, y + 5, { width: col.qtd - 6, align: 'right' });
    doc.text(item.unidadeMedida, x.un + 6, y + 5, { width: col.un - 8 });
    doc.text(brl(item.precoUnitario), x.unitario, y + 5, { width: col.unitario - 6, align: 'right' });
    doc.font('Helvetica-Bold').text(brl(total), x.total, y + 5, { width: col.total - 6, align: 'right' });

    y += altura;
    doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA_UTIL, y).lineWidth(0.5).stroke(BORDA);
  });

  doc.y = y + 8;
}

function totais(doc: PDFKit.PDFDocument, p: PedidoParaImprimir): void {
  const subtotal = somar(p.itens.map((i) => dinheiro(i.quantidade).times(dinheiro(i.precoUnitario))));
  const linhas: Array<[string, string, boolean]> = [['Subtotal dos itens', brl(subtotal), false]];
  if (p.freteValor && dinheiro(p.freteValor).greaterThan(0)) linhas.push(['Frete', brl(p.freteValor), false]);
  if (p.descontoAvista && dinheiro(p.descontoAvista).greaterThan(0)) {
    linhas.push(['Desconto a vista', `- ${brl(p.descontoAvista)}`, false]);
  }
  linhas.push(['TOTAL DO PEDIDO', brl(p.valorTotal), true]);

  const largura = 220;
  const x = MARGEM + LARGURA_UTIL - largura;
  let y = doc.y;

  for (const [rotulo, valor, destaque] of linhas) {
    if (destaque) {
      doc.rect(x, y, largura, 22).fill(AZUL);
      doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold').text(rotulo, x + 10, y + 7, { width: 120 });
      doc.fontSize(11).text(valor, x + 10, y + 6, { width: largura - 20, align: 'right' });
      y += 22;
    } else {
      doc.fillColor(TEXTO2).fontSize(8.5).font('Helvetica').text(rotulo, x + 10, y + 3, { width: 120 });
      doc.fillColor(TEXTO).text(valor, x + 10, y + 3, { width: largura - 20, align: 'right' });
      y += 15;
    }
  }

  doc.y = y + 14;
}

/**
 * A prova de que o pedido esta aprovado.
 *
 * E a razao de o documento existir. Sem este bloco, a folha e so uma cotacao bonita: o
 * fornecedor nao sabe se pode faturar, e o almoxarife nao sabe se pode receber.
 */
function provaDaAprovacao(doc: PDFKit.PDFDocument, p: PedidoParaImprimir): void {
  const altura = p.aprovacao ? 66 : 42;
  const y = doc.y;

  if (!p.aprovacao) {
    /*
     * Lote que chegou a "aprovado" sem decisao registrada existe — o painel permitia
     * arrastar o card ate a coluna, pulando a fila de aprovacao. O PDF diz isso em letras
     * claras em vez de omitir o bloco: documento que esconde a falta da assinatura e pior
     * que documento que a denuncia.
     */
    doc.roundedRect(MARGEM, y, LARGURA_UTIL, altura, 4).fillAndStroke('#FBEAEA', '#C0392B');
    doc.fillColor('#C0392B').fontSize(8).font('Helvetica-Bold')
      .text('SEM APROVACAO ELETRONICA REGISTRADA', MARGEM + 12, y + 11, { width: LARGURA_UTIL - 24 });
    doc.fontSize(8).font('Helvetica')
      .text(
        'Este pedido foi emitido sem decisao de alcada gravada. Regularize pela fila de aprovacao antes de enviar ao fornecedor.',
        MARGEM + 12,
        y + 24,
        { width: LARGURA_UTIL - 24 },
      );
    doc.y = y + altura + 14;
    return;
  }

  const a = p.aprovacao;
  doc.roundedRect(MARGEM, y, LARGURA_UTIL, altura, 4).fillAndStroke('#EAF3EC', '#1E8449');
  doc.fillColor('#1E8449').fontSize(8).font('Helvetica-Bold')
    .text('APROVACAO ELETRONICA', MARGEM + 12, y + 10, { width: LARGURA_UTIL - 24 });

  doc.fillColor(TEXTO).fontSize(9).font('Helvetica')
    .text(
      `Aprovado por ${a.aprovador} em ${dataHora(a.decididoEm)} · faixa ${a.nivel} da matriz de alcadas` +
        (a.autoaprovacao ? ' · autoaprovacao de faixa 1' : ''),
      MARGEM + 12,
      y + 23,
      { width: LARGURA_UTIL - 24 },
    );

  if (a.ressalva) {
    doc.fillColor(TEXTO2).fontSize(8).font('Helvetica-Oblique')
      .text(`Ressalva: ${a.ressalva}`, MARGEM + 12, y + 37, { width: LARGURA_UTIL - 24, ellipsis: true, height: 10 });
  }

  doc.fillColor(TEXTO2).fontSize(6.5).font('Courier')
    .text(`Assinatura (SHA-256): ${a.hash}`, MARGEM + 12, y + altura - 16, { width: LARGURA_UTIL - 24 });

  doc.y = y + altura + 14;
}

function observacoes(doc: PDFKit.PDFDocument, texto: string): void {
  doc.fillColor(TEXTO2).fontSize(7).font('Helvetica-Bold').text('OBSERVACOES', MARGEM, doc.y);
  doc.fillColor(TEXTO).fontSize(8.5).font('Helvetica').text(texto, MARGEM, doc.y + 3, { width: LARGURA_UTIL });
  doc.y += 12;
}

/** Aceite do fornecedor: o papel volta assinado e vira anexo do recebimento. */
function assinaturas(doc: PDFKit.PDFDocument): void {
  if (doc.y > 660) doc.addPage();
  const y = Math.max(doc.y + 16, 640);
  const largura = (LARGURA_UTIL - 40) / 2;

  [
    ['Aceite do fornecedor', 'Nome legivel, data e carimbo'],
    ['Conferencia no recebimento', 'Almoxarifado — quantidade e preco'],
  ].forEach(([titulo, ajuda], i) => {
    const x = MARGEM + (largura + 40) * i;
    doc.moveTo(x, y).lineTo(x + largura, y).lineWidth(0.8).stroke(TEXTO2);
    doc.fillColor(TEXTO).fontSize(8).font('Helvetica-Bold').text(titulo!, x, y + 5, { width: largura });
    doc.fillColor(TEXTO2).fontSize(7).font('Helvetica').text(ajuda!, x, y + 15, { width: largura });
  });

  doc.y = y + 32;
}

/**
 * Numeracao em todas as paginas, no fim: `bufferPages` deixa voltar depois de saber o total.
 *
 * A margem inferior e zerada durante a escrita. O rodape mora **abaixo** da area util, e o
 * pdfkit trata texto que ultrapassa a margem como estouro: ele cria uma pagina nova e
 * continua nela. Era o que fazia um pedido de uma pagina sair com tres — a primeira com o
 * conteudo, a segunda com o rodape que "transbordou", a terceira com a numeracao dele.
 */
function rodape(doc: PDFKit.PDFDocument, p: PedidoParaImprimir): void {
  const { count } = doc.bufferedPageRange();

  for (let i = 0; i < count; i += 1) {
    doc.switchToPage(i);

    const margemOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.moveTo(MARGEM, 800).lineTo(MARGEM + LARGURA_UTIL, 800).lineWidth(0.5).stroke(BORDA);
    doc.fillColor(TEXTO2).fontSize(7).font('Helvetica')
      .text(
        `${p.numero} · emitido por ${p.emitidoPor} · SGI Ceara`,
        MARGEM,
        806,
        { width: LARGURA_UTIL - 60, lineBreak: false },
      );
    doc.text(`${i + 1}/${count}`, MARGEM + LARGURA_UTIL - 60, 806, { width: 60, align: 'right', lineBreak: false });

    doc.page.margins.bottom = margemOriginal;
  }
}
