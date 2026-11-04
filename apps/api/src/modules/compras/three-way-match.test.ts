import { describe, expect, it } from 'vitest';
import {
  atrasoEntradaFiscal,
  conferirItem,
  conferirRecebimento,
  podeGerarTitulo,
  type ItemDoPedido,
} from './three-way-match.js';

/** Tolerancia do seed: 2% de variacao de preco na NF-e. */
const TOLERANCIA = '0.02';

const itemPedido = (over: Partial<ItemDoPedido> = {}): ItemDoPedido => ({
  pedidoItemId: 'pi1',
  descricao: 'Pneu 275/80 R22.5',
  quantidadePedida: '10',
  precoUnitario: '1000.00',
  ...over,
});

describe('conferencia de item', () => {
  it('quantidade e preco batendo: item conforme, valor liberado', () => {
    const r = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '10' }, TOLERANCIA);
    expect(r.conforme).toBe(true);
    expect(r.tipoDivergencia).toBeNull();
    expect(r.pagamentoRetido).toBe(false);
    expect(r.valorLiberado.toFixed(2)).toBe('10000.00');
    expect(r.valorRetido.toFixed(2)).toBe('0.00');
  });

  it('quantidade menor gera divergencia mas NAO retem pagamento do que chegou', () => {
    const r = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '6' }, TOLERANCIA);
    expect(r.tipoDivergencia).toBe('QUANTIDADE_MENOR');
    expect(r.pagamentoRetido).toBe(false);
    expect(r.valorLiberado.toFixed(2)).toBe('6000.00');
    expect(r.quantidadePendente.toFixed(0)).toBe('4');
  });

  it('quantidade maior que a pedida retem o pagamento', () => {
    const r = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '12' }, TOLERANCIA);
    expect(r.tipoDivergencia).toBe('QUANTIDADE_MAIOR');
    expect(r.pagamentoRetido).toBe(true);
    expect(r.valorRetido.toFixed(2)).toBe('12000.00');
  });

  it('preco dentro da tolerancia nao e divergencia', () => {
    // 1015 sobre 1000 = 1,5%, abaixo dos 2%
    const r = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '10', precoNotaFiscal: '1015.00' }, TOLERANCIA);
    expect(r.conforme).toBe(true);
    expect(r.valorLiberado.toFixed(2)).toBe('10150.00');
  });

  it('preco exatamente na tolerancia ainda passa', () => {
    const r = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '10', precoNotaFiscal: '1020.00' }, TOLERANCIA);
    expect(r.conforme).toBe(true);
  });

  it('preco acima da tolerancia retem o pagamento', () => {
    // 1050 sobre 1000 = 5%
    const r = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '10', precoNotaFiscal: '1050.00' }, TOLERANCIA);
    expect(r.tipoDivergencia).toBe('PRECO_ACIMA_TOLERANCIA');
    expect(r.pagamentoRetido).toBe(true);
    expect(r.valorRetido.toFixed(2)).toBe('10500.00');
    expect(r.variacaoPreco.times(100).toFixed(2)).toBe('5.00');
  });

  it('preco ABAIXO do pedido nao e divergencia - e desconto a favor da empresa', () => {
    const r = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '10', precoNotaFiscal: '900.00' }, TOLERANCIA);
    expect(r.conforme).toBe(true);
    expect(r.valorLiberado.toFixed(2)).toBe('9000.00');
  });

  it('avaria apontada pelo conferente tem precedencia e retem', () => {
    const r = conferirItem(
      itemPedido(),
      { pedidoItemId: 'pi1', quantidadeRecebida: '10', divergenciaManual: 'AVARIA', observacao: 'dois pneus com bolha' },
      TOLERANCIA,
    );
    expect(r.tipoDivergencia).toBe('AVARIA');
    expect(r.pagamentoRetido).toBe(true);
    expect(r.observacao).toBe('dois pneus com bolha');
  });

  it('acumula com o que ja foi recebido antes', () => {
    const r = conferirItem(
      itemPedido({ quantidadeJaRecebida: '4' }),
      { pedidoItemId: 'pi1', quantidadeRecebida: '6' },
      TOLERANCIA,
    );
    expect(r.quantidadeAcumulada.toFixed(0)).toBe('10');
    expect(r.quantidadePendente.toFixed(0)).toBe('0');
    expect(r.conforme).toBe(true);
  });

  it('recusa quantidade negativa', () => {
    expect(() => conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '-1' }, TOLERANCIA)).toThrow(RangeError);
  });
});

