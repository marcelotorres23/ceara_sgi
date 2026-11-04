/** Fumaca do ciclo do comprador: cotacoes de N fornecedores, mapa, savings e pedido. */
import { criarApp } from '../app.js';
import { prisma, novoId } from '../core/db.js';
import { gerarHashSenha } from '../core/auth/password.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const sufixo = String(Date.now()).slice(-6);
const senha = 'Smoke#COT-2026';

const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
const cc = await prisma.centroCusto.findFirstOrThrow({ where: { unidadeId: matriz.id, deletedAt: null } });

async function sessao(perfil: string, apelido: string) {
  const usuario = await prisma.usuario.create({
    data: {
      id: novoId(),
      nome: `${apelido} ${sufixo}`,
      email: `${apelido.toLowerCase()}-${sufixo}@cearaalimentos.com.br`,
      senhaHash: await gerarHashSenha(senha),
      unidadeId: matriz.id,
    },
  });
  const p = await prisma.perfil.findFirstOrThrow({ where: { nome: perfil } });
  await prisma.usuarioPerfil.create({
    data: { usuarioId: usuario.id, perfilId: p.id, escopo: { unidades: [matriz.id], centrosCusto: [] } },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: usuario.email, senha, unidadeId: matriz.id },
  });
  return { usuario, cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

const solicitante = await sessao('Solicitante', 'Sol');
const comprador = await sessao('Comprador', 'Comp');
const coordenador = await sessao('Coordenador de Suprimentos', 'Coord');

/** PNG 1x1 real: o storage recusa arquivo vazio e valida o mime. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const req = (method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie } });

// tres fornecedores homologados, para exercitar a comparacao
const fornecedores = [];
for (const nome of ['Alfa Pecas', 'Beta Suprimentos', 'Gama Distribuidora']) {
  const criado = await req('POST', '/api/v1/compras/fornecedores', comprador.cookie, {
    razaoSocial: `${nome} ${sufixo}`,
    cnpj: String(Date.now() + fornecedores.length).padStart(14, '0').slice(-14),
  });
  await req('POST', `/api/v1/compras/fornecedores/${criado.json().id}/homologar`, comprador.cookie, {
    validoAte: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  });
  fornecedores.push(criado.json());
}
ok('tres fornecedores homologados', fornecedores.length === 3, fornecedores.map((f) => f.razaoSocial));

// solicitacao e lote
const solicitacao = await req('POST', '/api/v1/compras/solicitacoes', solicitante.cookie, {
  centroCustoId: cc.id,
  criticidade: 'P3',
  origemDemanda: 'Reposicao programada',
  dataLimite: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
  itens: [{ descricaoLivre: 'Oleo lubrificante 15W40 balde 20L', quantidade: '10', unidadeMedida: 'BD' }],
});
const lote = await req('POST', '/api/v1/compras/lotes', comprador.cookie, {
  solicitacaoIds: [solicitacao.json().id],
});
const loteId = lote.json().id;
const itemId = solicitacao.json().itens[0].id;

// ------------------------------------------------ cotacoes
const abertura = await req('POST', `/api/v1/compras/lotes/${loteId}/cotacoes`, comprador.cookie, {
  fornecedorIds: fornecedores.map((f) => f.id),
});
ok('abre cotacao para os tres fornecedores de uma vez', abertura.statusCode === 201 && abertura.json().itens.length === 3, abertura.json());

const cotacoes = abertura.json().itens;

/** Registra proposta com preco unitario e prazo de pagamento. */
const anexarEvidencia = (cotacaoId: string, nome = 'orcamento.png') =>
  req('POST', `/api/v1/compras/cotacoes/${cotacaoId}/evidencias`, comprador.cookie, {
    conteudoBase64: PNG_1X1,
    mime: 'image/png',
    nome,
    descricao: 'Print do orcamento enviado pelo fornecedor',
  });

const responder = (cotacaoId: string, preco: string, prazoDias: number, frete = '0') =>
  req('POST', `/api/v1/compras/cotacoes/${cotacaoId}/resposta`, comprador.cookie, {
    condicaoPagamento: `${prazoDias} dias`,
    prazoDias,
    prazoEntregaDias: 7,
    freteTipo: 'CIF',
    freteValor: frete,
    itens: [{ solicitacaoItemId: itemId, precoUnitario: preco, quantidade: '10' }],
  });

// ------------------------------------------------ evidencia da cotacao
const semEvidencia = await responder(cotacoes[0].id, '100.00', 0);
ok('proposta sem evidencia e recusada', semEvidencia.statusCode === 400, semEvidencia.json());

const evidencia = await anexarEvidencia(cotacoes[0].id);
ok('evidencia anexada a cotacao', evidencia.statusCode === 201 && evidencia.json().anexo?.id, evidencia.json());

const repetida = await anexarEvidencia(cotacoes[0].id);
ok('o mesmo arquivo nao vira segunda evidencia', repetida.statusCode === 200 && repetida.json().duplicada === true, repetida.json());

const listaEvidencias = await req('GET', `/api/v1/compras/cotacoes/${cotacoes[0].id}/evidencias`, comprador.cookie);
ok(
  'evidencia lista com url assinada, autor e hash',
  listaEvidencias.statusCode === 200 &&
    listaEvidencias.json().itens.length === 1 &&
    Boolean(listaEvidencias.json().itens[0].url) &&
    Boolean(listaEvidencias.json().itens[0].hashSha256),
  listaEvidencias.json().itens?.[0],
);

await anexarEvidencia(cotacoes[1].id, 'orcamento-beta.png');
await anexarEvidencia(cotacoes[2].id, 'orcamento-gama.png');

// Alfa: 100/un a vista = 1.000 · Beta: 105/un em 60 dias = 1.050 · Gama: 120/un = 1.200
const alfa = await responder(cotacoes[0].id, '100.00', 0);
ok('proposta registrada com total calculado', alfa.statusCode === 200 && Number(alfa.json().valorTotal) === 1000, alfa.json());

await responder(cotacoes[1].id, '105.00', 60);
await responder(cotacoes[2].id, '120.00', 0);

const duasVezes = await responder(cotacoes[0].id, '90.00', 0);
ok('a mesma cotacao nao aceita segunda resposta', duasVezes.statusCode === 409, duasVezes.json());

// ------------------------------------------------ mapa e savings
const mapa = await req('POST', `/api/v1/compras/lotes/${loteId}/mapa`, comprador.cookie, {});
const resultado = mapa.json();
ok('mapa responde com ranking das tres propostas', mapa.statusCode === 201 && resultado.ranking.length === 3, resultado);

const posicoes = resultado.ranking.map((r: { fornecedor: string; posicao: number }) => `${r.posicao}:${r.fornecedor}`);
ok('o ranking ordena por valor presente, nao por valor de face', posicoes[0].includes('Alfa'), posicoes);

// savings = pior proposta (1.200 da Gama) - escolhida (1.000 da Alfa)
ok('savings compara com a pior proposta levantada', Number(resultado.savings) === 200, {
  savings: resultado.savings,
  ranking: resultado.ranking,
});

const painelSavings = await req('GET', '/api/v1/relatorios/compras/savings', comprador.cookie);
ok('painel de savings responde ao proprio comprador', painelSavings.statusCode === 200, painelSavings.statusCode);
ok(
  'a memoria de calculo explica a base',
  /maior proposta/.test(painelSavings.json().memoriaDeCalculo?.base ?? ''),
  painelSavings.json().memoriaDeCalculo,
);

// ------------------------------------------------ escolha divergente
const outroLote = await (async () => {
  const s = await req('POST', '/api/v1/compras/solicitacoes', solicitante.cookie, {
    centroCustoId: cc.id,
    criticidade: 'P3',
    origemDemanda: 'Teste de escolha divergente',
    dataLimite: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
    itens: [{ descricaoLivre: 'Filtro de combustivel', quantidade: '5', unidadeMedida: 'UN' }],
  });
  const l = await req('POST', '/api/v1/compras/lotes', comprador.cookie, { solicitacaoIds: [s.json().id] });
  const c = await req('POST', `/api/v1/compras/lotes/${l.json().id}/cotacoes`, comprador.cookie, {
    fornecedorIds: [fornecedores[0].id, fornecedores[1].id],
  });
  const itemDoLote = s.json().itens[0].id;

  for (const [indice, preco] of [['0', '10.00'], ['1', '20.00']] as const) {
    await anexarEvidencia(c.json().itens[Number(indice)].id, `orcamento-divergente-${indice}.png`);
    await req('POST', `/api/v1/compras/cotacoes/${c.json().itens[Number(indice)].id}/resposta`, comprador.cookie, {
      condicaoPagamento: 'a vista',
      prazoDias: 0,
      prazoEntregaDias: 5,
      freteTipo: 'CIF',
      itens: [{ solicitacaoItemId: itemDoLote, precoUnitario: preco, quantidade: '5' }],
    });
  }
  return { loteId: l.json().id, cotacaoCara: c.json().itens[1].id };
})();

const semJustificativa = await req('POST', `/api/v1/compras/lotes/${outroLote.loteId}/mapa`, comprador.cookie, {
  cotacaoEscolhidaId: outroLote.cotacaoCara,
});
ok('escolha fora do menor preco exige justificativa', semJustificativa.statusCode === 400, semJustificativa.json());

const comJustificativa = await req('POST', `/api/v1/compras/lotes/${outroLote.loteId}/mapa`, comprador.cookie, {
  cotacaoEscolhidaId: outroLote.cotacaoCara,
  justificativa: 'Fornecedor unico com o filtro homologado pelo fabricante para o motor OM-457.',
});
ok('com justificativa, o mapa aceita e marca a divergencia', comJustificativa.statusCode === 201 && comJustificativa.json().divergenteMenorPreco === true, comJustificativa.json());

// ------------------------------------------------ aprovacao e pedido
const submissao = await req('POST', `/api/v1/compras/lotes/${loteId}/submeter`, comprador.cookie, {});
ok('lote submetido a alcada', submissao.statusCode === 200, submissao.json());

const autoAprovacao = await req('POST', `/api/v1/compras/lotes/${loteId}/aprovacao`, comprador.cookie, {
  decisao: 'APROVADO',
});
ok('comprador nao aprova o proprio lote fora da faixa 1', autoAprovacao.statusCode === 403, autoAprovacao.json());

const aprovacao = await req('POST', `/api/v1/compras/lotes/${loteId}/aprovacao`, coordenador.cookie, {
  decisao: 'APROVADO',
});
ok('coordenador aprova dentro da alcada', aprovacao.statusCode === 201, aprovacao.json());

const pedido = await req('POST', `/api/v1/compras/lotes/${loteId}/pedido`, comprador.cookie, {
  dataPrometida: new Date(Date.now() + 7 * 86_400_000).toISOString(),
});
ok('pedido emitido com numero e data prometida', pedido.statusCode === 201 && /^PC-\d{4}-\d{4}$/.test(pedido.json().numero), pedido.json());

// ------------------------------------------------ o que a tela consome
const detalhe = await req('GET', `/api/v1/compras/lotes/${loteId}`, comprador.cookie);
const d = detalhe.json();
ok(
  'detalhe do lote traz cotacoes, mapa, aprovacoes e pedidos',
  d.cotacoes.length === 3 && d.mapas.length >= 1 && d.aprovacoes.length === 1 && d.pedidos.length === 1,
  { cotacoes: d.cotacoes.length, mapas: d.mapas.length, aprovacoes: d.aprovacoes.length, pedidos: d.pedidos.length },
);
ok('o savings fica gravado no lote', Number(d.savings) === 200, d.savings);
ok(
  'o detalhe do lote conta as evidencias por cotacao',
  Object.values(d.evidenciasPorCotacao ?? {}).filter((n) => Number(n) > 0).length === 3,
  d.evidenciasPorCotacao,
);

const exportacao = await req('GET', '/api/v1/relatorios/exportar/savings', comprador.cookie);
ok(
  'savings exporta em XLSX',
  exportacao.statusCode === 200 && Boolean(exportacao.headers['content-type']?.toString().includes('spreadsheetml')),
  exportacao.statusCode,
);

await app.close();
await prisma.$disconnect();
process.exit(process.exitCode ?? 0);
