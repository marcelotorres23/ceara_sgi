/**
 * Importa o controle de trocas de oleo e de alinhamento da planilha da operacao (secao 7.10).
 *
 * Cada aba da planilha vira um tipo, e de cada linha so entram tres coisas: **o ativo, a
 * medicao da ultima execucao e a data**. As colunas de "proxima troca", "a vencer" e
 * "vencidos" ficam de fora de proposito — sao conta, e conta o sistema refaz sozinho a
 * cada abertura do painel, sem depender de alguem arrastar formula.
 *
 * Idempotente: a mesma execucao (ativo + tipo + medicao) nao entra duas vezes.
 *
 * Uso:
 *   npx tsx src/db/importar-servicos-periodicos.ts "caminho/da/planilha.xlsx" [--unidade=MATRIZ] [--aplicar]
 */
import ExcelJS from 'exceljs';
import { prisma, novoId } from '../core/db.js';
import { INTERVALO_PADRAO, type TipoServicoPeriodico } from '../modules/transporte/manutencao-periodica.js';

interface Aba {
  nome: string;
  tipo: TipoServicoPeriodico;
  /** colunas 1-based: identificador do ativo, medicao da ultima execucao, data */
  colunas: { ativo: number; medicao: number; data: number };
}

const ABAS: Aba[] = [
  { nome: 'MOTOR', tipo: 'OLEO_MOTOR', colunas: { ativo: 1, medicao: 3, data: 4 } },
  { nome: 'THERMO KING', tipo: 'OLEO_THERMO_KING', colunas: { ativo: 1, medicao: 3, data: 4 } },
  { nome: 'OLEO DIFERENCIAL', tipo: 'OLEO_DIFERENCIAL', colunas: { ativo: 1, medicao: 2, data: 3 } },
  { nome: 'OLEO CAIXA DE MARCHA', tipo: 'OLEO_CAIXA_MARCHA', colunas: { ativo: 1, medicao: 2, data: 3 } },
  { nome: 'ALINHAMENTO E BALACEAMENTO', tipo: 'ALINHAMENTO', colunas: { ativo: 1, medicao: 2, data: 3 } },
];

const texto = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown };
    if ('result' in o) return String(o.result ?? '').trim();
    if ('text' in o) return String(o.text ?? '').trim();
  }
  return String(v).trim();
};

const numero = (v: unknown): string | null => {
  const t = texto(v).replace(/\./g, '').replace(',', '.');
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return null;
  return t;
};

/** Serial do Excel (base 1899-12-30) ou data ja tipada. */
function data(v: unknown): Date | null {
  if (v instanceof Date) return v;
  const t = texto(v);
  if (/^\d+(\.\d+)?$/.test(t)) {
    const serial = Number(t);
    if (serial < 20000 || serial > 60000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  }
  return null;
}

const placaNormalizada = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

interface LinhaImportada {
  identificador: string;
  medicao: string;
  executadoEm: Date | null;
}

async function lerAba(caminho: string, aba: Aba): Promise<LinhaImportada[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.getWorksheet(aba.nome);
  if (!ws) throw new Error(`Aba "${aba.nome}" nao encontrada na planilha.`);

  const linhas: LinhaImportada[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    // linha 1 e o titulo da aba, linha 2 o cabecalho
    if (n <= 2) return;
    const identificador = placaNormalizada(texto(row.getCell(aba.colunas.ativo).value));
    const medicao = numero(row.getCell(aba.colunas.medicao).value);
    // linha sem medicao e ativo listado que nunca teve a troca controlada: nao e execucao
    if (identificador === '' || medicao === null) return;
    linhas.push({ identificador, medicao, executadoEm: data(row.getCell(aba.colunas.data).value) });
  });

  return linhas;
}

