import { describe, expect, it } from 'vitest';
import { calcularHash } from './hash.js';

const registro = {
  id: '0192f3c0-0000-7000-8000-000000000001',
  timestamp: '2026-08-02T12:00:00.000Z',
  usuarioId: 'u1',
  entidade: 'lotes',
  entidadeId: 'l1',
  acao: 'APROVAR',
  valorAnterior: null,
  valorNovo: { decisao: 'APROVADO' },
  severidade: 'INFO',
};

describe('cadeia de hash da auditoria', () => {
  it('e deterministica para o mesmo conteudo e elo anterior', () => {
    expect(calcularHash(registro, 'abc')).toBe(calcularHash({ ...registro }, 'abc'));
  });

  it('muda quando qualquer campo do registro muda', () => {
    const adulterado = { ...registro, acao: 'REPROVAR' };
    expect(calcularHash(adulterado, 'abc')).not.toBe(calcularHash(registro, 'abc'));
  });

  it('muda quando o elo anterior muda - adulteracao no meio quebra o resto da cadeia', () => {
    expect(calcularHash(registro, 'abc')).not.toBe(calcularHash(registro, 'abd'));
  });

  it('independe da ordem das chaves do objeto', () => {
    // mesmas chaves e valores, ordem de insercao invertida
    const reordenado = Object.fromEntries(Object.entries(registro).reverse());
    expect(calcularHash(reordenado, null)).toBe(calcularHash(registro, null));
  });

  it('produz sha256 em hex', () => {
    expect(calcularHash(registro, null)).toMatch(/^[a-f0-9]{64}$/);
  });
});
