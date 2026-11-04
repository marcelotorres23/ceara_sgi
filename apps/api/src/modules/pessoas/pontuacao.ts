import type { CalendarioUtil } from '../compras/horas-uteis.js';

/**
 * Pontuacao mensal de colaboradores (secao 9). Modulo puro.
 *
 * A regra de ouro deste modulo: **pontuacao e insumo de gestao, nao sentenca**.
 * Por isso ocorrencia sugerida pelo sistema nao pontua, ocorrencia revertida nao
 * pontua mas continua no historico, e nada aqui apaga registro.
 */

export type TipoCriterio = 'POSITIVO' | 'NEGATIVO';

export type StatusOcorrencia =
  | 'SUGERIDA'
  | 'VALIDADA'
  | 'CONTESTADA'
  | 'MANTIDA'
  | 'REVERTIDA'
  | 'DESCARTADA';

/**
 * Status que efetivamente contam pontos.
 *
 * `SUGERIDA` fica de fora: ocorrencia gerada por evento do sistema so vale apos
 * validacao humana (secao 9.2). `CONTESTADA` conta, porque a contestacao suspende
 * o julgamento, nao o fato — se fosse zerada na abertura, contestar viraria
 * estrategia para escapar do mes.
 */
const PONTUAM = new Set<StatusOcorrencia>(['VALIDADA', 'CONTESTADA', 'MANTIDA']);

export const ocorrenciaPontua = (status: StatusOcorrencia): boolean => PONTUAM.has(status);

export interface OcorrenciaParaPontuar {
  id: string;
  criterioCodigo: string;
  criterioDescricao: string;
  tipo: TipoCriterio;
  /** ja com sinal, congelado no lancamento */
  pontos: number;
  status: StatusOcorrencia;
}

export interface ExtratoMensal {
  competencia: string;
  pontosBase: number;
  pontosPositivos: number;
  pontosNegativos: number;
  pontosFinal: number;
  ocorrenciasConsideradas: number;
  ocorrenciasIgnoradas: number;
  porCriterio: Array<{ codigo: string; descricao: string; tipo: TipoCriterio; ocorrencias: number; pontos: number }>;
}

/**
 * Consolida a competencia. O piso e zero: pontuacao negativa nao existe como
 * numero, e o extrato precisa ser legivel numa conversa de feedback.
 */
export function consolidarCompetencia(
  competencia: string,
  pontosBase: number,
  ocorrencias: OcorrenciaParaPontuar[],
): ExtratoMensal {
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    throw new RangeError('Competencia deve estar no formato YYYY-MM.');
  }
  if (pontosBase < 0) throw new RangeError('A pontuacao base nao pode ser negativa.');

  const validas = ocorrencias.filter((o) => ocorrenciaPontua(o.status));

  let positivos = 0;
  let negativos = 0;
  const grupos = new Map<string, ExtratoMensal['porCriterio'][number]>();

  for (const o of validas) {
    if (o.pontos >= 0) positivos += o.pontos;
    else negativos += Math.abs(o.pontos);

    const atual = grupos.get(o.criterioCodigo) ?? {
      codigo: o.criterioCodigo,
      descricao: o.criterioDescricao,
      tipo: o.tipo,
      ocorrencias: 0,
      pontos: 0,
    };
    atual.ocorrencias += 1;
    atual.pontos += o.pontos;
    grupos.set(o.criterioCodigo, atual);
  }

  return {
    competencia,
    pontosBase,
    pontosPositivos: positivos,
    pontosNegativos: negativos,
    pontosFinal: Math.max(pontosBase + positivos - negativos, 0),
    ocorrenciasConsideradas: validas.length,
    ocorrenciasIgnoradas: ocorrencias.length - validas.length,
    porCriterio: [...grupos.values()].sort((a, b) => a.pontos - b.pontos),
  };
}

/** Pontos com sinal a partir do criterio: o peso e sempre positivo no cadastro. */
export function pontosDoCriterio(tipo: TipoCriterio, peso: number): number {
  if (peso < 0) throw new RangeError('O peso do criterio e sempre positivo; o sinal vem do tipo.');
  return tipo === 'POSITIVO' ? peso : -peso;
}

/**
 * Multa pesa conforme a gravidade (secao 9.1): -10 padrao, -15 grave, -20 gravissima.
 * A escala e da tabela de critérios, não do valor pago: infração cara não é
 * necessariamente a mais perigosa.
 */
export function pontosDaMulta(gravidade: 'LEVE' | 'MEDIA' | 'GRAVE' | 'GRAVISSIMA', pesoBase = 10): number {
  const escala: Record<typeof gravidade, number> = {
    LEVE: pesoBase,
    MEDIA: pesoBase,
    GRAVE: Math.round(pesoBase * 1.5),
    GRAVISSIMA: pesoBase * 2,
  };
  return -escala[gravidade];
}

// ---------------------------------------------------------------- prazos

