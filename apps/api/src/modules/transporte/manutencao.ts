import { Decimal, centavos, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Regras de manutencao (secao 7.5). Modulo puro.
 * O plano preventivo dispara por km, por horas de motor ou por data - e o alerta
 * precisa chegar ANTES do vencimento, senao vira corretiva.
 */

export type GatilhoManutencao = 'KM' | 'HORAS' | 'DIAS';

export interface PlanoParaAvaliar {
  descricao: string;
  gatilhoTipo: GatilhoManutencao;
  /** intervalo entre execucoes: km, horas ou dias */
  gatilhoValor: ValorMonetario;
  /** antecedencia do alerta, na mesma unidade do gatilho */
  antecedencia: ValorMonetario;
  /** marcador da ultima execucao: hodometro ou horimetro */
  ultimoValor?: ValorMonetario | null;
  ultimoEm?: Date | null;
}

export interface LeituraVeiculo {
  hodometro: ValorMonetario;
  horimetro?: ValorMonetario | null;
}

export type SituacaoPlano = 'EM_DIA' | 'EM_ALERTA' | 'VENCIDO';

export interface AvaliacaoPlano {
  descricao: string;
  situacao: SituacaoPlano;
  /** proximo ponto de execucao: km/horas quando o gatilho e medido, data quando e por dias */
  proximoValor: string | null;
  proximoEm: Date | null;
  /** quanto falta ate o vencimento, na unidade do gatilho; negativo quando ja passou */
  faltam: number;
  unidade: 'km' | 'horas' | 'dias';
  mensagem: string;
}

const UNIDADE: Record<GatilhoManutencao, AvaliacaoPlano['unidade']> = {
  KM: 'km',
  HORAS: 'horas',
  DIAS: 'dias',
};

const DIA_MS = 86_400_000;

/**
 * Calcula o proximo vencimento e classifica o plano.
 *
 * Plano sem execucao anterior conta a partir da leitura atual: e o unico ponto de
 * referencia honesto quando o veiculo entra no sistema com o hodometro ja rodado.
 */
export function avaliarPlano(
  plano: PlanoParaAvaliar,
  leitura: LeituraVeiculo,
  agora = new Date(),
): AvaliacaoPlano {
  const intervalo = dinheiro(plano.gatilhoValor);
  if (intervalo.lessThanOrEqualTo(0)) throw new RangeError('O intervalo do plano precisa ser maior que zero.');
  const antecedencia = dinheiro(plano.antecedencia);

  if (plano.gatilhoTipo === 'DIAS') {
    const base = plano.ultimoEm ?? agora;
    const proximoEm = new Date(base.getTime() + Number(intervalo) * DIA_MS);
    const faltam = Math.floor((proximoEm.getTime() - agora.getTime()) / DIA_MS);
    const situacao = classificar(new Decimal(faltam), antecedencia);

    return {
      descricao: plano.descricao,
      situacao,
      proximoValor: null,
      proximoEm,
      faltam,
      unidade: 'dias',
      mensagem: mensagemDe(situacao, plano.descricao, faltam, 'dias'),
    };
  }

  const atual =
    plano.gatilhoTipo === 'KM' ? dinheiro(leitura.hodometro) : dinheiro(leitura.horimetro ?? 0);

  const base = plano.ultimoValor != null ? dinheiro(plano.ultimoValor) : atual;
  const proximoValor = base.plus(intervalo);
  const faltam = proximoValor.minus(atual);
  const situacao = classificar(faltam, antecedencia);

  return {
    descricao: plano.descricao,
    situacao,
    proximoValor: proximoValor.toFixed(1),
    proximoEm: null,
    faltam: Number(faltam.toDecimalPlaces(1)),
    unidade: UNIDADE[plano.gatilhoTipo],
    mensagem: mensagemDe(situacao, plano.descricao, Number(faltam.toDecimalPlaces(1)), UNIDADE[plano.gatilhoTipo]),
  };
}

function classificar(faltam: Decimal, antecedencia: Decimal): SituacaoPlano {
  if (faltam.lessThanOrEqualTo(0)) return 'VENCIDO';
  if (faltam.lessThanOrEqualTo(antecedencia)) return 'EM_ALERTA';
  return 'EM_DIA';
}

function mensagemDe(situacao: SituacaoPlano, descricao: string, faltam: number, unidade: string): string {
  if (situacao === 'VENCIDO') return `${descricao}: vencida ha ${Math.abs(faltam)} ${unidade}.`;
  if (situacao === 'EM_ALERTA') return `${descricao}: faltam ${faltam} ${unidade}.`;
  return `${descricao}: em dia, faltam ${faltam} ${unidade}.`;
}

// ---------------------------------------------------------------- custo da OS

export interface ItemDeCusto {
  quantidade: ValorMonetario;
  custoUnitario: ValorMonetario;
  maoDeObra: boolean;
}

export interface CustoOrdemServico {
  custoPecas: Decimal;
  custoMaoObra: Decimal;
  custoTotal: Decimal;
}

/** Peca e mao de obra somam separado: a razao entre elas e indicador de maturidade (secao 10.2). */
export function apurarCustoOs(itens: ItemDeCusto[]): CustoOrdemServico {
  let pecas = new Decimal(0);
  let maoObra = new Decimal(0);

  for (const item of itens) {
    const total = dinheiro(item.quantidade).times(dinheiro(item.custoUnitario));
    if (item.maoDeObra) maoObra = maoObra.plus(total);
    else pecas = pecas.plus(total);
  }

  return {
    custoPecas: centavos(pecas),
    custoMaoObra: centavos(maoObra),
    custoTotal: centavos(pecas.plus(maoObra)),
  };
}

/** Tempo de veiculo parado, em horas - insumo de disponibilidade e MTTR (secao 7.8). */
export function tempoParadoHoras(abertaEm: Date, fechadaEm: Date): Decimal {
  if (fechadaEm < abertaEm) throw new RangeError('Fechamento anterior a abertura da OS.');
  return new Decimal(fechadaEm.getTime() - abertaEm.getTime()).dividedBy(3_600_000).toDecimalPlaces(2);
}

// ---------------------------------------------------------------- indicadores

export interface OsParaIndicador {
  tipo: 'PREVENTIVA' | 'CORRETIVA';
  custoTotal: ValorMonetario;
  tempoParadoHoras?: ValorMonetario | null;
}

export interface IndicadoresManutencao {
  ordens: number;
  custoTotal: string;
  custoPreventiva: string;
  custoCorretiva: string;
  /** preventiva / total: quanto maior, mais madura a gestao (secao 10.2) */
  indicePreventiva: number | null;
  /** tempo medio de reparo, em horas */
  mttrHoras: string | null;
}

export function consolidarManutencao(ordens: OsParaIndicador[]): IndicadoresManutencao {
  let preventiva = new Decimal(0);
  let corretiva = new Decimal(0);
  let parado = new Decimal(0);
  let comTempo = 0;

  for (const os of ordens) {
    const custo = dinheiro(os.custoTotal);
    if (os.tipo === 'PREVENTIVA') preventiva = preventiva.plus(custo);
    else corretiva = corretiva.plus(custo);

    if (os.tempoParadoHoras != null) {
      parado = parado.plus(dinheiro(os.tempoParadoHoras));
      comTempo += 1;
    }
  }

  const total = preventiva.plus(corretiva);

  return {
    ordens: ordens.length,
    custoTotal: centavos(total).toFixed(2),
    custoPreventiva: centavos(preventiva).toFixed(2),
    custoCorretiva: centavos(corretiva).toFixed(2),
    indicePreventiva: total.greaterThan(0) ? Number(preventiva.dividedBy(total).toDecimalPlaces(4)) : null,
    mttrHoras: comTempo > 0 ? parado.dividedBy(comTempo).toDecimalPlaces(2).toFixed(2) : null,
  };
}

/**
 * Disponibilidade da frota (secao 7.8): dias operacionais / dias do periodo.
 * Uma OS de 30 horas tira o veiculo de 2 dias, nao de 1 - por isso o arredondamento e para cima.
 */
export function disponibilidade(diasDoPeriodo: number, horasParado: ValorMonetario): number {
  if (diasDoPeriodo <= 0) throw new RangeError('O periodo precisa ter ao menos um dia.');
  const diasParado = Math.ceil(Number(dinheiro(horasParado)) / 24);
  const operacionais = Math.max(diasDoPeriodo - diasParado, 0);
  return Number((operacionais / diasDoPeriodo).toFixed(4));
}
