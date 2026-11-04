import type { TipoServicoPeriodico } from '../modules/transporte/manutencao-periodica.js';
import type { Severidade } from '../modules/transporte/regua-manutencao.js';

/**
 * Os casos de borda da regua de manutencao (ADR 0023), num lugar so.
 *
 * A frota real tem 89 veiculos, mas ela mostra o que a operacao viveu — nao o que a regua
 * precisa provar. Faltam justamente as bordas: o item exatamente em 75%, o que vence por
 * calendario com o hodometro parado, o aparelho de frio que resetou, o caminhao com tres
 * itens vencidos de uma vez. Esperar esses casos aparecerem sozinhos e esperar o ano que vem.
 *
 * O `seed-teste-regua` monta cada caso no banco; o `smoke-regua` roda a regua em cima e
 * confere contra o que esta declarado aqui. Por isso a expectativa e **dado estruturado**, e
 * nao frase: conferir severidade procurando palavra em texto corrido acha "vencido" ate na
 * explicacao de por que algo nao pode vencer.
 */

export interface ExecucaoTeste {
  tipo: TipoServicoPeriodico;
  medicao: number;
  intervalo: number;
  diasAtras: number;
}

export interface FrioTeste {
  marca: string;
  /** leitura do display hoje */
  horimetro: number;
  /** medicao da ultima troca */
  ultima: number;
  intervalo: number;
  diasAtras: number;
  espera: Severidade;
}

export interface CasoRegua {
  placa: string;
  modelo: string;
  /** hodometro do cadastro do veiculo */
  hodometro: number;
  /** o que se espera ver, em portugues, gravado na observacao do veiculo */
  esperado: string;
  execucoes: ExecucaoTeste[];
  /** severidade esperada por item do veiculo — inclusive de item sem execucao registrada */
  espera: Partial<Record<TipoServicoPeriodico, Severidade>>;
  /** score de fila esperado para o ativo inteiro */
  scoreEsperado: number;
  frio?: FrioTeste;
}

const motor = (medicao: number, dias: number): ExecucaoTeste => ({
  tipo: 'OLEO_MOTOR',
  medicao,
  intervalo: 20_000,
  diasAtras: dias,
});

export const CASOS: CasoRegua[] = [
  {
    placa: 'TST0A01',
    modelo: 'Regua - em dia',
    hodometro: 310_000,
    esperado: 'Motor EM DIA: metade do ciclo gasto (10.000 de 20.000), 30 dias de idade.',
    execucoes: [motor(300_000, 30)],
    espera: { OLEO_MOTOR: 'EM_DIA' },
    scoreEsperado: 1,
  },
  {
    placa: 'TST0A02',
    modelo: 'Regua - atencao',
    hodometro: 315_000,
    esperado: 'Motor em ATENCAO: exatamente 75% do ciclo. A borda ja conta.',
    execucoes: [motor(300_000, 30)],
    espera: { OLEO_MOTOR: 'ATENCAO' },
    scoreEsperado: 2,
  },
  {
    placa: 'TST0A03',
    modelo: 'Regua - critico',
    hodometro: 318_000,
    esperado: 'Motor em estado CRITICO: exatamente 90% do ciclo.',
    execucoes: [motor(300_000, 30)],
    espera: { OLEO_MOTOR: 'CRITICO' },
    scoreEsperado: 13,
  },
  {
    placa: 'TST0A04',
    modelo: 'Regua - vencido por km',
    hodometro: 322_000,
    esperado: 'Motor VENCIDO: passou 2.000 km do ponto de troca.',
    execucoes: [motor(300_000, 30)],
    espera: { OLEO_MOTOR: 'VENCIDO' },
    scoreEsperado: 104,
  },
  {
    placa: 'TST0A05',
    modelo: 'Regua - vencido por calendario',
    hodometro: 302_000,
    esperado:
      'Motor VENCIDO POR TEMPO: so 10% do ciclo rodado, mas 212 dias desde a ultima ' +
      '(limite 180). Caminhao parado nao preserva oleo.',
    execucoes: [motor(300_000, 212)],
    espera: { OLEO_MOTOR: 'VENCIDO' },
    scoreEsperado: 104,
  },
  {
    placa: 'TST0A06',
    modelo: 'Regua - critico por calendario',
    hodometro: 302_000,
    esperado: 'Motor em estado CRITICO POR TEMPO: 170 dias, acima de 90% do limite de 180.',
    execucoes: [motor(300_000, 170)],
    espera: { OLEO_MOTOR: 'CRITICO' },
    scoreEsperado: 13,
  },
  {
    placa: 'TST0A07',
    modelo: 'Regua - odometro invertido',
    hodometro: 30_000,
    esperado:
      'Motor sem base, com alerta: hodometro (30.000) menor que o da ultima troca (300.000). ' +
      'Troca de painel ou digito errado — a regua para e pede confirmacao, nao corrige sozinha.',
    execucoes: [motor(300_000, 30)],
    espera: { OLEO_MOTOR: 'SEM_BASE' },
    scoreEsperado: 0,
  },
  {
    placa: 'TST0A08',
    modelo: 'Regua - sem historico',
    hodometro: 421_553,
    esperado:
      'Motor sem base: nenhuma troca registrada e mais de um ciclo rodado. Falta historico, ' +
      'nao manutencao — nao entra na fila.',
    execucoes: [],
    espera: { OLEO_MOTOR: 'SEM_BASE' },
    scoreEsperado: 0,
  },
  {
    placa: 'TST0A09',
    modelo: 'Regua - fila da oficina',
    hodometro: 400_000,
    esperado:
      'TRES itens vencidos de uma vez (motor, alinhamento, diferencial): score 304, primeiro ' +
      'da fila. A mesma parada resolve os tres.',
    execucoes: [
      { tipo: 'OLEO_MOTOR', medicao: 370_000, intervalo: 20_000, diasAtras: 60 },
      { tipo: 'ALINHAMENTO', medicao: 385_000, intervalo: 10_000, diasAtras: 45 },
      { tipo: 'OLEO_DIFERENCIAL', medicao: 330_000, intervalo: 60_000, diasAtras: 90 },
    ],
    espera: { OLEO_MOTOR: 'VENCIDO', ALINHAMENTO: 'VENCIDO', OLEO_DIFERENCIAL: 'VENCIDO' },
    scoreEsperado: 304,
  },
  {
    placa: 'TST0A10',
    modelo: 'Regua - horimetro do frio resetado',
    hodometro: 250_000,
    esperado:
      'Aparelho de frio sem base, com alerta: aparelho trocado, display em 21 h, ultima troca ' +
      'em 18.195 h. Caso real da base — nunca pode virar atraso de 18 mil horas.',
    execucoes: [motor(240_000, 20)],
    espera: { OLEO_MOTOR: 'EM_DIA' },
    // o motor em dia pontua 1; o frio sem base nao pontua
    scoreEsperado: 1,
    frio: {
      marca: 'THERMO KING',
      horimetro: 21,
      ultima: 18_195,
      intervalo: 2_000,
      diasAtras: 400,
      espera: 'SEM_BASE',
    },
  },
];
