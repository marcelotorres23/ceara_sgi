import { Decimal, centavos, dinheiro, type ValorMonetario } from '../../core/money.js';
import type { StatusLote } from './state-machine.js';

/**
 * Regras de apresentacao do painel Kanban (secao 6.3). Modulo puro:
 * recebe os dados ja lidos e devolve o que a tela precisa desenhar.
 */

/** Colunas configuraveis por perfil: o comprador ve da triagem ao encerramento;
 *  o aprovador ve so a raia de aprovacao. */
export const COLUNAS_POR_PERFIL: Record<string, StatusLote[]> = {
  COMPRADOR: [
    'TRIAGEM',
    'EM_COTACAO',
    'MAPA_PRONTO',
    'AGUARDANDO_APROVACAO',
    'APROVADO',
    'PEDIDO_EMITIDO',
    'AGUARDANDO_ENTREGA',
    'RECEBIDO',
    'NF_LANCADA',
    'ENCERRADO',
  ],
  APROVADOR: ['AGUARDANDO_APROVACAO', 'APROVADO', 'REPROVADO', 'EM_RENEGOCIACAO'],
  ALMOXARIFE: ['AGUARDANDO_ENTREGA', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'BLOQUEADO_DIVERGENCIA'],
};

export const ROTULO_COLUNA: Record<StatusLote, string> = {
  RASCUNHO: 'Rascunho',
  TRIAGEM: 'Triagem',
  EM_COTACAO: 'Em cotacao',
  MAPA_PRONTO: 'Mapa pronto',
  AGUARDANDO_APROVACAO: 'Aguardando aprovacao',
  APROVADO: 'Aprovado',
  PEDIDO_EMITIDO: 'Pedido emitido',
  AGUARDANDO_ENTREGA: 'Aguardando entrega',
  RECEBIDO_PARCIAL: 'Recebido parcial',
  RECEBIDO: 'Recebido',
  NF_LANCADA: 'NF lancada',
  ENCERRADO: 'Encerrado',
  DEVOLVIDO_AO_SOLICITANTE: 'Devolvido ao solicitante',
  EM_RENEGOCIACAO: 'Em renegociacao',
  REPROVADO: 'Reprovado',
  CANCELADO: 'Cancelado',
  BLOQUEADO_DIVERGENCIA: 'Bloqueado por divergencia',
};

/** Cor da barra lateral do card, por criticidade (secao 6.3). */
export const COR_CRITICIDADE: Record<'P1' | 'P2' | 'P3' | 'P4', 'vermelho' | 'ouro' | 'azul' | 'cinza'> = {
  P1: 'vermelho',
  P2: 'ouro',
  P3: 'azul',
  P4: 'cinza',
};

export interface ConsumoSla {
  /** 0 a 100; passa de 100 quando vencido */
  percentual: number;
  vencido: boolean;
  /** horas corridas restantes; negativo quando vencido */
  horasRestantes: number;
  rotulo: string;
}

const HORA_MS = 3_600_000;

/**
 * Barra de consumo do SLA do card. O percentual usa tempo corrido entre a abertura
 * do lote e o vencimento ja calculado em horas uteis - a conversao para horas uteis
 * ja aconteceu quando `venceEm` foi gravado.
 */
export function consumoSla(abertoEm: Date, venceEm: Date | null, agora = new Date()): ConsumoSla {
  if (!venceEm) {
    return { percentual: 0, vencido: false, horasRestantes: Number.POSITIVE_INFINITY, rotulo: 'Sem SLA definido' };
  }

  const total = venceEm.getTime() - abertoEm.getTime();
  const decorrido = agora.getTime() - abertoEm.getTime();
  const restanteMs = venceEm.getTime() - agora.getTime();
  const horasRestantes = Math.round((restanteMs / HORA_MS) * 10) / 10;

  // SLA imediato (faixa 1 / P1): sem janela, ou vence agora ou ja venceu
  const percentual = total <= 0 ? (restanteMs < 0 ? 100 : 0) : Math.max(0, Math.round((decorrido / total) * 100));
  const vencido = restanteMs < 0;

  return {
    percentual: vencido ? Math.max(percentual, 100) : Math.min(percentual, 99),
    vencido,
    horasRestantes,
    rotulo: vencido ? `Vencido ha ${formatarHoras(-horasRestantes)}` : `Vence em ${formatarHoras(horasRestantes)}`,
  };
}

