import { describe, expect, it } from 'vitest';
import {
  apurarKpisCompras,
  competenciaAnterior,
  competenciasDoAno,
  concentracaoDeFornecedores,
  curvaAbc,
  resumirEstoque,
  scorecardDeFornecedores,
  variacao,
  type LinhaKpiCompras,
} from './indicadores.js';

describe('curva ABC', () => {
  const itens = [
    { itemId: '1', codigo: 'PN-01', descricao: 'Pneu', valor: '80000.00' },
    { itemId: '2', codigo: 'FL-02', descricao: 'Filtro', valor: '15000.00' },
    { itemId: '3', codigo: 'LB-03', descricao: 'Oleo', valor: '4000.00' },
    { itemId: '4', codigo: 'PR-04', descricao: 'Parafuso', valor: '1000.00' },
  ];

  it('classifica por valor acumulado: A ate 80%, B ate 95%, C o resto', () => {
    const curva = curvaAbc(itens);
    expect(curva.itens.map((i) => `${i.codigo}:${i.curva}`)).toEqual([
      'PN-01:A',
      'FL-02:B',
      'LB-03:C',
      'PR-04:C',
    ]);
  });

  it('o item que cruza o corte ainda pertence a faixa anterior', () => {
    // o pneu sozinho ja e 80% do valor: ele fecha a faixa A, nao abre a B
    const curva = curvaAbc(itens);
    expect(curva.itens[0]?.acumulado).toBe(0.8);
    expect(curva.itens[0]?.curva).toBe('A');
  });

  it('resume valor e participacao por faixa', () => {
    const curva = curvaAbc(itens);
    expect(curva.valorTotal).toBe('100000.00');
    expect(curva.resumo.A).toEqual({ itens: 1, valor: '80000.00', participacao: 0.8 });
    expect(curva.resumo.C.itens).toBe(2);
  });

  it('universo vazio nao quebra nem inventa faixa', () => {
    expect(curvaAbc([]).itens).toEqual([]);
    expect(curvaAbc([]).valorTotal).toBe('0.00');
  });

  it('aceita cortes diferentes', () => {
    const curva = curvaAbc(itens, 0.5, 0.9);
    expect(curva.itens[1]?.curva).toBe('B');
  });
});

describe('concentracao de fornecedores', () => {
  it('acusa fonte unica', () => {
    const c = concentracaoDeFornecedores([{ fornecedorId: 'a', fornecedor: 'Unica', valor: '50000' }]);
    expect(c.risco).toBe('FONTE_UNICA');
    expect(c.maiorParticipacao).toBe(1);
    expect(c.hhi).toBe(1);
  });

  it('distingue carteiras com o mesmo lider e riscos diferentes', () => {
    const equilibrada = concentracaoDeFornecedores([
      { fornecedorId: 'a', fornecedor: 'A', valor: '40' },
      { fornecedorId: 'b', fornecedor: 'B', valor: '30' },
      { fornecedorId: 'c', fornecedor: 'C', valor: '30' },
    ]);
    const pulverizada = concentracaoDeFornecedores([
      { fornecedorId: 'a', fornecedor: 'A', valor: '40' },
      ...Array.from({ length: 30 }, (_, i) => ({ fornecedorId: `f${i}`, fornecedor: `F${i}`, valor: '2' })),
    ]);

    expect(equilibrada.maiorParticipacao).toBe(0.4);
    expect(pulverizada.maiorParticipacao).toBe(0.4);
    // o mesmo lider, mas o HHI separa os dois casos
    expect(equilibrada.hhi).toBeGreaterThan(pulverizada.hhi!);
    expect(equilibrada.risco).toBe('ALTA');
  });

  it('ordena o ranking do maior para o menor', () => {
    const c = concentracaoDeFornecedores([
      { fornecedorId: 'a', fornecedor: 'Pequeno', valor: '10' },
      { fornecedorId: 'b', fornecedor: 'Grande', valor: '90' },
    ]);
    expect(c.ranking[0]?.fornecedor).toBe('Grande');
    expect(c.ranking[0]?.participacao).toBe(0.9);
  });

  it('sem gasto no periodo devolve null, nao zero', () => {
    const c = concentracaoDeFornecedores([]);
    expect(c.hhi).toBeNull();
    expect(c.risco).toBeNull();
  });
});

