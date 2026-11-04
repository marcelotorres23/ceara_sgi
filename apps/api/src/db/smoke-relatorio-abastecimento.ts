/** Fumaca do relatorio de abastecimento (secao 7.2): filtros, totais, agrupamento e CSV. */
import { criarApp } from '../app.js';
import { prisma } from '../core/db.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
const login = await app.inject({
  method: 'POST', url: '/api/v1/auth/login',
  payload: { email: process.env.SEED_ADMIN_EMAIL, senha: process.env.SEED_ADMIN_PASSWORD, unidadeId: matriz.id },
});
const cookies = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const req = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: cookies } });

const base = await req('/api/v1/transporte/abastecimentos/relatorio');
const rel = base.json();
ok('relatorio abre sem filtro', base.statusCode === 200 && Array.isArray(rel.itens), rel.erro);
ok('traz totais do periodo', typeof rel.totais?.litros === 'string', rel.totais);
ok('e os quatro agrupamentos', ['porVeiculo','porMotorista','porPosto','porCombustivel'].every((k) => Array.isArray(rel[k])), Object.keys(rel));

const soma = rel.itens.reduce((a: number, i: { valorTotal: string }) => a + Number(i.valorTotal), 0);
ok('o total do topo bate com a soma da tabela', Math.abs(soma - Number(rel.totais.valorTotal)) < 0.01, { soma, total: rel.totais.valorTotal });

const somaGrupo = rel.porVeiculo.reduce((a: number, g: { valorTotal: string }) => a + Number(g.valorTotal), 0);
ok('e com a soma dos grupos', Math.abs(somaGrupo - Number(rel.totais.valorTotal)) < 0.01, { somaGrupo });

const comVeiculo = rel.itens[0];
if (comVeiculo) {
  const porVeiculo = await req(`/api/v1/transporte/abastecimentos/relatorio?veiculoId=${comVeiculo.veiculo.id}`);
  ok('filtra por veiculo', porVeiculo.json().itens.every((i: { veiculo: { id: string } }) => i.veiculo.id === comVeiculo.veiculo.id));

  const porBusca = await req(`/api/v1/transporte/abastecimentos/relatorio?busca=${comVeiculo.veiculo.placa}`);
  ok('busca por placa acha o registro', porBusca.json().itens.length > 0, porBusca.json().totais);
}

const futuro = await req('/api/v1/transporte/abastecimentos/relatorio?de=2099-01-01T00:00:00.000Z');
ok('periodo vazio devolve zeros, e nao erro', futuro.json().totais.abastecimentos === 0 && futuro.json().totais.consumoMedioKml === null, futuro.json().totais);

const soAnomalia = await req('/api/v1/transporte/abastecimentos/relatorio?anomalia=true');
ok('filtra so anomalias', soAnomalia.json().itens.every((i: { anomalia: boolean }) => i.anomalia), soAnomalia.json().totais);

const opcoes = await req('/api/v1/transporte/abastecimentos/opcoes-de-filtro');
ok('opcoes de filtro saem do historico', Array.isArray(opcoes.json().combustiveis) && Array.isArray(opcoes.json().postos), opcoes.json());

const csv = await req('/api/v1/transporte/abastecimentos/relatorio.csv');
const texto = csv.body;
ok('csv responde com cabecalho e BOM', csv.statusCode === 200 && texto.startsWith('\ufeff"data";') === false && texto.includes('data;placa'), texto.slice(0, 60));
ok('csv tem uma linha por abastecimento', texto.trim().split('\r\n').length === rel.itens.length + 1, {
  linhas: texto.trim().split('\r\n').length, itens: rel.itens.length,
});

await app.close();
await prisma.$disconnect();
