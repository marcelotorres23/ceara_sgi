/**
 * Importa a frota real a partir da planilha de controle da distribuidora (secao 7.1).
 *
 * Idempotente: roda quantas vezes precisar. Veiculo ja cadastrado e atualizado pela
 * placa; equipamento de frio e casado pelo numero de serie quando existir, e pelo
 * veiculo quando nao. Nada e excluido - veiculo que sumiu da planilha e **inativado
 * com motivo** (regra de ouro 2), porque ele responde por checklists e OS antigas.
 *
 * Uso:
 *   npx tsx src/db/importar-frota.ts "caminho/da/planilha.xlsx" [--aplicar]
 *
 * Sem `--aplicar` roda em ensaio: mostra o que faria e nao grava nada.
 */
import ExcelJS from 'exceljs';
import { prisma, novoId } from '../core/db.js';
import { traduzirLinha, type LinhaDaPlanilha } from '../modules/transporte/importacao-frota.js';

const COLUNAS: Array<keyof LinhaDaPlanilha> = [
  'placa',
  'status',
  'propriedade',
  'cnpjProp',
  'renavam',
  'chassi',
  'vencCronotacografo',
  'licenciamento',
  'modelo',
  'tipo',
  'modeloBau',
  'anoBau',
  'capacidadeKg',
  'ano',
  'finalidade',
  'km',
  'marcaEqFrio',
  'motorEqFrio',
  'anoEqFrio',
  'numeroSerieEqFrio',
  'modeloEqFrio',
  'horimetroEqFrio',
  'statusEqFrio',
  'obsVeiculo',
  'obsEqFrio',
];

const celula = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown };
    if ('result' in o) return String(o.result ?? '');
    if ('text' in o) return String(o.text ?? '');
  }
  return String(v).trim();
};

async function lerPlanilha(caminho: string): Promise<LinhaDaPlanilha[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Planilha sem abas.');

  const linhas: LinhaDaPlanilha[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    // a planilha tem titulo e cabecalho antes dos dados; a linha 6 e o cabecalho
    if (n <= 6) return;
    const valores = (row.values as unknown[]).slice(2).map(celula);
    if (celula(valores[0]) === '') return;

    const linha = {} as Record<string, string>;
    COLUNAS.forEach((chave, i) => {
      linha[chave as string] = valores[i] ?? '';
    });
    linhas.push(linha as unknown as LinhaDaPlanilha);
  });

  return linhas;
}

