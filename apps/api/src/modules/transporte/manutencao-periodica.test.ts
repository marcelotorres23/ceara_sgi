import { describe, expect, it } from 'vitest';
import {
  INTERVALO_PADRAO,
  basesPermitidas,
  medicaoDaExecucaoInvalida,
  planoAplicavel,
  posicaoPeriodica,
  type PlanoPeriodico,
  type TipoServicoPeriodico,
} from './manutencao-periodica.js';

const plano = (tipo: TipoServicoPeriodico): PlanoPeriodico => ({
  tipo,
  base: INTERVALO_PADRAO[tipo].base,
  intervalo: String(INTERVALO_PADRAO[tipo].intervalo),
  avisarCom: String(INTERVALO_PADRAO[tipo].avisarCom),
});

describe('posicaoPeriodica — as contas que a planilha fazia', () => {
  it('motor: proxima e a ultima troca mais 20.000 km', () => {
    // linha OIV5946 da aba MOTOR: 252.676 na troca, 272.121 hoje, faltam 555
    const p = posicaoPeriodica({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: '252676', medicaoAtual: '272121' });
    expect(p.proxima?.toString()).toBe('272676');
    expect(p.aVencer.toString()).toBe('555');
    expect(p.vencido.toString()).toBe('0');
    expect(p.situacao).toBe('PROXIMA');
  });

  it('diferencial e caixa de marcha usam 60.000 km', () => {
    // linha PTM9H11 da aba OLEO DIFERENCIAL: 367.585 na troca, 375.501 hoje, faltam 52.084
    const dif = posicaoPeriodica({ plano: plano('OLEO_DIFERENCIAL'), medicaoDaUltima: '367585', medicaoAtual: '375501' });
    expect(dif.proxima?.toString()).toBe('427585');
    expect(dif.aVencer.toString()).toBe('52084');
    expect(dif.situacao).toBe('EM_DIA');

    // linha PTM8E92 da aba CAIXA DE MARCHA: 365.355 na troca, 377.435 hoje, faltam 47.920
    const caixa = posicaoPeriodica({ plano: plano('OLEO_CAIXA_MARCHA'), medicaoDaUltima: '365355', medicaoAtual: '377435' });
    expect(caixa.aVencer.toString()).toBe('47920');
  });

  it('thermo king conta em horas, nao em km', () => {
    // linha EQR8I02 da aba THERMO KING: 4.085 h na troca, 5.038 h hoje, faltam 47
    const p = posicaoPeriodica({ plano: plano('OLEO_THERMO_KING'), medicaoDaUltima: '4085', medicaoAtual: '5038' });
    expect(p.proxima?.toString()).toBe('5085');
    expect(p.aVencer.toString()).toBe('47');
    expect(p.situacao).toBe('PROXIMA');
  });

  it('alinhamento vence a cada 10.000 km e mostra o quanto passou', () => {
    // linha PTM8I32 da aba ALINHAMENTO: 413.893 na ultima, 425.734 hoje, 1.841 km vencidos
    const p = posicaoPeriodica({ plano: plano('ALINHAMENTO'), medicaoDaUltima: '413893', medicaoAtual: '425734' });
    expect(p.proxima?.toString()).toBe('423893');
    expect(p.vencido.toString()).toBe('1841');
    expect(p.aVencer.toString()).toBe('0');
    expect(p.situacao).toBe('VENCIDA');
  });

  it('sem troca registrada, o primeiro vencimento e o proprio intervalo', () => {
    // linha SNH3B29 da aba MOTOR: sem data de troca, vence em 20.000
    const p = posicaoPeriodica({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: null, medicaoAtual: '18653' });
    expect(p.semHistorico).toBe(true);
    expect(p.proxima?.toString()).toBe('20000');
    expect(p.aVencer.toString()).toBe('1347');
  });

  it('ativo que nunca entrou no controle nao vira "vencido ha 400.000 km"', () => {
    // caminhao com 441.553 km e nenhuma troca registrada: o que falta e historico
    const p = posicaoPeriodica({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: null, medicaoAtual: '441553' });
    expect(p.situacao).toBe('SEM_REGISTRO');
    expect(p.semHistorico).toBe(true);
  });

  it('sem registro, mas atrasado dentro do primeiro ciclo, e vencimento de verdade', () => {
    const p = posicaoPeriodica({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: null, medicaoAtual: '25000' });
    expect(p.situacao).toBe('VENCIDA');
    expect(p.vencido.toString()).toBe('5000');
  });

  it('veiculo novo sem troca e sem rodagem ainda nao esta vencido', () => {
    const p = posicaoPeriodica({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: null, medicaoAtual: '0' });
    expect(p.situacao).toBe('EM_DIA');
    expect(p.vencido.toString()).toBe('0');
  });

  it('exatamente na medicao de vencimento ainda nao venceu, mas ja avisa', () => {
    const p = posicaoPeriodica({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: '100000', medicaoAtual: '120000' });
    expect(p.aVencer.toString()).toBe('0');
    expect(p.vencido.toString()).toBe('0');
    expect(p.situacao).toBe('PROXIMA');
  });

  it('sem leitura atual nao acusa vencimento: o que falta e medicao, nao manutencao', () => {
    const p = posicaoPeriodica({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: '100000', medicaoAtual: null });
    expect(p.situacao).toBe('EM_DIA');
    expect(p.proxima?.toString()).toBe('120000');
  });
});

