import { describe, expect, it } from 'vitest';
import {
  abastecerTanque,
  apurarAfericao,
  conferirEncerrante,
  consolidarConsumo,
  ehEntradaNoTanque,
  retirarDoTanque,
  turnoDe,
  valorNoTanque,
} from './tanque.js';
import { Decimal } from '../../core/money.js';

const posicao = (saldo: string, custo: string) => ({
  saldoLitros: new Decimal(saldo),
  custoMedio: new Decimal(custo),
});

describe('entrada no tanque', () => {
  it('recalcula o custo medio ponderado movel', () => {
    // 1.000 L a 6,00 + 1.000 L a 6,40 = 2.000 L a 6,20
    const nova = abastecerTanque(posicao('1000', '6.00'), '1000', '6.40', '10000');
    expect(nova.saldoLitros.toFixed(3)).toBe('2000.000');
    expect(nova.custoMedio.toFixed(4)).toBe('6.2000');
  });

  it('tanque zerado assume o custo da entrada, sem media', () => {
    const nova = abastecerTanque(posicao('0', '0'), '5000', '6.15', '10000');
    expect(nova.custoMedio.toFixed(4)).toBe('6.1500');
  });

  it('recusa entrada acima da capacidade, dizendo os numeros', () => {
    expect(() => abastecerTanque(posicao('9000', '6.00'), '2000', '6.00', '10000')).toThrow(
      /acima da capacidade/i,
    );
  });

  it('recusa litro zerado e custo negativo', () => {
    expect(() => abastecerTanque(posicao('0', '0'), '0', '6.00', '10000')).toThrow(RangeError);
    expect(() => abastecerTanque(posicao('0', '0'), '100', '-1', '10000')).toThrow(RangeError);
  });

  it('sem capacidade declarada, nao trava a entrada', () => {
    const nova = abastecerTanque(posicao('100', '6.00'), '900', '6.00', '0');
    expect(nova.saldoLitros.toFixed(3)).toBe('1000.000');
  });
});

describe('saida do tanque', () => {
  it('consome pelo custo medio, sem altera-lo', () => {
    const nova = retirarDoTanque(posicao('2000', '6.20'), '150');
    expect(nova.saldoLitros.toFixed(3)).toBe('1850.000');
    expect(nova.custoMedio.toFixed(4)).toBe('6.2000');
  });

  it('nunca deixa o tanque negativo', () => {
    expect(() => retirarDoTanque(posicao('100', '6.00'), '150')).toThrow(/saldo insuficiente/i);
  });

  it('valoriza o que esta parado no tanque', () => {
    expect(valorNoTanque(posicao('1850', '6.20')).toFixed(2)).toBe('11470.00');
  });

  it('classifica entrada e saida pelo tipo', () => {
    expect(ehEntradaNoTanque('ENTRADA_COMPRA')).toBe(true);
    expect(ehEntradaNoTanque('SAIDA_ABASTECIMENTO')).toBe(false);
  });
});

describe('afericao do tanque', () => {
  it('perda pequena fica dentro da tolerancia de evaporacao', () => {
    // 5.000 no sistema, 4.990 medidos = -0,2%
    const a = apurarAfericao('5000', '4990', '6.20', 0.005);
    expect(a.resultado).toBe('PERDA');
    expect(a.dentroDaTolerancia).toBe(true);
    expect(a.exigeJustificativa).toBe(false);
    expect(a.mensagem).toMatch(/dentro da tolerancia/i);
  });

  it('perda acima da tolerancia exige justificativa', () => {
    // 5.000 no sistema, 4.850 medidos = -3%
    const a = apurarAfericao('5000', '4850', '6.20', 0.005);
    expect(a.dentroDaTolerancia).toBe(false);
    expect(a.exigeJustificativa).toBe(true);
    expect(a.impactoFinanceiro).toBe('-930.00');
    expect(a.mensagem).toMatch(/exige justificativa/i);
  });

  it('sobra tambem e divergencia, nao boa noticia', () => {
    const a = apurarAfericao('5000', '5200', '6.20', 0.005);
    expect(a.resultado).toBe('SOBRA');
    expect(a.dentroDaTolerancia).toBe(false);
    expect(Number(a.impactoFinanceiro)).toBeGreaterThan(0);
  });

  it('medicao igual ao sistema e conforme', () => {
    const a = apurarAfericao('5000', '5000', '6.20', 0.005);
    expect(a.resultado).toBe('CONFORME');
    expect(a.percentual).toBe(0);
  });

  it('tanque vazio no sistema nao divide por zero', () => {
    expect(apurarAfericao('0', '0', '6.20', 0.005).percentual).toBe(0);
    expect(apurarAfericao('0', '50', '6.20', 0.005).percentual).toBe(1);
  });

  it('recusa saldo medido negativo e tolerancia negativa', () => {
    expect(() => apurarAfericao('100', '-1', '6', 0.005)).toThrow(RangeError);
    expect(() => apurarAfericao('100', '100', '6', -1)).toThrow(RangeError);
  });
});