describe('conferencia do recebimento', () => {
  const doisItens: ItemDoPedido[] = [
    itemPedido({ pedidoItemId: 'a', quantidadePedida: '10', precoUnitario: '100.00' }),
    itemPedido({ pedidoItemId: 'b', quantidadePedida: '5', precoUnitario: '200.00' }),
  ];

  it('tudo conforme: aceite total e three-way ok', () => {
    const r = conferirRecebimento(
      doisItens,
      [{ pedidoItemId: 'a', quantidadeRecebida: '10' }, { pedidoItemId: 'b', quantidadeRecebida: '5' }],
      TOLERANCIA,
    );
    expect(r.status).toBe('ACEITE_TOTAL');
    expect(r.threeWayOk).toBe(true);
    expect(r.entregaPendente).toBe(false);
    expect(r.valorLiberado.toFixed(2)).toBe('2000.00');
    expect(r.bloqueiaEntradaFiscal).toBe(false);
  });

  it('entrega parcial: aceite parcial, three-way nao ok, pendencia sinalizada', () => {
    const r = conferirRecebimento(
      doisItens,
      [{ pedidoItemId: 'a', quantidadeRecebida: '10' }, { pedidoItemId: 'b', quantidadeRecebida: '3' }],
      TOLERANCIA,
    );
    expect(r.status).toBe('ACEITE_PARCIAL');
    expect(r.threeWayOk).toBe(false);
    expect(r.entregaPendente).toBe(true);
    expect(r.valorLiberado.toFixed(2)).toBe('1600.00');
  });

  it('item do pedido nao conferido conta como pendente', () => {
    const r = conferirRecebimento(doisItens, [{ pedidoItemId: 'a', quantidadeRecebida: '10' }], TOLERANCIA);
    expect(r.entregaPendente).toBe(true);
    expect(r.status).toBe('ACEITE_PARCIAL');
  });

  it('nada recebido e recusa', () => {
    const r = conferirRecebimento(
      doisItens,
      [{ pedidoItemId: 'a', quantidadeRecebida: '0' }, { pedidoItemId: 'b', quantidadeRecebida: '0' }],
      TOLERANCIA,
    );
    expect(r.status).toBe('RECUSADO');
    expect(r.valorLiberado.toFixed(2)).toBe('0.00');
  });

  it('divergencia retem apenas o item divergente, nao o pedido inteiro', () => {
    const r = conferirRecebimento(
      doisItens,
      [
        { pedidoItemId: 'a', quantidadeRecebida: '10' },
        { pedidoItemId: 'b', quantidadeRecebida: '5', divergenciaManual: 'AVARIA' },
      ],
      TOLERANCIA,
    );
    expect(r.valorLiberado.toFixed(2)).toBe('1000.00');
    expect(r.valorRetido.toFixed(2)).toBe('1000.00');
    expect(r.valorConferido.toFixed(2)).toBe('2000.00');
  });

  it('preco acima da tolerancia bloqueia a entrada fiscal com motivo', () => {
    const r = conferirRecebimento(
      doisItens,
      [
        { pedidoItemId: 'a', quantidadeRecebida: '10', precoNotaFiscal: '130.00' },
        { pedidoItemId: 'b', quantidadeRecebida: '5' },
      ],
      TOLERANCIA,
    );
    expect(r.bloqueiaEntradaFiscal).toBe(true);
    expect(r.motivoBloqueio).toContain('tolerancia');
    expect(r.divergencias).toContain('PRECO_ACIMA_TOLERANCIA');
  });

  it('avaria sozinha nao bloqueia a entrada fiscal - so retem o item', () => {
    const r = conferirRecebimento(
      doisItens,
      [
        { pedidoItemId: 'a', quantidadeRecebida: '10', divergenciaManual: 'AVARIA' },
        { pedidoItemId: 'b', quantidadeRecebida: '5' },
      ],
      TOLERANCIA,
    );
    expect(r.bloqueiaEntradaFiscal).toBe(false);
    expect(r.valorRetido.toFixed(2)).toBe('1000.00');
  });

  it('recusa item que nao pertence ao pedido', () => {
    expect(() => conferirRecebimento(doisItens, [{ pedidoItemId: 'z', quantidadeRecebida: '1' }], TOLERANCIA)).toThrow(RangeError);
  });

  it('recusa pedido sem itens', () => {
    expect(() => conferirRecebimento([], [], TOLERANCIA)).toThrow(RangeError);
  });
});