async function main(): Promise<void> {
  const caminho = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!caminho) throw new Error('Informe o caminho da planilha.');

  const linhas = await lerPlanilha(caminho);
  console.log(`Planilha: ${linhas.length} veiculo(s).`);

  /*
   * A unidade e escolhida, nao adivinhada: ordenar por codigo mandava a frota inteira
   * para a filial, so porque "FILIAL-TE" vem antes de "MATRIZ" no alfabeto.
   * Use --unidade=CODIGO para outra; sem isso, MATRIZ.
   */
  const codigoPedido = process.argv.find((a) => a.startsWith('--unidade='))?.split('=')[1] ?? 'MATRIZ';
  const unidade = await prisma.unidade.findFirst({ where: { codigo: codigoPedido, deletedAt: null } });
  if (!unidade) throw new Error(`Unidade "${codigoPedido}" nao encontrada.`);
  console.log(`Unidade de destino: ${unidade.codigo} - ${unidade.nome}\n`);

  const placasDaPlanilha = new Set<string>();
  const relatorio = { criados: 0, atualizados: 0, equipamentos: 0, avisos: [] as string[] };

  for (const linha of linhas) {
    const { veiculo, equipamento, avisos } = traduzirLinha(linha);
    placasDaPlanilha.add(veiculo.placa);
    for (const a of avisos) relatorio.avisos.push(`${veiculo.placa}: ${a}`);

    const existente = await prisma.veiculo.findFirst({ where: { placa: veiculo.placa } });

    const dados = {
      unidadeId: unidade.id,
      placa: veiculo.placa,
      frotaNumero: veiculo.frotaNumero,
      renavam: veiculo.renavam,
      chassi: veiculo.chassi,
      tipo: veiculo.tipo as never,
      marca: veiculo.marca,
      modelo: veiculo.modelo,
      ano: veiculo.ano,
      status: veiculo.status as never,
      situacaoDescrita: veiculo.situacaoDescrita,
      propriedade: veiculo.propriedade,
      cnpjProprietario: veiculo.cnpjProprietario,
      capacidadeKg: veiculo.capacidadeKg,
      finalidade: veiculo.finalidade,
      observacao: veiculo.observacao,
      // hodometro so avanca: a planilha pode estar atras do que o sistema ja registrou
      hodometroAtual: existente
        ? String(Math.max(Number(existente.hodometroAtual), Number(veiculo.hodometroAtual)))
        : veiculo.hodometroAtual,
    };

    if (!aplicar) {
      console.log(`[ensaio] ${existente ? 'atualizaria' : 'criaria'} ${veiculo.placa} ${veiculo.marca ?? ''} ${veiculo.modelo ?? ''}`);
      if (equipamento) console.log(`         equipamento ${equipamento.marca} ${equipamento.modelo ?? ''} (${equipamento.tipoAcionamento})`);
      existente ? relatorio.atualizados++ : relatorio.criados++;
      if (equipamento) relatorio.equipamentos++;
      continue;
    }

    const gravado = existente
      ? await prisma.veiculo.update({ where: { id: existente.id }, data: dados })
      : await prisma.veiculo.create({ data: { id: novoId(), ...dados } });

    existente ? relatorio.atualizados++ : relatorio.criados++;

    // documentos com vencimento entram no cadastro proprio, que ja tem alerta D-30/15/7
    if (veiculo.vencimentoCronotacografo) {
      await gravarDocumento(gravado.id, 'CRONOTACOGRAFO', veiculo.vencimentoCronotacografo);
    }
    if (veiculo.licenciamentoAno) {
      await gravarDocumento(gravado.id, 'LICENCIAMENTO', new Date(Date.UTC(veiculo.licenciamentoAno, 11, 31)));
    }

    if (equipamento) {
      const jaExiste = equipamento.numeroSerie
        ? await prisma.equipamentoFrio.findFirst({ where: { numeroSerie: equipamento.numeroSerie, deletedAt: null } })
        : await prisma.equipamentoFrio.findFirst({ where: { veiculoId: gravado.id, deletedAt: null } });

      const dadosEq = {
        unidadeId: unidade.id,
        marca: equipamento.marca,
        modelo: equipamento.modelo,
        numeroSerie: equipamento.numeroSerie,
        tipoAcionamento: equipamento.tipoAcionamento as never,
        ano: equipamento.ano,
        horimetro: equipamento.horimetro,
        status: equipamento.status as never,
        observacao: equipamento.observacao,
        veiculoId: gravado.id,
      };

      if (jaExiste) await prisma.equipamentoFrio.update({ where: { id: jaExiste.id }, data: dadosEq });
      else await prisma.equipamentoFrio.create({ data: { id: novoId(), ...dadosEq } });
      relatorio.equipamentos++;
    }
  }

  // o que existia e nao esta na planilha: inativa com motivo, nunca apaga
  const forasDaPlanilha = await prisma.veiculo.findMany({
    where: { deletedAt: null, placa: { notIn: [...placasDaPlanilha] }, status: { not: 'INATIVO' } },
    select: { id: true, placa: true },
  });

  if (aplicar) {
    for (const v of forasDaPlanilha) {
      await prisma.veiculo.update({
        where: { id: v.id },
        data: {
          status: 'INATIVO',
          inativadoEm: new Date(),
          motivoInativacao: 'Nao consta na planilha de frota importada.',
        },
      });
    }
  }

  console.log('\n--- Relatorio ---');
  console.log(`criados: ${relatorio.criados} · atualizados: ${relatorio.atualizados} · equipamentos de frio: ${relatorio.equipamentos}`);
  console.log(`inativados por nao constarem na planilha: ${forasDaPlanilha.length}`);
  if (forasDaPlanilha.length > 0) console.log(`  ${forasDaPlanilha.map((v) => v.placa).join(', ')}`);

  if (relatorio.avisos.length > 0) {
    console.log(`\nAvisos (${relatorio.avisos.length}) - conferir com quem conhece a frota:`);
    for (const a of relatorio.avisos) console.log(`  ${a}`);
  }

  if (!aplicar) console.log('\nENSAIO: nada foi gravado. Rode de novo com --aplicar.');
}

async function gravarDocumento(veiculoId: string, tipo: string, vencimento: Date): Promise<void> {
  const existente = await prisma.veiculoDocumento.findFirst({ where: { veiculoId, tipo, deletedAt: null } });
  if (existente) {
    await prisma.veiculoDocumento.update({ where: { id: existente.id }, data: { vencimento } });
    return;
  }
  await prisma.veiculoDocumento.create({ data: { id: novoId(), veiculoId, tipo, vencimento } });
}

main()
  .catch((erro) => {
    console.error('Falha na importacao:', erro instanceof Error ? erro.message : erro);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
