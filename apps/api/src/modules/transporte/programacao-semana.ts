import { PESO_SEVERIDADE, type Severidade } from './regua-manutencao.js';
import type { ItemDoPatio, VeiculoNoPatio } from './servico-periodico.service.js';

/**
 * Programacao da semana da oficina (ADR 0023, passo 3).
 *
 * O patio responde **quem esta pior**. Esta camada responde a pergunta seguinte, que e a que
 * o encarregado faz de manha com a prancheta na mao: **quem entra no box esta semana, e o que
 * se faz em cada um quando ele estiver la dentro**.
 *
 * Duas regras vem direto do plano de manutencao preventiva da frota (item 6, "rotina diaria"):
 *
 * - **Programa-se pelos vencidos.** Vencido nao espera dia bonito na agenda; ele e a razao da
 *   parada. Critico entra junto porque o ciclo dele acaba dentro da semana que esta sendo
 *   montada — deixar para a proxima e programar o vencimento.
 * - **Encaixa-se o que estiver na mesma faixa.** Com o caminhao no elevador, trocar tambem o
 *   item que esta em atencao custa a peca e nao custa a parada. Nao encaixar e pagar duas
 *   viagens ao box pelo mesmo servico — foi o que a planilha fazia.
 *
 * O que **nao** entra: veiculo cujo unico apontamento e `SEM_BASE`. Falta de leitura nao e falta
 * de manutencao (decisao 5 do ADR), e encher a fila com quem talvez nem esteja vencido tira o
 * box de quem esta. Ele sai numa lista propria — a de quem precisa de leitura antes de plano.
 */

/** Em que momento da fila o veiculo entra. */
export type FaixaDaProgramacao = 'IMEDIATO' | 'ESTA_SEMANA' | 'PROXIMA_SEMANA';

export const ROTULO_FAIXA: Record<FaixaDaProgramacao, string> = {
  IMEDIATO: 'Entrar agora',
  ESTA_SEMANA: 'Esta semana',
  PROXIMA_SEMANA: 'Proxima semana',
};

/** Horizonte de uma semana de programacao, em dias. */
export const HORIZONTE_PADRAO_DIAS = 7;

/**
 * Dias sem leitura a partir dos quais o veiculo perde credibilidade de painel.
 *
 * Uma semana e o ciclo natural da operacao: quem roda todo dia abastece, passa na portaria ou
 * entra em checklist dentro de sete dias. Passou disso, o hodometro na tela e memoria, e nao
 * medicao — e programar em cima dele e chutar com selo de sistema.
 */
export const DIAS_SEM_LEITURA_TOLERADOS = 7;

export interface ServicoProgramado {
  tipo: ItemDoPatio['tipo'];
  rotulo: string;
  base: ItemDoPatio['base'];
  severidade: Severidade;
  /** o item e a razao da parada, ou pegou carona nela */
  encaixe: boolean;
  usado: number;
  aVencer: string;
  vencido: string;
  venceEmDias: number | null;
  motivo: string | null;
}

export interface VeiculoProgramado {
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  descricao: string;
  unidadeId: string;
  hodometro: string;
  kmPorDia: string | null;
  diasSemLeitura: number | null;
  faixa: FaixaDaProgramacao;
  /** por que este caminhao esta nesta faixa, em portugues */
  motivo: string;
  score: number;
  pior: Severidade;
  venceEmDias: number | null;
  /** o que abre a OS: vencidos e criticos primeiro, encaixes depois */
  servicos: ServicoProgramado[];
  /** quantos servicos justificam a parada, sem contar os encaixes */
  motivadores: number;
  encaixes: number;
}

export interface AtivoSemLeitura {
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  descricao: string;
  unidadeId: string;
  hodometro: string;
  /** null quando o veiculo nunca teve leitura registrada */
  diasSemLeitura: number | null;
  motivo: string;
}

