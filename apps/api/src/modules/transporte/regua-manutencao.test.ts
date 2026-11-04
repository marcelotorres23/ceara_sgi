import { describe, expect, it } from 'vitest';
import { INTERVALO_PADRAO, type PlanoPeriodico, type TipoServicoPeriodico } from './manutencao-periodica.js';
import {
  LIMITE_DIAS_PADRAO,
  piorSeveridade,
  posicaoNaRegua,
  scoreDoAtivo,
  textoDoRestante,
  type Severidade,
} from './regua-manutencao.js';

const plano = (tipo: TipoServicoPeriodico): PlanoPeriodico => ({
  tipo,
  base: INTERVALO_PADRAO[tipo].base,
  intervalo: String(INTERVALO_PADRAO[tipo].intervalo),
  avisarCom: String(INTERVALO_PADRAO[tipo].avisarCom),
});

const HOJE = new Date('2026-08-18T12:00:00Z');
const diasAtras = (n: number): Date => new Date(HOJE.getTime() - n * 86_400_000);

describe('posicaoNaRegua — faixas do ciclo', () => {
  it('em dia enquanto menos de tres quartos do ciclo foram gastos', () => {
    // motor: trocou em 300.000, hoje 310.000 — metade do ciclo de 20.000
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '310000',
      agora: HOJE,
    });
    expect(r.severidade).toBe('EM_DIA');
    expect(r.usado).toBe(0.5);
  });

  it('atencao a partir de 75% do ciclo', () => {
    // 15.000 de 20.000 gastos: exatamente na borda, e a borda conta
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '315000',
      agora: HOJE,
    });
    expect(r.severidade).toBe('ATENCAO');
    expect(r.usado).toBe(0.75);
  });

  it('critico a partir de 90% do ciclo', () => {
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '318000',
      agora: HOJE,
    });
    expect(r.severidade).toBe('CRITICO');
    expect(r.usado).toBe(0.9);
  });

  it('vencido quando nao falta mais nada, e o usado passa de 1', () => {
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '322000',
      agora: HOJE,
    });
    expect(r.severidade).toBe('VENCIDO');
    expect(r.usado).toBe(1.1);
    expect(r.posicao.vencido.toString()).toBe('2000');
  });

  it('a linha real do Thermo King da planilha: 47 h para vencer, ja critica', () => {
    // EQR8I02: 4.085 h na troca, 5.038 h hoje, ciclo CARRIER de 1.000 h
    const r = posicaoNaRegua({
      plano: plano('OLEO_THERMO_KING'),
      medicaoDaUltima: '4085',
      medicaoAtual: '5038',
      agora: HOJE,
    });
    expect(r.severidade).toBe('CRITICO');
    expect(r.usado).toBe(0.953);
    expect(textoDoRestante(r, 'HORIMETRO')).toBe('faltam 47 h');
  });
});

describe('posicaoNaRegua — o calendario so agrava', () => {
  it('vence por tempo ainda que o hodometro nao tenha andado', () => {
    // caminhao parado: gastou 10% do ciclo, mas o oleo tem 212 dias
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '302000',
      dataDaUltima: diasAtras(212),
      agora: HOJE,
    });
    expect(r.severidade).toBe('VENCIDO');
    expect(r.motivo).toBe('212 dias desde a ultima (limite 180)');
    expect(r.usado).toBe(1);
    // a conta de km continua intacta: quem for trocar precisa do numero real
    expect(r.posicao.aVencer.toString()).toBe('18000');
  });

  it('critico a 90% do limite de calendario', () => {
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '302000',
      dataDaUltima: diasAtras(170),
      agora: HOJE,
    });
    expect(r.severidade).toBe('CRITICO');
    expect(r.usado).toBe(0.92);
  });

  it('nao abranda o que ja venceu por km', () => {
    // trocou ontem no papel, mas o hodometro diz que passou 2.000 km do ponto
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '322000',
      dataDaUltima: diasAtras(1),
      agora: HOJE,
    });
    expect(r.severidade).toBe('VENCIDO');
    expect(r.motivo).toBeNull();
  });

  it('diferencial e caixa aguentam dois anos; motor e alinhamento, meio ano', () => {
    expect(LIMITE_DIAS_PADRAO.OLEO_DIFERENCIAL).toBe(730);
    expect(LIMITE_DIAS_PADRAO.OLEO_CAIXA_MARCHA).toBe(730);
    expect(LIMITE_DIAS_PADRAO.OLEO_THERMO_KING).toBe(365);
    expect(LIMITE_DIAS_PADRAO.ALINHAMENTO).toBe(180);

    // um ano de diferencial ainda nao agrava nada
    const r = posicaoNaRegua({
      plano: plano('OLEO_DIFERENCIAL'),
      medicaoDaUltima: '300000',
      medicaoAtual: '310000',
      dataDaUltima: diasAtras(365),
      agora: HOJE,
    });
    expect(r.severidade).toBe('EM_DIA');
  });

  it('lubrificacao nao leva regua de calendario em cima: a base dela ja e o calendario', () => {
    expect(LIMITE_DIAS_PADRAO.LUBRIFICACAO).toBeNull();
    const r = posicaoNaRegua({ plano: plano('LUBRIFICACAO'), dataDaUltima: diasAtras(12), agora: HOJE });
    expect(r.severidade).toBe('VENCIDO');
    expect(r.motivo).toBeNull();
  });

  it('o limite do plano ganha do padrao do tipo', () => {
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '302000',
      dataDaUltima: diasAtras(100),
      limiteDias: 90,
      agora: HOJE,
    });
    expect(r.severidade).toBe('VENCIDO');
    expect(r.motivo).toBe('100 dias desde a ultima (limite 90)');
  });
});

