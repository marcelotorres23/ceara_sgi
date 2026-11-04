import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../../core/errors/index.js';
import {
  ESTADOS_ABERTOS,
  ESTADOS_FINAIS,
  podeTransicionar,
  statusInicial,
  transicoesValidas,
  validarTransicao,
  type StatusAcesso,
} from './state-machine.js';

describe('estado inicial do acesso', () => {
  it('quem vem de fora entra no patio', () => {
    expect(statusInicial('PESSOA', false)).toBe('NO_PATIO');
    expect(statusInicial('VEICULO_EXTERNO', false)).toBe('NO_PATIO');
  });

  it('caminhao da casa comeca dentro: sair o poe em transito', () => {
    expect(statusInicial('VEICULO_PROPRIO', false)).toBe('EM_TRANSITO');
  });

  it('visita marcada nasce agendada, seja qual for o tipo', () => {
    expect(statusInicial('PESSOA', true)).toBe('AGENDADO');
    expect(statusInicial('VEICULO_PROPRIO', true)).toBe('AGENDADO');
  });
});

describe('transicoes permitidas', () => {
  it.each([
    ['AGENDADO', 'NO_PATIO'],
    ['AGENDADO', 'CANCELADO'],
    ['AGENDADO', 'RECUSADO'],
    ['NO_PATIO', 'ENCERRADO'],
    ['EM_TRANSITO', 'ENCERRADO'],
  ] as Array<[StatusAcesso, StatusAcesso]>)('%s -> %s e valida', (de, para) => {
    expect(podeTransicionar(de, para)).toBe(true);
  });

  it.each([
    ['NO_PATIO', 'EM_TRANSITO'],
    ['NO_PATIO', 'AGENDADO'],
    ['ENCERRADO', 'NO_PATIO'],
    ['CANCELADO', 'NO_PATIO'],
    ['RECUSADO', 'NO_PATIO'],
    ['EM_TRANSITO', 'NO_PATIO'],
  ] as Array<[StatusAcesso, StatusAcesso]>)('%s -> %s e recusada', (de, para) => {
    expect(podeTransicionar(de, para)).toBe(false);
    expect(() => validarTransicao(de, para, 'motivo suficiente')).toThrow(InvalidTransitionError);
  });

  it('registro fechado nao reabre - a volta e outro acesso', () => {
    expect(transicoesValidas('ENCERRADO')).toEqual([]);
  });

  it('transicao para o mesmo estado e invalida', () => {
    expect(() => validarTransicao('NO_PATIO', 'NO_PATIO')).toThrow(InvalidTransitionError);
  });
});

describe('motivo obrigatorio', () => {
  it('recusar exige motivo', () => {
    expect(() => validarTransicao('AGENDADO', 'RECUSADO')).toThrow(InvalidTransitionError);
    expect(() => validarTransicao('AGENDADO', 'RECUSADO', 'sem')).toThrow(InvalidTransitionError);
    expect(validarTransicao('AGENDADO', 'RECUSADO', 'documento nao confere').motivo).toBe('documento nao confere');
  });

  it('cancelar exige motivo', () => {
    expect(() => validarTransicao('AGENDADO', 'CANCELADO', ' ')).toThrow(InvalidTransitionError);
  });

  it('encerrar a saida normal nao exige motivo', () => {
    expect(validarTransicao('NO_PATIO', 'ENCERRADO').motivo).toBeNull();
  });
});

describe('conjuntos de estado', () => {
  it('aberto e o que ainda conta no patio', () => {
    expect([...ESTADOS_ABERTOS].sort()).toEqual(['AGENDADO', 'EM_TRANSITO', 'NO_PATIO']);
  });

  it('nenhum estado final tem saida', () => {
    for (const estado of ESTADOS_FINAIS) {
      expect(transicoesValidas(estado)).toEqual([]);
    }
  });
});
