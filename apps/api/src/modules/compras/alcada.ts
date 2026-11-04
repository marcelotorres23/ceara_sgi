import { centavos, Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Matriz de alcadas (secao 6.4). Parametrizavel em banco - este modulo so decide,
 * a partir das faixas recebidas. Puro, sem I/O.
 */

export interface FaixaAlcada {
  nivel: number;
  valorMin: ValorMonetario;
  /** null = sem teto */
  valorMax: ValorMonetario | null;
  perfilAprovador: string;
  propostasMinimas: number;
  slaHoras: number;
}

export interface DecisaoAlcada {
  nivel: number;
  perfilAprovador: string;
  propostasMinimas: number;
  slaHoras: number;
  /** faixa 1 admite autoaprovacao do comprador, registrada como tal */
  autoaprovacaoPermitida: boolean;
  /** true quando a escolha divergente elevou o nivel */
  elevadoPorDivergencia: boolean;
  nivelOriginal: number;
}

const ordenar = (faixas: FaixaAlcada[]): FaixaAlcada[] => [...faixas].sort((a, b) => a.nivel - b.nivel);

/**
 * Faixa cujo intervalo [min, max] contem o valor. Sem teto vale como infinito.
 *
 * O valor e arredondado para centavos ANTES do enquadramento. A matriz da secao 6.4 e
 * escrita em centavos (teto 1.000,00 / piso seguinte 1.000,01), entao qualquer fracao
 * abaixo do centavo cairia num vao entre faixas - e o total de um lote nasce de
 * quantidade(14,4) x preco(14,4), que produz fracoes assim.
 */
export function faixaPorValor(faixas: FaixaAlcada[], valor: ValorMonetario): FaixaAlcada {
  const v = centavos(valor);
  if (v.isNegative()) throw new RangeError('Valor do lote nao pode ser negativo.');

  const encontrada = ordenar(faixas).find((f) => {
    const min = dinheiro(f.valorMin);
    if (v.lessThan(min)) return false;
    if (f.valorMax === null) return true;
    return v.lessThanOrEqualTo(dinheiro(f.valorMax));
  });

  if (!encontrada) throw new RangeError(`Nenhuma faixa de alcada cobre o valor ${v.toFixed(2)}.`);
  return encontrada;
}

/**
 * Decide a alcada aplicavel.
 * Regra codificada: escolha divergente do menor preco sobe automaticamente 1 nivel (secao 6.4).
 * No topo da matriz nao ha para onde subir - permanece no ultimo nivel.
 */
export function decidirAlcada(
  faixas: FaixaAlcada[],
  valor: ValorMonetario,
  opcoes: { escolhaDivergente?: boolean } = {},
): DecisaoAlcada {
  const ordenadas = ordenar(faixas);
  const base = faixaPorValor(ordenadas, valor);

  let aplicada = base;
  let elevado = false;

  if (opcoes.escolhaDivergente) {
    const acima = ordenadas.find((f) => f.nivel === base.nivel + 1);
    if (acima) {
      aplicada = acima;
      elevado = true;
    }
  }

  return {
    nivel: aplicada.nivel,
    perfilAprovador: aplicada.perfilAprovador,
    propostasMinimas: aplicada.propostasMinimas,
    slaHoras: aplicada.slaHoras,
    // a autoaprovacao pertence a faixa 1; se subiu de nivel, deixa de valer
    autoaprovacaoPermitida: aplicada.nivel === 1,
    elevadoPorDivergencia: elevado,
    nivelOriginal: base.nivel,
  };
}

export interface HabilitacaoDoAprovador {
  pode: boolean;
  /** perfil que a matriz designa para a faixa do lote */
  perfilExigido: string;
  nivelExigido: number;
  /** maior faixa que os perfis do usuario alcancam; null quando ele nao aprova nada */
  nivelMaximo: number | null;
  /** texto pronto para a tela quando `pode` e falso */
  motivo?: string;
}

/**
 * Se este usuario pode decidir um lote desta faixa (secao 6.4).
 *
 * A matriz sempre disse **qual perfil** aprova cada faixa, mas nada conferia isso na hora
 * da decisao: quem tivesse `lote:aprovar` aprovava qualquer valor. A Gerencia, cujo teto e
 * a faixa 3, decidia um lote de R$ 51.000 que a matriz manda para a Diretoria.
 *
 * Faixa maior alcanca faixa menor — quem aprova sem teto aprova o que esta abaixo. O
 * contrario nao: e justamente o teto que a matriz existe para impor.
 */
export function aprovadorHabilitado(
  faixas: FaixaAlcada[],
  nivelDoLote: number,
  perfisDoUsuario: readonly string[],
): HabilitacaoDoAprovador {
  const ordenadas = ordenar(faixas);
  const doLote = ordenadas.find((f) => f.nivel === nivelDoLote);

  if (!doLote) {
    return {
      pode: false,
      perfilExigido: '—',
      nivelExigido: nivelDoLote,
      nivelMaximo: null,
      motivo: `A faixa ${nivelDoLote} nao existe mais na matriz de alcadas. Submeta o lote de novo para reenquadrar.`,
    };
  }

  const alcancados = ordenadas.filter((f) => perfisDoUsuario.includes(f.perfilAprovador)).map((f) => f.nivel);
  const nivelMaximo = alcancados.length > 0 ? Math.max(...alcancados) : null;

  if (nivelMaximo === null) {
    return {
      pode: false,
      perfilExigido: doLote.perfilAprovador,
      nivelExigido: doLote.nivel,
      nivelMaximo: null,
      motivo: `Esta faixa e aprovada por ${doLote.perfilAprovador}.`,
    };
  }

  if (nivelMaximo < doLote.nivel) {
    return {
      pode: false,
      perfilExigido: doLote.perfilAprovador,
      nivelExigido: doLote.nivel,
      nivelMaximo,
      motivo:
        `Este valor cai na faixa ${doLote.nivel}, que a matriz manda para ${doLote.perfilAprovador}. ` +
        `Seu perfil aprova ate a faixa ${nivelMaximo}.`,
    };
  }

  return { pode: true, perfilExigido: doLote.perfilAprovador, nivelExigido: doLote.nivel, nivelMaximo };
}

export interface ChecagemPropostas {
  suficiente: boolean;
  exigidas: number;
  recebidas: number;
  mensagem?: string;
}

/** O minimo de propostas e requisito da faixa, verificado antes de submeter a aprovacao. */
export function checarPropostasMinimas(decisao: DecisaoAlcada, propostasRespondidas: number): ChecagemPropostas {
  const suficiente = propostasRespondidas >= decisao.propostasMinimas;
  return {
    suficiente,
    exigidas: decisao.propostasMinimas,
    recebidas: propostasRespondidas,
    ...(suficiente
      ? {}
      : {
          mensagem:
            `Esta faixa exige ${decisao.propostasMinimas} propostas respondidas. ` +
            `Registre mais ${decisao.propostasMinimas - propostasRespondidas} ou a recusa do fornecedor.`,
        }),
  };
}

/** Valor total do lote a partir dos itens (quantidade x preco), para enquadrar a faixa. */
export const somarItens = (itens: Array<{ quantidade: ValorMonetario; precoUnitario: ValorMonetario }>): Decimal =>
  itens
    .reduce<Decimal>((acc, i) => acc.plus(dinheiro(i.quantidade).times(dinheiro(i.precoUnitario))), new Decimal(0))
    .toDecimalPlaces(2);
