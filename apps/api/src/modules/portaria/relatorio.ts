import { Decimal } from 'decimal.js';
import { kmDaViagem, permanenciaEmMinutos } from './regras.js';
import type { StatusAcesso, TipoAcesso } from '@prisma/client';

/**
 * Relatorio de movimento de veiculos pelo portao (secao 14.5).
 *
 * Modulo puro: recebe o que veio do banco e devolve a linha do relatorio e os
 * totais. A apuracao fica aqui, e nao na rota, para que a mesma conta valha na
 * tela, no XLSX e no teste — relatorio que calcula diferente em cada saida nao
 * serve como prova documental.
 *
 * O periodo recorta pelo **registro** do movimento, e nao pelo evento de
 * fechamento: a guarita registra no momento em que o veiculo cruza o portao, e
 * quem pede "o movimento de agosto" quer o que passou no portao em agosto —
 * inclusive o caminhao que saiu no dia 31 e voltou em setembro.
 */

export interface AcessoParaRelatorio {
  id: string;
  tipo: TipoAcesso;
  status: StatusAcesso;
  createdAt: Date;
  entradaEm: Date | null;
  saidaEm: Date | null;
  hodometroSaida: { toString(): string } | null;
  hodometroRetorno: { toString(): string } | null;
  motivo: string;
  destino: string | null;
  placaExterna: string | null;
  transportadora: string | null;
  veiculo: { placa: string; frotaNumero: string | null } | null;
  motorista: { nome: string } | null;
  pessoaExterna: { nome: string } | null;
  rota: { codigo: string; nome: string } | null;
  pontoAcesso: { codigo: string; nome: string };
}

export interface LinhaDoRelatorio {
  id: string;
  tipo: TipoAcesso;
  status: StatusAcesso;
  /** Placa do veiculo — da frota ou de terceiro, que so tem a placa. */
  placa: string | null;
  frotaNumero: string | null;
  rota: string | null;
  rotaCodigo: string | null;
  motorista: string | null;
  ponto: string;
  /** Quando o movimento comecou: saida para a rota, ou entrada no patio. */
  inicioEm: Date | null;
  /** Quando fechou: retorno do caminhao, ou saida do visitante. */
  fimEm: Date | null;
  registradoEm: Date;
  permanenciaMinutos: number | null;
  kmViagem: string | null;
  motivo: string;
  destino: string | null;
  emAberto: boolean;
}

export interface TotaisDoRelatorio {
  movimentos: number;
  encerrados: number;
  emAberto: number;
  saidasDaFrota: number;
  entradasDeTerceiros: number;
  /** Nulo, e nao zero, quando nenhum movimento encerrado tem os dois eventos. */
  permanenciaMediaMinutos: number | null;
  kmTotal: string | null;
  veiculosDistintos: number;
  rotasDistintas: number;
}

/**
 * Para o caminhao da casa a ordem se inverte: ele comeca dentro, entao o
 * movimento abre na saida e fecha na volta (secao 14.2).
 */
function eventos(acesso: AcessoParaRelatorio): {
  inicioEm: Date | null;
  fimEm: Date | null;
} {
  return acesso.tipo === 'VEICULO_PROPRIO'
    ? { inicioEm: acesso.saidaEm, fimEm: acesso.entradaEm }
    : { inicioEm: acesso.entradaEm, fimEm: acesso.saidaEm };
}