export interface Programacao {
  horizonteDias: number;
  itens: VeiculoProgramado[];
  /** quem nao pode ser programado porque o painel dele nao tem medicao de pe (ADR 0023) */
  semLeitura: AtivoSemLeitura[];
  resumo: {
    veiculos: number;
    imediato: number;
    estaSemana: number;
    proximaSemana: number;
    servicos: number;
    encaixes: number;
    semLeitura: number;
  };
}

/** Severidades que sozinhas justificam levar o caminhao ao box. */
const MOTIVA_PARADA: readonly Severidade[] = ['VENCIDO', 'CRITICO'];
/** Severidade que nao motiva parada, mas aproveita a que ja vai acontecer. */
const ENCAIXA: readonly Severidade[] = ['ATENCAO'];

/**
 * Monta a semana a partir das linhas do patio.
 *
 * Funcao pura de proposito: a conta que decide quem para o caminhao precisa ser conferivel sem
 * banco, e o patio ja resolveu a parte cara — regua, ritmo e score de cada linha.
 */
export function programacaoDaSemana(
  linhas: readonly VeiculoNoPatio[],
  horizonteDias = HORIZONTE_PADRAO_DIAS,
): Programacao {
  const itens: VeiculoProgramado[] = [];
  const semLeitura: AtivoSemLeitura[] = [];

  for (const linha of linhas) {
    const falta = faltaDeLeitura(linha);
    if (falta !== null) semLeitura.push(falta);

    const faixa = faixaDo(linha, horizonteDias);
    if (faixa === null) continue;

    const motivadores = linha.itens.filter((i) => MOTIVA_PARADA.includes(i.severidade));
    const encaixes = linha.itens.filter((i) => ENCAIXA.includes(i.severidade));

    /*
     * A faixa pode vir da previsao em dias sem que nenhum item esteja vencido ou critico ainda.
     * Nesse caso o que motiva a parada e justamente o que vence dentro do horizonte, e o resto
     * pega carona — senao a OS sairia sem nenhuma linha de servico.
     */
    const porPrevisao =
      motivadores.length === 0
        ? linha.itens.filter((i) => i.venceEmDias !== null && i.venceEmDias <= horizonteDias * 2)
        : [];

    const razoes = motivadores.length > 0 ? motivadores : porPrevisao;
    const carona = encaixes.filter((i) => !razoes.includes(i));
    if (razoes.length === 0) continue;

    const servicos = [
      ...ordenar(razoes).map((i) => servicoProgramado(i, false)),
      ...ordenar(carona).map((i) => servicoProgramado(i, true)),
    ];

    itens.push({
      veiculoId: linha.veiculoId,
      placa: linha.placa,
      frotaNumero: linha.frotaNumero,
      descricao: linha.descricao,
      unidadeId: linha.unidadeId,
      hodometro: linha.hodometro,
      kmPorDia: linha.kmPorDia,
      diasSemLeitura: linha.diasSemLeitura,
      faixa,
      motivo: motivoDaFaixa(linha, faixa, razoes.length),
      score: linha.score,
      pior: linha.pior,
      venceEmDias: linha.venceEmDias,
      servicos,
      motivadores: razoes.length,
      encaixes: carona.length,
    });
  }

  // dentro da semana, a fila e a mesma do box: score manda, placa desempata para nao dancar
  const ordem: Record<FaixaDaProgramacao, number> = { IMEDIATO: 0, ESTA_SEMANA: 1, PROXIMA_SEMANA: 2 };
  itens.sort(
    (a, b) => ordem[a.faixa] - ordem[b.faixa] || b.score - a.score || a.placa.localeCompare(b.placa),
  );
  semLeitura.sort((a, b) => (b.diasSemLeitura ?? Infinity) - (a.diasSemLeitura ?? Infinity) || a.placa.localeCompare(b.placa));

  return {
    horizonteDias,
    itens,
    semLeitura,
    resumo: {
      veiculos: itens.length,
      imediato: itens.filter((i) => i.faixa === 'IMEDIATO').length,
      estaSemana: itens.filter((i) => i.faixa === 'ESTA_SEMANA').length,
      proximaSemana: itens.filter((i) => i.faixa === 'PROXIMA_SEMANA').length,
      servicos: itens.reduce((t, i) => t + i.servicos.length, 0),
      encaixes: itens.reduce((t, i) => t + i.encaixes, 0),
      semLeitura: semLeitura.length,
    },
  };
}

