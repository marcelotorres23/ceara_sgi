import { XMLParser } from 'fast-xml-parser';
import { Decimal, dinheiro } from '../../core/money.js';

/**
 * Leitura da NF-e de compra de combustivel (secao 7.9).
 *
 * A nota do distribuidor traz tudo que a entrada no tanque precisa: fornecedor, numero,
 * data, litros e preco do litro. Digitar isso a mao, com o XML aberto na tela ao lado, e
 * pedir para trocar um digito no preco e desalinhar o custo medio de todo o estoque.
 *
 * **O que este modulo faz e ler e propor, nunca gravar.** A entrada continua sendo um ato
 * de quem confere a nota contra o que chegou no caminhao-tanque: o XML preenche o
 * formulario, e a pessoa confirma. Nota fiscal casa com o que o fornecedor emitiu, e nao
 * necessariamente com o que desceu para o tanque — quem sabe a diferenca e quem recebeu.
 */

/** Unidades que a distribuidora usa para litro. Fora disso, o item nao e combustivel a granel. */
const UNIDADES_DE_LITRO = new Set(['LT', 'L', 'LTS', 'LITRO', 'LITROS', 'UN/L']);

/**
 * Produtos que interessam ao tanque.
 *
 * A nota costuma trazer o combustivel junto de frete, taxa e ate lubrificante em balde. O
 * filtro por descricao evita puxar um item de 20 litros de oleo como se fosse diesel.
 */
const PALAVRAS_DE_COMBUSTIVEL = ['DIESEL', 'ARLA', 'GASOLINA', 'ETANOL', 'ALCOOL', 'S10', 'S500', 'B S10', 'OLEO DIESEL'];

export interface ItemDaNota {
  codigo: string | null;
  descricao: string;
  unidade: string | null;
  litros: string;
  valorUnitario: string;
  valorTotal: string;
  /** o item parece combustivel a granel, e nao frete nem lubrificante embalado */
  ehCombustivel: boolean;
}

export interface NotaDeCombustivel {
  chave: string | null;
  numero: string | null;
  serie: string | null;
  emitidaEm: Date | null;
  fornecedor: {
    cnpj: string | null;
    razaoSocial: string | null;
    nomeFantasia: string | null;
  };
  itens: ItemDaNota[];
  /** soma dos itens de combustivel — o que a entrada no tanque deve considerar */
  litrosDeCombustivel: string;
  valorDeCombustivel: string;
  /** preco medio do litro na nota, ponderado pelo volume de cada item */
  custoUnitarioMedio: string | null;
  /** total da nota, com frete e impostos que nao entram no custo do litro */
  valorTotalDaNota: string | null;
  /** o que a leitura nao conseguiu resolver sozinha e precisa de olho humano */
  avisos: string[];
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(typeof v === 'object' && '#text' in (v as object) ? (v as { '#text': unknown })['#text'] : v).trim();
  return s === '' ? null : s;
};

/** A NF-e usa ponto decimal e nao separa milhar; virgula so aparece em arquivo remontado a mao. */
const numero = (v: unknown): Decimal | null => {
  const s = texto(v);
  if (s === null) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? new Decimal(n) : null;
};

const listaDe = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const pareceCombustivel = (descricao: string, unidade: string | null): boolean => {
  const desc = descricao.toUpperCase();
  const temPalavra = PALAVRAS_DE_COMBUSTIVEL.some((p) => desc.includes(p));
  const emLitro = unidade === null || UNIDADES_DE_LITRO.has(unidade.toUpperCase());
  return temPalavra && emLitro;
};

/**
 * Le o XML da NF-e e devolve o que a entrada no tanque precisa.
 *
 * Aceita a nota com e sem o envelope `nfeProc`, que e a diferenca entre o arquivo baixado
 * do portal e o que o contador manda por e-mail. Arquivo que nao e NF-e vira erro claro,
 * e nao um objeto vazio que o operador so descobre torto la na frente.
 */