describe('posicaoNaRegua — falta de base', () => {
  it('horimetro que retrocedeu e reset de aparelho, nao atraso de 18 mil horas', () => {
    // caso real da base: ultima troca em 18.195 h, aparelho trocado e marcando 21 h
    const r = posicaoNaRegua({
      plano: plano('OLEO_THERMO_KING'),
      medicaoDaUltima: '18195',
      medicaoAtual: '21',
      agora: HOJE,
    });
    expect(r.severidade).toBe('SEM_BASE');
    expect(r.alerta).toContain('menor que a da ultima execucao');
    expect(r.alerta).toContain('reset');
    expect(r.peso).toBe(0);
  });

  it('mesma protecao vale para o odometro', () => {
    const r = posicaoNaRegua({
      plano: plano('OLEO_MOTOR'),
      medicaoDaUltima: '300000',
      medicaoAtual: '30000',
      agora: HOJE,
    });
    expect(r.severidade).toBe('SEM_BASE');
    expect(r.alerta).toContain('km');
  });

  it('sem leitura do medidor nao ha severidade a apurar', () => {
    const r = posicaoNaRegua({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: '300000', agora: HOJE });
    expect(r.severidade).toBe('SEM_BASE');
    expect(r.motivo).toBe('Sem leitura do medidor');
  });

  it('ativo que nunca entrou no controle e falta de historico, nao atraso de 400 mil km', () => {
    const r = posicaoNaRegua({ plano: plano('OLEO_MOTOR'), medicaoAtual: '421553', agora: HOJE });
    expect(r.severidade).toBe('SEM_BASE');
    expect(r.motivo).toBe('Sem execucao registrada');
  });

  it('caminhao novo sem troca vence no primeiro intervalo, e nao vira sem base', () => {
    const r = posicaoNaRegua({ plano: plano('OLEO_MOTOR'), medicaoAtual: '19000', agora: HOJE });
    expect(r.severidade).toBe('CRITICO');
  });

  it('sem base nao empurra caminhao para a fila', () => {
    expect(scoreDoAtivo([{ severidade: 'SEM_BASE' }, { severidade: 'SEM_BASE' }])).toBe(0);
  });
});

describe('scoreDoAtivo — a mesma parada resolve varios servicos', () => {
  const itens = (...s: Severidade[]) => s.map((severidade) => ({ severidade }));

  it('tres vencidos sobem na frente de um vencido', () => {
    expect(scoreDoAtivo(itens('VENCIDO', 'VENCIDO', 'VENCIDO', 'EM_DIA'))).toBe(304);
    expect(scoreDoAtivo(itens('VENCIDO', 'EM_DIA', 'EM_DIA'))).toBe(104);
    expect(scoreDoAtivo(itens('VENCIDO', 'VENCIDO', 'VENCIDO', 'EM_DIA'))).toBeGreaterThan(
      scoreDoAtivo(itens('VENCIDO', 'EM_DIA', 'EM_DIA')),
    );
  });

  it('nenhuma pilha de criticos ultrapassa um unico vencido', () => {
    // sete criticos = 74; um vencido = 104. Vencido e vencido.
    expect(scoreDoAtivo(itens('CRITICO', 'CRITICO', 'CRITICO', 'CRITICO', 'CRITICO', 'CRITICO', 'CRITICO'))).toBeLessThan(
      scoreDoAtivo(itens('VENCIDO')),
    );
  });

  it('o pior status desempata quem tem a mesma contagem', () => {
    expect(scoreDoAtivo(itens('ATENCAO', 'EM_DIA'))).toBe(2);
    expect(scoreDoAtivo(itens('EM_DIA', 'EM_DIA'))).toBe(1);
  });

  it('ativo inteiramente em dia fica no fim da fila, mas nao zerado', () => {
    expect(scoreDoAtivo(itens('EM_DIA'))).toBe(1);
  });
});

describe('piorSeveridade — o selo ao lado da placa', () => {
  it('mostra o pior, nao o mais comum', () => {
    expect(piorSeveridade([{ severidade: 'EM_DIA' }, { severidade: 'VENCIDO' }, { severidade: 'EM_DIA' }])).toBe('VENCIDO');
  });

  it('conjunto vazio nao tem base', () => {
    expect(piorSeveridade([])).toBe('SEM_BASE');
  });
});

describe('textoDoRestante — status nunca so por cor', () => {
  it('diz o que falta em km', () => {
    const r = posicaoNaRegua({ plano: plano('OLEO_MOTOR'), medicaoDaUltima: '252676', medicaoAtual: '272121' });
    expect(textoDoRestante(r, 'HODOMETRO')).toBe('faltam 555 km');
  });

  it('diz o quanto passou quando ja venceu', () => {
    const r = posicaoNaRegua({ plano: plano('ALINHAMENTO'), medicaoDaUltima: '413893', medicaoAtual: '425734' });
    expect(textoDoRestante(r, 'HODOMETRO')).toBe('1.841 km vencidos');
  });

  it('sem base nao mostra numero nenhum', () => {
    // o ativo sem historico tem restante aritmeticamente correto e operacionalmente falso:
    // "401.553 km vencidos" ao lado de "sem registro" e a mentira que a planilha contava
    const semHistorico = posicaoNaRegua({ plano: plano('OLEO_MOTOR'), medicaoAtual: '421553' });
    expect(semHistorico.severidade).toBe('SEM_BASE');
    expect(textoDoRestante(semHistorico, 'HODOMETRO')).toBe('sem base para calcular');

    const invertido = posicaoNaRegua({
      plano: plano('OLEO_THERMO_KING'),
      medicaoDaUltima: '18195',
      medicaoAtual: '21',
    });
    expect(textoDoRestante(invertido, 'HORIMETRO')).toBe('sem base para calcular');
  });
});
