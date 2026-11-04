import { describe, expect, it } from 'vitest';
import {
  apurarAbastecimento,
  consumoMedioHistorico,
  custoPorKmDoPeriodo,
  type ContextoVeiculo,
  type NovoAbastecimento,
} from './abastecimento.js';

const PARAMETROS = { desvioTolerado: '0.15', janelaMinimaHoras: 2 };

const em = (iso: string): Date => new Date(`${iso}-03:00`);

const novo = (over: Partial<NovoAbastecimento> = {}): NovoAbastecimento => ({
  dataHora: em('2026-08-10T09:00'),
  litros: '100',
  valorUnitario: '6.00',
  hodometro: '10300',
  ...over,
});

const contexto = (over: Partial<ContextoVeiculo> = {}): ContextoVeiculo => ({
  capacidadeTanque: '400',
  consumoMedioHistorico: '3.000',
  anterior: { dataHora: em('2026-08-08T09:00'), hodometro: '10000' },
  ...over,
});

describe('calculo do abastecimento', () => {
  it('valor total e litros x preco unitario', () => {
    expect(apurarAbastecimento(novo(), contexto(), PARAMETROS).valorTotal.toFixed(2)).toBe('600.00');
  });

  it('km percorridos vem da diferenca de hodometro', () => {
    expect(apurarAbastecimento(novo(), contexto(), PARAMETROS).kmPercorridos?.toFixed(1)).toBe('300.0');
  });

  it('consumo do intervalo em km/L', () => {
    expect(apurarAbastecimento(novo(), contexto(), PARAMETROS).consumoKml?.toFixed(3)).toBe('3.000');
  });

  it('custo por km e o total dividido pela distancia', () => {
    expect(apurarAbastecimento(novo(), contexto(), PARAMETROS).custoPorKm?.toFixed(4)).toBe('2.0000');
  });

  it('primeiro abastecimento do veiculo nao calcula consumo', () => {
    const r = apurarAbastecimento(novo(), contexto({ anterior: null }), PARAMETROS);
    expect(r.kmPercorridos).toBeNull();
    expect(r.consumoKml).toBeNull();
    expect(r.desvioPercentual).toBeNull();
    expect(r.anomalia).toBe(false);
  });

  it('recusa litragem zero ou negativa', () => {
    expect(() => apurarAbastecimento(novo({ litros: '0' }), contexto(), PARAMETROS)).toThrow(RangeError);
  });

  it('recusa hodometro negativo', () => {
    expect(() => apurarAbastecimento(novo({ hodometro: '-1' }), contexto(), PARAMETROS)).toThrow(RangeError);
  });
});

describe('anomalia de consumo', () => {
  it('consumo dentro da tolerancia nao e anomalia', () => {
    // 330 km / 100 L = 3.3 km/L, 10% acima da media de 3.0
    const r = apurarAbastecimento(novo({ hodometro: '10330' }), contexto(), PARAMETROS);
    expect(r.anomalia).toBe(false);
    expect(r.desvioPercentual?.times(100).toFixed(1)).toBe('10.0');
  });

  it('consumo 20% abaixo da media e anomalia', () => {
    // 240 km / 100 L = 2.4 km/L, 20% abaixo de 3.0
    const r = apurarAbastecimento(novo({ hodometro: '10240' }), contexto(), PARAMETROS);
    expect(r.tipos).toContain('CONSUMO_FORA_DA_MEDIA');
    expect(r.mensagens[0]).toContain('abaixo');
  });

  it('consumo muito acima da media tambem e anomalia', () => {
    // 400 km / 100 L = 4.0 km/L, 33% acima - pode indicar hodometro adulterado
    const r = apurarAbastecimento(novo({ hodometro: '10400' }), contexto(), PARAMETROS);
    expect(r.tipos).toContain('CONSUMO_FORA_DA_MEDIA');
    expect(r.mensagens[0]).toContain('acima');
  });

  it('exatamente no limite da tolerancia nao dispara', () => {
    // 345 km / 100 = 3.45, exatamente 15% acima
    const r = apurarAbastecimento(novo({ hodometro: '10345' }), contexto(), PARAMETROS);
    expect(r.tipos).not.toContain('CONSUMO_FORA_DA_MEDIA');
  });

  it('veiculo sem media historica nao gera anomalia de consumo', () => {
    const r = apurarAbastecimento(novo({ hodometro: '10100' }), contexto({ consumoMedioHistorico: null }), PARAMETROS);
    expect(r.tipos).not.toContain('CONSUMO_FORA_DA_MEDIA');
    expect(r.consumoKml?.toFixed(3)).toBe('1.000');
  });
});

