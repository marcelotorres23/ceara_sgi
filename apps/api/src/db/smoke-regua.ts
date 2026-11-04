/**
 * Fumaca da regua de manutencao sobre a frota de teste (ADR 0023).
 *
 * A regua ainda nao esta ligada ao painel — isso e a etapa 3. Enquanto nao esta, este
 * script e a unica forma de ver os casos do `seed-teste-regua` respondidos de verdade: roda
 * a regua sobre cada ativo, imprime severidade, fracao do ciclo, motivo e alerta, e confere
 * cada linha contra o que `casos-teste-regua.ts` declara.
 *
 * Serve de conferencia e de porta de entrada: quando a tela existir, ela tem que mostrar
 * exatamente estas linhas.
 *
 *   pnpm smoke:regua
 */
import { prisma } from '../core/db.js';
import { INTERVALO_PADRAO, type TipoServicoPeriodico } from '../modules/transporte/manutencao-periodica.js';
import {
  ROTULO_SEVERIDADE,
  posicaoNaRegua,
  scoreDoAtivo,
  textoDoRestante,
  type PosicaoNaRegua,
} from '../modules/transporte/regua-manutencao.js';
import { CASOS } from './casos-teste-regua.js';

let falhas = 0;
const falhar = (msg: string): void => {
  console.log(`      FALHA: ${msg}`);
  falhas += 1;
};

for (const caso of CASOS) {
  const veiculo = await prisma.veiculo.findUnique({
    where: { placa: caso.placa },
    include: {
      servicosPeriodicos: { where: { deletedAt: null }, orderBy: { executadoEm: 'desc' } },
      equipamentosFrio: {
        where: { deletedAt: null },
        include: { servicosPeriodicos: { where: { deletedAt: null }, orderBy: { executadoEm: 'desc' } } },
      },
    },
  });

  console.log(`\n${caso.placa}  ${caso.modelo}`);
  console.log(`  ${caso.esperado}`);

  if (!veiculo) {
    falhar(`veiculo nao encontrado. Rode antes: pnpm db:seed-teste-regua`);
    continue;
  }

  const apuradas: PosicaoNaRegua[] = [];

  // ---- itens do veiculo. Os tipos vem da **expectativa**, e nao do historico: item sem
  // execucao registrada tambem precisa ser apurado — e o caso do ativo sem historico.
  for (const [tipo, esperada] of Object.entries(caso.espera) as [TipoServicoPeriodico, string][]) {
    const ultima = veiculo.servicosPeriodicos.find((s) => s.tipo === tipo);
    const r = posicaoNaRegua({
      plano: {
        tipo,
        base: 'HODOMETRO',
        intervalo: ultima ? ultima.intervalo.toString() : String(INTERVALO_PADRAO[tipo].intervalo),
        avisarCom: String(INTERVALO_PADRAO[tipo].avisarCom),
      },
      medicaoDaUltima: ultima?.medicao?.toString() ?? null,
      medicaoAtual: veiculo.hodometroAtual.toString(),
      dataDaUltima: ultima?.executadoEm ?? null,
    });
    apuradas.push(r);
    imprimir(tipo, r, 'HODOMETRO');
    if (r.severidade !== esperada) falhar(`${tipo}: esperava ${esperada}, apurou ${r.severidade}`);
  }

  // ---- aparelho de frio: horimetro proprio, nunca o do veiculo (decisao 4)
  if (caso.frio) {
    const frio = veiculo.equipamentosFrio[0];
    if (!frio) {
      falhar('aparelho de frio nao encontrado');
    } else {
      const ultima = frio.servicosPeriodicos.find((s) => s.tipo === 'OLEO_THERMO_KING');
      const r = posicaoNaRegua({
        plano: {
          tipo: 'OLEO_THERMO_KING',
          base: 'HORIMETRO',
          intervalo: ultima ? ultima.intervalo.toString() : String(caso.frio.intervalo),
          avisarCom: '100',
        },
        medicaoDaUltima: ultima?.medicao?.toString() ?? null,
        medicaoAtual: frio.horimetro?.toString() ?? null,
        dataDaUltima: ultima?.executadoEm ?? null,
      });
      apuradas.push(r);
      imprimir(`OLEO_THERMO_KING (${frio.marca})`, r, 'HORIMETRO');
      if (r.severidade !== caso.frio.espera) {
        falhar(`frio: esperava ${caso.frio.espera}, apurou ${r.severidade}`);
      }
    }
  }

  const score = scoreDoAtivo(apuradas);
  console.log(`  score de fila: ${score}`);
  if (score !== caso.scoreEsperado) falhar(`score: esperava ${caso.scoreEsperado}, apurou ${score}`);
}

function imprimir(rotulo: string, r: PosicaoNaRegua, base: 'HODOMETRO' | 'HORIMETRO'): void {
  const pct = `${(r.usado * 100).toFixed(1)}%`.padStart(7);
  console.log(
    `  ${rotulo.padEnd(30)} ${ROTULO_SEVERIDADE[r.severidade].padEnd(12)} ${pct}  ${textoDoRestante(r, base)}`,
  );
  if (r.motivo) console.log(`      motivo: ${r.motivo}`);
  if (r.alerta) console.log(`      alerta: ${r.alerta}`);
}

console.log(
  falhas === 0
    ? `\n${CASOS.length} casos conferidos, nenhuma divergencia.`
    : `\n${falhas} divergencia(s) entre o esperado e o apurado.`,
);
if (falhas > 0) process.exitCode = 1;

await prisma.$disconnect();
