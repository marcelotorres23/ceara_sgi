import { describe, expect, it } from 'vitest';
import {
  CALENDARIO_PADRAO,
  horasUteisEntre,
  reprogramarPorSuspensao,
  somarHorasUteis,
  type CalendarioUtil,
} from './horas-uteis.js';

/** Fortaleza e UTC-3 o ano inteiro: 08:00 local = 11:00Z. */
const local = (iso: string): Date => new Date(`${iso}-03:00`);
const paraLocal = (d: Date): string =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Fortaleza',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);

const CAL: CalendarioUtil = CALENDARIO_PADRAO;

describe('soma de horas uteis', () => {
  it('dentro do expediente, soma direta', () => {
    // quarta 08:00 + 2h = 10:00
    expect(paraLocal(somarHorasUteis(local('2026-08-05T08:00'), 2, CAL))).toBe('2026-08-05 10:00');
  });

  it('pula o intervalo de almoco', () => {
    // 11:00 + 2h uteis = 11->12 (1h) + 13->14 (1h) = 14:00
    expect(paraLocal(somarHorasUteis(local('2026-08-05T11:00'), 2, CAL))).toBe('2026-08-05 14:00');
  });

  it('vira para o proximo dia util ao estourar o expediente', () => {
    // quarta 17:00 + 2h = 1h ate 18:00, 1h na quinta a partir das 08:00
    expect(paraLocal(somarHorasUteis(local('2026-08-05T17:00'), 2, CAL))).toBe('2026-08-06 09:00');
  });

  it('pula o fim de semana', () => {
    // sexta 17:00 + 2h -> segunda 09:00
    expect(paraLocal(somarHorasUteis(local('2026-08-07T17:00'), 2, CAL))).toBe('2026-08-10 09:00');
  });

  it('inicio fora do expediente comeca na proxima abertura', () => {
    // domingo 10:00 + 1h -> segunda 09:00
    expect(paraLocal(somarHorasUteis(local('2026-08-09T10:00'), 1, CAL))).toBe('2026-08-10 09:00');
  });

  it('inicio antes da abertura nao consome o tempo parado', () => {
    // quarta 06:00 + 1h -> 09:00, nao 07:00
    expect(paraLocal(somarHorasUteis(local('2026-08-05T06:00'), 1, CAL))).toBe('2026-08-05 09:00');
  });

  it('pula feriado parametrizado', () => {
    // 2026-08-06 e quinta; declarada feriado -> cai na sexta
    const comFeriado: CalendarioUtil = { ...CAL, feriados: ['2026-08-06'] };
    expect(paraLocal(somarHorasUteis(local('2026-08-05T17:30'), 1, comFeriado))).toBe('2026-08-07 08:30');
  });

  it('SLA imediato vence no proprio instante (faixa 1 e P1)', () => {
    const t = local('2026-08-05T14:23');
    expect(somarHorasUteis(t, 0, CAL).getTime()).toBe(t.getTime());
  });

  it('SLA de 4h uteis do P1 aberto no fim do dia vira para o dia seguinte', () => {
    // quarta 16:00 + 4h = 2h ate 18:00 + 2h na quinta = 10:00
    expect(paraLocal(somarHorasUteis(local('2026-08-05T16:00'), 4, CAL))).toBe('2026-08-06 10:00');
  });

  it('SLA de 24h uteis equivale a quase 3 dias de expediente', () => {
    // expediente util = 9h/dia. quarta 9h + quinta 9h = 18h; restam 6h na sexta:
    // 08:00->12:00 (4h) + 13:00->15:00 (2h) = sexta 15:00
    expect(paraLocal(somarHorasUteis(local('2026-08-05T08:00'), 24, CAL))).toBe('2026-08-07 15:00');
  });

  it('recusa horas negativas', () => {
    expect(() => somarHorasUteis(local('2026-08-05T08:00'), -1, CAL)).toThrow(RangeError);
  });
});

describe('horas uteis decorridas', () => {
  it('conta apenas o expediente', () => {
    expect(horasUteisEntre(local('2026-08-05T08:00'), local('2026-08-05T18:00'), CAL)).toBe(9);
  });

  it('desconta o almoco', () => {
    expect(horasUteisEntre(local('2026-08-05T11:00'), local('2026-08-05T14:00'), CAL)).toBe(2);
  });

  it('ignora o fim de semana', () => {
    // sexta 17:00 -> segunda 09:00 = 1h + 1h
    expect(horasUteisEntre(local('2026-08-07T17:00'), local('2026-08-10T09:00'), CAL)).toBe(2);
  });

  it('intervalo inteiramente fora do expediente conta zero', () => {
    expect(horasUteisEntre(local('2026-08-08T10:00'), local('2026-08-09T16:00'), CAL)).toBe(0);
  });

  it('fim antes do inicio conta zero', () => {
    expect(horasUteisEntre(local('2026-08-05T10:00'), local('2026-08-05T08:00'), CAL)).toBe(0);
  });

  it('e o inverso da soma', () => {
    const inicio = local('2026-08-05T09:00');
    const venc = somarHorasUteis(inicio, 12, CAL);
    expect(horasUteisEntre(inicio, venc, CAL)).toBeCloseTo(12, 3);
  });
});

describe('suspensao do SLA quando devolvido ao solicitante', () => {
  it('empurra o vencimento pelas horas uteis paradas', () => {
    const vencimento = local('2026-08-06T10:00');
    // parado quarta 09:00 -> quarta 12:00 = 3h uteis.
    // vencimento 10:00 + 3h = 10:00->12:00 (2h) + 13:00->14:00 (1h) = 14:00
    const novo = reprogramarPorSuspensao(vencimento, local('2026-08-05T09:00'), local('2026-08-05T12:00'), CAL);
    expect(paraLocal(novo)).toBe('2026-08-06 14:00');
  });

  it('suspensao inteiramente fora do expediente nao altera o vencimento', () => {
    const vencimento = local('2026-08-10T10:00');
    const novo = reprogramarPorSuspensao(vencimento, local('2026-08-08T10:00'), local('2026-08-09T16:00'), CAL);
    expect(novo.getTime()).toBe(vencimento.getTime());
  });

  it('suspensao longa atravessa o fim de semana corretamente', () => {
    const vencimento = local('2026-08-11T09:00');
    // parado sexta 17:00 -> segunda 09:00 = 2h uteis
    const novo = reprogramarPorSuspensao(vencimento, local('2026-08-07T17:00'), local('2026-08-10T09:00'), CAL);
    expect(paraLocal(novo)).toBe('2026-08-11 11:00');
  });
});
