/**
 * Chave de acesso da NF-e (secao 6.1.11 e F10). Modulo puro.
 *
 * A chave tem 44 digitos e carrega, nela mesma, a UF, a competencia de emissao,
 * o CNPJ do emitente, modelo, serie e numero da nota - alem de um digito
 * verificador mod-11. Validar so o tamanho, como estava antes, deixa passar
 * digitacao errada: o erro so aparece no confronto com a SEFAZ, depois que o
 * titulo ja foi provisionado.
 */

export interface ChaveNfe {
  chave: string;
  uf: number;
  ufSigla: string;
  /** competencia de emissao no formato AAAA-MM */
  competencia: string;
  cnpjEmitente: string;
  modelo: string;
  serie: string;
  numero: string;
  tipoEmissao: string;
  codigoNumerico: string;
  digitoVerificador: number;
}

/** Codigo de UF do IBGE - o primeiro par de digitos da chave. */
const UFS: Record<number, string> = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

export class ChaveNfeInvalida extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
    this.name = 'ChaveNfeInvalida';
  }
}

/**
 * Digito verificador mod-11 com pesos ciclicos de 2 a 9, da direita para a esquerda.
 * Resto 0 ou 1 resulta em DV zero - regra do manual da NF-e, nao arredondamento nosso.
 */
export function digitoVerificador(chaveSemDv: string): number {
  if (!/^\d{43}$/.test(chaveSemDv)) {
    throw new ChaveNfeInvalida('O calculo do digito exige os 43 primeiros digitos da chave.');
  }

  let peso = 2;
  let soma = 0;

  for (let i = chaveSemDv.length - 1; i >= 0; i -= 1) {
    soma += Number(chaveSemDv[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Aceita chave com pontuacao ou espaco: quem digita copia de PDF, e o PDF vem sujo. */
export const normalizarChave = (entrada: string): string => entrada.replace(/\D/g, '');

/**
 * Valida e destrincha a chave. Lanca `ChaveNfeInvalida` com o motivo exato -
 * "chave invalida" sozinho nao ajuda quem esta com a nota na mao.
 */
export function lerChaveNfe(entrada: string): ChaveNfe {
  const chave = normalizarChave(entrada ?? '');

  if (chave.length !== 44) {
    throw new ChaveNfeInvalida(`A chave da NF-e tem 44 digitos; a informada tem ${chave.length}.`);
  }

  const uf = Number(chave.slice(0, 2));
  if (!UFS[uf]) {
    throw new ChaveNfeInvalida(`Os dois primeiros digitos (${chave.slice(0, 2)}) nao correspondem a uma UF.`);
  }

  const ano = Number(chave.slice(2, 4));
  const mes = Number(chave.slice(4, 6));
  if (mes < 1 || mes > 12) {
    throw new ChaveNfeInvalida(`O mes de emissao na chave (${chave.slice(4, 6)}) nao existe.`);
  }

  const modelo = chave.slice(20, 22);
  if (modelo !== '55' && modelo !== '65') {
    throw new ChaveNfeInvalida(`Modelo ${modelo} nao e NF-e (55) nem NFC-e (65).`);
  }

  const dv = Number(chave[43]);
  const esperado = digitoVerificador(chave.slice(0, 43));
  if (dv !== esperado) {
    throw new ChaveNfeInvalida(
      `Digito verificador nao confere: a chave termina em ${dv} e deveria terminar em ${esperado}. Confira a digitacao.`,
    );
  }

  return {
    chave,
    uf,
    ufSigla: UFS[uf]!,
    // o ano na chave tem dois digitos; a NF-e existe desde 2006, entao 20xx resolve
    competencia: `20${String(ano).padStart(2, '0')}-${String(mes).padStart(2, '0')}`,
    cnpjEmitente: chave.slice(6, 20),
    modelo,
    serie: chave.slice(22, 25),
    numero: chave.slice(25, 34),
    tipoEmissao: chave[34]!,
    codigoNumerico: chave.slice(35, 43),
    digitoVerificador: dv,
  };
}

/** Versao que nao lanca - util em validacao de schema e em importacao em lote. */
export function chaveValida(entrada: string): { valida: boolean; motivo?: string; dados?: ChaveNfe } {
  try {
    return { valida: true, dados: lerChaveNfe(entrada) };
  } catch (erro) {
    return { valida: false, motivo: erro instanceof Error ? erro.message : 'Chave invalida.' };
  }
}

/** CNPJ formatado para exibicao, a partir do trecho da chave. */
export const formatarCnpj = (cnpj: string): string =>
  cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

/**
 * O CNPJ do emitente na chave tem de bater com o do fornecedor do pedido.
 * Sem isso, a nota de um fornecedor pode ser lancada contra o pedido de outro -
 * e o three-way match nao pegaria, porque valor e quantidade podem coincidir.
 */
export function emitenteConfere(chave: ChaveNfe, cnpjFornecedor: string): boolean {
  return chave.cnpjEmitente === normalizarChave(cnpjFornecedor ?? '');
}
