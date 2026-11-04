import { prisma } from '../../core/db.js';
import { Decimal, dinheiro } from '../../core/money.js';
import {
  agruparEmRaias, calcularKpis, COLUNAS_POR_PERFIL, montarColunas,
  type ColunaKanban, type KpisPainel, type LoteNoPainel, type Swimlane,
} from './kanban.js';
import type { StatusLote } from './state-machine.js';

export interface FiltrosPainel {
  criticidade?: 'P1' | 'P2' | 'P3' | 'P4';
  centroCusto?: string;
  fornecedorId?: string;
  valorMin?: string;
  valorMax?: string;
  de?: Date;
  ate?: Date;
  apenasMeus?: boolean;
  apenasAtrasados?: boolean;
  swimlane?: Swimlane;
  /** unidades que o usuario alcanca; vazio significa rede inteira (secao 5.6) */
  unidades?: string[];
}

/** Recorte por unidade reutilizado no board e nos agregados do cabecalho. */
const recorteDeUnidade = (unidades?: string[]) =>
  unidades && unidades.length > 0 ? { unidadeId: { in: unidades } } : {};

/** Colunas visiveis conforme o perfil de quem olha (secao 6.3). */
export function colunasDoUsuario(perfis: string[]): StatusLote[] {
  if (perfis.some((p) => ['Diretoria', 'Gerencia', 'Coordenador de Suprimentos'].includes(p))) {
    return COLUNAS_POR_PERFIL.APROVADOR!;
  }
  if (perfis.includes('Almoxarife')) return COLUNAS_POR_PERFIL.ALMOXARIFE!;
  return COLUNAS_POR_PERFIL.COMPRADOR!;
}

async function carregarLotes(usuarioId: string, colunas: StatusLote[], filtros: FiltrosPainel): Promise<LoteNoPainel[]> {
  const lotes = await prisma.lote.findMany({
    where: {
      deletedAt: null,
      status: { in: colunas },
      ...recorteDeUnidade(filtros.unidades),
      ...(filtros.criticidade ? { criticidade: filtros.criticidade } : {}),
      ...(filtros.apenasMeus ? { compradorId: usuarioId } : {}),
      ...(filtros.de || filtros.ate
        ? { createdAt: { ...(filtros.de ? { gte: filtros.de } : {}), ...(filtros.ate ? { lte: filtros.ate } : {}) } }
        : {}),
      ...(filtros.valorMin || filtros.valorMax
        ? {
            valorEstimado: {
              ...(filtros.valorMin ? { gte: filtros.valorMin } : {}),
              ...(filtros.valorMax ? { lte: filtros.valorMax } : {}),
            },
          }
        : {}),
      ...(filtros.centroCusto
        ? { solicitacoes: { some: { centroCusto: { codigo: filtros.centroCusto } } } }
        : {}),
      ...(filtros.fornecedorId ? { pedidos: { some: { fornecedorId: filtros.fornecedorId } } } : {}),
    },
    include: {
      comprador: { select: { nome: true } },
      solicitacoes: {
        select: { centroCusto: { select: { codigo: true } }, solicitante: { select: { nome: true } }, _count: { select: { itens: true } } },
      },
      pedidos: { select: { fornecedor: { select: { razaoSocial: true } } } },
      aprovacoes: { select: { aprovador: { select: { nome: true } } }, orderBy: { decididoEm: 'desc' }, take: 1 },
      _count: { select: { cotacoes: true } },
    },
    orderBy: [{ criticidade: 'asc' }, { slaVenceEm: 'asc' }],
    take: 500,
  });

  return lotes.map((l) => ({
    id: l.id,
    numero: l.numero,
    status: l.status as StatusLote,
    criticidade: l.criticidade,
    valor: l.valorFechado?.toString() ?? l.valorEstimado?.toString() ?? null,
    quantidadeItens: l.solicitacoes.reduce((soma, s) => soma + s._count.itens, 0),
    solicitante: l.solicitacoes[0]?.solicitante.nome ?? '—',
    centroCusto: l.solicitacoes[0]?.centroCusto.codigo ?? '—',
    compradorId: l.compradorId,
    compradorNome: l.comprador.nome,
    fornecedor: l.pedidos[0]?.fornecedor.razaoSocial ?? null,
    aprovador: l.aprovacoes[0]?.aprovador.nome ?? null,
    anexos: 0,
    notas: l._count.cotacoes,
    bloqueado: l.status === 'BLOQUEADO_DIVERGENCIA',
    abertoEm: l.createdAt,
    slaVenceEm: l.slaVenceEm,
  }));
}

export interface PainelKanban {
  colunas: ColunaKanban[];
  raias: Array<{ chave: string; rotulo: string; totalLotes: number }> | null;
  kpis: KpisPainel;
  swimlane: Swimlane | null;
}

export async function montarPainel(
  usuario: { sub: string; perfis: string[] },
  filtros: FiltrosPainel,
  agora = new Date(),
): Promise<PainelKanban> {
  const colunas = colunasDoUsuario(usuario.perfis);
  let lotes = await carregarLotes(usuario.sub, colunas, filtros);

  if (filtros.apenasAtrasados) {
    lotes = lotes.filter((l) => l.slaVenceEm !== null && l.slaVenceEm < agora);
  }

  // savings do mes e pedidos sem NF-e nao vem do board: sao agregados proprios
  const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const [agregadoSavings, pedidosSemNf] = await Promise.all([
    prisma.lote.aggregate({
      _sum: { savings: true },
      where: {
        deletedAt: null,
        aprovadoEm: { gte: inicioDoMes },
        savings: { not: null },
        ...recorteDeUnidade(filtros.unidades),
      },
    }),
    prisma.pedido.count({
      where: {
        deletedAt: null,
        status: { in: ['EMITIDO', 'CONFIRMADO', 'PARCIALMENTE_RECEBIDO', 'RECEBIDO'] },
        // "sem NF-e" enquanto o lote nao chegou em NF_LANCADA (three-way match entra na F3)
        lote: { status: { notIn: ['NF_LANCADA', 'ENCERRADO'] }, ...recorteDeUnidade(filtros.unidades) },
      },
    }),
  ]);

  const savings = agregadoSavings._sum.savings ?? new Decimal(0);

  return {
    colunas: montarColunas(lotes, colunas, agora),
    raias: filtros.swimlane
      ? agruparEmRaias(lotes, filtros.swimlane).map((r) => ({ chave: r.chave, rotulo: r.rotulo, totalLotes: r.lotes.length }))
      : null,
    kpis: calcularKpis(lotes, { savingsDoMes: dinheiro(savings.toString()), pedidosSemNotaFiscal: pedidosSemNf }, agora),
    swimlane: filtros.swimlane ?? null,
  };
}