function formatarHoras(horas: number): string {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))}min`;
  if (horas < 48) return `${Math.round(horas)}h`;
  return `${Math.round(horas / 24)} dias`;
}

/** Dias corridos em aberto. Visivel no card a partir de 5 dias (secao 6.3). */
export function aging(abertoEm: Date, agora = new Date()): { dias: number; exibir: boolean; critico: boolean } {
  const dias = Math.floor((agora.getTime() - abertoEm.getTime()) / (24 * HORA_MS));
  return { dias, exibir: dias >= 5, critico: dias > 10 };
}

export interface LoteNoPainel {
  id: string;
  numero: string;
  status: StatusLote;
  criticidade: 'P1' | 'P2' | 'P3' | 'P4';
  valor: ValorMonetario | null;
  quantidadeItens: number;
  solicitante: string;
  centroCusto: string;
  compradorId: string;
  compradorNome: string;
  fornecedor: string | null;
  aprovador: string | null;
  anexos: number;
  notas: number;
  bloqueado: boolean;
  abertoEm: Date;
  slaVenceEm: Date | null;
}

export interface CardKanban extends LoteNoPainel {
  sla: ConsumoSla;
  aging: ReturnType<typeof aging>;
  cor: 'vermelho' | 'ouro' | 'azul' | 'cinza';
}

export const montarCard = (lote: LoteNoPainel, agora = new Date()): CardKanban => ({
  ...lote,
  sla: consumoSla(lote.abertoEm, lote.slaVenceEm, agora),
  aging: aging(lote.abertoEm, agora),
  cor: COR_CRITICIDADE[lote.criticidade],
});

export interface ColunaKanban {
  status: StatusLote;
  rotulo: string;
  total: number;
  valor: string;
  cards: CardKanban[];
}

/** Distribui os lotes nas colunas do perfil. Coluna sem lote continua visivel. */
export function montarColunas(lotes: LoteNoPainel[], colunas: StatusLote[], agora = new Date()): ColunaKanban[] {
  return colunas.map((status) => {
    const cards = lotes.filter((l) => l.status === status).map((l) => montarCard(l, agora));
    return {
      status,
      rotulo: ROTULO_COLUNA[status],
      total: cards.length,
      valor: cards
        .reduce<Decimal>((acc, c) => acc.plus(dinheiro(c.valor ?? 0)), new Decimal(0))
        .toFixed(2),
      cards,
    };
  });
}

export type Swimlane = 'CRITICIDADE' | 'COMPRADOR' | 'CENTRO_CUSTO';

/** Swimlanes alternaveis do painel (secao 6.3). */
export function agruparEmRaias(lotes: LoteNoPainel[], por: Swimlane): Array<{ chave: string; rotulo: string; lotes: LoteNoPainel[] }> {
  const chaveDe = (l: LoteNoPainel): string => {
    if (por === 'CRITICIDADE') return l.criticidade;
    if (por === 'COMPRADOR') return l.compradorNome;
    return l.centroCusto;
  };

  const mapa = new Map<string, LoteNoPainel[]>();
  for (const l of lotes) {
    const chave = chaveDe(l);
    mapa.set(chave, [...(mapa.get(chave) ?? []), l]);
  }

  const raias = [...mapa.entries()].map(([chave, itens]) => ({ chave, rotulo: chave, lotes: itens }));

  // criticidade tem ordem propria: P1 primeiro
  if (por === 'CRITICIDADE') raias.sort((a, b) => a.chave.localeCompare(b.chave));
  else raias.sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));

  return raias;
}

export interface KpisPainel {
  lotesEmAberto: number;
  valorEmNegociacao: string;
  percentualDentroDoSla: number;
  agingAcimaDe10Dias: number;
  savingsDoMes: string;
  pedidosSemNotaFiscal: number;
}

const ABERTOS: StatusLote[] = [
  'TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'APROVADO',
  'PEDIDO_EMITIDO', 'AGUARDANDO_ENTREGA', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'NF_LANCADA',
  'EM_RENEGOCIACAO', 'BLOQUEADO_DIVERGENCIA',
];

const EM_NEGOCIACAO: StatusLote[] = ['EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'EM_RENEGOCIACAO'];

/** KPIs ao vivo do cabecalho do painel (secao 6.3). */
export function calcularKpis(
  lotes: LoteNoPainel[],
  extras: { savingsDoMes: ValorMonetario; pedidosSemNotaFiscal: number },
  agora = new Date(),
): KpisPainel {
  const abertos = lotes.filter((l) => ABERTOS.includes(l.status));

  const valorEmNegociacao = lotes
    .filter((l) => EM_NEGOCIACAO.includes(l.status))
    .reduce<Decimal>((acc, l) => acc.plus(dinheiro(l.valor ?? 0)), new Decimal(0));

  const comSla = abertos.filter((l) => l.slaVenceEm !== null);
  const dentroDoSla = comSla.filter((l) => !consumoSla(l.abertoEm, l.slaVenceEm, agora).vencido).length;

  return {
    lotesEmAberto: abertos.length,
    valorEmNegociacao: centavos(valorEmNegociacao).toFixed(2),
    // sem lote com SLA, a aderencia e 100% por vacuidade - nao ha atraso
    percentualDentroDoSla: comSla.length === 0 ? 100 : Math.round((dentroDoSla / comSla.length) * 100),
    agingAcimaDe10Dias: abertos.filter((l) => aging(l.abertoEm, agora).critico).length,
    savingsDoMes: centavos(extras.savingsDoMes).toFixed(2),
    pedidosSemNotaFiscal: extras.pedidosSemNotaFiscal,
  };
}
