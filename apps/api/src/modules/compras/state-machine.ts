import { InvalidTransitionError } from '../../core/errors/index.js';

/**
 * Maquina de estados do lote (secao 6.2). Transicao invalida = 422, jamais silenciosa.
 * Modulo puro - a persistencia da transicao fica no service.
 */

export type StatusLote =
  | 'RASCUNHO'
  | 'TRIAGEM'
  | 'EM_COTACAO'
  | 'MAPA_PRONTO'
  | 'AGUARDANDO_APROVACAO'
  | 'APROVADO'
  | 'PEDIDO_EMITIDO'
  | 'AGUARDANDO_ENTREGA'
  | 'RECEBIDO_PARCIAL'
  | 'RECEBIDO'
  | 'NF_LANCADA'
  | 'ENCERRADO'
  | 'DEVOLVIDO_AO_SOLICITANTE'
  | 'EM_RENEGOCIACAO'
  | 'REPROVADO'
  | 'CANCELADO'
  | 'BLOQUEADO_DIVERGENCIA';

const TRANSICOES: Record<StatusLote, StatusLote[]> = {
  RASCUNHO: ['TRIAGEM', 'CANCELADO'],
  TRIAGEM: ['EM_COTACAO', 'DEVOLVIDO_AO_SOLICITANTE', 'CANCELADO'],
  EM_COTACAO: ['MAPA_PRONTO', 'DEVOLVIDO_AO_SOLICITANTE', 'CANCELADO'],
  MAPA_PRONTO: ['AGUARDANDO_APROVACAO', 'EM_COTACAO', 'CANCELADO'],
  AGUARDANDO_APROVACAO: ['APROVADO', 'REPROVADO', 'EM_RENEGOCIACAO', 'CANCELADO'],
  APROVADO: ['PEDIDO_EMITIDO', 'CANCELADO'],
  PEDIDO_EMITIDO: ['AGUARDANDO_ENTREGA', 'CANCELADO'],
  AGUARDANDO_ENTREGA: ['RECEBIDO_PARCIAL', 'RECEBIDO', 'BLOQUEADO_DIVERGENCIA'],
  RECEBIDO_PARCIAL: ['RECEBIDO', 'BLOQUEADO_DIVERGENCIA'],
  RECEBIDO: ['NF_LANCADA', 'BLOQUEADO_DIVERGENCIA'],
  NF_LANCADA: ['ENCERRADO', 'BLOQUEADO_DIVERGENCIA'],
  ENCERRADO: [],
  DEVOLVIDO_AO_SOLICITANTE: ['TRIAGEM', 'CANCELADO'],
  EM_RENEGOCIACAO: ['MAPA_PRONTO', 'EM_COTACAO', 'CANCELADO'],
  REPROVADO: ['EM_RENEGOCIACAO', 'CANCELADO'],
  CANCELADO: [],
  BLOQUEADO_DIVERGENCIA: ['RECEBIDO_PARCIAL', 'RECEBIDO', 'NF_LANCADA', 'CANCELADO'],
};

/** Ordem do fluxo principal, usada para detectar movimento para tras no Kanban (F2). */
const ORDEM_FLUXO: StatusLote[] = [
  'RASCUNHO', 'TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'APROVADO',
  'PEDIDO_EMITIDO', 'AGUARDANDO_ENTREGA', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'NF_LANCADA', 'ENCERRADO',
];

/** Estados que so podem ser atingidos com motivo registrado. */
const EXIGEM_MOTIVO = new Set<StatusLote>([
  'DEVOLVIDO_AO_SOLICITANTE',
  'EM_RENEGOCIACAO',
  'REPROVADO',
  'CANCELADO',
  'BLOQUEADO_DIVERGENCIA',
]);

export const ESTADOS_FINAIS = new Set<StatusLote>(['ENCERRADO', 'CANCELADO']);

export const transicoesValidas = (de: StatusLote): StatusLote[] => [...TRANSICOES[de]];

export const podeTransicionar = (de: StatusLote, para: StatusLote): boolean =>
  TRANSICOES[de]?.includes(para) ?? false;

/** Retrocesso no fluxo principal exige motivo, mesmo quando o destino nao o exige por si. */
export function ehRetrocesso(de: StatusLote, para: StatusLote): boolean {
  const i = ORDEM_FLUXO.indexOf(de);
  const j = ORDEM_FLUXO.indexOf(para);
  return i >= 0 && j >= 0 && j < i;
}

export function exigeMotivo(de: StatusLote, para: StatusLote): boolean {
  return EXIGEM_MOTIVO.has(para) || ehRetrocesso(de, para);
}

