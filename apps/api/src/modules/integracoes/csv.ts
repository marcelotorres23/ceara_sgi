/**
 * Leitura de CSV do posto interno / ERP legado (F10 - "fim da redigitacao").
 * Modulo puro, sem dependencia externa.
 *
 * O arquivo vem de sistema de terceiro: separador `;` (padrao pt-BR), decimal com
 * virgula, acento no cabecalho e BOM do Excel. Nada disso pode virar erro de
 * importacao - o operador nao tem como consertar o gerador do arquivo.
 */

export interface LinhaCsv {
  /** numero da linha no arquivo, contando o cabecalho - e o que o operador ve no Excel */
  numero: number;
  valores: Record<string, string>;
}

/** Detecta `;` ou `,` pela primeira linha: quem exporta do Excel pt-BR usa `;`. */
export function detectarSeparador(conteudo: string): ';' | ',' | '\t' {
  const primeira = conteudo.split(/\r?\n/)[0] ?? '';
  const contagem = {
    ';': (primeira.match(/;/g) ?? []).length,
    ',': (primeira.match(/,/g) ?? []).length,
    '\t': (primeira.match(/\t/g) ?? []).length,
  };

  return (Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ';') as ';' | ',' | '\t';
}

/** Cabecalho normalizado: sem acento, sem espaco, minusculo. */
export const normalizarCabecalho = (texto: string): string =>
  texto
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** Divide respeitando aspas: campo com o separador dentro nao pode partir a linha. */
function dividir(linha: string, separador: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let entreAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i]!;

    if (c === '"') {
      // aspas duplicadas dentro de campo entre aspas representam uma aspa literal
      if (entreAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        entreAspas = !entreAspas;
      }
      continue;
    }

    if (c === separador && !entreAspas) {
      campos.push(atual);
      atual = '';
      continue;
    }

    atual += c;
  }

  campos.push(atual);
  return campos.map((c) => c.trim());
}

export interface ArquivoLido {
  cabecalhos: string[];
  linhas: LinhaCsv[];
  separador: string;
}

export function lerCsv(conteudo: string): ArquivoLido {
  const texto = conteudo.replace(/^﻿/, '');
  const separador = detectarSeparador(texto);

  const linhas = texto
    .split(/\r?\n/)
    .map((l, i) => ({ texto: l, numero: i + 1 }))
    // linha vazia no fim do arquivo e regra, nao excecao
    .filter((l) => l.texto.trim().length > 0);

  const primeira = linhas.shift();
  if (!primeira) return { cabecalhos: [], linhas: [], separador };

  const cabecalhos = dividir(primeira.texto, separador).map(normalizarCabecalho);

  return {
    separador,
    cabecalhos,
    linhas: linhas.map((l) => ({
      numero: l.numero,
      valores: Object.fromEntries(
        dividir(l.texto, separador).map((valor, i) => [cabecalhos[i] ?? `coluna_${i + 1}`, valor]),
      ),
    })),
  };
}

// ---------------------------------------------------------------- conversores

/**
 * Numero em formato brasileiro: "1.234,56" vira "1234.56".
 * Aceita tambem o formato com ponto decimal, porque metade dos sistemas exporta assim.
 */
export function numeroBr(entrada: string | undefined): string | null {
  const texto = (entrada ?? '').trim();
  if (texto === '') return null;

  // com virgula, a virgula e o separador decimal e o ponto e milhar
  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;

  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null;
  return normalizado;
}

/** Data em dd/mm/aaaa, dd/mm/aaaa hh:mm ou ISO. Devolve null quando nao reconhece. */
export function dataBr(entrada: string | undefined): Date | null {
  const texto = (entrada ?? '').trim();
  if (texto === '') return null;

  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(texto);
  if (br) {
    const [, dia, mes, ano, hora = '00', minuto = '00', segundo = '00'] = br;
    const data = new Date(
      `${ano}-${mes}-${dia}T${hora.padStart(2, '0')}:${minuto}:${segundo}-03:00`,
    );
    return Number.isNaN(data.getTime()) ? null : data;
  }

  const iso = new Date(texto);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

/** Placa nos dois padroes: ABC-1234 e ABC1D23 (Mercosul). */
export function placa(entrada: string | undefined): string | null {
  const texto = (entrada ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(texto) ? texto : null;
}

// ---------------------------------------------------------------- validacao

export interface ErroDeLinha {
  linha: number;
  coluna?: string;
  mensagem: string;
}

export interface Conferencia<T> {
  validas: Array<{ linha: number; dados: T }>;
  erros: ErroDeLinha[];
}

/**
 * Aplica o conversor linha a linha, acumulando os erros em vez de parar no primeiro.
 * Importacao que aborta na linha 3 de um arquivo de 400 faz o operador corrigir
 * um erro por vez, e ele desiste antes do terceiro.
 */
export function conferir<T>(
  arquivo: ArquivoLido,
  obrigatorias: string[],
  converter: (linha: LinhaCsv) => T,
): Conferencia<T> {
  const faltando = obrigatorias.filter((c) => !arquivo.cabecalhos.includes(c));
  if (faltando.length > 0) {
    return {
      validas: [],
      erros: [
        {
          linha: 1,
          mensagem:
            `O arquivo nao tem a(s) coluna(s): ${faltando.join(', ')}. ` +
            `Colunas encontradas: ${arquivo.cabecalhos.join(', ') || 'nenhuma'}.`,
        },
      ],
    };
  }

  const validas: Conferencia<T>['validas'] = [];
  const erros: ErroDeLinha[] = [];

  for (const linha of arquivo.linhas) {
    try {
      validas.push({ linha: linha.numero, dados: converter(linha) });
    } catch (erro) {
      erros.push({
        linha: linha.numero,
        mensagem: erro instanceof Error ? erro.message : 'Linha invalida.',
      });
    }
  }

  return { validas, erros };
}

/** Erro de conversao que carrega a coluna - a mensagem chega pronta para o operador. */
export class ErroDeConversao extends Error {
  constructor(coluna: string, motivo: string) {
    super(`Coluna "${coluna}": ${motivo}`);
    this.name = 'ErroDeConversao';
  }
}

export const exigir = (linha: LinhaCsv, coluna: string): string => {
  const valor = linha.valores[coluna]?.trim();
  if (!valor) throw new ErroDeConversao(coluna, 'valor obrigatorio nao informado.');
  return valor;
};

export const exigirNumero = (linha: LinhaCsv, coluna: string): string => {
  const valor = numeroBr(exigir(linha, coluna));
  if (valor === null) throw new ErroDeConversao(coluna, `"${linha.valores[coluna]}" nao e um numero.`);
  return valor;
};

export const exigirData = (linha: LinhaCsv, coluna: string): Date => {
  const valor = dataBr(exigir(linha, coluna));
  if (valor === null) {
    throw new ErroDeConversao(coluna, `"${linha.valores[coluna]}" nao e uma data (use dd/mm/aaaa).`);
  }
  return valor;
};

export const exigirPlaca = (linha: LinhaCsv, coluna: string): string => {
  const valor = placa(exigir(linha, coluna));
  if (valor === null) {
    throw new ErroDeConversao(coluna, `"${linha.valores[coluna]}" nao e uma placa valida.`);
  }
  return valor;
};
