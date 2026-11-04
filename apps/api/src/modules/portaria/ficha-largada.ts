import PDFDocument from 'pdfkit';

/**
 * Ficha de largada do caminhao da frota (secao 14.7).
 *
 * A saida para a rota ja era registro no banco desde a F12, mas quem sai com o caminhao
 * nao tem o banco na mao. O que o motorista levava era o que lembrava: rota, nota e
 * hodometro combinados de viva voz na guarita. Divergencia de carga e "eu nao sabia que
 * era essa rota" nascem exatamente ai.
 *
 * A ficha e o mesmo registro do portao impresso: rota, veiculo, motorista, carga e a
 * leitura do hodometro que ficou gravada. Vai assinada pelo porteiro e pelo motorista, e
 * traz em branco o que so o retorno preenche - para a conferencia da volta ser feita
 * contra o mesmo papel, e nao contra a memoria de ninguem.
 *
 * Layout puro: recebe a ficha ja montada e devolve o PDF. Sem I/O e sem Prisma, para
 * poder ser conferido sem banco - mesma separacao do pedido de compra (6.1.8).
 */

/** Paleta da secao 4.1. */
const AZUL = '#16469D';
const OURO = '#F3AE00';
const TEXTO = '#1A1A1A';
const TEXTO2 = '#5A5A5A';
const VERMELHO = '#C0392B';
const BORDA = '#E3E7EE';
const NEVOA = '#F2F4F8';

const MARGEM = 40;
const LARGURA_PAGINA = 595.28; // A4 retrato
const LARGURA_UTIL = LARGURA_PAGINA - MARGEM * 2;

export interface FichaDeLargada {
  /** identificador curto que aparece no topo; o id completo vai no rodape */
  protocolo: string;
  acessoId: string;
  largadaEm: Date;
  geradoEm: Date;
  unidade: { nome: string; cidade: string | null; uf: string | null };
  guarita: { codigo: string; nome: string };
  registradoPor: string;
  motorista: {
    nome: string;
    cpf: string | null;
    cnhNumero: string | null;
    cnhCategoria: string | null;
    cnhVencimento: Date | null;
    telefone: string | null;
  } | null;
  veiculo: {
    placa: string;
    frotaNumero: string | null;
    marca: string | null;
    modelo: string | null;
  } | null;
  rota: { codigo: string; nome: string; fechamento: string | null; largada: string | null } | null;
  /** hodometro lido na guarita, em km; string para nao passar por float */
  hodometroSaida: string | null;
  notaFiscal: string | null;
  cargaDescricao: string | null;
  motivo: string;
  observacao: string | null;
  /** ocorrencias abertas no ato da largada - leitura de hodometro fora do cadastro, por exemplo */
  ocorrencias: Array<{ gravidade: string; descricao: string }>;
}

const dataHora = (d: Date): string => d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dataCurta = (d: Date | null): string => (d ? d.toLocaleDateString('pt-BR') : '—');

/** CPF formatado so na apresentacao; no banco ele mora limpo. */
function cpfFormatado(cpf: string | null): string {
  if (!cpf) return '—';
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Telefone brasileiro legivel: (85) 99999-9999. */
export function telefoneFormatado(telefone: string | null): string {
  const d = (telefone ?? '').replace(/\D/g, '');
  const semPais = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  if (semPais.length === 11) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 7)}-${semPais.slice(7)}`;
  if (semPais.length === 10) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 6)}-${semPais.slice(6)}`;
  return telefone?.trim() || '—';
}

