/**
 * Fumaca dos perfis padrao (secao 5.2 e 5.3).
 *
 * Os testes de unidade provam que a **definicao** dos perfis e coerente. Este smoke prova
 * a outra metade: que o servidor de fato recusa, com 403, o que a definicao proibe. Regra
 * de acesso que so existe na lista de permissoes e comentario — o que vale e a porta.
 *
 * Cria um usuario descartavel por perfil, loga com ele e bate nas rotas.
 */
import { criarApp } from '../app.js';
import { prisma, novoId } from '../core/db.js';
import { gerarHashSenha } from '../core/auth/password.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
const centroCusto = await prisma.centroCusto.findFirstOrThrow({ where: { deletedAt: null } });

const SENHA = 'Smoke#Perfis2026';
const senhaHash = await gerarHashSenha(SENHA);
const sufixo = String(Date.now()).slice(-8);

/** Usuario descartavel com um unico perfil, para medir exatamente o que aquele perfil abre. */
async function comoPerfil(nomePerfil: string) {
  const perfil = await prisma.perfil.findUniqueOrThrow({ where: { nome: nomePerfil } });
  const email = `smk-${nomePerfil.toLowerCase().replace(/[^a-z]/g, '')}-${sufixo}@cearaalimentos.com.br`;

  const usuario = await prisma.usuario.create({
    data: { id: novoId(), nome: `Smoke ${nomePerfil}`, email, senhaHash, unidadeId: matriz.id, centroCustoId: centroCusto.id },
  });
  await prisma.usuarioPerfil.create({
    data: { usuarioId: usuario.id, perfilId: perfil.id, escopo: { unidades: [matriz.id], centrosCusto: [] } },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, senha: SENHA, unidadeId: matriz.id },
  });
  ok(`login como ${nomePerfil}`, login.statusCode === 200, login.statusCode);

  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as never, headers: { cookie } });
}

const tanque = await prisma.tanque.findFirstOrThrow({ where: { unidadeId: matriz.id, deletedAt: null } });

// ------------------------------------------------------------------ motorista
const motorista = await comoPerfil('Motorista');

/*
 * O ponto central: abastecer e movimentar o tanque deixaram de ser a mesma permissao. Antes
 * disto, a unica credencial do motorista lancava a entrada de combustivel que cobriria o
 * proprio abastecimento.
 */
const entradaPeloMotorista = await motorista('POST', `/api/v1/transporte/tanques/${tanque.id}/entradas`, {
  litros: '1000',
  custoUnitario: '6.20',
  notaFiscal: `SMK-${sufixo}`,
});
ok('motorista nao da entrada de combustivel no tanque', entradaPeloMotorista.statusCode === 403, entradaPeloMotorista.statusCode);

const transferenciaPeloMotorista = await motorista('POST', `/api/v1/transporte/tanques/${tanque.id}/transferencias`, {
  destinoId: tanque.id,
  litros: '100',
});
ok('motorista nao transfere entre tanques', transferenciaPeloMotorista.statusCode === 403, transferenciaPeloMotorista.statusCode);

const xmlPeloMotorista = await motorista('POST', '/api/v1/transporte/tanques/entradas/ler-xml', {
  conteudoBase64: Buffer.from('<nfeProc><NFe><infNFe></infNFe></NFe></nfeProc>').toString('base64'),
});
ok('motorista nao le XML de nota de combustivel', xmlPeloMotorista.statusCode === 403, xmlPeloMotorista.statusCode);

// o que ele precisa para trabalhar continua aberto
const tanquesPeloMotorista = await motorista('GET', '/api/v1/transporte/tanques');
ok('motorista ainda consulta os tanques para abastecer', tanquesPeloMotorista.statusCode === 200, tanquesPeloMotorista.statusCode);

// ------------------------------------------------------------------ gestor de frota
const frota = await comoPerfil('Gestor de Frota');

const xmlPelaFrota = await frota('POST', '/api/v1/transporte/tanques/entradas/ler-xml', {
  conteudoBase64: Buffer.from('<nfeProc><NFe><infNFe></infNFe></NFe></nfeProc>').toString('base64'),
});
// 400 = passou pelo RBAC e caiu na leitura do XML, que e o que se quer provar aqui
ok('gestor de frota opera o tanque', xmlPelaFrota.statusCode !== 403, xmlPelaFrota.statusCode);

