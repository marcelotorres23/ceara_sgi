/**
 * Vencimento de documentos de veiculo e de motorista (secao 7.1).
 * Alerta em D-30, D-15 e D-7. Modulo puro - as janelas sao parametrizaveis.
 *
 * Comparacao por DIA no fuso America/Fortaleza: um documento que vence hoje as 23h
 * nao pode ser tratado como vencido as 8h da manha por causa de aritmetica de milissegundos.
 */

export const JANELAS_PADRAO = [30, 15, 7] as const;

export type SituacaoDocumento = 'VENCIDO' | 'VENCE_HOJE' | 'EM_ALERTA' | 'REGULAR';

export interface DocumentoParaConferir {
  id: string;
  tipo: string;
  /** 'veiculo' | 'motorista' */
  origem: string;
  origemId: string;
  identificacao: string;
  vencimento: Date;
}

export interface AlertaDocumento extends DocumentoParaConferir {
  situacao: SituacaoDocumento;
  diasRestantes: number;
  /** janela atingida (30, 15 ou 7); null quando regular ou vencido */
  janela: number | null;
  semaforo: 'vermelho' | 'ouro' | 'verde';
  mensagem: string;
}

const FUSO = 'America/Fortaleza';
const formatador = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Converte um instante no dia local (meia-noite UTC do dia correspondente em Fortaleza). */
function diaLocal(d: Date): number {
  const [ano, mes, dia] = formatador.format(d).split('-').map(Number);
  return Date.UTC(ano!, mes! - 1, dia!) / 86_400_000;
}

export const diasAte = (vencimento: Date, agora = new Date()): number =>
  diaLocal(vencimento) - diaLocal(agora);

export function classificarDocumento(
  doc: DocumentoParaConferir,
  janelas: readonly number[] = JANELAS_PADRAO,
  agora = new Date(),
): AlertaDocumento {
  const dias = diasAte(doc.vencimento, agora);

  if (dias < 0) {
    return {
      ...doc,
      situacao: 'VENCIDO',
      diasRestantes: dias,
      janela: null,
      semaforo: 'vermelho',
      mensagem: `${doc.tipo} de ${doc.identificacao} vencido ha ${Math.abs(dias)} dia(s).`,
    };
  }

  if (dias === 0) {
    return {
      ...doc,
      situacao: 'VENCE_HOJE',
      diasRestantes: 0,
      janela: null,
      semaforo: 'vermelho',
      mensagem: `${doc.tipo} de ${doc.identificacao} vence hoje.`,
    };
  }

  // menor janela que ainda cobre o prazo: 5 dias cai na janela de 7, nao na de 30
  const ordenadas = [...janelas].sort((a, b) => a - b);
  const janela = ordenadas.find((j) => dias <= j) ?? null;

  if (janela === null) {
    return {
      ...doc,
      situacao: 'REGULAR',
      diasRestantes: dias,
      janela: null,
      semaforo: 'verde',
      mensagem: `${doc.tipo} de ${doc.identificacao} regular por mais ${dias} dias.`,
    };
  }

  return {
    ...doc,
    situacao: 'EM_ALERTA',
    diasRestantes: dias,
    janela,
    semaforo: 'ouro',
    mensagem: `${doc.tipo} de ${doc.identificacao} vence em ${dias} dia(s).`,
  };
}

export interface PainelDocumentos {
  alertas: AlertaDocumento[];
  vencidos: number;
  venceHoje: number;
  emAlerta: number;
  regulares: number;
}

/** Ordena por urgencia: vencidos primeiro, depois pelo menor prazo restante. */
export function montarPainelDocumentos(
  documentos: DocumentoParaConferir[],
  janelas: readonly number[] = JANELAS_PADRAO,
  agora = new Date(),
): PainelDocumentos {
  const alertas = documentos
    .map((d) => classificarDocumento(d, janelas, agora))
    .sort((a, b) => a.diasRestantes - b.diasRestantes);

  return {
    alertas,
    vencidos: alertas.filter((a) => a.situacao === 'VENCIDO').length,
    venceHoje: alertas.filter((a) => a.situacao === 'VENCE_HOJE').length,
    emAlerta: alertas.filter((a) => a.situacao === 'EM_ALERTA').length,
    regulares: alertas.filter((a) => a.situacao === 'REGULAR').length,
  };
}

/**
 * Veiculo com documento vencido nao deve rodar; motorista com CNH, toxicologico ou
 * ASO vencido nao deve dirigir. A decisao de bloquear a saida e do checklist (F6);
 * aqui devolvemos apenas o impedimento apurado.
 */
export function impedimentos(alertas: AlertaDocumento[]): Array<{ origemId: string; motivos: string[] }> {
  const porOrigem = new Map<string, string[]>();

  for (const a of alertas) {
    if (a.situacao !== 'VENCIDO') continue;
    porOrigem.set(a.origemId, [...(porOrigem.get(a.origemId) ?? []), `${a.tipo} vencido`]);
  }

  return [...porOrigem.entries()].map(([origemId, motivos]) => ({ origemId, motivos }));
}
