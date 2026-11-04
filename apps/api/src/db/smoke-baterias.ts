/**
 * Fumaca do controle de baterias (secao 7.11).
 *
 * Cobre o caminho que a manutencao faz: cadastrar, instalar, medir, ver o ponto de troca,
 * recusar leitura impossivel e retirar com destino.
 */
import { criarApp } from '../app.js';
import { prisma, novoId } from '../core/db.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });

const login = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { email: process.env.SEED_ADMIN_EMAIL, senha: process.env.SEED_ADMIN_PASSWORD, unidadeId: matriz.id },
});
ok('login', login.statusCode === 200, login.json());
const cookies = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie: cookies } });

const veiculo = await prisma.veiculo.findFirstOrThrow({
  where: { unidadeId: matriz.id, deletedAt: null, status: 'ATIVO' },
});

// identificacao unica por execucao: o smoke roda quantas vezes precisar
const etiqueta = `SMK-BAT-${String(Date.now()).slice(-6)}`;

const criada = await req('POST', '/api/v1/transporte/baterias', {
  identificacao: etiqueta,
  marca: 'MOURA',
  amperagem: 150,
  dataCompra: new Date().toISOString(),
  garantiaMeses: 12,
  custo: '1250.00',
});
ok('cadastra a bateria', criada.statusCode === 201, criada.json());
const bateriaId = criada.json().id;

const repetida = await req('POST', '/api/v1/transporte/baterias', { identificacao: etiqueta });
ok('recusa etiqueta repetida na mesma unidade', repetida.statusCode === 409, repetida.json());

// ---- em estoque nao conta vida util
const painelEstoque = await req('GET', '/api/v1/transporte/baterias');
const emEstoque = painelEstoque.json().itens.find((b: { id: string }) => b.id === bateriaId);
ok('bateria nova em estoque aparece sem medicao', emEstoque.situacao === 'SEM_MEDICAO', emEstoque);
ok('em estoque nao conta tempo de uso', emEstoque.mesesEmUso === null, emEstoque);

// ---- instalacao
const instalada = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/instalar`, {
  veiculoId: veiculo.id,
  posicao: 1,
});
ok('instala no veiculo', instalada.statusCode === 200 && instalada.json().status === 'EM_USO', instalada.json());
ok(
  'o hodometro da instalacao vem do cadastro do veiculo',
  Number(instalada.json().hodometroInstalacao) === Number(veiculo.hodometroAtual),
  instalada.json().hodometroInstalacao,
);

const duplicada = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/instalar`, { veiculoId: veiculo.id });
ok('bateria ja instalada nao migra calada para outro veiculo', duplicada.statusCode === 409, duplicada.json());

// ---- medicoes
const impossivel = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/medicoes`, { tensaoV: '126.00' });
ok('recusa tensao fora da faixa fisica', impossivel.statusCode === 400, impossivel.json());

const boa = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/medicoes`, { tensaoV: '12.70' });
ok('registra medicao em repouso', boa.statusCode === 201, boa.json());
ok('bateria nova medindo bem fica em dia', boa.json().posicao.situacao === 'EM_DIA', boa.json().posicao);

const aposRodar = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/medicoes`, {
  tensaoV: '11.50',
  aposRodar: true,
});
ok('aceita medicao apos rodar', aposRodar.statusCode === 201, aposRodar.json());
ok(
  'medicao apos rodar nao decide o ponto de troca',
  aposRodar.json().posicao.situacao === 'EM_DIA',
  aposRodar.json().posicao,
);

const critica = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/medicoes`, { tensaoV: '11.60' });
ok('tensao critica em repouso leva ao ponto de troca', critica.json().posicao.situacao === 'TROCAR', critica.json().posicao);
ok(
  'e avisa que a troca ainda cabe na garantia',
  critica.json().posicao.naGarantia === true &&
    critica.json().posicao.mensagens.some((m: string) => m.includes('Garantia vigente')),
  critica.json().posicao,
);

const historico = await req('GET', `/api/v1/transporte/baterias/${bateriaId}/medicoes`);
ok('historico guarda as tres medicoes', historico.json().itens.length === 3, historico.json().itens?.length);

const painel = await req('GET', '/api/v1/transporte/baterias');
const linha = painel.json().itens.find((b: { id: string }) => b.id === bateriaId);
ok('o painel poe quem precisa trocar em primeiro', painel.json().itens[0].situacao === 'TROCAR', painel.json().itens[0]);
ok('e conta a bateria na garantia no ponto de troca', painel.json().resumo.naGarantiaNoPonto >= 1, painel.json().resumo);
ok('a linha mostra o veiculo onde ela esta', linha.veiculo?.placa === veiculo.placa, linha);

// ---- retirada
const semMotivo = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/retirar`, {
  motivo: 'ruim',
  destino: 'SUCATA',
});
ok('retirada sem motivo descrito e recusada', semMotivo.statusCode === 400, semMotivo.json());

const retirada = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/retirar`, {
  motivo: 'Tensao abaixo do minimo apos recarga',
  destino: 'EM_ANALISE_GARANTIA',
});
ok('retira com motivo e destino', retirada.statusCode === 200 && retirada.json().status === 'EM_ANALISE_GARANTIA', retirada.json());
ok('e solta o veiculo', retirada.json().veiculoId === null, retirada.json());

const novaRetirada = await req('POST', `/api/v1/transporte/baterias/${bateriaId}/retirar`, {
  motivo: 'Tentando retirar de novo',
  destino: 'SUCATA',
});
ok('bateria fora do veiculo nao e retirada duas vezes', novaRetirada.statusCode === 409, novaRetirada.json());

// o registro do smoke fica marcado, e nada e apagado (regra de ouro 2)
await prisma.bateria.update({
  where: { id: bateriaId },
  data: { observacao: 'Registro de fumaca automatizada.', status: 'SUCATA', motivoRetirada: 'Fumaca automatizada.' },
});

await app.close();
await prisma.$disconnect();
