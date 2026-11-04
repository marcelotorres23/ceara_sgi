import { describe, expect, it } from 'vitest';
import {
  apurarCustoOs,
  avaliarPlano,
  consolidarManutencao,
  disponibilidade,
  tempoParadoHoras,
} from './manutencao.js';

const leitura = { hodometro: '312000', horimetro: '4800' };

describe('plano preventivo por km', () => {
  const plano = {
    descricao: 'Troca de oleo do motor',
    gatilhoTipo: 'KM' as const,
    gatilhoValor: '20000',
    antecedencia: '1500',
    ultimoValor: '300000',
  };

  it('calcula o proximo vencimento a partir da ultima execucao', () => {
    const r = avaliarPlano(plano, leitura);
    expect(r.proximoValor).toBe('320000.0');
    expect(r.faltam).toBe(8000);
    expect(r.situacao).toBe('EM_DIA');
  });

  it('entra em alerta dentro da antecedencia configurada', () => {
    const r = avaliarPlano(plano, { hodometro: '319000' });
    expect(r.faltam).toBe(1000);
    expect(r.situacao).toBe('EM_ALERTA');
    expect(r.mensagem).toMatch(/faltam 1000 km/);
  });

  it('acusa vencido quando o veiculo passou do ponto', () => {
    const r = avaliarPlano(plano, { hodometro: '323500' });
    expect(r.situacao).toBe('VENCIDO');
    expect(r.mensagem).toMatch(/vencida ha 3500 km/);
  });

  it('plano sem execucao anterior conta da leitura atual', () => {
    const r = avaliarPlano({ ...plano, ultimoValor: null }, leitura);
    expect(r.proximoValor).toBe('332000.0');
    expect(r.situacao).toBe('EM_DIA');
  });

  it('recusa intervalo zerado', () => {
    expect(() => avaliarPlano({ ...plano, gatilhoValor: '0' }, leitura)).toThrow(RangeError);
  });
});

describe('plano preventivo por horas e por data', () => {
  it('usa o horimetro quando o gatilho e por horas', () => {
    const r = avaliarPlano(
      { descricao: 'Revisao do compressor', gatilhoTipo: 'HORAS', gatilhoValor: '500', antecedencia: '50', ultimoValor: '4500' },
      leitura,
    );
    expect(r.unidade).toBe('horas');
    expect(r.faltam).toBe(200);
  });

  it('conta dias corridos a partir da ultima execucao', () => {
    const agora = new Date('2026-08-03T12:00:00Z');
    const r = avaliarPlano(
      {
        descricao: 'Inspecao anual do tacografo',
        gatilhoTipo: 'DIAS',
        gatilhoValor: '365',
        antecedencia: '30',
        ultimoEm: new Date('2025-08-20T12:00:00Z'),
      },
      leitura,
      agora,
    );
    expect(r.faltam).toBe(17);
    expect(r.situacao).toBe('EM_ALERTA');
    expect(r.proximoEm?.toISOString().slice(0, 10)).toBe('2026-08-20');
  });
});

describe('custo da ordem de servico', () => {
  it('separa peca de mao de obra', () => {
    const custo = apurarCustoOs([
      { quantidade: '4', custoUnitario: '85.50', maoDeObra: false },
      { quantidade: '1', custoUnitario: '320.00', maoDeObra: true },
    ]);
    expect(custo.custoPecas.toFixed(2)).toBe('342.00');
    expect(custo.custoMaoObra.toFixed(2)).toBe('320.00');
    expect(custo.custoTotal.toFixed(2)).toBe('662.00');
  });

  it('mede o tempo de veiculo parado em horas', () => {
    const abertura = new Date('2026-08-01T08:00:00Z');
    const fechamento = new Date('2026-08-02T14:30:00Z');
    expect(tempoParadoHoras(abertura, fechamento).toFixed(2)).toBe('30.50');
  });

  it('recusa fechamento anterior a abertura', () => {
    expect(() => tempoParadoHoras(new Date('2026-08-02'), new Date('2026-08-01'))).toThrow(RangeError);
  });
});

describe('indicadores de manutencao', () => {
  const ordens = [
    { tipo: 'PREVENTIVA' as const, custoTotal: '1200.00', tempoParadoHoras: '6' },
    { tipo: 'CORRETIVA' as const, custoTotal: '3800.00', tempoParadoHoras: '30' },
    { tipo: 'CORRETIVA' as const, custoTotal: '1000.00', tempoParadoHoras: null },
  ];

  it('consolida custo, indice de preventiva e MTTR', () => {
    const r = consolidarManutencao(ordens);
    expect(r.custoTotal).toBe('6000.00');
    expect(r.custoCorretiva).toBe('4800.00');
    expect(r.indicePreventiva).toBe(0.2);
    // MTTR so considera as OS com tempo medido: (6 + 30) / 2
    expect(r.mttrHoras).toBe('18.00');
  });

  it('nao divide por zero quando nao ha OS', () => {
    const r = consolidarManutencao([]);
    expect(r.indicePreventiva).toBeNull();
    expect(r.mttrHoras).toBeNull();
  });

  it('conta dia parado inteiro: 30 horas tiram o veiculo de dois dias', () => {
    expect(disponibilidade(30, '30')).toBe(0.9333);
    expect(disponibilidade(30, '0')).toBe(1);
  });

  it('nao deixa a disponibilidade ficar negativa', () => {
    expect(disponibilidade(2, '240')).toBe(0);
  });
});