/** Hodometro com separador de milhar e "km": 128.450,0 km. */
export function hodometroFormatado(valor: string | null): string {
  if (!valor) return '—';
  const [inteira, decimal = '0'] = valor.split('.');
  const comMilhar = (inteira ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${comMilhar},${decimal.slice(0, 1)} km`;
}

const vazio = (v: string | null | undefined): string => (v && v.trim() !== '' ? v.trim() : '—');

/**
 * Monta o PDF e resolve com o arquivo inteiro em memoria.
 *
 * A ficha e de uma pagina: cabe de sobra no buffer, e evita expor um stream que o
 * handler - e o envio por WhatsApp - teriam que fechar na mao.
 */
export function gerarFichaDeLargada(ficha: FichaDeLargada): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true });
  const pedacos: Buffer[] = [];
  doc.on('data', (p: Buffer) => pedacos.push(p));

  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  cabecalho(doc, ficha);
  let y = 108;
  y = blocoRotaEVeiculo(doc, ficha, y);
  y = blocoMotorista(doc, ficha, y);
  y = blocoCarga(doc, ficha, y);
  if (ficha.ocorrencias.length > 0) y = blocoOcorrencias(doc, ficha, y);
  y = blocoRetorno(doc, y);
  assinaturas(doc, ficha, y);
  rodape(doc, ficha);

  doc.end();
  return pronto;
}

function cabecalho(doc: PDFKit.PDFDocument, f: FichaDeLargada): void {
  doc.rect(0, 0, LARGURA_PAGINA, 76).fill(AZUL);
  doc.rect(0, 76, LARGURA_PAGINA, 3).fill(OURO);

  doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text(f.unidade.nome, MARGEM, 20, { width: 320 });

  const local = [f.unidade.cidade, f.unidade.uf].filter(Boolean).join('/');
  doc.fontSize(8).font('Helvetica').fillColor('#D6DEEE');
  doc.text(['Portaria e controle de acesso', local].filter(Boolean).join(' · '), MARGEM, 42, { width: 320 });
  doc.text(`Guarita ${f.guarita.codigo} — ${f.guarita.nome}`, MARGEM, 54, { width: 320 });

  doc.fontSize(13).font('Helvetica-Bold').fillColor('#FFFFFF');
  doc.text('FICHA DE LARGADA', LARGURA_PAGINA - MARGEM - 220, 20, { width: 220, align: 'right' });
  doc.fontSize(9).font('Helvetica').fillColor(OURO);
  doc.text(f.protocolo, LARGURA_PAGINA - MARGEM - 220, 38, { width: 220, align: 'right' });
  doc.fontSize(8).fillColor('#D6DEEE');
  doc.text(`Saida em ${dataHora(f.largadaEm)}`, LARGURA_PAGINA - MARGEM - 220, 54, { width: 220, align: 'right' });
}

/** Titulo de secao com a regua dourada - mesma linguagem do pedido de compra. */
function tituloBloco(doc: PDFKit.PDFDocument, texto: string, y: number): number {
  doc.fontSize(9).font('Helvetica-Bold').fillColor(AZUL).text(texto.toUpperCase(), MARGEM, y);
  doc.rect(MARGEM, y + 12, 28, 2).fill(OURO);
  return y + 22;
}

/**
 * Grade de rotulo e valor. Recebe as celulas em ordem de leitura e devolve o y final -
 * assim cada bloco cresce sozinho conforme o que existe para mostrar.
 */
function grade(
  doc: PDFKit.PDFDocument,
  celulas: Array<{ rotulo: string; valor: string; colunas?: number; destaque?: boolean }>,
  y: number,
  colunasPorLinha = 3,
): number {
  const larguraColuna = LARGURA_UTIL / colunasPorLinha;
  const alturaLinha = 32;
  let coluna = 0;
  let topo = y;

  for (const celula of celulas) {
    const ocupa = Math.min(celula.colunas ?? 1, colunasPorLinha);
    if (coluna + ocupa > colunasPorLinha) {
      coluna = 0;
      topo += alturaLinha;
    }

    const x = MARGEM + coluna * larguraColuna;
    const largura = larguraColuna * ocupa - 8;

    doc.fontSize(7).font('Helvetica').fillColor(TEXTO2).text(celula.rotulo.toUpperCase(), x, topo, { width: largura });
    doc
      .fontSize(celula.destaque ? 12 : 10)
      .font(celula.destaque ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(TEXTO)
      .text(celula.valor, x, topo + 10, { width: largura, ellipsis: true, height: 16 });

    coluna += ocupa;
  }

  return topo + alturaLinha;
}

function blocoRotaEVeiculo(doc: PDFKit.PDFDocument, f: FichaDeLargada, y: number): number {
  const topo = tituloBloco(doc, 'Rota e veiculo', y);

  const cadencia = [
    f.rota?.fechamento ? `fechamento ${f.rota.fechamento}` : null,
    f.rota?.largada ? `largada ${f.rota.largada}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return grade(
    doc,
    [
      { rotulo: 'Rota', valor: f.rota ? `${f.rota.codigo} — ${f.rota.nome}` : 'Sem rota informada', colunas: 2, destaque: true },
      { rotulo: 'Placa', valor: f.veiculo?.placa ?? '—', destaque: true },
      { rotulo: 'Cadencia da rota', valor: cadencia || '—' },
      { rotulo: 'Frota', valor: vazio(f.veiculo?.frotaNumero) },
      { rotulo: 'Veiculo', valor: vazio([f.veiculo?.marca, f.veiculo?.modelo].filter(Boolean).join(' ')) },
      { rotulo: 'Hodometro na saida', valor: hodometroFormatado(f.hodometroSaida), destaque: true },
      { rotulo: 'Saida registrada em', valor: dataHora(f.largadaEm) },
      { rotulo: 'Registrada por', valor: f.registradoPor },
    ],
    topo,
  );
}

function blocoMotorista(doc: PDFKit.PDFDocument, f: FichaDeLargada, y: number): number {
  const topo = tituloBloco(doc, 'Motorista', y + 4);

  if (!f.motorista) {
    doc.fontSize(10).font('Helvetica').fillColor(VERMELHO);
    doc.text('Saida registrada sem motorista identificado.', MARGEM, topo, { width: LARGURA_UTIL });
    return topo + 22;
  }

  return grade(
    doc,
    [
      { rotulo: 'Nome', valor: f.motorista.nome, colunas: 2, destaque: true },
      { rotulo: 'CPF', valor: cpfFormatado(f.motorista.cpf) },
      { rotulo: 'CNH', valor: vazio([f.motorista.cnhNumero, f.motorista.cnhCategoria].filter(Boolean).join(' · ')) },
      { rotulo: 'CNH vence em', valor: dataCurta(f.motorista.cnhVencimento) },
      { rotulo: 'Telefone', valor: telefoneFormatado(f.motorista.telefone) },
    ],
    topo,
  );
}

function blocoCarga(doc: PDFKit.PDFDocument, f: FichaDeLargada, y: number): number {
  const topo = tituloBloco(doc, 'Carga e finalidade', y + 4);

  let fim = grade(
    doc,
    [
      { rotulo: 'Nota fiscal', valor: vazio(f.notaFiscal) },
      { rotulo: 'Finalidade da saida', valor: f.motivo, colunas: 2 },
    ],
    topo,
  );

  const textos: Array<[string, string | null]> = [
    ['Descricao da carga', f.cargaDescricao],
    ['Observacao da guarita', f.observacao],
  ];

  for (const [rotulo, conteudo] of textos) {
    if (!conteudo || conteudo.trim() === '') continue;
    doc.fontSize(7).font('Helvetica').fillColor(TEXTO2).text(rotulo.toUpperCase(), MARGEM, fim);
    doc.fontSize(9).font('Helvetica').fillColor(TEXTO);
    doc.text(conteudo.trim(), MARGEM, fim + 10, { width: LARGURA_UTIL });
    fim = doc.y + 8;
  }

  return fim;
}

/**
 * Ocorrencia aberta na largada vai impressa. Hodometro que nao fecha com o cadastro e o
 * caso comum - e e justamente o que precisa chegar em quem confere o retorno.
 */
function blocoOcorrencias(doc: PDFKit.PDFDocument, f: FichaDeLargada, y: number): number {
  const topo = tituloBloco(doc, 'Ocorrencias registradas nesta saida', y + 4);
  const altura = f.ocorrencias.length * 16 + 12;

  doc.rect(MARGEM, topo - 4, LARGURA_UTIL, altura).fillAndStroke('#FDF3F2', VERMELHO);

  let linha = topo + 3;
  for (const o of f.ocorrencias) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(VERMELHO).text(`${o.gravidade}`, MARGEM + 8, linha, { width: 52 });
    doc.font('Helvetica').fillColor(TEXTO).text(o.descricao, MARGEM + 64, linha, {
      width: LARGURA_UTIL - 72,
      ellipsis: true,
      height: 12,
    });
    linha += 16;
  }

  return topo + altura + 4;
}

