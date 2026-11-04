import { describe, expect, it } from 'vitest';
import { CALENDARIO_PADRAO } from '../compras/horas-uteis.js';
import {
  aplicarVisibilidade,
  competenciaDe,
  consolidarCompetencia,
  consolidarPainel,
  ocorrenciaPontua,
  pontosDaMulta,
  pontosDoCriterio,
  prazoEmDiasUteis,
  prazoVencido,
  type OcorrenciaParaPontuar,
} from './pontuacao.js';

const ocorrencia = (over: Partial<OcorrenciaParaPontuar>): OcorrenciaParaPontuar => ({
  id: 'o1',
  criterioCodigo: 'CHECKLIST_NAO_REALIZADO',
  criterioDescricao: 'Checklist nao realizado',
  tipo: 'NEGATIVO',
  pontos: -10,
  status: 'VALIDADA',
  ...over,
});

describe('consolidacao da competencia', () => {
  it('soma positivos e subtrai negativos sobre a base de 100', () => {
    const extrato = consolidarCompetencia('2026-08', 100, [
      ocorrencia({ id: '1', pontos: -10 }),
      ocorrencia({ id: '2', criterioCodigo: 'ZERO_MULTA', tipo: 'POSITIVO', pontos: 8 }),
    ]);

    expect(extrato.pontosPositivos).toBe(8);
    expect(extrato.pontosNegativos).toBe(10);
    expect(extrato.pontosFinal).toBe(98);
  });

  it('nao conta ocorrencia sugerida pelo sistema: so vale apos validacao humana', () => {
    const extrato = consolidarCompetencia('2026-08', 100, [
      ocorrencia({ id: '1', status: 'SUGERIDA', pontos: -20 }),
    ]);

    expect(extrato.pontosFinal).toBe(100);
    expect(extrato.ocorrenciasIgnoradas).toBe(1);
  });

  it('ocorrencia revertida sai da conta mas continua no historico', () => {
    const extrato = consolidarCompetencia('2026-08', 100, [
      ocorrencia({ id: '1', status: 'REVERTIDA', pontos: -15 }),
      ocorrencia({ id: '2', status: 'MANTIDA', pontos: -15 }),
    ]);

    expect(extrato.pontosFinal).toBe(85);
    expect(extrato.ocorrenciasConsideradas).toBe(1);
    expect(extrato.ocorrenciasIgnoradas).toBe(1);
  });

  it('contestacao aberta nao suspende os pontos - contestar nao pode virar rota de fuga', () => {
    expect(ocorrenciaPontua('CONTESTADA')).toBe(true);
    expect(ocorrenciaPontua('SUGERIDA')).toBe(false);
    expect(ocorrenciaPontua('DESCARTADA')).toBe(false);
  });

  it('a pontuacao final tem piso zero', () => {
    const extrato = consolidarCompetencia('2026-08', 100, [
      ocorrencia({ id: '1', pontos: -80 }),
      ocorrencia({ id: '2', pontos: -60 }),
    ]);

    expect(extrato.pontosNegativos).toBe(140);
    expect(extrato.pontosFinal).toBe(0);
  });

  it('agrupa por criterio, do mais negativo para o mais positivo', () => {
    const extrato = consolidarCompetencia('2026-08', 100, [
      ocorrencia({ id: '1', pontos: -10 }),
      ocorrencia({ id: '2', pontos: -10 }),
      ocorrencia({ id: '3', criterioCodigo: 'SUGESTAO', tipo: 'POSITIVO', pontos: 10 }),
    ]);

    expect(extrato.porCriterio[0]).toMatchObject({ codigo: 'CHECKLIST_NAO_REALIZADO', ocorrencias: 2, pontos: -20 });
    expect(extrato.porCriterio[1]).toMatchObject({ codigo: 'SUGESTAO', pontos: 10 });
  });

  it('recusa competencia mal formada e base negativa', () => {
    expect(() => consolidarCompetencia('agosto', 100, [])).toThrow(RangeError);
    expect(() => consolidarCompetencia('2026-08', -1, [])).toThrow(RangeError);
  });
});

describe('pontos do criterio', () => {
  it('o sinal vem do tipo, nao do peso cadastrado', () => {
    expect(pontosDoCriterio('POSITIVO', 10)).toBe(10);
    expect(pontosDoCriterio('NEGATIVO', 10)).toBe(-10);
    expect(() => pontosDoCriterio('NEGATIVO', -10)).toThrow(RangeError);
  });

  it('multa pesa pela gravidade: -10 padrao, -15 grave, -20 gravissima', () => {
    expect(pontosDaMulta('LEVE')).toBe(-10);
    expect(pontosDaMulta('MEDIA')).toBe(-10);
    expect(pontosDaMulta('GRAVE')).toBe(-15);
    expect(pontosDaMulta('GRAVISSIMA')).toBe(-20);
  });
});

