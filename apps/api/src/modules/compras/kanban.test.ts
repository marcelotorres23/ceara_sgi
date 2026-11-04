import { describe, expect, it } from 'vitest';
import {
  agruparEmRaias,
  aging,
  calcularKpis,
  consumoSla,
  montarColunas,
  COLUNAS_POR_PERFIL,
  type LoteNoPainel,
} from './kanban.js';
import type { StatusLote } from './state-machine.js';

const AGORA = new Date('2026-08-10T12:00:00-03:00');
const horasAtras = (h: number): Date => new Date(AGORA.getTime() - h * 3_600_000);
const horasAFrente = (h: number): Date => new Date(AGORA.getTime() + h * 3_600_000);

const lote = (over: Partial<LoteNoPainel> = {}): LoteNoPainel => ({
  id: 'l1',
  numero: 'LOTE-2026-0001',
  status: 'EM_COTACAO',
  criticidade: 'P3',
  valor: '1000.00',
  quantidadeItens: 3,
  solicitante: 'Manutencao',
  centroCusto: '3021',
  compradorId: 'u1',
  compradorNome: 'Comprador Tecnico',
  fornecedor: null,
  aprovador: null,
  anexos: 0,
  notas: 0,
  bloqueado: false,
  abertoEm: horasAtras(10),
  slaVenceEm: horasAFrente(10),
  ...over,
});

describe('consumo de SLA', () => {
  it('metade do prazo consumido marca ~50%', () => {
    const c = consumoSla(horasAtras(10), horasAFrente(10), AGORA);
    expect(c.percentual).toBe(50);
    expect(c.vencido).toBe(false);
  });

  it('nao chega a 100% enquanto nao vencer', () => {
    const c = consumoSla(horasAtras(999), horasAFrente(0.1), AGORA);
    expect(c.vencido).toBe(false);
    expect(c.percentual).toBeLessThanOrEqual(99);
  });

  it('marca vencido e passa de 100% depois do prazo', () => {
    const c = consumoSla(horasAtras(20), horasAtras(2), AGORA);
    expect(c.vencido).toBe(true);
    expect(c.percentual).toBeGreaterThanOrEqual(100);
    expect(c.rotulo).toContain('Vencido');
  });

  it('mostra horas restantes e o rotulo de vencimento', () => {
    const c = consumoSla(horasAtras(1), horasAFrente(3), AGORA);
    expect(c.horasRestantes).toBeCloseTo(3, 1);
    expect(c.rotulo).toBe('Vence em 3h');
  });

  it('formata prazo longo em dias', () => {
    expect(consumoSla(horasAtras(1), horasAFrente(72), AGORA).rotulo).toBe('Vence em 3 dias');
  });

  it('formata prazo curto em minutos', () => {
    expect(consumoSla(horasAtras(1), horasAFrente(0.5), AGORA).rotulo).toBe('Vence em 30min');
  });

  it('lote sem SLA nao entra na conta', () => {
    const c = consumoSla(horasAtras(100), null, AGORA);
    expect(c.vencido).toBe(false);
    expect(c.rotulo).toBe('Sem SLA definido');
  });

  it('SLA imediato ja vencido quando o instante passou', () => {
    const t = horasAtras(1);
    expect(consumoSla(t, t, AGORA).vencido).toBe(true);
  });
});

describe('aging', () => {
  it('nao aparece antes de 5 dias', () => {
    expect(aging(horasAtras(24 * 4), AGORA)).toEqual({ dias: 4, exibir: false, critico: false });
  });

  it('aparece a partir de 5 dias', () => {
    expect(aging(horasAtras(24 * 5), AGORA).exibir).toBe(true);
  });

  it('vira critico acima de 10 dias', () => {
    expect(aging(horasAtras(24 * 11), AGORA).critico).toBe(true);
    expect(aging(horasAtras(24 * 10), AGORA).critico).toBe(false);
  });
});

