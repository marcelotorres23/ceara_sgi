import { describe, expect, it } from 'vitest';
import { Decimal } from '../../core/money.js';
import {
  apurarInventario,
  aplicarEntrada,
  aplicarSaida,
  classificar,
  coberturaEmDias,
  ehEntrada,
  montarPainelDeAlertas,
  sugerirPontoPedido,
  valorEmEstoque,
  type LinhaEstoque,
} from './estoque.js';

const posicao = (quantidade: string, custoMedio: string) => ({
  quantidade: new Decimal(quantidade),
  custoMedio: new Decimal(custoMedio),
});

describe('custo medio ponderado movel', () => {
  it('primeira entrada define o custo, sem media', () => {
    const r = aplicarEntrada(posicao('0', '0'), '10', '25.00');
    expect(r.quantidade.toFixed(0)).toBe('10');
    expect(r.custoMedio.toFixed(4)).toBe('25.0000');
  });

  it('pondera pela quantidade, nao pela media simples', () => {
    // 10 a 25 + 10 a 35 = 20 a 30 (media simples coincide aqui)
    const r = aplicarEntrada(posicao('10', '25.00'), '10', '35.00');
    expect(r.custoMedio.toFixed(4)).toBe('30.0000');
  });

  it('entrada pequena a preco alto move pouco a media', () => {
    // 100 a 10 + 1 a 110 = (1000 + 110) / 101 = 10.99
    const r = aplicarEntrada(posicao('100', '10.00'), '1', '110.00');
    expect(r.custoMedio.toFixed(4)).toBe('10.9901');
    expect(r.quantidade.toFixed(0)).toBe('101');
  });

  it('saldo zerado recomeca a media pelo custo da entrada', () => {
    const r = aplicarEntrada(posicao('0', '999.00'), '5', '12.00');
    expect(r.custoMedio.toFixed(4)).toBe('12.0000');
  });

  it('saida nao altera o custo medio', () => {
    const r = aplicarSaida(posicao('20', '30.00'), '5');
    expect(r.quantidade.toFixed(0)).toBe('15');
    expect(r.custoMedio.toFixed(4)).toBe('30.0000');
  });

  it('saida que zeraria abaixo de zero e rejeitada', () => {
    expect(() => aplicarSaida(posicao('5', '10.00'), '6')).toThrow(RangeError);
  });

  it('saida do saldo exato e permitida', () => {
    expect(aplicarSaida(posicao('5', '10.00'), '5').quantidade.toFixed(0)).toBe('0');
  });

  it('recusa entrada com quantidade zero ou negativa', () => {
    expect(() => aplicarEntrada(posicao('1', '1'), '0', '10')).toThrow(RangeError);
    expect(() => aplicarEntrada(posicao('1', '1'), '-1', '10')).toThrow(RangeError);
  });

  it('recusa custo negativo', () => {
    expect(() => aplicarEntrada(posicao('1', '1'), '1', '-5')).toThrow(RangeError);
  });

  it('valor em estoque e saldo x custo medio', () => {
    expect(valorEmEstoque(posicao('12.5', '8.40')).toFixed(2)).toBe('105.00');
  });

  it('classifica entrada e saida pelo prefixo do tipo', () => {
    expect(ehEntrada('ENTRADA_COMPRA')).toBe(true);
    expect(ehEntrada('SAIDA_REQUISICAO')).toBe(false);
  });

  it('sequencia real de movimentacoes mantem o valor coerente', () => {
    let p = aplicarEntrada(posicao('0', '0'), '100', '10.00');
    p = aplicarSaida(p, '30');
    p = aplicarEntrada(p, '50', '16.00');
    // (70 x 10 + 50 x 16) / 120 = 1500 / 120 = 12.50
    expect(p.custoMedio.toFixed(4)).toBe('12.5000');
    expect(valorEmEstoque(p).toFixed(2)).toBe('1500.00');
  });
});