describe('posicaoPeriodica por dias — a lubrificacao', () => {
  const emDias = (intervalo = 10, avisarCom = 2): PlanoPeriodico => ({
    tipo: 'LUBRIFICACAO',
    base: 'DIAS',
    intervalo: String(intervalo),
    avisarCom: String(avisarCom),
  });

  const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it('o padrao da operacao e de 10 em 10 dias', () => {
    expect(INTERVALO_PADRAO.LUBRIFICACAO).toEqual({ base: 'DIAS', intervalo: 10, avisarCom: 2 });
  });

  it('conta o vencimento a partir do dia da ultima lubrificacao', () => {
    const p = posicaoPeriodica({ plano: emDias(), dataDaUltima: dia('2026-08-01'), agora: dia('2026-08-05') });
    expect(p.proximaEm?.toISOString().slice(0, 10)).toBe('2026-08-11');
    expect(p.aVencer.toString()).toBe('6');
    expect(p.situacao).toBe('EM_DIA');
    expect(p.proxima).toBeNull();
  });

  it('avisa nos dois dias antes de vencer', () => {
    const p = posicaoPeriodica({ plano: emDias(), dataDaUltima: dia('2026-08-01'), agora: dia('2026-08-09') });
    expect(p.aVencer.toString()).toBe('2');
    expect(p.situacao).toBe('PROXIMA');
  });

  it('passou do dia, conta os dias de atraso', () => {
    const p = posicaoPeriodica({ plano: emDias(), dataDaUltima: dia('2026-08-01'), agora: dia('2026-08-14') });
    expect(p.vencido.toString()).toBe('3');
    expect(p.situacao).toBe('VENCIDA');
  });

  it('nunca lubrificado nao e "em dia": e falta de registro', () => {
    const p = posicaoPeriodica({ plano: emDias(), dataDaUltima: null, agora: dia('2026-08-11') });
    expect(p.situacao).toBe('SEM_REGISTRO');
    expect(p.proximaEm?.toISOString().slice(0, 10)).toBe('2026-08-21');
  });

  it('o gestor pode trocar o intervalo sem mexer em codigo', () => {
    const p = posicaoPeriodica({ plano: emDias(15, 3), dataDaUltima: dia('2026-08-01'), agora: dia('2026-08-14') });
    expect(p.proximaEm?.toISOString().slice(0, 10)).toBe('2026-08-16');
    expect(p.situacao).toBe('PROXIMA');
  });

  it('o mesmo tipo pode passar a vencer por km, e a conta muda de unidade', () => {
    const porKm: PlanoPeriodico = { tipo: 'LUBRIFICACAO', base: 'HODOMETRO', intervalo: '5000', avisarCom: '500' };
    const p = posicaoPeriodica({ plano: porKm, medicaoDaUltima: '100000', medicaoAtual: '104800' });
    expect(p.proxima?.toString()).toBe('105000');
    expect(p.proximaEm).toBeNull();
    expect(p.situacao).toBe('PROXIMA');
  });
});

describe('basesPermitidas', () => {
  it('dias vale para qualquer tipo', () => {
    expect(basesPermitidas('LUBRIFICACAO')).toContain('DIAS');
    expect(basesPermitidas('OLEO_MOTOR')).toContain('DIAS');
  });

  it('horimetro so para o que e medido no aparelho de frio', () => {
    expect(basesPermitidas('OLEO_THERMO_KING')).toEqual(['HORIMETRO', 'DIAS']);
    expect(basesPermitidas('ALINHAMENTO')).not.toContain('HORIMETRO');
  });
});

describe('planoAplicavel', () => {
  const planos = [
    { tipo: 'OLEO_THERMO_KING' as const, modelo: null, intervalo: '1000' },
    { tipo: 'OLEO_THERMO_KING' as const, modelo: 'THERMO KING', intervalo: '2000' },
    { tipo: 'OLEO_MOTOR' as const, modelo: null, intervalo: '20000' },
  ];

  it('o plano do modelo ganha do plano geral', () => {
    expect(planoAplicavel(planos, 'OLEO_THERMO_KING', 'THERMO KING')?.intervalo).toBe('2000');
  });

  it('modelo sem plano proprio cai no geral do tipo', () => {
    expect(planoAplicavel(planos, 'OLEO_THERMO_KING', 'CARRIER')?.intervalo).toBe('1000');
  });

  it('ignora caixa e acento ao casar o modelo', () => {
    expect(planoAplicavel(planos, 'OLEO_THERMO_KING', 'Thermo King 2026')?.intervalo).toBe('2000');
  });

  it('tipo sem plano nenhum devolve null', () => {
    expect(planoAplicavel(planos, 'ALINHAMENTO', 'QUALQUER')).toBeNull();
  });
});

describe('medicaoDaExecucaoInvalida', () => {
  it('recusa leitura menor que a da ultima execucao do mesmo tipo', () => {
    expect(medicaoDaExecucaoInvalida('250000', '252676')).toContain('menor que a da ultima execucao');
  });

  it('aceita leitura igual ou maior', () => {
    expect(medicaoDaExecucaoInvalida('252676', '252676')).toBeNull();
    expect(medicaoDaExecucaoInvalida('260000', '252676')).toBeNull();
  });

  it('primeira execucao do ativo nao tem contra o que comparar', () => {
    expect(medicaoDaExecucaoInvalida('80000', null)).toBeNull();
  });

  it('recusa medicao negativa', () => {
    expect(medicaoDaExecucaoInvalida('-1', null)).toContain('negativa');
  });
});
