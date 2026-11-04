/**
 * Carrega o historico de medidor a partir do que o sistema ja registrou (ADR 0023, decisao 6).
 *
 * A tabela de leituras nasceu depois dos dados. Sem esta carga, o km/dia comecaria do zero
 * e a coluna "vence em X dias" ficaria vazia por 30 dias — justamente a coluna que o
 * encarregado usa para montar a semana.
 *
 * Fontes, todas com data e valor ja confiaveis:
 *   - abastecimentos (hodometro e horimetro do veiculo)
 *   - execucoes de servico periodico (medicao da troca)
 *   - acessos de portaria do caminhao da casa (saida e retorno)
 *
 * Idempotente: nao duplica leitura que ja aponte para o mesmo documento de origem.
 *
 * Uso:
 *   npx tsx src/db/backfill-leituras.ts [--aplicar]
 */
import { prisma, novoId } from '../core/db.js';

const aplicar = process.argv.includes('--aplicar');

interface LeituraParaGravar {
  unidadeId: string;
  tipo: 'ODOMETRO' | 'HORIMETRO_VEICULO' | 'HORIMETRO_FRIO';
  valor: string;
  medidoEm: Date;
  origem: 'ABASTECIMENTO' | 'EXECUCAO_OFICINA' | 'PORTARIA';
  veiculoId?: string | null;
  equipamentoFrioId?: string | null;
  abastecimentoId?: string | null;
  servicoPeriodicoId?: string | null;
  acessoPortariaId?: string | null;
}

const paraGravar: LeituraParaGravar[] = [];

// ---- abastecimentos: a fonte mais densa de leitura de hodometro que a operacao ja tem
const abastecimentos = await prisma.abastecimento.findMany({
  where: { deletedAt: null },
  include: { veiculo: { select: { unidadeId: true } } },
});

for (const a of abastecimentos) {
  paraGravar.push({
    unidadeId: a.veiculo.unidadeId,
    tipo: 'ODOMETRO',
    valor: a.hodometro.toString(),
    medidoEm: a.dataHora,
    origem: 'ABASTECIMENTO',
    veiculoId: a.veiculoId,
    abastecimentoId: a.id,
  });

  // horimetro do abastecimento e do veiculo, e nao do aparelho de frio (ADR 0023)
  if (a.horimetro) {
    paraGravar.push({
      unidadeId: a.veiculo.unidadeId,
      tipo: 'HORIMETRO_VEICULO',
      valor: a.horimetro.toString(),
      medidoEm: a.dataHora,
      origem: 'ABASTECIMENTO',
      veiculoId: a.veiculoId,
      abastecimentoId: a.id,
    });
  }
}

// ---- execucoes de servico periodico
const execucoes = await prisma.servicoPeriodico.findMany({
  where: { deletedAt: null, medicao: { not: null } },
});

for (const e of execucoes) {
  if (e.medicao === null) continue;
  paraGravar.push({
    unidadeId: e.unidadeId,
    tipo: e.equipamentoFrioId ? 'HORIMETRO_FRIO' : 'ODOMETRO',
    valor: e.medicao.toString(),
    medidoEm: e.executadoEm,
    origem: 'EXECUCAO_OFICINA',
    veiculoId: e.veiculoId,
    equipamentoFrioId: e.equipamentoFrioId,
    servicoPeriodicoId: e.id,
  });
}

// ---- portaria: saida e retorno do caminhao da casa sao duas leituras distintas
const acessos = await prisma.acessoPortaria.findMany({
  where: { deletedAt: null, veiculoId: { not: null }, OR: [{ hodometroSaida: { not: null } }, { hodometroRetorno: { not: null } }] },
});

for (const a of acessos) {
  if (a.hodometroSaida && a.saidaEm) {
    paraGravar.push({
      unidadeId: a.unidadeId,
      tipo: 'ODOMETRO',
      valor: a.hodometroSaida.toString(),
      medidoEm: a.saidaEm,
      origem: 'PORTARIA',
      veiculoId: a.veiculoId,
      acessoPortariaId: a.id,
    });
  }
  if (a.hodometroRetorno && a.entradaEm) {
    paraGravar.push({
      unidadeId: a.unidadeId,
      tipo: 'ODOMETRO',
      valor: a.hodometroRetorno.toString(),
      medidoEm: a.entradaEm,
      origem: 'PORTARIA',
      veiculoId: a.veiculoId,
      acessoPortariaId: a.id,
    });
  }
}

// ---- o que ja existe nao entra de novo
const existentes = await prisma.leitura.findMany({
  where: { deletedAt: null },
  select: { abastecimentoId: true, servicoPeriodicoId: true, acessoPortariaId: true, tipo: true, valor: true },
});

const chaveDe = (l: { abastecimentoId?: string | null; servicoPeriodicoId?: string | null; acessoPortariaId?: string | null; tipo: string; valor: unknown }) =>
  `${l.abastecimentoId ?? ''}|${l.servicoPeriodicoId ?? ''}|${l.acessoPortariaId ?? ''}|${l.tipo}|${String(l.valor)}`;

const jaTem = new Set(existentes.map(chaveDe));
const novas = paraGravar.filter((l) => !jaTem.has(chaveDe(l)));

const porOrigem = novas.reduce<Record<string, number>>((acc, l) => {
  acc[l.origem] = (acc[l.origem] ?? 0) + 1;
  return acc;
}, {});

console.log(`leituras a gravar: ${novas.length} (ja existentes: ${paraGravar.length - novas.length})`);
console.log('por origem:', JSON.stringify(porOrigem));

if (!aplicar) {
  console.log('\nEnsaio: nada foi gravado. Rode com --aplicar para valer.');
} else {
  /*
   * `avancouAtivo` fica falso: esta carga e historico, e nao pode mexer no cadastro. O
   * hodometro corrente ja e o que os fluxos vivos deixaram — reescrever aqui seria inventar
   * uma ordem de chegada que nunca existiu.
   */
  for (const lote of dividir(novas, 500)) {
    await prisma.leitura.createMany({
      data: lote.map((l) => ({
        id: novoId(),
        unidadeId: l.unidadeId,
        tipo: l.tipo,
        valor: l.valor,
        medidoEm: l.medidoEm,
        origem: l.origem,
        veiculoId: l.veiculoId ?? null,
        equipamentoFrioId: l.equipamentoFrioId ?? null,
        abastecimentoId: l.abastecimentoId ?? null,
        servicoPeriodicoId: l.servicoPeriodicoId ?? null,
        acessoPortariaId: l.acessoPortariaId ?? null,
        observacao: 'Carga inicial do historico de medidor.',
        avancouAtivo: false,
      })),
    });
  }
  console.log(`gravadas: ${novas.length}`);
}

function* dividir<T>(lista: T[], tamanho: number): Generator<T[]> {
  for (let i = 0; i < lista.length; i += tamanho) yield lista.slice(i, i + tamanho);
}

await prisma.$disconnect();