describe('ponto de pedido', () => {
  it('PP = consumo diario x lead time + estoque de seguranca', () => {
    // 300/mes = 10/dia; lead 10 dias; seguranca 30% de 10 = 3 dias
    const r = sugerirPontoPedido({ consumoMedioMensal: '300', leadTimeDias: 10 });
    expect(r.consumoMedioDiario.toFixed(4)).toBe('10.0000');
    expect(r.estoqueSeguranca.toFixed(0)).toBe('30');
    expect(r.pontoPedido.toFixed(0)).toBe('130');
  });

  it('aceita dias de seguranca informados', () => {
    const r = sugerirPontoPedido({ consumoMedioMensal: '300', leadTimeDias: 10, diasSeguranca: 0 });
    expect(r.pontoPedido.toFixed(0)).toBe('100');
  });

  it('item sem consumo tem ponto de pedido zero', () => {
    expect(sugerirPontoPedido({ consumoMedioMensal: '0', leadTimeDias: 15 }).pontoPedido.toFixed(0)).toBe('0');
  });

  it('recusa lead time negativo', () => {
    expect(() => sugerirPontoPedido({ consumoMedioMensal: '10', leadTimeDias: -1 })).toThrow(RangeError);
  });
});

describe('cobertura', () => {
  it('saldo dividido pelo consumo diario', () => {
    expect(coberturaEmDias('100', '300')).toBe(10);
  });

  it('item sem consumo nao tem cobertura calculavel', () => {
    expect(coberturaEmDias('100', '0')).toBeNull();
  });

  it('saldo zero da cobertura zero', () => {
    expect(coberturaEmDias('0', '300')).toBe(0);
  });
});

describe('semaforo do painel de alertas', () => {
  const linha = (over: Partial<LinhaEstoque> = {}): LinhaEstoque => ({
    itemId: 'i1',
    codigo: 'PN-0001',
    descricao: 'Pneu 275/80',
    almoxarifado: 'ALM-01 — Central',
    critico: false,
    saldo: '100',
    custoMedio: '10.00',
    estoqueMinimo: '20',
    estoqueMaximo: '200',
    pontoPedido: '50',
    loteEconomico: '80',
    leadTimeDias: 7,
    consumoMedioMensal: '300',
    ultimaMovimentacaoEm: new Date('2026-08-01T10:00:00-03:00'),
    ...over,
  });

  const AGORA = new Date('2026-08-10T10:00:00-03:00');

  it('item critico zerado e RUPTURA vermelha', () => {
    const a = classificar(linha({ saldo: '0', critico: true }), 180, AGORA);
    expect(a.nivel).toBe('RUPTURA');
    expect(a.semaforo).toBe('vermelho');
  });

  it('item nao critico zerado cai em abaixo do minimo', () => {
    expect(classificar(linha({ saldo: '0', critico: false }), 180, AGORA).nivel).toBe('ABAIXO_DO_MINIMO');
  });

  it('saldo abaixo do minimo e vermelho', () => {
    const a = classificar(linha({ saldo: '15' }), 180, AGORA);
    expect(a.nivel).toBe('ABAIXO_DO_MINIMO');
    expect(a.mensagem).toContain('abaixo do minimo');
  });

  it('numeros da mensagem saem em pt-BR, com virgula decimal', () => {
    // "30.00" seria lido como trinta mil por quem usa virgula decimal
    const a = classificar(linha({ saldo: '1234.5', estoqueMinimo: '2000' }), 180, AGORA);
    expect(a.mensagem).toContain('1.234,50');
    expect(a.mensagem).toContain('2.000,00');
  });

  it('identifica de qual almoxarifado e o saldo', () => {
    expect(classificar(linha(), 180, AGORA).almoxarifado).toBe('ALM-01 — Central');
  });

  it('saldo no ponto de pedido e amarelo', () => {
    const a = classificar(linha({ saldo: '50' }), 180, AGORA);
    expect(a.nivel).toBe('NO_PONTO_DE_PEDIDO');
    expect(a.semaforo).toBe('amarelo');
  });

  it('cobertura menor que o lead time e amarelo', () => {
    // saldo 60 com consumo 300/mes = 6 dias, lead time 7
    const a = classificar(linha({ saldo: '60', pontoPedido: '10' }), 180, AGORA);
    expect(a.nivel).toBe('COBERTURA_BAIXA');
    expect(a.cobertura).toBe(6);
  });

  it('saldo acima do maximo e excesso azul', () => {
    const a = classificar(linha({ saldo: '250' }), 180, AGORA);
    expect(a.nivel).toBe('EXCESSO');
    expect(a.semaforo).toBe('azul');
  });

  it('sem movimentacao ha mais de 180 dias e sem giro', () => {
    const a = classificar(
      linha({ saldo: '150', consumoMedioMensal: '0', ultimaMovimentacaoEm: new Date('2025-01-01T10:00:00-03:00') }),
      180,
      AGORA,
    );
    expect(a.nivel).toBe('SEM_GIRO');
    expect(a.semaforo).toBe('preto');
  });

  it('linha saudavel fica verde', () => {
    const a = classificar(linha({ saldo: '150', consumoMedioMensal: '150' }), 180, AGORA);
    expect(a.nivel).toBe('NORMAL');
    expect(a.semaforo).toBe('verde');
  });

  it('sugere o lote economico quando precisa repor', () => {
    expect(classificar(linha({ saldo: '10' }), 180, AGORA).quantidadeSugerida).toBe('80.0000');
  });

  it('sem lote economico sugere o que falta ate o maximo', () => {
    const a = classificar(linha({ saldo: '10', loteEconomico: null }), 180, AGORA);
    expect(a.quantidadeSugerida).toBe('190.0000');
  });

  it('linha normal nao sugere reposicao', () => {
    expect(classificar(linha({ saldo: '150', consumoMedioMensal: '150' }), 180, AGORA).quantidadeSugerida).toBe('0.0000');
  });

  it('calcula o valor imobilizado', () => {
    expect(classificar(linha({ saldo: '100', custoMedio: '12.50' }), 180, AGORA).valorImobilizado).toBe('1250.00');
  });

  it('painel ordena por gravidade e resume', () => {
    const { alertas, resumo } = montarPainelDeAlertas(
      [
        linha({ itemId: 'ok', saldo: '150', consumoMedioMensal: '150' }),
        linha({ itemId: 'ruptura', saldo: '0', critico: true }),
        linha({ itemId: 'pedido', saldo: '50' }),
      ],
      180,
      AGORA,
    );
    expect(alertas.map((a) => a.itemId)).toEqual(['ruptura', 'pedido', 'ok']);
    expect(resumo.RUPTURA).toBe(1);
    expect(resumo.NORMAL).toBe(1);
  });
});

