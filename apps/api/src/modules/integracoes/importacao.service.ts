import { createHash } from 'node:crypto';
import { prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { ValidationError } from '../../core/errors/index.js';
import type { Ator } from '../compras/service.js';
import { registrarAbastecimento } from '../transporte/service.js';
import {
  conferir,
  exigirData,
  exigirNumero,
  exigirPlaca,
  lerCsv,
  numeroBr,
  type ErroDeLinha,
  type LinhaCsv,
} from './csv.js';

/**
 * Importacao de abastecimentos do posto interno / ERP legado (F10).
 *
 * Duas garantias que fazem a diferenca na mesa do operador:
 * - **conferencia antes de gravar** (`dryRun`): ele ve todos os erros de uma vez,
 *   corrige o arquivo e reenvia, em vez de descobrir um erro por importacao;
 * - **idempotencia por hash da linha**: reenviar o mesmo arquivo nao duplica
 *   abastecimento. Arquivo de posto costuma vir repetido, com o mes inteiro.
 */

export interface AbastecimentoImportado {
  dataHora: Date;
  placa: string;
  litros: string;
  valorUnitario: string;
  valorTotal: string | null;
  hodometro: string;
  posto: string;
  motorista: string | null;
  numeroCartao: string | null;
  /** identidade da linha, para nao importar duas vezes */
  chave: string;
}

const COLUNAS_OBRIGATORIAS = ['data', 'placa', 'litros', 'hodometro'];

/**
 * Chave de idempotencia da linha. Usa os campos que identificam o evento no mundo
 * real - veiculo, momento, volume e hodometro. Nao usa o numero da linha: o mesmo
 * abastecimento pode vir em posicao diferente no arquivo seguinte.
 */
const chaveDaLinha = (dados: Omit<AbastecimentoImportado, 'chave'>): string =>
  createHash('sha256')
    .update([dados.placa, dados.dataHora.toISOString(), dados.litros, dados.hodometro].join('|'))
    .digest('hex')
    .slice(0, 32);

function converter(linha: LinhaCsv): AbastecimentoImportado {
  const dataHora = exigirData(linha, 'data');
  const placa = exigirPlaca(linha, 'placa');
  const litros = exigirNumero(linha, 'litros');
  const hodometro = exigirNumero(linha, 'hodometro');

  const valorTotal = numeroBr(linha.valores.valor_total ?? linha.valores.valor);
  const valorUnitario = numeroBr(linha.valores.valor_unitario ?? linha.valores.preco_unitario);

  if (!valorTotal && !valorUnitario) {
    throw new ValidationError('Informe o valor total ou o valor unitario do abastecimento.');
  }

  const dados = {
    dataHora,
    placa,
    litros,
    hodometro,
    // com um dos dois, o outro sai por divisao - o arquivo raramente traz ambos
    valorUnitario: valorUnitario ?? (Number(valorTotal) / Number(litros)).toFixed(4),
    valorTotal,
    posto: linha.valores.posto?.trim() || 'Posto interno',
    motorista: linha.valores.motorista?.trim() || null,
    numeroCartao: linha.valores.cartao?.trim() || linha.valores.numero_cartao?.trim() || null,
  };

  return { ...dados, chave: chaveDaLinha(dados) };
}

export interface ResultadoImportacao {
  arquivo: { linhas: number; separador: string };
  conferencia: { validas: number; comErro: number };
  erros: ErroDeLinha[];
  /** o que seria (ou foi) gravado */
  importadas: number;
  /** linhas ja importadas antes, ignoradas por idempotencia */
  duplicadas: number;
  /** linhas validas no arquivo mas rejeitadas na gravacao (veiculo inexistente, anomalia bloqueante) */
  rejeitadas: Array<{ linha: number; motivo: string }>;
  dryRun: boolean;
}

/**
 * Confere e, se `dryRun` for falso, importa. O registro passa pelo mesmo servico
 * de abastecimento usado na tela: consumo, anomalia e trilha valem igual para o
 * que entra por arquivo. Importar por um atalho criaria dado de segunda classe.
 */
export async function importarAbastecimentos(
  ator: Ator,
  conteudo: string,
  opcoes: { dryRun?: boolean; unidades?: string[] } = {},
): Promise<ResultadoImportacao> {
  const dryRun = opcoes.dryRun ?? true;
  const arquivo = lerCsv(conteudo);

  if (arquivo.linhas.length === 0) {
    throw new ValidationError('O arquivo nao tem linhas de dados.');
  }

  const { validas, erros } = conferir(arquivo, COLUNAS_OBRIGATORIAS, converter);

  const resultado: ResultadoImportacao = {
    arquivo: { linhas: arquivo.linhas.length, separador: arquivo.separador },
    conferencia: { validas: validas.length, comErro: erros.length },
    erros,
    importadas: 0,
    duplicadas: 0,
    rejeitadas: [],
    dryRun,
  };

  if (validas.length === 0) return resultado;

  // veiculos por placa, uma consulta so - e ja restrito a unidade em operacao
  const placas = [...new Set(validas.map((v) => v.dados.placa))];
  const veiculos = await prisma.veiculo.findMany({
    where: {
      placa: { in: placas },
      deletedAt: null,
      ...(opcoes.unidades && opcoes.unidades.length > 0 ? { unidadeId: { in: opcoes.unidades } } : {}),
    },
    select: { id: true, placa: true, unidadeId: true },
  });
  const porPlaca = new Map(veiculos.map((v) => [v.placa, v]));

  const jaImportadas = new Set(
    (
      await prisma.abastecimento.findMany({
        where: { chaveImportacao: { in: validas.map((v) => v.dados.chave) } },
        select: { chaveImportacao: true },
      })
    ).map((a) => a.chaveImportacao!),
  );

  for (const { linha, dados } of validas) {
    if (jaImportadas.has(dados.chave)) {
      resultado.duplicadas += 1;
      continue;
    }

    const veiculo = porPlaca.get(dados.placa);
    if (!veiculo) {
      resultado.rejeitadas.push({
        linha,
        motivo: `Veiculo ${dados.placa} nao encontrado na unidade em operacao.`,
      });
      continue;
    }

    // o motorista do arquivo e texto livre; sem vinculo confiavel, usa o padrao do veiculo
    const motorista = await prisma.motorista.findFirst({
      where: {
        deletedAt: null,
        status: 'ATIVO',
        ...(dados.motorista
          ? { nome: { contains: dados.motorista, mode: 'insensitive' } }
          : { veiculoPadraoId: veiculo.id }),
      },
      select: { id: true, nome: true },
    });

    if (!motorista) {
      resultado.rejeitadas.push({
        linha,
        motivo: dados.motorista
          ? `Motorista "${dados.motorista}" nao encontrado.`
          : `Veiculo ${dados.placa} nao tem motorista padrao para atribuir o abastecimento.`,
      });
      continue;
    }

    if (dryRun) {
      resultado.importadas += 1;
      continue;
    }

    try {
      await registrarAbastecimento(
        { ...ator, unidadeId: veiculo.unidadeId },
        {
          veiculoId: veiculo.id,
          motoristaId: motorista.id,
          dataHora: dados.dataHora,
          posto: dados.posto,
          postoInterno: true,
          tipoCombustivel: 'DIESEL_S10',
          litros: dados.litros,
          valorUnitario: dados.valorUnitario,
          hodometro: dados.hodometro,
          numeroCartao: dados.numeroCartao,
          justificativa: `Importado de arquivo em ${new Date().toLocaleDateString('pt-BR')}`,
          chaveImportacao: dados.chave,
        },
      );
      resultado.importadas += 1;
    } catch (erro) {
      // anomalia bloqueante (hodometro retrocedido, por exemplo) nao derruba o lote inteiro
      resultado.rejeitadas.push({
        linha,
        motivo: erro instanceof Error ? erro.message : 'Falha ao registrar o abastecimento.',
      });
    }
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: 'abastecimentos',
    entidadeId: null,
    acao: dryRun ? 'CONFERIR_IMPORTACAO' : 'IMPORTAR',
    valorNovo: {
      linhas: resultado.arquivo.linhas,
      importadas: resultado.importadas,
      duplicadas: resultado.duplicadas,
      comErro: resultado.conferencia.comErro,
      rejeitadas: resultado.rejeitadas.length,
    },
    severidade: resultado.rejeitadas.length > 0 || erros.length > 0 ? 'ALERTA' : 'INFO',
  });

  return resultado;
}
