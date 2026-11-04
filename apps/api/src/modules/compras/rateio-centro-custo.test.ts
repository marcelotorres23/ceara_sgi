import { describe, expect, it } from 'vitest';
import { agruparPorMes, consumoDoOrcamento, ratearLote, type PesoDeSolicitacao } from './rateio-centro-custo.js';

const peso = (centroCustoId: string, peso: number, solicitacaoId = `s-${centroCustoId}-${peso}`): PesoDeSolicitacao => ({
  solicitacaoId,
  centroCustoId,
  peso,
});

describe('rateio do lote entre centros de custo', () => {
  it('lote de uma placa so vai inteiro para ela, sem marca de rateio', () => {
    const parcelas = ratearLote('12500.00', [peso('cc-abc1234', 3), peso('cc-abc1234', 1)]);
    expect(parcelas).toHaveLength(1);
    expect(parcelas[0]!.valor.toFixed(2)).toBe('12500.00');
    expect(parcelas[0]!.rateado).toBe(false);
  });

  it('lote misto divide pelo peso de cada solicitacao e marca como rateado', () => {
    const parcelas = ratearLote('1000.00', [peso('cc-a', 3), peso('cc-b', 1)]);
    const porCentro = new Map(parcelas.map((p) => [p.centroCustoId, p.valor.toFixed(2)]));
    expect(porCentro.get('cc-a')).toBe('750.00');
    expect(porCentro.get('cc-b')).toBe('250.00');
    expect(parcelas.every((p) => p.rateado)).toBe(true);
  });

  it('soma das parcelas fecha com o total mesmo com divisao inexata', () => {
    const parcelas = ratearLote('100.00', [peso('cc-a', 1), peso('cc-b', 1), peso('cc-c', 1)]);
    const soma = parcelas.reduce((acc, p) => acc.plus(p.valor), parcelas[0]!.valor.times(0));
    expect(soma.toFixed(2)).toBe('100.00');
  });

  it('sem peso util divide em partes iguais em vez de zerar o historico', () => {
    const parcelas = ratearLote('90.00', [peso('cc-a', 0), peso('cc-b', 0), peso('cc-c', 0)]);
    expect(parcelas.map((p) => p.valor.toFixed(2))).toEqual(['30.00', '30.00', '30.00']);
  });

  it('lote sem solicitacao nao gera parcela', () => {
    expect(ratearLote('500.00', [])).toEqual([]);
  });
});

describe('serie mensal do centro', () => {
  it('agrupa por competencia e ordena da mais antiga para a mais recente', () => {
    const serie = agruparPorMes([
      { data: new Date('2026-03-10T12:00:00Z'), valor: '100.00' },
      { data: new Date('2026-01-05T12:00:00Z'), valor: '50.00' },
      { data: new Date('2026-03-28T12:00:00Z'), valor: '25.50' },
    ]);
    expect(serie.map((m) => m.mes)).toEqual(['2026-01', '2026-03']);
    expect(serie[1]!.valor.toFixed(2)).toBe('125.50');
    expect(serie[1]!.pedidos).toBe(2);
  });
});

describe('consumo do orcamento mensal', () => {
  it('sem orcamento cadastrado nao apura percentual', () => {
    expect(consumoDoOrcamento('900.00', null).percentual).toBeNull();
  });

  it('orcamento zerado tambem nao vira base de divisao', () => {
    expect(consumoDoOrcamento('900.00', '0').percentual).toBeNull();
  });

  it('acusa estouro quando o gasto do mes passa do orcamento', () => {
    const r = consumoDoOrcamento('12000.00', '10000.00');
    expect(r.percentual).toBeCloseTo(1.2, 4);
    expect(r.estourou).toBe(true);
  });

  it('dentro do orcamento nao acusa estouro', () => {
    const r = consumoDoOrcamento('4000.00', '10000.00');
    expect(r.percentual).toBeCloseTo(0.4, 4);
    expect(r.estourou).toBe(false);
  });
});