/**
 * O que so o retorno preenche. Sai em branco de proposito: a conferencia da volta e
 * feita contra o mesmo papel que saiu, e nao contra a lembranca de quem despachou.
 */
function blocoRetorno(doc: PDFKit.PDFDocument, y: number): number {
  const topo = tituloBloco(doc, 'A preencher no retorno', y + 4);
  const altura = 46;

  doc.rect(MARGEM, topo - 4, LARGURA_UTIL, altura).fillAndStroke(NEVOA, BORDA);

  const campos = ['Hodometro de retorno', 'Data e hora da chegada', 'Conferido por'];
  const largura = LARGURA_UTIL / campos.length;

  campos.forEach((rotulo, i) => {
    const x = MARGEM + i * largura + 10;
    doc.fontSize(7).font('Helvetica').fillColor(TEXTO2).text(rotulo.toUpperCase(), x, topo + 4, { width: largura - 20 });
    doc.moveTo(x, topo + 30).lineTo(x + largura - 24, topo + 30).stroke(BORDA);
  });

  doc.fontSize(7).font('Helvetica').fillColor(TEXTO2);
  doc.text(
    'Leitura de retorno menor que a da saida e recusada pelo sistema (secao 14.3).',
    MARGEM + 10,
    topo + 33,
    { width: LARGURA_UTIL - 20 },
  );

  return topo + altura + 8;
}