export function lerNotaDeCombustivel(xml: string): NotaDeCombustivel {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', trimValues: true });

  let raiz: Record<string, unknown>;
  try {
    raiz = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new Error('Arquivo XML invalido: nao foi possivel interpretar o conteudo.');
  }

  // o portal entrega `nfeProc > NFe > infNFe`; o e-mail do contador costuma vir so com `NFe`
  const proc = (raiz.nfeProc ?? raiz) as Record<string, unknown>;
  const nfe = (proc.NFe ?? proc.nfe ?? proc) as Record<string, unknown>;
  const inf = (nfe.infNFe ?? nfe.infnfe) as Record<string, unknown> | undefined;

  if (!inf) throw new Error('Este XML nao parece uma NF-e: nao encontrei o bloco infNFe.');

  const ide = (inf.ide ?? {}) as Record<string, unknown>;
  const emit = (inf.emit ?? {}) as Record<string, unknown>;
  const total = ((inf.total ?? {}) as Record<string, unknown>).ICMSTot as Record<string, unknown> | undefined;

  const avisos: string[] = [];

  const itens: ItemDaNota[] = listaDe(inf.det as unknown[]).map((det) => {
    const prod = ((det as Record<string, unknown>).prod ?? {}) as Record<string, unknown>;
    const descricao = texto(prod.xProd) ?? 'sem descricao';
    const unidade = texto(prod.uCom);
    const litros = numero(prod.qCom) ?? new Decimal(0);
    const unitario = numero(prod.vUnCom) ?? new Decimal(0);
    const valor = numero(prod.vProd) ?? litros.times(unitario);

    return {
      codigo: texto(prod.cProd),
      descricao,
      unidade,
      litros: litros.toFixed(3),
      valorUnitario: unitario.toFixed(4),
      valorTotal: valor.toFixed(2),
      ehCombustivel: pareceCombustivel(descricao, unidade),
    };
  });

  const combustiveis = itens.filter((i) => i.ehCombustivel);
  if (itens.length > 0 && combustiveis.length === 0) {
    avisos.push('Nenhum item da nota foi reconhecido como combustivel. Confira os itens antes de lancar a entrada.');
  }

  let litrosTotal = new Decimal(0);
  let valorTotal = new Decimal(0);
  for (const i of combustiveis) {
    litrosTotal = litrosTotal.plus(dinheiro(i.litros));
    valorTotal = valorTotal.plus(dinheiro(i.valorTotal));
  }

  /*
   * Custo do litro ponderado pelo volume, e nao media dos precos unitarios: nota com dois
   * itens do mesmo produto em precos diferentes e comum quando ha desconto por faixa.
   */
  const custoUnitario = litrosTotal.greaterThan(0) ? valorTotal.dividedBy(litrosTotal).toDecimalPlaces(4) : null;

  const totalDaNota = numero(total?.vNF);
  if (totalDaNota && valorTotal.greaterThan(0) && totalDaNota.minus(valorTotal).abs().greaterThan(0.01)) {
    avisos.push(
      `O total da nota (R$ ${totalDaNota.toFixed(2)}) difere do valor dos itens de combustivel ` +
        `(R$ ${valorTotal.toFixed(2)}). A diferenca costuma ser frete ou item que nao vai para o tanque.`,
    );
  }

  const cnpj = texto(emit.CNPJ)?.replace(/\D/g, '') ?? null;
  if (!cnpj) avisos.push('A nota nao trouxe o CNPJ do emitente. Escolha o fornecedor na lista.');

  return {
    chave: texto((inf as Record<string, unknown>)['@Id'])?.replace(/^NFe/i, '') ?? null,
    numero: texto(ide.nNF),
    serie: texto(ide.serie),
    emitidaEm: dataDaNota(texto(ide.dhEmi) ?? texto(ide.dEmi)),
    fornecedor: {
      cnpj,
      razaoSocial: texto(emit.xNome),
      nomeFantasia: texto(emit.xFant),
    },
    itens,
    litrosDeCombustivel: litrosTotal.toFixed(3),
    valorDeCombustivel: valorTotal.toFixed(2),
    custoUnitarioMedio: custoUnitario?.toFixed(4) ?? null,
    valorTotalDaNota: totalDaNota?.toFixed(2) ?? null,
    avisos,
  };
}

/** `dhEmi` vem ISO com fuso; `dEmi`, das notas antigas, vem so a data. */
function dataDaNota(valor: string | null): Date | null {
  if (!valor) return null;
  const d = new Date(valor.length === 10 ? `${valor}T12:00:00` : valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
