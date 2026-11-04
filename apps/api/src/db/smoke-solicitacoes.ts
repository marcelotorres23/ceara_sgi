/** Fumaca do ciclo de solicitacao: abertura, triagem, lote e recorte por unidade. */
import { criarApp } from '../app.js';
import { prisma, novoId } from '../core/db.js';
import { gerarHashSenha } from '../core/auth/password.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const sufixo = String(Date.now()).slice(-6);
const senha = 'Smoke#SOL-2026';

const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
const filial = await prisma.unidade.upsert({
  where: { codigo: 'FILIAL-TE' },
  update: {},
  create: { id: novoId(), codigo: 'FILIAL-TE', nome: 'Filial Teresina', cidade: 'Teresina', uf: 'PI' },
});

const ccMatriz = await prisma.centroCusto.findFirstOrThrow({ where: { unidadeId: matriz.id, deletedAt: null } });
const ccFilial = await prisma.centroCusto.upsert({
  where: { codigo: 'F-3021' },
  update: {},
  create: { id: novoId(), codigo: 'F-3021', nome: 'Manutencao Filial', unidadeId: filial.id },
});

/** Cria um usuario com um perfil e devolve o cookie da sessao na unidade informada. */
async function sessao(nomePerfil: string, unidadeId: string, apelido: string) {
  const usuario = await prisma.usuario.create({
    data: {
      id: novoId(),
      nome: `${apelido} ${sufixo}`,
      email: `${apelido.toLowerCase()}-${sufixo}@cearaalimentos.com.br`,
      senhaHash: await gerarHashSenha(senha),
      unidadeId,
    },
  });
  const perfil = await prisma.perfil.findFirstOrThrow({ where: { nome: nomePerfil } });
  await prisma.usuarioPerfil.create({
    data: { usuarioId: usuario.id, perfilId: perfil.id, escopo: { unidades: [unidadeId], centrosCusto: [] } },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: usuario.email, senha, unidadeId },
  });

  return {
    usuario,
    cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  };
}

const solicitante = await sessao('Solicitante', matriz.id, 'Solicitante');
const comprador = await sessao('Comprador', matriz.id, 'Comprador');
const daFilial = await sessao('Solicitante', filial.id, 'Filial');

const req = (method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie } });

const amanha = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------ abertura
const semItem = await req('POST', '/api/v1/compras/solicitacoes', solicitante.cookie, {
  centroCustoId: ccMatriz.id,
  criticidade: 'P3',
  origemDemanda: 'Reposicao de estoque',
  dataLimite: amanha,
  itens: [],
});
ok('solicitacao sem item e recusada', semItem.statusCode === 400, semItem.json());

const aberta = await req('POST', '/api/v1/compras/solicitacoes', solicitante.cookie, {
  centroCustoId: ccMatriz.id,
  criticidade: 'P3',
  origemDemanda: 'Reposicao de estoque minimo',
  dataLimite: amanha,
  itens: [{ descricaoLivre: 'Correia dentada do motor MB OM-457', quantidade: '2', unidadeMedida: 'UN' }],
});
const solicitacao = aberta.json();
ok('solicitacao aberta com numero sequencial', aberta.statusCode === 201 && /^SOL-\d{4}-\d{4}$/.test(solicitacao.numero), solicitacao);
ok('a unidade vem do centro de custo, nao do cliente', solicitacao.unidadeId === matriz.id, solicitacao.unidadeId);

const ccDeOutraUnidade = await req('POST', '/api/v1/compras/solicitacoes', solicitante.cookie, {
  centroCustoId: ccFilial.id,
  criticidade: 'P3',
  origemDemanda: 'Teste de unidade cruzada',
  dataLimite: amanha,
  itens: [{ descricaoLivre: 'Item qualquer', quantidade: '1', unidadeMedida: 'UN' }],
});
ok('centro de custo de outra unidade e recusado', ccDeOutraUnidade.statusCode === 400, ccDeOutraUnidade.json());

// ------------------------------------------------ recorte por unidade na listagem
const daFilialAberta = await req('POST', '/api/v1/compras/solicitacoes', daFilial.cookie, {
  centroCustoId: ccFilial.id,
  criticidade: 'P4',
  origemDemanda: 'Compra da filial',
  dataLimite: amanha,
  itens: [{ descricaoLivre: 'Filtro de ar', quantidade: '4', unidadeMedida: 'UN' }],
});
ok('filial abre solicitacao na propria unidade', daFilialAberta.statusCode === 201, daFilialAberta.json());