async function main(): Promise<void> {
  const caminho = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!caminho) throw new Error('Informe o caminho da planilha.');

  const codigoPedido = process.argv.find((a) => a.startsWith('--unidade='))?.split('=')[1] ?? 'MATRIZ';
  const unidade = await prisma.unidade.findFirst({ where: { codigo: codigoPedido, deletedAt: null } });
  if (!unidade) throw new Error(`Unidade "${codigoPedido}" nao encontrada.`);
  console.log(`Unidade de destino: ${unidade.codigo} - ${unidade.nome}\n`);

  const veiculos = await prisma.veiculo.findMany({
    where: { deletedAt: null },
    select: { id: true, placa: true, unidadeId: true },
  });
  const equipamentos = await prisma.equipamentoFrio.findMany({
    where: { deletedAt: null },
    include: { veiculo: { select: { placa: true } } },
  });

  const relatorio = { criadas: 0, repetidas: 0, semAtivo: [] as string[] };

  for (const aba of ABAS) {
    const linhas = await lerAba(caminho, aba);
    console.log(`--- ${aba.nome} (${aba.tipo}): ${linhas.length} linha(s) com execucao registrada`);

    for (const linha of linhas) {
      /*
       * O identificador do Thermo King na planilha e "EQR" + os quatro ultimos caracteres
       * da placa do caminhao onde o aparelho estava. Casar por ai e o que existe: a
       * planilha nunca teve o numero de serie do aparelho. Final ambiguo nao e adivinhado —
       * duas placas com o mesmo final entrariam com o aparelho errado, e isso e pior do
       * que a linha ficar de fora com aviso.
       */
      let veiculo: (typeof veiculos)[number] | undefined;
      if (aba.tipo === 'OLEO_THERMO_KING') {
        const final = linha.identificador.slice(-4);
        const candidatos = veiculos.filter((v) => v.placa.slice(-4) === final);
        if (candidatos.length > 1) {
          relatorio.semAtivo.push(`${aba.nome}: ${linha.identificador} (final ${final} em ${candidatos.length} placas)`);
          continue;
        }
        veiculo = candidatos[0];
      } else {
        veiculo = veiculos.find((v) => v.placa === linha.identificador);
      }

      const equipamento = aba.tipo === 'OLEO_THERMO_KING' && veiculo
        ? equipamentos.find((e) => e.veiculoId === veiculo.id)
        : null;

      const alvo = aba.tipo === 'OLEO_THERMO_KING' ? equipamento : veiculo;
      if (!alvo) {
        relatorio.semAtivo.push(`${aba.nome}: ${linha.identificador}`);
        continue;
      }

      const jaExiste = await prisma.servicoPeriodico.findFirst({
        where: {
          deletedAt: null,
          tipo: aba.tipo,
          medicao: linha.medicao,
          ...(aba.tipo === 'OLEO_THERMO_KING' ? { equipamentoFrioId: alvo.id } : { veiculoId: alvo.id }),
        },
      });
      if (jaExiste) {
        relatorio.repetidas++;
        continue;
      }

      const modelo = aba.tipo === 'OLEO_THERMO_KING' ? [equipamento?.marca, equipamento?.modelo].filter(Boolean).join(' ') : '';
      // CARRIER troca a cada 1.000 h; THERMO KING, a cada 2.000 h (secao 7.10)
      const intervalo =
        aba.tipo === 'OLEO_THERMO_KING' && /THERMO/i.test(modelo) ? 2000 : INTERVALO_PADRAO[aba.tipo].intervalo;
      const proxima = (Number(linha.medicao) + intervalo).toFixed(1);

      if (!aplicar) {
        console.log(`[ensaio] ${linha.identificador}: ultima em ${linha.medicao}, proxima em ${proxima}`);
        relatorio.criadas++;
        continue;
      }

      await prisma.servicoPeriodico.create({
        data: {
          id: novoId(),
          unidadeId: unidade.id,
          tipo: aba.tipo,
          base: INTERVALO_PADRAO[aba.tipo].base,
          veiculoId: aba.tipo === 'OLEO_THERMO_KING' ? null : alvo.id,
          equipamentoFrioId: aba.tipo === 'OLEO_THERMO_KING' ? alvo.id : null,
          executadoEm: linha.executadoEm ?? new Date(),
          medicao: linha.medicao,
          intervalo: String(intervalo),
          proxima,
          observacao: 'Importado da planilha de controle de trocas.',
        },
      });
      relatorio.criadas++;
    }
  }

  console.log('\n--- Relatorio ---');
  console.log(`execucoes ${aplicar ? 'importadas' : 'a importar'}: ${relatorio.criadas} · ja existentes: ${relatorio.repetidas}`);
  if (relatorio.semAtivo.length > 0) {
    console.log(`sem ativo correspondente no cadastro (${relatorio.semAtivo.length}):`);
    console.log(`  ${relatorio.semAtivo.join(', ')}`);
  }
  if (!aplicar) console.log('\nEnsaio: nada foi gravado. Rode com --aplicar para valer.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
