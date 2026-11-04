/** Fumaca da F7 + multiunidade: login com escolha de unidade, pneu, mapa, OS com baixa de estoque. */
import { criarApp } from '../app.js';
import { prisma, novoId } from '../core/db.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();

// segunda unidade, para exercitar o recorte
const filial = await prisma.unidade.upsert({
  where: { codigo: 'FILIAL-TE' },
  update: {},
  create: { id: novoId(), codigo: 'FILIAL-TE', nome: 'Filial Teresina', cidade: 'Teresina', uf: 'PI' },
});
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });

const login = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { email: process.env.SEED_ADMIN_EMAIL, senha: process.env.SEED_ADMIN_PASSWORD },
});
const corpoLogin = login.json();
ok('login pede a unidade quando ha mais de uma', corpoLogin.selecionarUnidade === true, corpoLogin);

const login2 = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { email: process.env.SEED_ADMIN_EMAIL, senha: process.env.SEED_ADMIN_PASSWORD, unidadeId: matriz.id },
});
ok('login com unidade informada abre sessao', login2.statusCode === 200 && login2.json().usuario?.unidadeAtivaId === matriz.id, login2.json());
const cookies = login2.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie: cookies } });

// veiculo na matriz - placa unica por execucao, para o smoke poder rodar varias vezes
const sufixo = String(Date.now()).slice(-4);
const veiculo = await req('POST', '/api/v1/transporte/veiculos', {
  placa: `SMK${sufixo[0]}A${sufixo.slice(1, 3)}`, frotaNumero: `SMK-${Date.now()}`, tipo: 'TRUCK', hodometroAtual: '100000',
});
ok('veiculo nasce na unidade ativa', veiculo.statusCode === 201 && veiculo.json().unidadeId === matriz.id, veiculo.json());
const veiculoId = veiculo.json().id;

const posicoes = await req('POST', `/api/v1/transporte/veiculos/${veiculoId}/posicoes-pneu`, {
  posicoes: [
    { codigo: '1E', eixo: 1, lado: 'ESQUERDO', ordem: 1 },
    { codigo: '1D', eixo: 1, lado: 'DIREITO', ordem: 2 },
  ],
});
ok('mapa de rodagem cadastrado', posicoes.statusCode === 201, posicoes.json());
const posicaoId = posicoes.json().itens[0].id;

// pneu
const pneu = await req('POST', '/api/v1/transporte/pneus', {
  numeroFogo: `F-${Date.now()}`, marca: 'Michelin', modelo: 'X Multi', medida: '275/80 R22.5',
  custoAquisicao: '2400.00', sulcoInicialMm: '14.00', vidaUtilKm: '120000',
});
ok('pneu cadastrado em estoque', pneu.statusCode === 201 && pneu.json().status === 'EM_ESTOQUE', pneu.json());
const pneuId = pneu.json().id;

const instalar = await req('POST', `/api/v1/transporte/pneus/${pneuId}/movimentacoes`, {
  tipo: 'INSTALACAO', veiculoId, posicaoId, hodometro: '100000', sulcoMm: '14.00',
});
ok('instalacao poe o pneu em uso', instalar.statusCode === 201 && instalar.json().pneu.status === 'EM_USO', instalar.json());

const invalida = await req('POST', `/api/v1/transporte/pneus/${pneuId}/movimentacoes`, {
  tipo: 'RETORNO_RECAPAGEM', hodometro: '100000',
});
ok('transicao invalida e recusada', invalida.statusCode === 409, invalida.json());

const remover = await req('POST', `/api/v1/transporte/pneus/${pneuId}/movimentacoes`, {
  tipo: 'REMOCAO', hodometro: '160000', sulcoMm: '5.00',
});
const removido = remover.json().pneu;
ok('remocao apura km do periodo', remover.statusCode === 201 && Number(removido.kmAcumulado) === 60000, removido);
ok('CPK calculado 2400/60000 = 0,04', Number(removido.cpk) === 0.04, removido.cpk);

const inspecao = await req('POST', `/api/v1/transporte/pneus/${pneuId}/inspecoes`, { sulcoMm: '1.20' });
ok('inspecao abaixo do legal bloqueia circulacao', inspecao.json().avaliacao?.bloqueiaCirculacao === true, inspecao.json());

const mapa = await req('GET', `/api/v1/transporte/pneus/mapa/${veiculoId}`);
ok('mapa de rodagem responde', mapa.statusCode === 200 && mapa.json().posicoes.length === 2, mapa.json().resumo);

// OS com baixa de estoque
const almox = await prisma.almoxarifado.findFirst({ where: { deletedAt: null } });
const item = await prisma.item.findFirst({ where: { deletedAt: null } });
const os = await req('POST', '/api/v1/transporte/manutencao/ordens', {
  veiculoId, tipo: 'CORRETIVA', descricao: 'Troca de filtro apos inspecao de rotina', hodometro: '160000',
});
ok('OS aberta na unidade do veiculo', os.statusCode === 201 && os.json().unidadeId === matriz.id, os.json());

if (almox && item) {
  const saldo = await prisma.saldo.findFirst({ where: { almoxarifadoId: almox.id, itemId: item.id } });
  const antes = Number(saldo?.quantidade ?? 0);
  const itemOs = await req('POST', `/api/v1/transporte/manutencao/ordens/${os.json().id}/itens`, {
    descricao: item.descricao, itemId: item.id, quantidade: '1', almoxarifadoId: almox.id,
  });
  if (antes >= 1) {
    const depois = await prisma.saldo.findFirst({ where: { almoxarifadoId: almox.id, itemId: item.id } });
    ok('peca da OS baixa o estoque', itemOs.statusCode === 201 && Number(depois?.quantidade) === antes - 1, {
      antes, depois: depois?.quantidade?.toString(), resposta: itemOs.json(),
    });
  } else {
    ok('sem saldo: baixa recusada com conflito', itemOs.statusCode === 409, itemOs.json());
  }
}

const concluir = await req('POST', `/api/v1/transporte/manutencao/ordens/${os.json().id}/concluir`, { hodometro: '160000' });
ok('OS concluida apura tempo parado', concluir.statusCode === 200 && concluir.json().os.status === 'CONCLUIDA', concluir.json());

// relatorios com recorte de unidade
const relatorio = await req('GET', `/api/v1/relatorios/frota/custo-por-veiculo?unidadeId=${matriz.id}`);
ok('relatorio recortado por unidade', relatorio.statusCode === 200 && Array.isArray(relatorio.json().itens), relatorio.json());

const outraUnidade = await req('GET', `/api/v1/relatorios/frota/custo-por-veiculo?unidadeId=${filial.id}`);
ok('admin com unidade:todas alcanca a filial', outraUnidade.statusCode === 200, outraUnidade.json());

const trocar = await req('POST', '/api/v1/auth/unidade-ativa', { unidadeId: filial.id });
ok('troca de unidade em operacao', trocar.statusCode === 200 && trocar.json().usuario.unidadeAtivaId === filial.id, trocar.json());

const inexistente = await req('POST', '/api/v1/auth/unidade-ativa', { unidadeId: 'nao-existe' });
ok('unidade fora do alcance e recusada', inexistente.statusCode === 422 || inexistente.statusCode === 400, inexistente.json());

await app.close();
await prisma.$disconnect();

// o pool do Redis e o do S3 mantem handles abertos; o script ja terminou seu trabalho
process.exit(process.exitCode ?? 0);