/**
 * Destinos que **nao se alcancam arrastando o card** (secao 6.3).
 *
 * O board move o lote pela maquina de estados, e a maquina de estados so sabe se o caminho
 * existe — nao sabe quem esta empurrando nem se o valor cabe na alcada de quem empurra.
 * Cada destino aqui tem um ato proprio, com dado e checagem que o arrasto nao tem: a
 * aprovacao passa pela faixa de alcada e pela SoD que impede o comprador de aprovar o
 * proprio lote; o pedido precisa da data prometida; o recebimento, do three-way match.
 *
 * Sem esta lista, arrastar era um atalho que pulava as tres coisas.
 */
export const DESTINOS_COM_ATO_PROPRIO: Partial<Record<StatusLote, string>> = {
  APROVADO: 'A aprovacao passa pela fila de aprovacao, que confere a faixa de alcada e impede quem cotou de aprovar o proprio lote. Abra o lote e decida por la.',
  REPROVADO: 'Reprovar e decisao registrada na fila de aprovacao, com justificativa. Abra o lote e decida por la.',
  PEDIDO_EMITIDO: 'Emitir pedido exige a data prometida pelo fornecedor. Use a emissao de pedido no lote.',
  RECEBIDO: 'O recebimento passa pela conferencia de quantidade e preco (three-way match). Registre pelo recebimento.',
  RECEBIDO_PARCIAL: 'O recebimento passa pela conferencia de quantidade e preco (three-way match). Registre pelo recebimento.',
  NF_LANCADA: 'O lancamento da NF-e e da entrada fiscal, que confere a nota contra o pedido.',
  ENCERRADO: 'Encerrar exige material recebido, NF-e lancada e titulo provisionado. O sistema encerra sozinho quando as tres condicoes se cumprem.',
};

/**
 * Permissao exigida para arrastar o card ate cada destino que o board ainda aceita.
 *
 * Arrastar e a forma curta de fazer o que a tela do lote faz — entao pede a mesma
 * permissao. `lote:consultar` abre o board; nao move nada nele.
 */
export const PERMISSAO_POR_DESTINO: Partial<Record<StatusLote, string>> = {
  TRIAGEM: 'solicitacao:triar',
  DEVOLVIDO_AO_SOLICITANTE: 'solicitacao:triar',
  EM_COTACAO: 'cotacao:gerenciar',
  MAPA_PRONTO: 'mapa:gerar',
  AGUARDANDO_APROVACAO: 'mapa:gerar',
  // devolver para renegociar e a terceira saida da fila de aprovacao, ao lado de aprovar e reprovar
  EM_RENEGOCIACAO: 'lote:aprovar',
  CANCELADO: 'solicitacao:cancelar',
  AGUARDANDO_ENTREGA: 'pedido:emitir',
  BLOQUEADO_DIVERGENCIA: 'recebimento:registrar',
};

export type DecisaoDeArrasto =
  | { permitido: true; exige: string }
  | { permitido: false; motivo: string };

/**
 * O que o board pode fazer com este arrasto, antes de olhar para quem arrastou.
 *
 * Devolve a permissao a exigir, ou a recusa com o texto que manda a pessoa para a tela
 * certa. Recusar sem dizer para onde ir transforma regra em parede.
 */
export function arrastoNoBoard(para: StatusLote): DecisaoDeArrasto {
  const atoProprio = DESTINOS_COM_ATO_PROPRIO[para];
  if (atoProprio) return { permitido: false, motivo: atoProprio };

  const exige = PERMISSAO_POR_DESTINO[para];
  // destino novo na maquina de estados entra fechado ate ganhar dono explicito
  if (!exige) return { permitido: false, motivo: `Mover para ${para} nao e feito pelo painel.` };

  return { permitido: true, exige };
}

export interface ResultadoTransicao {
  de: StatusLote;
  para: StatusLote;
  motivo: string | null;
}

/**
 * Valida a transicao. Lanca 422 se invalida e 400 se faltar motivo obrigatorio.
 * Nenhum caminho do sistema deve alterar `lotes.status` sem passar por aqui.
 */
export function validarTransicao(de: StatusLote, para: StatusLote, motivo?: string | null): ResultadoTransicao {
  if (de === para) throw new InvalidTransitionError(de, para);
  if (!podeTransicionar(de, para)) throw new InvalidTransitionError(de, para);

  const texto = motivo?.trim() ?? '';
  if (exigeMotivo(de, para) && texto.length < 5) {
    throw new InvalidTransitionError(de, para);
  }

  return { de, para, motivo: texto.length > 0 ? texto : null };
}

/**
 * Encerramento so e permitido com material recebido, NF-e lancada e titulo provisionado
 * (secao 6.2). As duas ultimas condicoes chegam na F3; a assinatura ja as exige.
 */
export function podeEncerrar(entrada: {
  status: StatusLote;
  materialRecebido: boolean;
  notaFiscalLancada: boolean;
  tituloProvisionado: boolean;
}): boolean {
  return (
    entrada.status === 'NF_LANCADA' &&
    entrada.materialRecebido &&
    entrada.notaFiscalLancada &&
    entrada.tituloProvisionado
  );
}