const listaMatriz = await req('GET', '/api/v1/compras/solicitacoes?limite=100', solicitante.cookie);
const numerosMatriz = listaMatriz.json().itens.map((s: { numero: string }) => s.numero);
ok(
  'listagem nao mostra solicitacao de outra unidade',
  numerosMatriz.includes(solicitacao.numero) && !numerosMatriz.includes(daFilialAberta.json().numero),
  { total: numerosMatriz.length },
);

const detalheCruzado = await req('GET', `/api/v1/compras/solicitacoes/${daFilialAberta.json().id}`, solicitante.cookie);
ok('detalhe de outra unidade responde 404', detalheCruzado.statusCode === 404, detalheCruzado.json());

// ------------------------------------------------ triagem
const semMotivo = await req('POST', `/api/v1/compras/solicitacoes/${solicitacao.id}/devolver`, comprador.cookie, {
  motivo: 'oi',
});
ok('devolucao exige motivo', semMotivo.statusCode === 400, semMotivo.json());

const devolvida = await req('POST', `/api/v1/compras/solicitacoes/${solicitacao.id}/devolver`, comprador.cookie, {
  motivo: 'Especificacao incompleta: informe a medida da correia.',
});
ok('devolucao ao solicitante registra o motivo', devolvida.statusCode === 200 && devolvida.json().status === 'DEVOLVIDA', devolvida.json());

// ------------------------------------------------ lote e SoD
const paraLote = await req('POST', '/api/v1/compras/solicitacoes', solicitante.cookie, {
  centroCustoId: ccMatriz.id,
  criticidade: 'P2',
  origemDemanda: 'Parada de veiculo',
  dataLimite: amanha,
  itens: [{ descricaoLivre: 'Bateria 150Ah', quantidade: '1', unidadeMedida: 'UN' }],
});

const lote = await req('POST', '/api/v1/compras/lotes', comprador.cookie, {
  solicitacaoIds: [paraLote.json().id],
});
ok('comprador agrupa em lote e o SLA nasce', lote.statusCode === 201 && lote.json().slaVenceEm, lote.json());
ok('o lote herda a unidade das solicitacoes', lote.json().unidadeId === matriz.id, lote.json().unidadeId);

// SoD: quem abriu a solicitacao nao pode cota-la
const outra = await req('POST', '/api/v1/compras/solicitacoes', solicitante.cookie, {
  centroCustoId: ccMatriz.id,
  criticidade: 'P3',
  origemDemanda: 'Teste de segregacao',
  dataLimite: amanha,
  itens: [{ descricaoLivre: 'Jogo de pastilhas', quantidade: '1', unidadeMedida: 'JG' }],
});

// o Solicitante nao tem lote:criar, entao a barreira aparece como falta de permissao
const proprioSolicitante = await req('POST', '/api/v1/compras/lotes', solicitante.cookie, {
  solicitacaoIds: [outra.json().id],
});
ok('solicitante nao agrupa o proprio pedido em lote', proprioSolicitante.statusCode === 403, proprioSolicitante.json());

// ------------------------------------------------ cancelamento
const cancelada = await req('POST', `/api/v1/compras/solicitacoes/${outra.json().id}/cancelar`, solicitante.cookie, {
  motivo: 'Peca encontrada no almoxarifado da unidade.',
});
ok('cancelamento com motivo preserva a trilha', cancelada.statusCode === 200 && cancelada.json().status === 'CANCELADA', cancelada.json());

const jaCancelada = await req('POST', `/api/v1/compras/solicitacoes/${outra.json().id}/cancelar`, solicitante.cookie, {
  motivo: 'Tentativa de cancelar de novo.',
});
ok('cancelar duas vezes e conflito', jaCancelada.statusCode === 409, jaCancelada.json());

const cancelarDeOutraUnidade = await req(
  'POST',
  `/api/v1/compras/solicitacoes/${daFilialAberta.json().id}/cancelar`,
  solicitante.cookie,
  { motivo: 'Cancelamento cruzado entre unidades.' },
);
ok('nao se cancela solicitacao de outra unidade', cancelarDeOutraUnidade.statusCode === 404, cancelarDeOutraUnidade.json());

// ------------------------------------------------ catalogo e centros de custo (apoio das telas)
const catalogo = await req('GET', '/api/v1/compras/itens?limite=10', solicitante.cookie);
ok('catalogo responde para o solicitante', catalogo.statusCode === 200 && Array.isArray(catalogo.json().itens), catalogo.statusCode);

const centros = await req('GET', '/api/v1/centros-custo', solicitante.cookie);
ok('centros de custo respondem com rotulo pronto', centros.statusCode === 200 && Boolean(centros.json().itens[0]?.rotulo), centros.json().itens?.[0]);

await app.close();
await prisma.$disconnect();
process.exit(process.exitCode ?? 0);