// ------------------------------------------------------------------ administrador
const admin = await comoPerfil('Administrador');

/*
 * Consultar a carteira ele pode — administrar inclui enxergar. O que nao pode e agir nela:
 * `lote:criar` sai do perfil junto com cotar, gerar mapa e emitir pedido.
 */
const loteCriadoPeloAdmin = await admin('POST', '/api/v1/compras/lotes', { solicitacoesIds: [] });
ok('administrador nao monta lote de compra', loteCriadoPeloAdmin.statusCode === 403, loteCriadoPeloAdmin.statusCode);

const usuariosPeloAdmin = await admin('GET', '/api/v1/usuarios');
ok('administrador administra usuarios', usuariosPeloAdmin.statusCode === 200, usuariosPeloAdmin.statusCode);

// ------------------------------------------------------------------ comprador no board
const comprador = await comoPerfil('Comprador');

/*
 * O board move o lote pela maquina de estados, que so sabe se o caminho existe. Enquanto
 * `/painel/mover` exigia apenas `lote:consultar`, arrastar o card para "Aprovado" pulava a
 * permissao de aprovar, a faixa de alcada e a SoD — e o proprio comprador aprovava o lote
 * que ele mesmo cotou.
 */
const loteAguardando = await prisma.lote.findFirst({
  where: { deletedAt: null, status: 'AGUARDANDO_APROVACAO' },
  select: { id: true },
});
const loteEmCotacao = await prisma.lote.findFirst({
  where: { deletedAt: null, status: 'EM_COTACAO' },
  select: { id: true },
});

const aprovarArrastando = await comprador('POST', '/api/v1/compras/painel/mover', {
  loteId: loteAguardando?.id ?? loteEmCotacao?.id ?? 'inexistente',
  para: 'APROVADO',
});
ok('comprador nao aprova arrastando o card', aprovarArrastando.statusCode === 403, aprovarArrastando.statusCode);
ok(
  'a recusa aponta a fila de aprovacao',
  String(aprovarArrastando.json()?.erro?.mensagem ?? '').includes('alcada'),
  aprovarArrastando.json(),
);

// a mesma porta pela tela do lote tem a mesma checagem
const aprovarPelaTransicao = await comprador('POST', `/api/v1/compras/lotes/${loteAguardando?.id ?? 'inexistente'}/transicao`, {
  para: 'APROVADO',
});
ok('nem pela rota de transicao do lote', aprovarPelaTransicao.statusCode === 403, aprovarPelaTransicao.statusCode);

// e o que e trabalho dele continua funcionando
if (loteEmCotacao) {
  const mandarParaMapa = await comprador('POST', '/api/v1/compras/painel/mover', {
    loteId: loteEmCotacao.id,
    para: 'MAPA_PRONTO',
  });
  ok('comprador ainda move o proprio lote no fluxo', mandarParaMapa.statusCode === 200, mandarParaMapa.json());
  // devolve o lote ao estado em que estava, para o smoke poder rodar de novo
  if (mandarParaMapa.statusCode === 200) {
    await comprador('POST', '/api/v1/compras/painel/mover', {
      loteId: loteEmCotacao.id,
      para: 'EM_COTACAO',
      motivo: 'Smoke de perfis: devolvendo ao estado anterior.',
    });
  }
}

// ------------------------------------------------------------------ auditor
const auditor = await comoPerfil('Auditor');

const trilha = await auditor('GET', '/api/v1/auditoria');
ok('auditor le a trilha', trilha.statusCode === 200, trilha.statusCode);

const auditorEscreve = await auditor('POST', '/api/v1/transporte/baterias', {
  identificacao: `SMK-AUD-${sufixo}`,
  marca: 'MOURA',
  amperagem: 150,
});
ok('auditor nao escreve', auditorEscreve.statusCode === 403, auditorEscreve.statusCode);

// ------------------------------------------------------------------ gerencia
const gerencia = await comoPerfil('Gerencia');

const colaboradores = await gerencia('GET', '/api/v1/pessoas/colaboradores');
ok('gerencia alcanca o cadastro de colaboradores', colaboradores.statusCode === 200, colaboradores.statusCode);

await app.close();
await prisma.$disconnect();