const FUSO = 'America/Fortaleza';

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

const DIA_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const diaLocal = (d: Date): { data: string; diaSemana: number } => {
  const partes = Object.fromEntries(formatador.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    diaSemana: DIA_SEMANA[partes.weekday as string] ?? 0,
  };
};

const ehDiaUtil = (d: Date, cal: CalendarioUtil): boolean => {
  const { data, diaSemana } = diaLocal(d);
  return cal.expediente.dias.includes(diaSemana) && !cal.feriados.includes(data);
};

/**
 * Prazo de contestacao em DIAS UTEIS (secao 9.2): 5 dias uteis a partir do lancamento.
 * O mesmo calendario do SLA de compras — feriado do Maranhão não pode consumir
 * o prazo de defesa de quem foi pontuado.
 */
export function prazoEmDiasUteis(inicio: Date, dias: number, cal: CalendarioUtil): Date {
  if (dias < 0) throw new RangeError('O prazo nao pode ser negativo.');

  const prazo = new Date(inicio.getTime());
  let restantes = dias;
  let voltas = 0;

  while (restantes > 0) {
    prazo.setUTCDate(prazo.getUTCDate() + 1);
    if (ehDiaUtil(prazo, cal)) restantes -= 1;

    // calendario sem nenhum dia util configurado nao pode virar laco infinito
    if (++voltas > 3650) throw new RangeError('Calendario sem dias uteis: prazo impossivel de calcular.');
  }

  return prazo;
}

export const prazoVencido = (contestarAte: Date | null, agora = new Date()): boolean =>
  contestarAte !== null && agora > contestarAte;

/** Competencia 'YYYY-MM' de uma data, no fuso da operacao. */
export const competenciaDe = (data: Date): string => diaLocal(data).data.slice(0, 7);

// ---------------------------------------------------------------- painel do setor

export interface LinhaDoPainel {
  colaboradorId: string;
  nome: string;
  setor: string;
  pontosFinal: number;
  /** o painel de classificacao mostra os dois lados, e nao so o saldo */
  pontosPositivos?: number;
  pontosNegativos?: number;
  cargo?: string;
  fotoUrl?: string | null;
}

export interface PainelDoSetor {
  colaboradores: number;
  media: number | null;
  mediana: number | null;
  /** quantos estao abaixo da base - o grupo que exige conversa */
  abaixoDaBase: number;
  distribuicao: Array<{ faixa: string; colaboradores: number }>;
}

/**
 * Painel do setor (secao 9.3). Traz media E mediana: com poucas pessoas, uma
 * ocorrencia grave puxa a media e some com o quadro real do time.
 */
export function consolidarPainel(linhas: LinhaDoPainel[], pontosBase: number): PainelDoSetor {
  if (linhas.length === 0) {
    return { colaboradores: 0, media: null, mediana: null, abaixoDaBase: 0, distribuicao: [] };
  }

  const pontos = linhas.map((l) => l.pontosFinal).sort((a, b) => a - b);
  const meio = Math.floor(pontos.length / 2);

  const faixas = [
    { faixa: 'Ate 60', minimo: 0, maximo: 60 },
    { faixa: '61 a 90', minimo: 61, maximo: 90 },
    { faixa: '91 a 110', minimo: 91, maximo: 110 },
    { faixa: 'Acima de 110', minimo: 111, maximo: Infinity },
  ];

  return {
    colaboradores: linhas.length,
    media: Number((pontos.reduce((a, b) => a + b, 0) / pontos.length).toFixed(1)),
    mediana:
      pontos.length % 2 === 0 ? Number(((pontos[meio - 1]! + pontos[meio]!) / 2).toFixed(1)) : pontos[meio]!,
    abaixoDaBase: pontos.filter((p) => p < pontosBase).length,
    distribuicao: faixas.map((f) => ({
      faixa: f.faixa,
      colaboradores: pontos.filter((p) => p >= f.minimo && p <= f.maximo).length,
    })),
  };
}

/**
 * Ranking respeitando a visibilidade configurada (secao 9.2). `ANONIMIZADO` troca
 * o nome por um rotulo estavel dentro da lista, para o colaborador se achar sem
 * expor os colegas.
 */
export function aplicarVisibilidade(
  linhas: LinhaDoPainel[],
  visibilidade: 'PUBLICO' | 'APENAS_GESTOR' | 'ANONIMIZADO',
  ehGestor: boolean,
): LinhaDoPainel[] | null {
  if (visibilidade === 'PUBLICO') return linhas;
  if (visibilidade === 'APENAS_GESTOR') return ehGestor ? linhas : null;

  // anonimizar sem tirar a foto seria teatro: a cara identifica mais que o nome
  return linhas.map((l, i) => ({
    ...l,
    nome: `Colaborador ${i + 1}`,
    colaboradorId: `anon-${i + 1}`,
    fotoUrl: null,
  }));
}
