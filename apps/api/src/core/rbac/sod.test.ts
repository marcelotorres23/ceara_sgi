import { describe, expect, it } from 'vitest';
import { avaliarSod, conflitosEntre, type ContextoSod } from './sod.js';

const base = (over: Partial<ContextoSod>): ContextoSod => ({
  usuarioId: 'u1',
  acao: 'APROVAR',
  entidade: 'lotes',
  entidadeId: 'l1',
  ...over,
});

describe('segregacao de funcoes', () => {
  it('impede que o solicitante cote a propria solicitacao', () => {
    const r = avaliarSod(base({ acao: 'COTAR', solicitantesIds: ['u1', 'u2'] }));
    expect(r.permitido).toBe(false);
    expect(r.regra).toBe('SOLICITANTE_NAO_COTA');
  });

  it('permite cotar quando o comprador nao solicitou', () => {
    expect(avaliarSod(base({ acao: 'COTAR', solicitantesIds: ['u9'] })).permitido).toBe(true);
  });

  it('impede que o solicitante aprove o lote que o contem', () => {
    const r = avaliarSod(base({ acao: 'APROVAR', solicitantesIds: ['u1'], nivelAlcada: 3 }));
    expect(r.regra).toBe('SOLICITANTE_NAO_APROVA');
  });

  it('impede que o comprador aprove o proprio lote acima da faixa 1', () => {
    const r = avaliarSod(base({ acao: 'APROVAR', compradorId: 'u1', nivelAlcada: 2 }));
    expect(r.permitido).toBe(false);
    expect(r.regra).toBe('COMPRADOR_NAO_APROVA');
  });

  it('permite autoaprovacao do comprador na faixa 1 e marca o registro', () => {
    const r = avaliarSod(base({ acao: 'APROVAR', compradorId: 'u1', nivelAlcada: 1 }));
    expect(r.permitido).toBe(true);
    expect(r.marcarAutoaprovacao).toBe(true);
  });

  it('nao permite autoaprovacao fora da faixa 1', () => {
    expect(avaliarSod(base({ acao: 'AUTOAPROVAR', compradorId: 'u1', nivelAlcada: 2 })).permitido).toBe(false);
  });

  it('impede que quem aprovou registre o recebimento', () => {
    const r = avaliarSod(base({ acao: 'RECEBER', aprovadorId: 'u1' }));
    expect(r.regra).toBe('APROVADOR_NAO_RECEBE');
  });

  it('impede que quem cotou registre o recebimento', () => {
    const r = avaliarSod(base({ acao: 'RECEBER', compradorId: 'u1' }));
    expect(r.regra).toBe('COMPRADOR_NAO_RECEBE');
  });

  it('permite recebimento por terceiro sem envolvimento no fluxo', () => {
    expect(
      avaliarSod(base({ acao: 'RECEBER', compradorId: 'u2', aprovadorId: 'u3', solicitantesIds: ['u4'] })).permitido,
    ).toBe(true);
  });
});

describe('matriz de conflitos de perfil', () => {
  it('aponta conflito entre Comprador e Almoxarife', () => {
    expect(conflitosEntre(['Comprador', 'Almoxarife'])).toHaveLength(1);
  });

  it('nao aponta conflito em combinacao valida', () => {
    expect(conflitosEntre(['Motorista', 'Solicitante'])).toHaveLength(0);
  });
});