/**
 * Em que faixa o caminhao cai, ou `null` quando ele nao entra na semana.
 *
 * Vencido e imediato sem discussao. Critico entra na semana porque o ciclo acaba dentro dela.
 * O resto entra pela previsao do proprio ritmo: e o que transforma "faltam 1.200 km" em uma
 * data no quadro — e so vale para quem tem ritmo apurado.
 */
function faixaDo(linha: VeiculoNoPatio, horizonteDias: number): FaixaDaProgramacao | null {
  if (linha.vencidos > 0) return 'IMEDIATO';
  if (linha.criticos > 0) return 'ESTA_SEMANA';

  const dias = linha.venceEmDias;
  if (dias === null) return null;
  if (dias <= horizonteDias) return 'ESTA_SEMANA';
  if (dias <= horizonteDias * 2) return 'PROXIMA_SEMANA';
  return null;
}

function motivoDaFaixa(linha: VeiculoNoPatio, faixa: FaixaDaProgramacao, razoes: number): string {
  if (faixa === 'IMEDIATO') {
    return linha.vencidos === 1 ? '1 servico vencido' : `${linha.vencidos} servicos vencidos`;
  }
  if (linha.criticos > 0) {
    return linha.criticos === 1 ? '1 servico critico' : `${linha.criticos} servicos criticos`;
  }
  const dias = linha.venceEmDias;
  const quando = dias === 0 ? 'vence hoje' : dias === 1 ? 'vence em 1 dia' : `vence em ${dias} dias`;
  return razoes > 1 ? `${quando} (${razoes} servicos na mesma faixa)` : quando;
}

/**
 * Veiculo cujo painel nao tem medicao de pe.
 *
 * Aparece na programacao, e nao num relatorio a parte, porque a consequencia dele e operacional:
 * enquanto ninguem ler o hodometro daquela placa, ela nao pode ser programada nem descartada — e
 * silencio sobre falta de dado e o pior modo de falha (consequencias do ADR 0023).
 */
function faltaDeLeitura(linha: VeiculoNoPatio): AtivoSemLeitura | null {
  const dias = linha.diasSemLeitura;
  const semNenhuma = dias === null;
  if (!semNenhuma && dias < DIAS_SEM_LEITURA_TOLERADOS) return null;

  // sem leitura ha meses, mas com todos os itens apurados, o painel dele ainda diz algo
  const semBase = linha.itens.filter((i) => i.severidade === 'SEM_BASE').length;
  if (!semNenhuma && semBase === 0 && linha.kmPorDia !== null) return null;

  return {
    veiculoId: linha.veiculoId,
    placa: linha.placa,
    frotaNumero: linha.frotaNumero,
    descricao: linha.descricao,
    unidadeId: linha.unidadeId,
    hodometro: linha.hodometro,
    diasSemLeitura: dias,
    motivo: semNenhuma
      ? 'Sem nenhuma leitura registrada'
      : `${dias} dias sem leitura${semBase > 0 ? ` e ${semBase} item(ns) sem base` : ''}`,
  };
}

/** Dentro da parada, o mais grave primeiro; entre iguais, o que consumiu mais ciclo. */
function ordenar(itens: readonly ItemDoPatio[]): ItemDoPatio[] {
  return [...itens].sort(
    (a, b) => PESO_SEVERIDADE[b.severidade] - PESO_SEVERIDADE[a.severidade] || b.usado - a.usado,
  );
}

function servicoProgramado(item: ItemDoPatio, encaixe: boolean): ServicoProgramado {
  return {
    tipo: item.tipo,
    rotulo: item.rotulo,
    base: item.base,
    severidade: item.severidade,
    encaixe,
    usado: item.usado,
    aVencer: item.aVencer,
    vencido: item.vencido,
    venceEmDias: item.venceEmDias,
    motivo: item.motivo,
  };
}
