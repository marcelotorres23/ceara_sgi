import { describe, expect, it } from 'vitest';
import {
  avaliarPneu,
  calcularCpk,
  consolidarCpk,
  estadoDoSulco,
  kmDoPeriodo,
  proximoStatus,
  transicoesValidasDoPneu,
} from './pneus.js';

describe('CPK', () => {
  it('divide o custo acumulado pelo km rodado (secao 7.4)', () => {
    // 1.800,00 de aquisicao + recapagem, 120.000 km rodados
    expect(calcularCpk('1800.00', '120000')?.toFixed(6)).toBe('0.015000');
  });

  it('nao inventa CPK para pneu que ainda nao rodou', () => {
    expect(calcularCpk('1200.00', '0')).toBeNull();
  });

  it('recusa numero negativo', () => {
    expect(() => calcularCpk('-1', '100')).toThrow(RangeError);
    expect(() => calcularCpk('100', '-1')).toThrow(RangeError);
  });

  it('apura o km do periodo entre instalacao e leitura atual', () => {
    expect(kmDoPeriodo('310450.0', '352300.5').toFixed(1)).toBe('41850.5');
  });

  it('recusa hodometro que retrocedeu', () => {
    expect(() => kmDoPeriodo('352300', '310450')).toThrow(/menor que o da instalacao/i);
  });
});

describe('estado do sulco no mapa de rodagem', () => {
  it('classifica pelas faixas da marca: verde, dourado e vermelho', () => {
    expect(estadoDoSulco('7.5')).toBe('VERDE');
    expect(estadoDoSulco('6')).toBe('VERDE');
    expect(estadoDoSulco('5.2')).toBe('DOURADO');
    expect(estadoDoSulco('3.9')).toBe('VERMELHO');
  });

  it('trata pneu sem medicao como pior caso, para forcar inspecao', () => {
    expect(estadoDoSulco(null)).toBe('VERMELHO');
  });
});

describe('avaliacao do pneu', () => {
  const base = { numeroFogo: 'F-1042', kmAcumulado: '80000', custoAcumulado: '1600.00' };

  it('bloqueia circulacao com sulco abaixo do limite legal', () => {
    const r = avaliarPneu({ ...base, sulcoAtualMm: '1.4' });
    expect(r.alertas).toContain('SULCO_ABAIXO_DO_LEGAL');
    expect(r.bloqueiaCirculacao).toBe(true);
  });

  it('sinaliza atencao sem bloquear quando o sulco esta na faixa dourada', () => {
    const r = avaliarPneu({ ...base, sulcoAtualMm: '4.5' });
    expect(r.estado).toBe('DOURADO');
    expect(r.alertas).toEqual(['SULCO_EM_ATENCAO']);
    expect(r.bloqueiaCirculacao).toBe(false);
  });

  it('acusa pneu acima da vida util esperada', () => {
    const r = avaliarPneu({ ...base, sulcoAtualMm: '6.5', vidaUtilKm: '70000' });
    expect(r.consumoVidaUtil).toBeCloseTo(1.1429, 3);
    expect(r.alertas).toContain('ACIMA_DA_VIDA_UTIL');
  });

  it('sugere rodizio a partir do km na mesma posicao', () => {
    const r = avaliarPneu({ ...base, sulcoAtualMm: '6.5', kmNaPosicao: '25000' }, { kmParaRodizio: 20000 });
    expect(r.alertas).toContain('CANDIDATO_A_RODIZIO');
  });

  it('pneu novo e bem calibrado nao gera alerta', () => {
    const r = avaliarPneu({ ...base, sulcoAtualMm: '9', kmNaPosicao: '1000', vidaUtilKm: '120000' });
    expect(r.alertas).toEqual([]);
    expect(r.cpk).toBe('0.020000');
  });
});

describe('ciclo de vida do pneu', () => {
  it('percorre estoque - uso - recapagem - estoque', () => {
    expect(proximoStatus('EM_ESTOQUE', 'INSTALACAO')).toBe('EM_USO');
    expect(proximoStatus('EM_USO', 'REMOCAO')).toBe('EM_ESTOQUE');
    expect(proximoStatus('EM_ESTOQUE', 'ENVIO_RECAPAGEM')).toBe('EM_RECAPAGEM');
    expect(proximoStatus('EM_RECAPAGEM', 'RETORNO_RECAPAGEM')).toBe('EM_ESTOQUE');
  });

  it('recusa transicao invalida em vez de aceitar em silencio', () => {
    expect(() => proximoStatus('SUCATA', 'INSTALACAO')).toThrow(RangeError);
    expect(() => proximoStatus('EM_ESTOQUE', 'RETORNO_RECAPAGEM')).toThrow(/nao aceita/i);
  });

  it('sucateamento e possivel de qualquer estado, menos de sucata', () => {
    expect(proximoStatus('EM_USO', 'SUCATEAMENTO')).toBe('SUCATA');
    expect(transicoesValidasDoPneu('SUCATA')).toEqual([]);
  });

  it('rodizio mantem o pneu em uso', () => {
    expect(proximoStatus('EM_USO', 'RODIZIO')).toBe('EM_USO');
  });
});

describe('CPK consolidado por marca', () => {
  const pneus = [
    { marca: 'Michelin', modelo: 'X Multi', custoAcumulado: '2000.00', kmAcumulado: '100000' },
    { marca: 'Michelin', modelo: 'X Multi', custoAcumulado: '2200.00', kmAcumulado: '120000' },
    { marca: 'Pirelli', modelo: 'FR85', custoAcumulado: '1500.00', kmAcumulado: '50000' },
  ];

  it('soma custo e km antes de dividir, em vez de tirar media de razoes', () => {
    const [melhor, pior] = consolidarCpk(pneus, 'marca');
    // Michelin: 4.200 / 220.000 = 0,019090...
    expect(melhor!.chave).toBe('Michelin');
    expect(melhor!.cpk).toBe('0.019091');
    expect(melhor!.pneus).toBe(2);
    // Pirelli: 1.500 / 50.000 = 0,03
    expect(pior!.cpk).toBe('0.030000');
  });

  it('agrupa por marca e modelo quando pedido', () => {
    expect(consolidarCpk(pneus).map((c) => c.chave)).toEqual(['Michelin X Multi', 'Pirelli FR85']);
  });
});
