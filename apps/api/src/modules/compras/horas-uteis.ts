/**
 * SLA em HORAS UTEIS (secao 6.5): calendario de expediente + feriados parametrizaveis,
 * com suspensao enquanto a solicitacao estiver devolvida ao solicitante.
 * Modulo puro - o calendario vem dos parametros e e passado pelo chamador.
 *
 * Todo o calculo roda no fuso America/Fortaleza, que nao observa horario de verao.
 */

export interface Expediente {
  /** 'HH:MM' */
  inicio: string;
  /** 'HH:MM' */
  fim: string;
  /** ['HH:MM','HH:MM'] - intervalo descontado do expediente */
  almoco?: [string, string] | null;
  /** dias da semana uteis: 0 domingo .. 6 sabado */
  dias: number[];
}

export interface CalendarioUtil {
  expediente: Expediente;
  /** datas ISO 'yyyy-mm-dd' */
  feriados: string[];
}

const MINUTOS_POR_HORA = 60;
const MS_POR_MINUTO = 60_000;
const FUSO = 'America/Fortaleza';

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
});

const DIA_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface InstanteLocal {
  data: string;
  minutosNoDia: number;
  diaSemana: number;
}

/** Projeta um instante UTC no fuso de Fortaleza, sem depender do fuso do servidor. */
function local(d: Date): InstanteLocal {
  const partes = Object.fromEntries(formatador.formatToParts(d).map((p) => [p.type, p.value]));
  const hora = Number(partes.hour === '24' ? '0' : partes.hour);
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    minutosNoDia: hora * MINUTOS_POR_HORA + Number(partes.minute),
    diaSemana: DIA_SEMANA[partes.weekday as string] ?? 0,
  };
}

const emMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * MINUTOS_POR_HORA + Number(m);
};

function janelasDoDia(cal: CalendarioUtil, dia: InstanteLocal): Array<[number, number]> {
  if (!cal.expediente.dias.includes(dia.diaSemana)) return [];
  if (cal.feriados.includes(dia.data)) return [];

  const inicio = emMinutos(cal.expediente.inicio);
  const fim = emMinutos(cal.expediente.fim);
  if (fim <= inicio) return [];

  const almoco = cal.expediente.almoco;
  if (!almoco) return [[inicio, fim]];

  const aIni = emMinutos(almoco[0]);
  const aFim = emMinutos(almoco[1]);
  if (aFim <= aIni || aFim <= inicio || aIni >= fim) return [[inicio, fim]];

  const janelas: Array<[number, number]> = [];
  if (aIni > inicio) janelas.push([inicio, aIni]);
  if (fim > aFim) janelas.push([aFim, fim]);
  return janelas;
}

/** Minutos uteis por dia completo, usado para limitar a busca. */
const minutosUteisPorDia = (cal: CalendarioUtil, dia: InstanteLocal): number =>
  janelasDoDia(cal, dia).reduce((soma, [i, f]) => soma + (f - i), 0);

const avancarUmDia = (d: Date): Date => new Date(d.getTime() + 24 * 60 * MS_POR_MINUTO);

/** Instante UTC correspondente a `minutosNoDia` da data local de `referencia`. */
function instanteEm(referencia: Date, minutosAlvo: number): Date {
  const atual = local(referencia);
  return new Date(referencia.getTime() + (minutosAlvo - atual.minutosNoDia) * MS_POR_MINUTO);
}

/**
 * Soma `horas` uteis a partir de `inicio` e devolve o instante de vencimento.
 * Se `inicio` cai fora do expediente, a contagem comeca na proxima abertura.
 */
export function somarHorasUteis(inicio: Date, horas: number, cal: CalendarioUtil): Date {
  if (horas < 0) throw new RangeError('horas nao pode ser negativo.');

  let restante = Math.round(horas * MINUTOS_POR_HORA);
  let cursor = new Date(inicio.getTime());

  // SLA imediato (faixa 1 / P1): vence no proprio instante de abertura
  if (restante === 0) return cursor;

  // limite de seguranca: 400 dias corridos de busca
  for (let voltas = 0; voltas < 400; voltas += 1) {
    const dia = local(cursor);
    const janelas = janelasDoDia(cal, dia);

    for (const [abre, fecha] of janelas) {
      const posicao = local(cursor).minutosNoDia;
      if (posicao >= fecha) continue;

      const partida = Math.max(posicao, abre);
      const disponivel = fecha - partida;

      if (restante <= disponivel) return instanteEm(cursor, partida + restante);

      restante -= disponivel;
      cursor = instanteEm(cursor, fecha);
    }

    // proximo dia, na virada
    cursor = instanteEm(avancarUmDia(cursor), 0);
  }

  throw new RangeError('Nao foi possivel calcular o vencimento do SLA em 400 dias.');
}

/** Horas uteis decorridas entre dois instantes. Usado para aderencia ao SLA (secao 6.6). */
export function horasUteisEntre(inicio: Date, fim: Date, cal: CalendarioUtil): number {
  if (fim <= inicio) return 0;

  let total = 0;
  let cursor = new Date(inicio.getTime());

  for (let voltas = 0; voltas < 400; voltas += 1) {
    const dia = local(cursor);
    if (minutosUteisPorDia(cal, dia) > 0) {
      for (const [abre, fecha] of janelasDoDia(cal, dia)) {
        const inicioJanela = instanteEm(cursor, abre);
        const fimJanela = instanteEm(cursor, fecha);
        const de = Math.max(inicioJanela.getTime(), inicio.getTime());
        const ate = Math.min(fimJanela.getTime(), fim.getTime());
        if (ate > de) total += (ate - de) / MS_POR_MINUTO;
      }
    }
    cursor = instanteEm(avancarUmDia(cursor), 0);
    if (cursor.getTime() > fim.getTime()) break;
  }

  return Number((total / MINUTOS_POR_HORA).toFixed(4));
}

/**
 * SLA suspenso enquanto a solicitacao esta devolvida ao solicitante (secao 6.5):
 * o vencimento e empurrado pelas horas uteis que a suspensao consumiu.
 */
export function reprogramarPorSuspensao(
  vencimentoAtual: Date,
  suspensoEm: Date,
  retomadoEm: Date,
  cal: CalendarioUtil,
): Date {
  const horasParadas = horasUteisEntre(suspensoEm, retomadoEm, cal);
  if (horasParadas <= 0) return vencimentoAtual;
  return somarHorasUteis(vencimentoAtual, horasParadas, cal);
}

export const CALENDARIO_PADRAO: CalendarioUtil = {
  expediente: { inicio: '08:00', fim: '18:00', almoco: ['12:00', '13:00'], dias: [1, 2, 3, 4, 5] },
  feriados: [],
};
