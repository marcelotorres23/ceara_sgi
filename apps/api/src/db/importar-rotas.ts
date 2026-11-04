/**
 * Importa o cadastro de rotas a partir da planilha comercial (secao 14.2).
 *
 * Idempotente: roda quantas vezes precisar. A rota e casada pelo codigo derivado do nome,
 * entao reimportar corrige os dados sem duplicar. Nada e excluido - rota que sumiu da
 * planilha e **inativada** (regra de ouro 2), porque ela responde por saidas ja registradas.
 *
 * Uso:
 *   npx tsx src/db/importar-rotas.ts "caminho/da/planilha.xlsx" [--unidade=MATRIZ] [--aplicar]
 *
 * Sem `--aplicar` roda em ensaio: mostra o que faria e nao grava nada.
 */
import ExcelJS from 'exceljs';
import { prisma, novoId } from '../core/db.js';
import { codigoDaRota, traduzirLinhaDeRota, type LinhaDeRota } from '../modules/portaria/importacao-rotas.js';

const celula = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown };
    if ('result' in o) return String(o.result ?? '').trim();
    if ('text' in o) return String(o.text ?? '').trim();
  }
  return String(v).trim();
};

async function lerPlanilha(caminho: string): Promise<LinhaDeRota[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Planilha sem abas.');

  const linhas: LinhaDeRota[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    // linha 1 e o cabecalho: ROTA | N VENDEDORES | DIAS PRE VENDA | FECHAMENTO | LARGADA
    if (n === 1) return;
    const linha = traduzirLinhaDeRota((row.values as unknown[]).slice(1).map(celula));
    if (linha) linhas.push(linha);
  });

  return linhas;
}

async function main(): Promise<void> {
  const caminho = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!caminho) throw new Error('Informe o caminho da planilha.');

  const linhas = await lerPlanilha(caminho);
  console.log(`Planilha: ${linhas.length} rota(s).`);

  // a unidade e escolhida, nao adivinhada; sem --unidade, MATRIZ
  const codigoPedido = process.argv.find((a) => a.startsWith('--unidade='))?.split('=')[1] ?? 'MATRIZ';
  const unidade = await prisma.unidade.findFirst({ where: { codigo: codigoPedido, deletedAt: null } });
  if (!unidade) throw new Error(`Unidade "${codigoPedido}" nao encontrada.`);
  console.log(`Unidade de destino: ${unidade.codigo} - ${unidade.nome}\n`);

  const codigosDaPlanilha = new Set<string>();
  const relatorio = { criadas: 0, atualizadas: 0 };

  for (const linha of linhas) {
    const codigo = codigoDaRota(linha.nome);
    if (codigosDaPlanilha.has(codigo)) {
      console.log(`[aviso] rota repetida na planilha, ignorada: ${linha.nome}`);
      continue;
    }
    codigosDaPlanilha.add(codigo);

    const existente = await prisma.rota.findFirst({ where: { unidadeId: unidade.id, codigo } });
    const dados = {
      unidadeId: unidade.id,
      codigo,
      nome: linha.nome,
      vendedores: linha.vendedores,
      diasPreVenda: linha.diasPreVenda,
      fechamento: linha.fechamento,
      largada: linha.largada,
      // rota que voltou para a planilha volta a valer, e a inativacao anterior fica na trilha
      ativo: true,
      inativadoEm: null,
      inativadoPor: null,
      motivoInativacao: null,
    };

    if (!aplicar) {
      console.log(`[ensaio] ${existente ? 'atualizaria' : 'criaria'} ${codigo} - ${linha.nome}`);
      if (existente) relatorio.atualizadas++;
      else relatorio.criadas++;
      continue;
    }

    if (existente) {
      await prisma.rota.update({ where: { id: existente.id }, data: dados });
      relatorio.atualizadas++;
    } else {
      await prisma.rota.create({ data: { id: novoId(), ...dados } });
      relatorio.criadas++;
    }
  }

  // o que existia e nao esta na planilha: inativa com motivo, nunca apaga
  const foraDaPlanilha = await prisma.rota.findMany({
    where: { unidadeId: unidade.id, deletedAt: null, ativo: true, codigo: { notIn: [...codigosDaPlanilha] } },
    select: { id: true, nome: true },
  });

  if (aplicar) {
    for (const r of foraDaPlanilha) {
      await prisma.rota.update({
        where: { id: r.id },
        data: {
          ativo: false,
          inativadoEm: new Date(),
          motivoInativacao: 'Nao consta na planilha de rotas importada.',
        },
      });
    }
  }

  console.log('\n--- Relatorio ---');
  console.log(`criadas: ${relatorio.criadas} · atualizadas: ${relatorio.atualizadas}`);
  console.log(`inativadas por nao constarem na planilha: ${foraDaPlanilha.length}`);
  if (foraDaPlanilha.length > 0) console.log(`  ${foraDaPlanilha.map((r) => r.nome).join(', ')}`);
  if (!aplicar) console.log('\nEnsaio: nada foi gravado. Rode com --aplicar para valer.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
