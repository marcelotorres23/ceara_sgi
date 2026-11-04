/**
 * Frota de teste da regua de manutencao (ADR 0023).
 *
 * A frota real tem 89 veiculos, mas ela mostra o que a operacao viveu — nao o que a regua
 * precisa provar. Faltam justamente os casos de borda: o item exatamente em 75%, o que
 * vence por calendario com o hodometro parado, o aparelho de frio que resetou, o caminhao
 * com tres itens vencidos de uma vez. Esperar esses casos aparecerem sozinhos e esperar o
 * ano que vem.
 *
 * Este seed constroi cada um deles de proposito, com o resultado esperado escrito na
 * observacao do veiculo: a tela vira conferencia, e nao adivinhacao.
 *
 * **Nao apaga nada.** Roda por upsert na placa (regra de ouro 2: nada se exclui em tabela
 * de negocio), entao pode rodar quantas vezes for preciso. Todos os ativos nascem na
 * unidade MATRIZ, com placa no prefixo `TST` e status INATIVO — frota de teste nao pode
 * entrar em relatorio de operacao nem em fila de oficina de verdade.
 *
 *   pnpm db:seed-teste-regua
 */
import { CASOS } from './casos-teste-regua.js';
import { novoId, prisma } from '../core/db.js';

const DIA_MS = 86_400_000;
const agora = new Date();
const diasAtras = (n: number): Date => new Date(agora.getTime() - n * DIA_MS);

// ---------------------------------------------------------------------------
const unidade = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
console.log(`Frota de teste da regua na unidade ${unidade.codigo}.\n`);

for (const caso of CASOS) {
  const veiculo = await prisma.veiculo.upsert({
    where: { placa: caso.placa },
    create: {
      id: novoId(),
      unidadeId: unidade.id,
      placa: caso.placa,
      frotaNumero: `TESTE-${caso.placa.slice(-2)}`,
      tipo: 'TRUCK',
      marca: 'TESTE',
      modelo: caso.modelo,
      hodometroAtual: caso.hodometro,
      // frota de teste nao entra em relatorio nem em fila de oficina de verdade
      status: 'INATIVO',
      situacaoDescrita: 'FROTA DE TESTE DA REGUA',
      observacao: caso.esperado,
      createdBy: 'seed-teste-regua',
    },
    update: {
      hodometroAtual: caso.hodometro,
      modelo: caso.modelo,
      observacao: caso.esperado,
      status: 'INATIVO',
      situacaoDescrita: 'FROTA DE TESTE DA REGUA',
      updatedBy: 'seed-teste-regua',
    },
  });

  // toda medicao do cadastro tem uma leitura por tras (ADR 0023, decisao 6)
  await registrarLeitura(veiculo.id, null, 'ODOMETRO', caso.hodometro);

  await inativarExecucoesAnteriores({ veiculoId: veiculo.id });
  for (const e of caso.execucoes) {
    await prisma.servicoPeriodico.create({
      data: {
        id: novoId(),
        unidadeId: unidade.id,
        tipo: e.tipo,
        base: 'HODOMETRO',
        veiculoId: veiculo.id,
        executadoEm: diasAtras(e.diasAtras),
        medicao: e.medicao,
        intervalo: e.intervalo,
        proxima: e.medicao + e.intervalo,
        observacao: 'Execucao de teste da regua.',
        createdBy: 'seed-teste-regua',
      },
    });
  }

  if (caso.frio) {
    const existente = await prisma.equipamentoFrio.findFirst({ where: { veiculoId: veiculo.id } });
    const frio = existente
      ? await prisma.equipamentoFrio.update({
          where: { id: existente.id },
          data: { horimetro: caso.frio.horimetro, updatedBy: 'seed-teste-regua' },
        })
      : await prisma.equipamentoFrio.create({
          data: {
            id: novoId(),
            unidadeId: unidade.id,
            marca: caso.frio.marca,
            numeroSerie: `TESTE-${caso.placa}`,
            horimetro: caso.frio.horimetro,
            veiculoId: veiculo.id,
            observacao: 'Aparelho de teste da regua.',
            createdBy: 'seed-teste-regua',
          },
        });

    await registrarLeitura(null, frio.id, 'HORIMETRO_FRIO', caso.frio.horimetro);

    await inativarExecucoesAnteriores({ equipamentoFrioId: frio.id });
    await prisma.servicoPeriodico.create({
      data: {
        id: novoId(),
        unidadeId: unidade.id,
        tipo: 'OLEO_THERMO_KING',
        base: 'HORIMETRO',
        equipamentoFrioId: frio.id,
        executadoEm: diasAtras(caso.frio.diasAtras),
        medicao: caso.frio.ultima,
        intervalo: caso.frio.intervalo,
        proxima: caso.frio.ultima + caso.frio.intervalo,
        observacao: 'Execucao de teste da regua.',
        createdBy: 'seed-teste-regua',
      },
    });
  }

  console.log(`  ${caso.placa}  ${caso.esperado}`);
}

/**
 * Limpa a rodada anterior do seed sem apagar linha.
 *
 * Rodar de novo nao pode empilhar execucao em cima de execucao, senao o caso deixa de ser o
 * caso. Mas `DELETE` fisico em tabela de negocio nao existe neste sistema, nem em dado de
 * teste: inativa-se, e so o que este seed criou.
 */
async function inativarExecucoesAnteriores(
  alvo: { veiculoId: string } | { equipamentoFrioId: string },
): Promise<void> {
  await prisma.servicoPeriodico.updateMany({
    where: { ...alvo, createdBy: 'seed-teste-regua', deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

async function registrarLeitura(
  veiculoId: string | null,
  equipamentoFrioId: string | null,
  tipo: 'ODOMETRO' | 'HORIMETRO_FRIO',
  valor: number,
): Promise<void> {
  const ja = await prisma.leitura.findFirst({
    where: { veiculoId, equipamentoFrioId, tipo, valor, deletedAt: null },
  });
  if (ja) return;

  await prisma.leitura.create({
    data: {
      id: novoId(),
      unidadeId: unidade.id,
      tipo,
      valor,
      medidoEm: agora,
      origem: 'IMPORTACAO_LEGADO',
      veiculoId,
      equipamentoFrioId,
      avancouAtivo: true,
      observacao: 'Leitura da frota de teste da regua.',
      createdBy: 'seed-teste-regua',
    },
  });
}

console.log(`\n${CASOS.length} casos prontos. Confira com: pnpm smoke:regua`);
await prisma.$disconnect();
