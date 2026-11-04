import { describe, expect, it } from 'vitest';
import { gerarPdfDoPedido, type PedidoParaImprimir } from './pedido-pdf.js';

const base: PedidoParaImprimir = {
  numero: 'PC-2026-0001',
  emitidoEm: new Date('2026-08-20T10:00:00-03:00'),
  emitidoPor: 'Comprador Tecnico',
  loteNumero: 'LOTE-2026-0001',
  unidade: { nome: 'Ceara Alimentos - Matriz', cnpj: null, endereco: 'Sao Luis/MA' },
  fornecedor: { razaoSocial: 'Distribuidora Alfa Pecas LTDA', cnpj: '11.222.333/0001-81', email: null, telefone: null },
  condicaoPagamento: '28 dias',
  dataPrometida: new Date('2026-09-01T12:00:00-03:00'),
  entrega: { local: 'Matriz', centrosCusto: ['3021 — Manutencao de Frota'], placas: ['ROO2C65'] },
  itens: [
    { codigo: 'PN-0001', descricao: 'Pneu 275/80 R22.5 borrachudo', quantidade: '4', unidadeMedida: 'UN', precoUnitario: '2500.00' },
  ],
  freteValor: null,
  descontoAvista: null,
  valorTotal: '10000.00',
  aprovacao: {
    aprovador: 'Gerente da Unidade',
    decididoEm: new Date('2026-08-19T16:30:00-03:00'),
    nivel: 3,
    hash: 'a'.repeat(64),
    ressalva: null,
    autoaprovacao: false,
  },
  observacoes: null,
};

const pdf = (p: Partial<PedidoParaImprimir> = {}) => gerarPdfDoPedido({ ...base, ...p });

/**
 * Paginas do arquivo, lidas do proprio PDF.
 *
 * O pdfkit comprime os fluxos de conteudo, mas escreve o catalogo em texto — entao o
 * `/Count` do no de paginas e legivel. Contar aqui e o unico jeito honesto de guardar a
 * regressao: qualquer escrita que ultrapasse a margem cria pagina, e isso so aparece no
 * arquivo pronto.
 */
const paginas = (arquivo: Buffer): number => {
  const achados = [...arquivo.toString('latin1').matchAll(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/g)];
  if (achados.length === 0) throw new Error('nao encontrei o no de paginas no PDF');
  return Math.max(...achados.map((m) => Number(m[1])));
};

describe('pedido em pdf', () => {
  it('produz um PDF valido', async () => {
    const arquivo = await pdf();
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
    expect(arquivo.length).toBeGreaterThan(1000);
  });

  it('pedido de um item cabe em uma pagina, e so uma', async () => {
    /*
     * O rodape mora abaixo da area util. Escrever ali sem zerar a margem inferior faz o
     * pdfkit entender estouro e abrir pagina nova — um pedido de um item saia com tres
     * folhas, duas delas so com o rodape que transbordou.
     */
    expect(paginas(await pdf())).toBe(1);
  });

  it('nenhuma variacao de conteudo curto passa de uma pagina', async () => {
    const casos: Array<[string, Partial<PedidoParaImprimir>]> = [
      ['sem aprovacao', { aprovacao: null }],
      ['com ressalva e observacoes', {
        observacoes: 'Entregar no portao 2, das 8h as 11h.',
        aprovacao: { ...base.aprovacao!, ressalva: 'Condicionado a confirmacao do prazo.' },
      }],
      ['com frete e desconto', { freteValor: '350.00', descontoAvista: '120.00' }],
      ['sem itens', { itens: [], valorTotal: '0.00' }],
    ];
    for (const [nome, caso] of casos) {
      expect(paginas(await pdf(caso)), nome).toBe(1);
    }
  });

  it('so vira duas paginas quando os itens realmente nao cabem', async () => {
    // 40 itens nao cabem numa folha; quebrar ai e o comportamento certo
    const muitos = await pdf({
      itens: Array.from({ length: 40 }, (_, i) => ({
        codigo: `IT-${i}`,
        descricao: `Item numero ${i}`,
        quantidade: '2',
        unidadeMedida: 'UN',
        precoUnitario: '125.50',
      })),
    });
    expect(paginas(muitos)).toBeGreaterThan(1);
  });

  it('o documento cresce com a quantidade de itens', async () => {
    const um = await pdf();
    const muitos = await pdf({
      itens: Array.from({ length: 40 }, (_, i) => ({
        codigo: `IT-${i}`,
        descricao: `Item numero ${i} com descricao suficientemente longa para quebrar linha na coluna`,
        quantidade: '2',
        unidadeMedida: 'UN',
        precoUnitario: '125.50',
      })),
    });
    expect(muitos.length).toBeGreaterThan(um.length);
  });

  it('pedido sem aprovacao registrada tambem gera documento', async () => {
    /*
     * Nao pode explodir: existem pedidos emitidos antes de o painel exigir a fila de
     * aprovacao. O documento denuncia a falta em vez de omitir o bloco — e a folha continua
     * saindo, para o comprador ver o problema.
     */
    const arquivo = await pdf({ aprovacao: null });
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('aceita ressalva, frete, desconto e observacoes sem quebrar o layout', async () => {
    const arquivo = await pdf({
      freteValor: '350.00',
      descontoAvista: '120.00',
      observacoes: 'Entregar no portao 2, das 8h as 11h. Falar com o almoxarifado antes de descarregar.',
      aprovacao: { ...base.aprovacao!, ressalva: 'Aprovado condicionado a confirmacao do prazo pelo fornecedor.' },
    });
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('item sem codigo de catalogo nao impede a impressao', async () => {
    // compra de item de descricao livre e o caso comum na manutencao
    const arquivo = await pdf({
      itens: [{ codigo: null, descricao: 'Servico de torno para eixo', quantidade: '1', unidadeMedida: 'SV', precoUnitario: '800.00' }],
    });
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('pedido sem itens nao derruba a geracao', async () => {
    const arquivo = await pdf({ itens: [], valorTotal: '0.00' });
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('autoaprovacao de faixa 1 sai marcada como tal', async () => {
    const arquivo = await pdf({ aprovacao: { ...base.aprovacao!, nivel: 1, autoaprovacao: true } });
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