export function montarLinha(acesso: AcessoParaRelatorio, agora: Date): LinhaDoRelatorio {
  const { inicioEm, fimEm } = eventos(acesso);
  const encerrado = acesso.status === 'ENCERRADO';

  return {
    id: acesso.id,
    tipo: acesso.tipo,
    status: acesso.status,
    placa: acesso.veiculo?.placa ?? acesso.placaExterna ?? null,
    frotaNumero: acesso.veiculo?.frotaNumero ?? null,
    rota: acesso.rota ? `${acesso.rota.codigo} · ${acesso.rota.nome}` : null,
    rotaCodigo: acesso.rota?.codigo ?? null,
    // Terceiro nao tem cadastro de motorista: quem dirige e a pessoa da ficha.
    motorista: acesso.motorista?.nome ?? acesso.pessoaExterna?.nome ?? null,
    ponto: `${acesso.pontoAcesso.codigo} · ${acesso.pontoAcesso.nome}`,
    inicioEm,
    fimEm,
    registradoEm: acesso.createdAt,
    permanenciaMinutos: permanenciaEmMinutos(inicioEm, encerrado ? fimEm : null, agora),
    kmViagem:
      kmDaViagem(acesso.hodometroSaida?.toString() ?? null, acesso.hodometroRetorno?.toString() ?? null)?.toString() ??
      null,
    motivo: acesso.motivo,
    destino: acesso.destino ?? acesso.transportadora ?? null,
    emAberto: !encerrado && acesso.status !== 'CANCELADO' && acesso.status !== 'RECUSADO',
  };
}

export function totalizar(linhas: readonly LinhaDoRelatorio[]): TotaisDoRelatorio {
  const encerrados = linhas.filter((l) => l.status === 'ENCERRADO');

  // Media so sobre o que fechou: contar movimento aberto puxaria a media para
  // baixo com uma permanencia que ainda esta correndo.
  const comPermanencia = encerrados.filter((l) => l.permanenciaMinutos !== null);
  const somaMinutos = comPermanencia.reduce((soma, l) => soma + (l.permanenciaMinutos ?? 0), 0);

  const comKm = linhas.filter((l) => l.kmViagem !== null);
  const kmTotal = comKm.reduce((soma, l) => soma.plus(new Decimal(l.kmViagem as string)), new Decimal(0));

  return {
    movimentos: linhas.length,
    encerrados: encerrados.length,
    emAberto: linhas.filter((l) => l.emAberto).length,
    saidasDaFrota: linhas.filter((l) => l.tipo === 'VEICULO_PROPRIO').length,
    entradasDeTerceiros: linhas.filter((l) => l.tipo === 'VEICULO_EXTERNO').length,
    // Sem base o indicador e nulo, nunca zero (secao 10.3).
    permanenciaMediaMinutos: comPermanencia.length === 0 ? null : Math.round(somaMinutos / comPermanencia.length),
    kmTotal: comKm.length === 0 ? null : kmTotal.toDecimalPlaces(1).toString(),
    veiculosDistintos: new Set(linhas.map((l) => l.placa).filter(Boolean)).size,
    rotasDistintas: new Set(linhas.map((l) => l.rotaCodigo).filter(Boolean)).size,
  };
}

/** A memoria de calculo acompanha o numero — na tela e no arquivo (secao 10.3). */
export function memoriaDeCalculo(limitePermanenciaHoras: number): Record<string, string> {
  return {
    Recorte:
      'Movimentos de veiculo registrados no periodo, pela data e hora do registro na guarita. ' +
      'Caminhao que saiu no ultimo dia do periodo e voltou depois entra no periodo da saida, com o retorno exibido.',
    Movimentos: 'Quantidade de acessos de veiculo (frota e terceiro) no recorte.',
    Permanencia:
      'Do evento de abertura ao de fechamento. Para o caminhao da frota a abertura e a SAIDA para a rota e o ' +
      'fechamento e o RETORNO; para veiculo de terceiro a abertura e a ENTRADA e o fechamento e a SAIDA (secao 14.2).',
    'Permanencia media':
      'Soma das permanencias dos movimentos ENCERRADOS dividida pela quantidade deles. Movimento em aberto nao entra: ' +
      'a permanencia dele ainda esta correndo. Sem movimento encerrado, o indicador e nulo — nunca zero.',
    'Km da viagem':
      'Hodometro de retorno menos hodometro de saida, com uma casa decimal. Movimento sem as duas leituras nao soma.',
    'Em aberto':
      `Movimento sem o evento de fechamento registrado. Acima de ${limitePermanenciaHoras}h costuma ser saida que ninguem ` +
      'registrou, e nao veiculo ainda fora (secao 14.3).',
  };
}