function assinaturas(doc: PDFKit.PDFDocument, f: FichaDeLargada, y: number): void {
  const topo = Math.max(y + 18, 640);
  const largura = (LARGURA_UTIL - 30) / 2;

  const linhas: Array<[string, string]> = [
    ['Motorista', f.motorista?.nome ?? ''],
    ['Porteiro', f.registradoPor],
  ];

  linhas.forEach(([papel, nome], i) => {
    const x = MARGEM + i * (largura + 30);
    doc.moveTo(x, topo).lineTo(x + largura, topo).stroke(TEXTO2);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXTO).text(papel, x, topo + 6, { width: largura });
    doc.fontSize(8).font('Helvetica').fillColor(TEXTO2).text(nome, x, topo + 18, { width: largura, ellipsis: true, height: 10 });
  });

  doc.fontSize(7).font('Helvetica').fillColor(TEXTO2);
  doc.text(
    'Assinando, o motorista declara que conferiu rota, carga e a leitura do hodometro acima.',
    MARGEM,
    topo + 36,
    { width: LARGURA_UTIL },
  );
}

function rodape(doc: PDFKit.PDFDocument, f: FichaDeLargada): void {
  const y = 792 - MARGEM - 22;
  doc.rect(MARGEM, y, LARGURA_UTIL, 1).fill(BORDA);
  doc.fontSize(7).font('Helvetica').fillColor(TEXTO2);
  doc.text(
    `Documento gerado pelo sistema em ${dataHora(f.geradoEm)} · acesso ${f.acessoId} · nao substitui os documentos fiscais da carga.`,
    MARGEM,
    y + 6,
    { width: LARGURA_UTIL },
  );
}