describe('encerrante da bomba', () => {
  it('confere o volume digitado com o que a bomba registrou', () => {
    const c = conferirEncerrante('120450.000', '120600.000', '150');
    expect(c.confere).toBe(true);
    expect(c.litrosPeloEncerrante).toBe('150.000');
  });

  it('acusa diferenca acima da tolerancia', () => {
    const c = conferirEncerrante('120450.000', '120600.000', '180');
    expect(c.confere).toBe(false);
    expect(c.diferenca).toBe('30.000');
    expect(c.mensagem).toMatch(/a bomba registrou/i);
  });

  it('aceita a folga de meio litro do arredondamento da bomba', () => {
    expect(conferirEncerrante('1000', '1150', '150.4').confere).toBe(true);
  });

  it('recusa encerrante que retrocedeu', () => {
    expect(() => conferirEncerrante('120600', '120450', '150')).toThrow(/nao retrocede/i);
  });
});

describe('turno da operacao', () => {
  it('classifica manha, tarde e noite', () => {
    expect(turnoDe(new Date('2026-08-04T11:00:00Z'))).toBe('Manha');
    expect(turnoDe(new Date('2026-08-04T18:00:00Z'))).toBe('Tarde');
    expect(turnoDe(new Date('2026-08-04T02:00:00Z'))).toBe('Noite');
  });

  it('o turno da noite atravessa a meia-noite', () => {
    // 23h e 03h locais caem no mesmo turno
    expect(turnoDe(new Date('2026-08-05T02:00:00Z'))).toBe('Noite');
    expect(turnoDe(new Date('2026-08-04T06:00:00Z'))).toBe('Noite');
  });
});

describe('consolidacao de consumo', () => {
  const itens = [
    { chave: 'v1', rotulo: 'Truck 01', litros: '100', kmPercorridos: '300', valorTotal: '620.00' },
    { chave: 'v1', rotulo: 'Truck 01', litros: '100', kmPercorridos: '260', valorTotal: '620.00' },
    { chave: 'v2', rotulo: 'Carreta 02', litros: '400', kmPercorridos: '1600', valorTotal: '2480.00' },
    { chave: 'v3', rotulo: 'Novo 03', litros: '50', kmPercorridos: null, valorTotal: '310.00' },
  ];

  it('soma litros e km antes de dividir', () => {
    const r = consolidarConsumo(itens);
    const truck = r.find((x) => x.chave === 'v1')!;
    // 560 km / 200 L = 2,8 km/L
    expect(truck.consumoMedioKml).toBe('2.800');
    expect(truck.abastecimentos).toBe(2);
  });

  it('coloca o pior consumo primeiro', () => {
    const r = consolidarConsumo(itens);
    expect(r[0]?.chave).toBe('v1');
    expect(r.find((x) => x.chave === 'v2')?.consumoMedioKml).toBe('4.000');
  });

  it('sem quilometragem apurada, o consumo e nulo e vai para o fim', () => {
    const r = consolidarConsumo(itens);
    expect(r[r.length - 1]?.chave).toBe('v3');
    expect(r[r.length - 1]?.consumoMedioKml).toBeNull();
    // mas o custo por litro continua apurado
    expect(r[r.length - 1]?.custoPorLitro).toBe('6.2000');
  });

  it('lista vazia nao quebra', () => {
    expect(consolidarConsumo([])).toEqual([]);
  });
});