describe('KPIs de compras', () => {
  const base: LinhaKpiCompras = {
    competencia: '2026-07',
    lotes: 20,
    lotesEncerrados: 15,
    lotesCancelados: 1,
    lotesEmergenciais: 1,
    lotesComTresPropostas: 12,
    lotesAcimaDeMil: 12,
    lotesNoSla: 18,
    lotesComSla: 20,
    leadTimeAteAprovacaoDias: 4.2,
    savings: '6000.00',
    valorNegociado: '100000.00',
  };

  it('apura aderencia ao SLA contra a meta de 90%', () => {
    const kpis = apurarKpisCompras(base);
    expect(kpis.aderenciaSla.valor).toBe(0.9);
    expect(kpis.aderenciaSla.dentroDaMeta).toBe(true);
  });

  it('na taxa de emergencial, menor e melhor', () => {
    const kpis = apurarKpisCompras({ ...base, lotesEmergenciais: 5 });
    expect(kpis.taxaEmergencial.valor).toBe(0.25);
    expect(kpis.taxaEmergencial.dentroDaMeta).toBe(false);
  });

  it('savings sobre o valor negociado, meta de 5%', () => {
    const kpis = apurarKpisCompras(base);
    expect(kpis.savings.valor).toBe(0.06);
    expect(kpis.savings.dentroDaMeta).toBe(true);
  });

  it('competencia sem lote devolve null em vez de zero', () => {
    const kpis = apurarKpisCompras({
      ...base,
      lotes: 0,
      lotesComSla: 0,
      lotesAcimaDeMil: 0,
      lotesEmergenciais: 0,
      lotesCancelados: 0,
      lotesComTresPropostas: 0,
      leadTimeAteAprovacaoDias: null,
      savings: '0',
      valorNegociado: '0',
    });
    expect(kpis.aderenciaSla.valor).toBeNull();
    expect(kpis.aderenciaSla.dentroDaMeta).toBeNull();
    expect(kpis.savings.valor).toBeNull();
  });

  it('taxa de cancelamento e monitoramento, sem meta', () => {
    const kpis = apurarKpisCompras(base);
    expect(kpis.taxaCancelamento.valor).toBe(0.05);
    expect(kpis.taxaCancelamento.meta).toBeNull();
  });
});

describe('scorecard de fornecedores', () => {
  const linhas = [
    { fornecedorId: 'a', fornecedor: 'Pontual', pedidos: 10, entregues: 10, otif: 9, comDivergencia: 1 },
    { fornecedorId: 'b', fornecedor: 'Atrasado', pedidos: 10, entregues: 8, otif: 4, comDivergencia: 3 },
    { fornecedorId: 'c', fornecedor: 'Novo', pedidos: 0, entregues: 0, otif: 0, comDivergencia: 0 },
  ];

  it('coloca o pior OTIF primeiro', () => {
    const { itens } = scorecardDeFornecedores(linhas);
    expect(itens[0]?.fornecedor).toBe('Atrasado');
    expect(itens[0]?.otifPercentual).toBe(0.4);
  });

  it('fornecedor sem pedido nao encabeca o risco', () => {
    const { itens } = scorecardDeFornecedores(linhas);
    expect(itens[itens.length - 1]?.fornecedor).toBe('Novo');
    expect(itens[itens.length - 1]?.otifPercentual).toBeNull();
  });

  it('consolida OTIF e divergencia da carteira', () => {
    const { consolidado } = scorecardDeFornecedores(linhas);
    expect(consolidado.pedidos).toBe(20);
    expect(consolidado.otifPercentual).toBe(0.65);
    expect(consolidado.indiceDivergencia).toBe(0.2);
  });

  it('conta pedidos ainda nao entregues', () => {
    const { itens } = scorecardDeFornecedores(linhas);
    expect(itens.find((i) => i.fornecedor === 'Atrasado')?.pendentes).toBe(2);
  });
});

describe('comparativos', () => {
  it('calcula variacao percentual mes a mes', () => {
    const v = variacao('120000', '100000');
    expect(v.percentual).toBe(0.2);
    expect(v.sentido).toBe('ALTA');
  });

  it('base zero nao vira aumento de 100%', () => {
    const v = variacao('5000', '0');
    expect(v.percentual).toBeNull();
    expect(v.sentido).toBe('ALTA');
    expect(v.diferenca).toBe('5000.00');
  });

  it('reconhece queda e estabilidade', () => {
    expect(variacao('80', '100').sentido).toBe('QUEDA');
    expect(variacao('100', '100').sentido).toBe('ESTAVEL');
  });

  it('navega entre competencias, inclusive na virada do ano', () => {
    expect(competenciaAnterior('2026-08')).toBe('2026-07');
    expect(competenciaAnterior('2026-01')).toBe('2025-12');
    expect(() => competenciaAnterior('agosto')).toThrow(RangeError);
  });

  it('monta o acumulado do ano ate a competencia', () => {
    expect(competenciasDoAno('2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('resumo de estoque', () => {
  const linhas = [
    { itemId: '1', codigo: 'A', descricao: 'Gira', valor: '10000', diasSemGiro: 10 },
    { itemId: '2', codigo: 'B', descricao: 'Parado', valor: '4000', diasSemGiro: 200 },
    { itemId: '3', codigo: 'C', descricao: 'Nunca movimentado', valor: '1000', diasSemGiro: null },
  ];

  it('separa o capital parado do valor total', () => {
    const r = resumirEstoque(linhas, 180);
    expect(r.valorTotal).toBe('15000.00');
    expect(r.valorSemGiro).toBe('4000.00');
    expect(r.percentualSemGiro).toBeCloseTo(0.2667, 4);
    expect(r.itensSemGiro).toBe(1);
  });

  it('estoque vazio nao divide por zero', () => {
    expect(resumirEstoque([], 180).percentualSemGiro).toBeNull();
  });
});