describe('acuracidade de inventario', () => {
  it('todos corretos da 100%', () => {
    const r = apurarInventario([
      { itemId: 'a', saldoSistema: '10', saldoContado: '10', custoMedio: '5' },
      { itemId: 'b', saldoSistema: '20', saldoContado: '20', custoMedio: '5' },
    ]);
    expect(r.acuracidade.toFixed(2)).toBe('1.00');
    expect(r.atingiuMeta).toBe(true);
    expect(r.divergencias).toHaveLength(0);
  });

  it('um errado em quatro da 75% e nao atinge a meta', () => {
    const r = apurarInventario([
      { itemId: 'a', saldoSistema: '10', saldoContado: '10', custoMedio: '5' },
      { itemId: 'b', saldoSistema: '10', saldoContado: '10', custoMedio: '5' },
      { itemId: 'c', saldoSistema: '10', saldoContado: '10', custoMedio: '5' },
      { itemId: 'd', saldoSistema: '10', saldoContado: '8', custoMedio: '5' },
    ]);
    expect(r.acuracidade.toFixed(2)).toBe('0.75');
    expect(r.atingiuMeta).toBe(false);
  });

  it('falta gera impacto financeiro negativo', () => {
    const r = apurarInventario([{ itemId: 'a', saldoSistema: '10', saldoContado: '7', custoMedio: '20' }]);
    expect(r.divergencias[0]?.divergencia.toFixed(0)).toBe('-3');
    expect(r.impactoFinanceiro.toFixed(2)).toBe('-60.00');
  });

  it('sobra gera impacto positivo', () => {
    const r = apurarInventario([{ itemId: 'a', saldoSistema: '10', saldoContado: '12', custoMedio: '20' }]);
    expect(r.impactoFinanceiro.toFixed(2)).toBe('40.00');
  });

  it('itens ainda nao contados ficam fora do calculo', () => {
    const r = apurarInventario([
      { itemId: 'a', saldoSistema: '10', saldoContado: '10', custoMedio: '5' },
      { itemId: 'b', saldoSistema: '10', saldoContado: null, custoMedio: '5' },
    ]);
    expect(r.itensContados).toBe(1);
    expect(r.acuracidade.toFixed(2)).toBe('1.00');
  });

  it('nada contado nao vira divisao por zero', () => {
    const r = apurarInventario([{ itemId: 'a', saldoSistema: '10', saldoContado: null, custoMedio: '5' }]);
    expect(r.itensContados).toBe(0);
    expect(r.acuracidade.toFixed(2)).toBe('0.00');
  });
});