describe('colunas do painel', () => {
  it('o comprador ve da triagem ao encerramento', () => {
    expect(COLUNAS_POR_PERFIL.COMPRADOR).toContain('TRIAGEM');
    expect(COLUNAS_POR_PERFIL.COMPRADOR).toContain('ENCERRADO');
  });

  it('o aprovador ve apenas a raia de aprovacao', () => {
    expect(COLUNAS_POR_PERFIL.APROVADOR).toEqual(['AGUARDANDO_APROVACAO', 'APROVADO', 'REPROVADO', 'EM_RENEGOCIACAO']);
    expect(COLUNAS_POR_PERFIL.APROVADOR).not.toContain('EM_COTACAO');
  });

  it('distribui os lotes na coluna do seu status', () => {
    const colunas = montarColunas(
      [lote({ id: 'a', status: 'TRIAGEM' }), lote({ id: 'b', status: 'EM_COTACAO' }), lote({ id: 'c', status: 'EM_COTACAO' })],
      ['TRIAGEM', 'EM_COTACAO', 'APROVADO'],
      AGORA,
    );
    expect(colunas.map((c) => c.total)).toEqual([1, 2, 0]);
  });

  it('coluna vazia continua visivel', () => {
    const colunas = montarColunas([], ['TRIAGEM', 'EM_COTACAO'], AGORA);
    expect(colunas).toHaveLength(2);
    expect(colunas[0]?.valor).toBe('0.00');
  });

  it('soma o valor dos cards da coluna', () => {
    const colunas = montarColunas(
      [lote({ id: 'a', valor: '1500.50' }), lote({ id: 'b', valor: '499.50' })],
      ['EM_COTACAO'],
      AGORA,
    );
    expect(colunas[0]?.valor).toBe('2000.00');
  });

  it('o card carrega SLA, aging e cor da criticidade', () => {
    const [coluna] = montarColunas([lote({ criticidade: 'P1' })], ['EM_COTACAO'], AGORA);
    const card = coluna!.cards[0]!;
    expect(card.cor).toBe('vermelho');
    expect(card.sla.percentual).toBe(50);
    expect(card.aging.dias).toBe(0);
  });
});

describe('swimlanes', () => {
  const lotes = [
    lote({ id: 'a', criticidade: 'P1', compradorNome: 'Ana', centroCusto: '3021' }),
    lote({ id: 'b', criticidade: 'P3', compradorNome: 'Bruno', centroCusto: '3021' }),
    lote({ id: 'c', criticidade: 'P1', compradorNome: 'Ana', centroCusto: '4010' }),
  ];

  it('agrupa por criticidade com P1 primeiro', () => {
    const raias = agruparEmRaias(lotes, 'CRITICIDADE');
    expect(raias.map((r) => r.chave)).toEqual(['P1', 'P3']);
    expect(raias[0]?.lotes).toHaveLength(2);
  });

  it('agrupa por comprador', () => {
    expect(agruparEmRaias(lotes, 'COMPRADOR').map((r) => r.chave)).toEqual(['Ana', 'Bruno']);
  });

  it('agrupa por centro de custo', () => {
    expect(agruparEmRaias(lotes, 'CENTRO_CUSTO').map((r) => r.chave)).toEqual(['3021', '4010']);
  });
});

describe('KPIs do cabecalho', () => {
  const extras = { savingsDoMes: '1234.56', pedidosSemNotaFiscal: 2 };

  it('conta apenas lotes em aberto', () => {
    const k = calcularKpis(
      [lote({ id: 'a', status: 'EM_COTACAO' }), lote({ id: 'b', status: 'ENCERRADO' }), lote({ id: 'c', status: 'CANCELADO' })],
      extras,
      AGORA,
    );
    expect(k.lotesEmAberto).toBe(1);
  });

  it('valor em negociacao soma so os estados de negociacao', () => {
    const k = calcularKpis(
      [
        lote({ id: 'a', status: 'EM_COTACAO', valor: '1000.00' }),
        lote({ id: 'b', status: 'AGUARDANDO_APROVACAO', valor: '500.00' }),
        lote({ id: 'c', status: 'PEDIDO_EMITIDO', valor: '9000.00' }),
      ],
      extras,
      AGORA,
    );
    expect(k.valorEmNegociacao).toBe('1500.00');
  });

  it('aderencia ao SLA desconta os vencidos', () => {
    const k = calcularKpis(
      [
        lote({ id: 'a', slaVenceEm: horasAFrente(5) }),
        lote({ id: 'b', slaVenceEm: horasAFrente(5) }),
        lote({ id: 'c', slaVenceEm: horasAtras(5) }),
        lote({ id: 'd', slaVenceEm: horasAtras(5) }),
      ],
      extras,
      AGORA,
    );
    expect(k.percentualDentroDoSla).toBe(50);
  });

  it('sem lote com SLA a aderencia e 100%, nao divisao por zero', () => {
    expect(calcularKpis([lote({ slaVenceEm: null })], extras, AGORA).percentualDentroDoSla).toBe(100);
  });

  it('conta aging critico apenas entre os abertos', () => {
    const k = calcularKpis(
      [
        lote({ id: 'a', abertoEm: horasAtras(24 * 12), status: 'EM_COTACAO' }),
        lote({ id: 'b', abertoEm: horasAtras(24 * 12), status: 'ENCERRADO' }),
      ],
      extras,
      AGORA,
    );
    expect(k.agingAcimaDe10Dias).toBe(1);
  });

  it('repassa savings e pedidos sem NF-e', () => {
    const k = calcularKpis([], extras, AGORA);
    expect(k.savingsDoMes).toBe('1234.56');
    expect(k.pedidosSemNotaFiscal).toBe(2);
  });
});
