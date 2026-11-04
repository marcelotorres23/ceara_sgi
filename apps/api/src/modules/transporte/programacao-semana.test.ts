import { describe, expect, it } from 'vitest';
import {
  DIAS_SEM_LEITURA_TOLERADOS,
  HORIZONTE_PADRAO_DIAS,
  programacaoDaSemana,
} from './programacao-semana.js';
import type { ItemDoPatio, VeiculoNoPatio } from './servico-periodico.service.js';
import type { Severidade } from './regua-manutencao.js';

const item = (
  tipo: ItemDoPatio['tipo'],
  severidade: Severidade,
  extra: Partial<ItemDoPatio> = {},
): ItemDoPatio => ({
  tipo,
  rotulo: tipo,
  base: 'HODOMETRO',
  severidade,
  usado: severidade === 'VENCIDO' ? 1.2 : severidade === 'CRITICO' ? 0.93 : severidade === 'ATENCAO' ? 0.8 : 0.2,
  aVencer: '1000.0',
  vencido: severidade === 'VENCIDO' ? '500.0' : '0.0',
  proxima: null,
  proximaEm: null,
  executadoEm: null,
  motivo: null,
  alerta: null,
  venceEmDias: null,
  previstoPara: null,
  ...extra,
});

const veiculo = (placa: string, itens: ItemDoPatio[], extra: Partial<VeiculoNoPatio> = {}): VeiculoNoPatio => ({
  veiculoId: `id-${placa}`,
  placa,
  frotaNumero: placa.slice(-3),
  descricao: 'VW Constellation 15.190',
  unidadeId: 'MATRIZ',
  hodometro: '250000.0',
  kmPorDia: '180.0',
  diasSemLeitura: 1,
  equipamento: null,
  itens,
  venceEmDias: null,
  score: itens.filter((i) => i.severidade === 'VENCIDO').length * 100 +
    itens.filter((i) => i.severidade === 'CRITICO').length * 10,
  pior: itens.some((i) => i.severidade === 'VENCIDO')
    ? 'VENCIDO'
    : itens.some((i) => i.severidade === 'CRITICO')
      ? 'CRITICO'
      : 'EM_DIA',
  vencidos: itens.filter((i) => i.severidade === 'VENCIDO').length,
  criticos: itens.filter((i) => i.severidade === 'CRITICO').length,
  ...extra,
});

describe('programacao da semana', () => {
  it('vencido entra imediato e critico entra na semana', () => {
    const { itens } = programacaoDaSemana([
      veiculo('PTM5D50', [item('OLEO_MOTOR', 'CRITICO')]),
      veiculo('PTM1F88', [item('OLEO_MOTOR', 'VENCIDO')]),
    ]);

    expect(itens.map((i) => [i.placa, i.faixa])).toEqual([
      ['PTM1F88', 'IMEDIATO'],
      ['PTM5D50', 'ESTA_SEMANA'],
    ]);
  });

  it('encaixa o item em atencao na parada que ja vai acontecer', () => {
    const linha = programacaoDaSemana([
      veiculo('PTM1F88', [item('OLEO_MOTOR', 'VENCIDO'), item('ALINHAMENTO', 'ATENCAO'), item('BALANCEAMENTO', 'EM_DIA')]),
    ]).itens[0]!;

    expect(linha.motivadores).toBe(1);
    expect(linha.encaixes).toBe(1);
    // o motivo da parada vem primeiro; o encaixe pega carona depois
    expect(linha.servicos.map((s) => [s.tipo, s.encaixe])).toEqual([
      ['OLEO_MOTOR', false],
      ['ALINHAMENTO', true],
    ]);
  });

  it('nao programa veiculo cujo unico apontamento e falta de base', () => {
    const { itens, semLeitura } = programacaoDaSemana([
      veiculo('OIV4D24', [item('OLEO_MOTOR', 'SEM_BASE')], {
        diasSemLeitura: null,
        kmPorDia: null,
        score: 0,
        pior: 'SEM_BASE',
      }),
    ]);

    expect(itens).toEqual([]);
    expect(semLeitura.map((s) => s.placa)).toEqual(['OIV4D24']);
    expect(semLeitura[0]!.motivo).toBe('Sem nenhuma leitura registrada');
  });

  it('entra na semana pela previsao do proprio ritmo, sem nada vencido', () => {
    const { itens } = programacaoDaSemana([
      veiculo('ROO2C65', [item('OLEO_MOTOR', 'EM_DIA', { venceEmDias: 5 })], { venceEmDias: 5 }),
      veiculo('ROO2G25', [item('OLEO_MOTOR', 'EM_DIA', { venceEmDias: 12 })], { venceEmDias: 12 }),
      veiculo('ROO8I02', [item('OLEO_MOTOR', 'EM_DIA', { venceEmDias: 40 })], { venceEmDias: 40 }),
    ]);

    expect(itens.map((i) => [i.placa, i.faixa])).toEqual([
      ['ROO2C65', 'ESTA_SEMANA'],
      ['ROO2G25', 'PROXIMA_SEMANA'],
    ]);
    expect(itens[0]!.motivo).toBe('vence em 5 dias');
    // sem vencido nem critico, o que vence dentro do horizonte e que motiva a parada
    expect(itens[0]!.servicos.map((s) => s.encaixe)).toEqual([false]);
  });

  it('a fila e por faixa, depois por score', () => {
    const tres = veiculo('PTM8E82', [
      item('OLEO_MOTOR', 'VENCIDO'),
      item('ALINHAMENTO', 'VENCIDO'),
      item('BALANCEAMENTO', 'VENCIDO'),
    ]);
    const um = veiculo('PTL8D26', [item('OLEO_MOTOR', 'VENCIDO')]);

    const { itens, resumo } = programacaoDaSemana([um, tres]);

    expect(itens.map((i) => i.placa)).toEqual(['PTM8E82', 'PTL8D26']);
    expect(resumo.imediato).toBe(2);
    expect(resumo.servicos).toBe(4);
  });

  it('veiculo sem leitura ha mais de uma semana aparece na lista propria', () => {
    const { semLeitura } = programacaoDaSemana([
      veiculo('SNH3B07', [item('OLEO_MOTOR', 'SEM_BASE')], {
        diasSemLeitura: DIAS_SEM_LEITURA_TOLERADOS + 25,
        kmPorDia: null,
      }),
      veiculo('SNH3B17', [item('OLEO_MOTOR', 'EM_DIA')], { diasSemLeitura: 2 }),
    ]);

    expect(semLeitura.map((s) => s.placa)).toEqual(['SNH3B07']);
    expect(semLeitura[0]!.motivo).toBe('32 dias sem leitura e 1 item(ns) sem base');
  });

  it('horizonte informado manda no corte das faixas', () => {
    const linha = veiculo('ROW7D83', [item('OLEO_MOTOR', 'EM_DIA', { venceEmDias: 20 })], { venceEmDias: 20 });

    expect(programacaoDaSemana([linha], HORIZONTE_PADRAO_DIAS).itens).toEqual([]);
    expect(programacaoDaSemana([linha], 20).itens[0]!.faixa).toBe('ESTA_SEMANA');
  });
});