describe('regra de ouro 4: titulo exige aceite', () => {
  const base = { status: 'ACEITE_TOTAL' as const, bloqueiaEntradaFiscal: false, valorLiberado: conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '10' }, TOLERANCIA).valorLiberado };

  it('aceite total libera a geracao do titulo', () => {
    expect(podeGerarTitulo(base).pode).toBe(true);
  });

  it('recebimento recusado nao gera titulo', () => {
    const r = podeGerarTitulo({ ...base, status: 'RECUSADO' });
    expect(r.pode).toBe(false);
    expect(r.motivo).toContain('recusado');
  });

  it('conferencia em aberto nao gera titulo', () => {
    expect(podeGerarTitulo({ ...base, status: 'EM_CONFERENCIA' }).pode).toBe(false);
  });

  it('bloqueio fiscal impede o titulo', () => {
    const r = podeGerarTitulo({ ...base, bloqueiaEntradaFiscal: true });
    expect(r.pode).toBe(false);
    expect(r.motivo).toContain('tolerancia');
  });

  it('sem valor liberado nao ha o que pagar', () => {
    const zero = conferirItem(itemPedido(), { pedidoItemId: 'pi1', quantidadeRecebida: '10', divergenciaManual: 'AVARIA' }, TOLERANCIA).valorLiberado;
    expect(podeGerarTitulo({ ...base, valorLiberado: zero }).pode).toBe(false);
  });

  it('aceite parcial gera titulo do que foi liberado', () => {
    expect(podeGerarTitulo({ ...base, status: 'ACEITE_PARCIAL' }).pode).toBe(true);
  });
});

describe('prazo de 48h entre fisico e fiscal', () => {
  const recebido = new Date('2026-08-03T10:00:00-03:00');

  it('dentro do prazo quando o fiscal sai em 24h', () => {
    const r = atrasoEntradaFiscal(recebido, new Date('2026-08-04T10:00:00-03:00'));
    expect(r.horas).toBe(24);
    expect(r.dentroDoPrazo).toBe(true);
  });

  it('exatamente 48h ainda esta dentro', () => {
    expect(atrasoEntradaFiscal(recebido, new Date('2026-08-05T10:00:00-03:00')).dentroDoPrazo).toBe(true);
  });

  it('acima de 48h estoura o indicador', () => {
    const r = atrasoEntradaFiscal(recebido, new Date('2026-08-05T14:00:00-03:00'));
    expect(r.horas).toBe(52);
    expect(r.dentroDoPrazo).toBe(false);
  });

  it('sem lancamento fiscal conta ate agora', () => {
    const r = atrasoEntradaFiscal(recebido, null, new Date('2026-08-06T10:00:00-03:00'));
    expect(r.horas).toBe(72);
    expect(r.dentroDoPrazo).toBe(false);
  });
});