describe('demais anomalias', () => {
  it('litragem acima da capacidade do tanque', () => {
    const r = apurarAbastecimento(novo({ litros: '450' }), contexto(), PARAMETROS);
    expect(r.tipos).toContain('LITRAGEM_ACIMA_DO_TANQUE');
  });

  it('litragem igual a capacidade nao e anomalia', () => {
    const r = apurarAbastecimento(novo({ litros: '400', hodometro: '11200' }), contexto(), PARAMETROS);
    expect(r.tipos).not.toContain('LITRAGEM_ACIMA_DO_TANQUE');
  });

  it('veiculo sem capacidade cadastrada nao dispara a regra', () => {
    const r = apurarAbastecimento(novo({ litros: '9999' }), contexto({ capacidadeTanque: null }), PARAMETROS);
    expect(r.tipos).not.toContain('LITRAGEM_ACIMA_DO_TANQUE');
  });

  it('hodometro menor que o anterior e anomalia e exige justificativa', () => {
    const r = apurarAbastecimento(novo({ hodometro: '9500' }), contexto(), PARAMETROS);
    expect(r.tipos).toContain('HODOMETRO_RETROCEDEU');
    expect(r.exigeJustificativa).toBe(true);
    expect(r.kmPercorridos).toBeNull();
  });

  it('dois abastecimentos em menos de 2h', () => {
    const r = apurarAbastecimento(
      novo({ dataHora: em('2026-08-08T10:30') }),
      contexto({ anterior: { dataHora: em('2026-08-08T09:00'), hodometro: '10000' } }),
      PARAMETROS,
    );
    expect(r.tipos).toContain('ABASTECIMENTOS_MUITO_PROXIMOS');
  });

  it('intervalo acima da janela nao dispara', () => {
    const r = apurarAbastecimento(
      novo({ dataHora: em('2026-08-08T12:00') }),
      contexto({ anterior: { dataHora: em('2026-08-08T09:00'), hodometro: '10000' } }),
      PARAMETROS,
    );
    expect(r.tipos).not.toContain('ABASTECIMENTOS_MUITO_PROXIMOS');
  });

  it('acumula multiplas anomalias no mesmo registro', () => {
    const r = apurarAbastecimento(
      novo({ litros: '500', hodometro: '9000', dataHora: em('2026-08-08T09:30') }),
      contexto(),
      PARAMETROS,
    );
    expect(r.tipos).toHaveLength(3);
    expect(r.anomalia).toBe(true);
  });
});

describe('media historica', () => {
  it('media dos consumos apurados', () => {
    expect(consumoMedioHistorico(['3.0', '3.5', '2.5'])?.toFixed(3)).toBe('3.000');
  });

  it('ignora registros sem consumo', () => {
    expect(consumoMedioHistorico(['3.0', null, '3.0'])?.toFixed(3)).toBe('3.000');
  });

  it('sem base retorna null', () => {
    expect(consumoMedioHistorico([null, null])).toBeNull();
  });

  it('descarta consumo zero', () => {
    expect(consumoMedioHistorico(['0', '4.0'])?.toFixed(3)).toBe('4.000');
  });
});

describe('custo por km do periodo', () => {
  it('soma gasto e distancia do periodo', () => {
    const r = custoPorKmDoPeriodo([
      { valorTotal: '600.00', kmPercorridos: '300' },
      { valorTotal: '400.00', kmPercorridos: '200' },
    ]);
    expect(r.totalGasto.toFixed(2)).toBe('1000.00');
    expect(r.kmTotal.toFixed(0)).toBe('500');
    expect(r.custoPorKm?.toFixed(4)).toBe('2.0000');
  });

  it('sem distancia nao ha custo por km', () => {
    const r = custoPorKmDoPeriodo([{ valorTotal: '600.00', kmPercorridos: null }]);
    expect(r.custoPorKm).toBeNull();
    expect(r.totalGasto.toFixed(2)).toBe('600.00');
  });
});
