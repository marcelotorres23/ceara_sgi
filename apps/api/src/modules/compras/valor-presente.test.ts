import { describe, expect, it } from 'vitest';
import {
  calcularSavings,
  calcularValorLiquido,
  calcularValorPresente,
  ehEscolhaDivergente,
  montarRanking,
  type PropostaParaComparar,
} from './valor-presente.js';

const TAXA = '0.015'; // 1,5% ao mes

describe('valor liquido', () => {
  it('soma frete e desconta o desconto a vista', () => {
    expect(calcularValorLiquido({ cotacaoId: 'c', fornecedorNome: 'F', valorItens: '1000', freteValor: '80', descontoAvista: '30', prazoDias: 0 }).toFixed(2))
      .toBe('1050.00');
  });

  it('trata frete e desconto ausentes como zero', () => {
    expect(calcularValorLiquido({ cotacaoId: 'c', fornecedorNome: 'F', valorItens: '1000', prazoDias: 0 }).toFixed(2)).toBe('1000.00');
  });
});

describe('valor presente', () => {
  it('a vista nao sofre desconto financeiro', () => {
    expect(calcularValorPresente('1000', TAXA, 0).toFixed(2)).toBe('1000.00');
  });

  it('desconta exatamente a taxa mensal em 30 dias', () => {
    // 1000 / 1.015 = 985.2216...
    expect(calcularValorPresente('1000', TAXA, 30).toFixed(2)).toBe('985.22');
  });

  it('desconta pela raiz do fator em prazo fracionario', () => {
    // 1000 / 1.015^(45/30) = 1000 / 1.0225842 = 977.91
    expect(calcularValorPresente('1000', TAXA, 45).toFixed(2)).toBe('977.91');
  });

  it('taxa zero nao altera o valor', () => {
    expect(calcularValorPresente('1000', '0', 60).toFixed(2)).toBe('1000.00');
  });

  it('prazo maior resulta em valor presente menor', () => {
    const curto = calcularValorPresente('1000', TAXA, 30);
    const longo = calcularValorPresente('1000', TAXA, 60);
    expect(longo.lessThan(curto)).toBe(true);
  });

  it('recusa prazo negativo', () => {
    expect(() => calcularValorPresente('1000', TAXA, -1)).toThrow(RangeError);
  });

  it('recusa taxa negativa', () => {
    expect(() => calcularValorPresente('1000', '-0.01', 30)).toThrow(RangeError);
  });
});

describe('ranking do mapa de cotacao', () => {
  // A e mais barata no papel, mas paga a vista; B custa mais e paga em 60 dias.
  const propostas: PropostaParaComparar[] = [
    { cotacaoId: 'A', fornecedorNome: 'Alfa', valorItens: '10000', prazoDias: 0, prazoEntregaDias: 10 },
    { cotacaoId: 'B', fornecedorNome: 'Beta', valorItens: '10250', prazoDias: 60, prazoEntregaDias: 12 },
    { cotacaoId: 'C', fornecedorNome: 'Gama', valorItens: '10800', prazoDias: 30, prazoEntregaDias: 8 },
  ];

  it('ordena por valor presente, nao por valor de face', () => {
    const r = montarRanking(propostas, TAXA);
    // B: 10250 / 1.015^2 = 9949.60 -> vence apesar do maior valor de face
    expect(r[0]?.cotacaoId).toBe('B');
    expect(r[1]?.cotacaoId).toBe('A');
    expect(r[2]?.cotacaoId).toBe('C');
  });

  it('marca posicoes de 1 a n', () => {
    expect(montarRanking(propostas, TAXA).map((p) => p.posicao)).toEqual([1, 2, 3]);
  });

  it('calcula a diferenca percentual contra o primeiro', () => {
    const r = montarRanking(propostas, TAXA);
    expect(r[0]?.diferencaPercentual.toFixed(2)).toBe('0.00');
    expect(Number(r[1]?.diferencaPercentual)).toBeGreaterThan(0);
  });

  it('exclui cotacao recusada do ranking', () => {
    const r = montarRanking([...propostas, { cotacaoId: 'D', fornecedorNome: 'Delta', valorItens: '1', prazoDias: 0, recusada: true }], TAXA);
    expect(r.map((p) => p.cotacaoId)).not.toContain('D');
  });

  it('desempata pelo menor prazo de entrega', () => {
    const r = montarRanking(
      [
        { cotacaoId: 'X', fornecedorNome: 'X', valorItens: '1000', prazoDias: 30, prazoEntregaDias: 20 },
        { cotacaoId: 'Y', fornecedorNome: 'Y', valorItens: '1000', prazoDias: 30, prazoEntregaDias: 5 },
      ],
      TAXA,
    );
    expect(r[0]?.cotacaoId).toBe('Y');
  });

  it('ranking vazio quando todas recusaram', () => {
    expect(montarRanking([{ cotacaoId: 'A', fornecedorNome: 'A', valorItens: '10', prazoDias: 0, recusada: true }], TAXA)).toHaveLength(0);
  });
});

describe('escolha divergente do menor preco', () => {
  const avaliadas = montarRanking(
    [
      { cotacaoId: 'A', fornecedorNome: 'Alfa', valorItens: '10000', prazoDias: 0 },
      { cotacaoId: 'B', fornecedorNome: 'Beta', valorItens: '10250', prazoDias: 60 },
    ],
    TAXA,
  );

  it('escolher o menor valor de face nao e divergencia', () => {
    expect(ehEscolhaDivergente(avaliadas, 'A')).toBe(false);
  });

  it('escolher o melhor valor presente com maior face E divergencia', () => {
    // B vence no VP, mas custa mais no papel: o aprovador precisa enxergar isso
    expect(avaliadas[0]?.cotacaoId).toBe('B');
    expect(ehEscolhaDivergente(avaliadas, 'B')).toBe(true);
  });
});

describe('savings', () => {
  const avaliadas = montarRanking(
    [
      { cotacaoId: 'A', fornecedorNome: 'Alfa', valorItens: '10000', prazoDias: 0 },
      { cotacaoId: 'B', fornecedorNome: 'Beta', valorItens: '12000', prazoDias: 0 },
    ],
    TAXA,
  );

  it('e a diferenca entre a maior cotacao e a escolhida', () => {
    expect(calcularSavings(avaliadas, 'A').toFixed(2)).toBe('2000.00');
  });

  it('e zero quando a escolhida e a mais cara', () => {
    expect(calcularSavings(avaliadas, 'B').toFixed(2)).toBe('0.00');
  });

  it('e zero com proposta unica - nao ha base de comparacao', () => {
    const unica = montarRanking([{ cotacaoId: 'A', fornecedorNome: 'A', valorItens: '900', prazoDias: 0 }], TAXA);
    expect(calcularSavings(unica, 'A').toFixed(2)).toBe('0.00');
  });
});