describe('prazo de contestacao em dias uteis', () => {
  it('pula o fim de semana', () => {
    // quinta 06/08/2026 + 5 dias uteis -> quinta 13/08
    const prazo = prazoEmDiasUteis(new Date('2026-08-06T12:00:00Z'), 5, CALENDARIO_PADRAO);
    expect(prazo.toISOString().slice(0, 10)).toBe('2026-08-13');
  });

  it('pula feriado configurado', () => {
    const cal = { ...CALENDARIO_PADRAO, feriados: ['2026-08-10', '2026-08-11'] };
    const prazo = prazoEmDiasUteis(new Date('2026-08-06T12:00:00Z'), 5, cal);
    expect(prazo.toISOString().slice(0, 10)).toBe('2026-08-17');
  });

  it('prazo zero nao move a data', () => {
    const inicio = new Date('2026-08-06T12:00:00Z');
    expect(prazoEmDiasUteis(inicio, 0, CALENDARIO_PADRAO).getTime()).toBe(inicio.getTime());
  });

  it('recusa prazo negativo e calendario sem dia util', () => {
    expect(() => prazoEmDiasUteis(new Date(), -1, CALENDARIO_PADRAO)).toThrow(RangeError);
    const semDias = { ...CALENDARIO_PADRAO, expediente: { ...CALENDARIO_PADRAO.expediente, dias: [] } };
    expect(() => prazoEmDiasUteis(new Date(), 1, semDias)).toThrow(/sem dias uteis/i);
  });

  it('reconhece prazo vencido', () => {
    const prazo = new Date('2026-08-13T23:59:00Z');
    expect(prazoVencido(prazo, new Date('2026-08-14T08:00:00Z'))).toBe(true);
    expect(prazoVencido(prazo, new Date('2026-08-12T08:00:00Z'))).toBe(false);
    expect(prazoVencido(null)).toBe(false);
  });

  it('deriva a competencia no fuso da operacao', () => {
    expect(competenciaDe(new Date('2026-08-31T23:00:00Z'))).toBe('2026-08');
    // 01/09 00:30 UTC ainda e 31/08 em Fortaleza
    expect(competenciaDe(new Date('2026-09-01T00:30:00Z'))).toBe('2026-08');
  });
});

describe('painel do setor', () => {
  const linhas = [
    { colaboradorId: 'a', nome: 'Ana', setor: 'Frota', pontosFinal: 110 },
    { colaboradorId: 'b', nome: 'Bruno', setor: 'Frota', pontosFinal: 95 },
    { colaboradorId: 'c', nome: 'Caio', setor: 'Frota', pontosFinal: 40 },
  ];

  it('traz media e mediana - com poucos, a media engana', () => {
    const painel = consolidarPainel(linhas, 100);
    expect(painel.media).toBe(81.7);
    expect(painel.mediana).toBe(95);
    expect(painel.abaixoDaBase).toBe(2);
  });

  it('distribui por faixa', () => {
    const painel = consolidarPainel(linhas, 100);
    expect(painel.distribuicao).toEqual([
      { faixa: 'Ate 60', colaboradores: 1 },
      { faixa: '61 a 90', colaboradores: 0 },
      { faixa: '91 a 110', colaboradores: 2 },
      { faixa: 'Acima de 110', colaboradores: 0 },
    ]);
  });

  it('setor vazio nao quebra nem inventa media', () => {
    expect(consolidarPainel([], 100)).toMatchObject({ colaboradores: 0, media: null, mediana: null });
  });
});

describe('visibilidade do ranking', () => {
  const linhas = [{ colaboradorId: 'a', nome: 'Ana', setor: 'Frota', pontosFinal: 110 }];

  it('publico mostra a todos', () => {
    expect(aplicarVisibilidade(linhas, 'PUBLICO', false)).toEqual(linhas);
  });

  it('apenas gestor esconde de quem nao e gestor', () => {
    expect(aplicarVisibilidade(linhas, 'APENAS_GESTOR', false)).toBeNull();
    expect(aplicarVisibilidade(linhas, 'APENAS_GESTOR', true)).toEqual(linhas);
  });

  it('anonimizado troca o nome mas mantem a posicao', () => {
    const anon = aplicarVisibilidade(linhas, 'ANONIMIZADO', false);
    expect(anon?.[0]?.nome).toBe('Colaborador 1');
    expect(anon?.[0]?.pontosFinal).toBe(110);
  });
});
