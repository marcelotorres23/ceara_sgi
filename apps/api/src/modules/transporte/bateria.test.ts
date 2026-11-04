import { describe, expect, it } from 'vitest';
import {
  FAIXAS_TENSAO_PADRAO,
  VIDA_UTIL_MESES_PADRAO,
  estadoDaTensao,
  kmComABateria,
  pontoDeTroca,
  tensaoInvalida,
} from './bateria.js';

const hoje = new Date('2026-08-11T12:00:00Z');
const mesesAtras = (n: number) => new Date(hoje.getTime() - n * 2_629_800_000);

describe('estadoDaTensao', () => {
  it('12,6 V e bateria cheia', () => expect(estadoDaTensao('12.60')).toBe('BOA'));
  it('12,3 V ja e atencao', () => expect(estadoDaTensao('12.30')).toBe('ATENCAO'));
  it('11,8 V e critica', () => expect(estadoDaTensao('11.80')).toBe('CRITICA'));
  it('sem medicao nao inventa estado', () => expect(estadoDaTensao(null)).toBeNull());

  it('as faixas sao parametrizaveis, para banco de 24 V', () => {
    expect(estadoDaTensao('24.20', { boa: 25, critica: 24 })).toBe('ATENCAO');
  });

  it('o padrao segue a bateria chumbo-acido de 12 V', () => {
    expect(FAIXAS_TENSAO_PADRAO).toEqual({ boa: 12.5, critica: 12.0 });
  });
});

describe('pontoDeTroca', () => {
  it('bateria nova medindo bem esta em dia', () => {
    const p = pontoDeTroca({ instaladaEm: mesesAtras(3), tensaoV: '12.70', agora: hoje });
    expect(p.situacao).toBe('EM_DIA');
    expect(p.motivos).toEqual([]);
    expect(p.mesesEmUso).toBe(3);
    expect(p.mesesRestantes).toBe(VIDA_UTIL_MESES_PADRAO - 3);
  });

  it('tensao critica troca hoje, mesmo com a bateria nova', () => {
    const p = pontoDeTroca({ instaladaEm: mesesAtras(2), tensaoV: '11.60', agora: hoje });
    expect(p.situacao).toBe('TROCAR');
    expect(p.motivos).toContain('TENSAO_CRITICA');
    expect(p.mensagens[0]).toContain('partida a frio');
  });

  it('vida util vencida entra na fila mesmo medindo bem', () => {
    const p = pontoDeTroca({ instaladaEm: mesesAtras(20), tensaoV: '12.80', agora: hoje });
    expect(p.situacao).toBe('TROCAR');
    expect(p.motivos).toContain('VIDA_UTIL_VENCIDA');
    expect(p.mesesRestantes).toBe(-2);
  });

  it('avisa dois meses antes do fim da vida util', () => {
    const p = pontoDeTroca({ instaladaEm: mesesAtras(17), tensaoV: '12.70', agora: hoje });
    expect(p.situacao).toBe('ATENCAO');
    expect(p.motivos).toContain('VIDA_UTIL_PROXIMA');
  });

  it('a vida util e por bateria, e nao do sistema', () => {
    const p = pontoDeTroca({ instaladaEm: mesesAtras(20), vidaUtilMeses: 36, tensaoV: '12.70', agora: hoje });
    expect(p.situacao).toBe('EM_DIA');
  });

  it('nunca medida nao e "em dia": e risco que ninguem enxerga', () => {
    const p = pontoDeTroca({ instaladaEm: mesesAtras(4), tensaoV: null, agora: hoje });
    expect(p.situacao).toBe('SEM_MEDICAO');
    expect(p.motivos).toContain('SEM_MEDICAO');
  });

  it('bateria em estoque nao acusa vida util: ela ainda nao comecou a contar', () => {
    const p = pontoDeTroca({ instaladaEm: null, tensaoV: '12.70', agora: hoje });
    expect(p.mesesEmUso).toBeNull();
    expect(p.mesesRestantes).toBeNull();
    expect(p.situacao).toBe('EM_DIA');
  });

  it('avisa que a troca ainda cabe na garantia', () => {
    const p = pontoDeTroca({
      instaladaEm: mesesAtras(10),
      tensaoV: '11.70',
      dataCompra: mesesAtras(10),
      garantiaMeses: 12,
      agora: hoje,
    });
    expect(p.naGarantia).toBe(true);
    expect(p.mensagens.some((m) => m.includes('Garantia vigente'))).toBe(true);
  });

  it('garantia vencida nao promete o que nao ha', () => {
    const p = pontoDeTroca({
      instaladaEm: mesesAtras(20),
      tensaoV: '11.70',
      dataCompra: mesesAtras(20),
      garantiaMeses: 12,
      agora: hoje,
    });
    expect(p.naGarantia).toBe(false);
    expect(p.mensagens.some((m) => m.includes('Garantia vigente'))).toBe(false);
  });

  it('a pior das leituras manda na situacao', () => {
    const p = pontoDeTroca({ instaladaEm: mesesAtras(17), tensaoV: '11.50', agora: hoje });
    expect(p.motivos).toContain('VIDA_UTIL_PROXIMA');
    expect(p.motivos).toContain('TENSAO_CRITICA');
    expect(p.situacao).toBe('TROCAR');
  });
});

describe('tensaoInvalida', () => {
  it('recusa zero e negativo', () => {
    expect(tensaoInvalida('0')).toContain('maior que zero');
  });

  it('recusa leitura fora da faixa fisica', () => {
    expect(tensaoInvalida('126')).toContain('30 V');
  });

  it('aceita leitura de 12 V e de 24 V', () => {
    expect(tensaoInvalida('12.60')).toBeNull();
    expect(tensaoInvalida('25.10')).toBeNull();
  });
});

describe('kmComABateria', () => {
  it('conta os km desde a instalacao', () => {
    expect(kmComABateria('100000', '148500')?.toString()).toBe('48500');
  });

  it('hodometro menor que o da instalacao nao vira km negativo', () => {
    expect(kmComABateria('100000', '90000')).toBeNull();
  });

  it('sem hodometro de instalacao nao ha o que contar', () => {
    expect(kmComABateria(null, '148500')).toBeNull();
  });
});
