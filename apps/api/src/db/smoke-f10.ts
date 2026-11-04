/** Fumaca da F10: fila de saida, chave de NF-e e importacao CSV com dry-run e idempotencia. */
import { criarApp } from '../app.js';
import { prisma, novoId } from '../core/db.js';
import { gerarHashSenha } from '../core/auth/password.js';
import { notificar } from '../core/notifications/index.js';
import { despacharPendentes, situacaoDaFila } from '../core/notifications/despacho.js';
import type { Adaptador } from '../core/notifications/adaptadores.js';
import type { Canal } from '../core/notifications/entrega.js';
import { digitoVerificador } from '../modules/fiscal/chave-nfe.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
const sufixo = String(Date.now()).slice(-6);

const login = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { email: process.env.SEED_ADMIN_EMAIL, senha: process.env.SEED_ADMIN_PASSWORD, unidadeId: matriz.id },
});
const cookies = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie: cookies } });

// ------------------------------------------------ status das integracoes
const status = await req('GET', '/api/v1/integracoes/status');
ok('status declara o que falta configurar', status.statusCode === 200 && Array.isArray(status.json().sefaz.faltando), status.json());
ok('IN_APP sempre configurado; e-mail depende do SMTP', status.json().notificacoes.IN_APP === true, status.json().notificacoes);

// ------------------------------------------------ chave da NF-e
// O Administrador NAO tem `nota_fiscal:lancar` (vedacao de SoD da secao 5.2),
// entao quem consulta a chave aqui e um usuario do perfil Fiscal/Financeiro.
const senhaFiscal = 'Smoke#F10-2026';
const fiscal = await prisma.usuario.create({
  data: {
    id: novoId(),
    nome: `Fiscal Smoke ${sufixo}`,
    email: `fiscal-${sufixo}@cearaalimentos.com.br`,
    senhaHash: await gerarHashSenha(senhaFiscal),
    unidadeId: matriz.id,
  },
});
const perfilFiscal = await prisma.perfil.findFirstOrThrow({ where: { nome: 'Fiscal/Financeiro' } });
await prisma.usuarioPerfil.create({
  data: { usuarioId: fiscal.id, perfilId: perfilFiscal.id, escopo: { unidades: [matriz.id], centrosCusto: [] } },
});

const loginFiscal = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { email: fiscal.email, senha: senhaFiscal, unidadeId: matriz.id },
});
const cookieFiscal = loginFiscal.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const reqFiscal = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: cookieFiscal } });

const base = '21' + '2608' + '12345678000199' + '55' + '001' + '000001234' + '1' + '00000001';
const chave = `${base}${digitoVerificador(base)}`;

const negadaAoAdmin = await req('GET', `/api/v1/integracoes/nfe/${chave}`);
ok('administrador nao consulta NF-e: vedacao de SoD continua valendo', negadaAoAdmin.statusCode === 403, negadaAoAdmin.json());

const lida = await reqFiscal(`/api/v1/integracoes/nfe/${chave}`);
ok('chave valida e destrinchada', lida.statusCode === 200 && lida.json().chave.ufSigla === 'MA', lida.json());
ok('consulta SEFAZ se declara indisponivel, com o motivo', lida.json().consultaSefaz.disponivel === false, lida.json().consultaSefaz);

const dvErrado = `${base}${(Number(chave[43]) + 1) % 10}`;
const recusada = await reqFiscal(`/api/v1/integracoes/nfe/${dvErrado}`);
ok('chave com digito errado e recusada', recusada.statusCode === 400, recusada.json());

// ------------------------------------------------ fila de saida
const usuario = await prisma.usuario.create({
  data: {
    id: novoId(),
    nome: `Destinatario ${sufixo}`,
    email: `destino-${sufixo}@cearaalimentos.com.br`,
    telefone: '(98) 98888-7777',
    senhaHash: 'nao-usado',
    unidadeId: matriz.id,
  },
});

await notificar({
  usuarioId: usuario.id,
  titulo: 'Teste de fila de saida',
  corpo: 'Mensagem usada pelo smoke da F10.',
  canal: 'EMAIL',
});

const pendente = await prisma.notificacao.findFirstOrThrow({ where: { usuarioId: usuario.id, canal: 'EMAIL' } });
ok('e-mail nasce pendente, nao "enviado"', pendente.enviadaEm === null && pendente.tentativas === 0, pendente);

// SMTP nao configurado no ambiente de teste: nao pode consumir tentativa
const semSmtp = await despacharPendentes(50);
const aposSemSmtp = await prisma.notificacao.findUniqueOrThrow({ where: { id: pendente.id } });
ok(
  'canal nao configurado nao consome tentativa e diz o motivo',
  aposSemSmtp.tentativas === 0 && aposSemSmtp.enviadaEm === null && Boolean(aposSemSmtp.ultimoErro),
  { tentativas: aposSemSmtp.tentativas, erro: aposSemSmtp.ultimoErro, resumo: semSmtp },
);

// adaptador de teste: entrega
await prisma.notificacao.update({ where: { id: pendente.id }, data: { proximaTentativaEm: null } });
const entregando: Record<Canal, Adaptador> = {
  IN_APP: async () => ({ estado: 'ENTREGUE' }),
  EMAIL: async () => ({ estado: 'ENTREGUE', referenciaExterna: 'smoke-msg-1' }),
  WHATSAPP: async () => ({ estado: 'ENTREGUE' }),
};
await despacharPendentes(50, new Date(), entregando);

const entregue = await prisma.notificacao.findUniqueOrThrow({ where: { id: pendente.id } });
ok(
  'entrega marca data e guarda a referencia do provedor',
  entregue.enviadaEm !== null && entregue.referenciaExterna === 'smoke-msg-1',
  entregue,
);

// adaptador de teste: falha permanente descarta e audita
await notificar({ usuarioId: usuario.id, titulo: 'Falha permanente', corpo: 'smoke', canal: 'EMAIL' });
const falhando: Record<Canal, Adaptador> = {
  IN_APP: async () => ({ estado: 'ENTREGUE' }),
  EMAIL: async () => ({ estado: 'FALHOU', erro: 'caixa inexistente', permanente: true }),
  WHATSAPP: async () => ({ estado: 'ENTREGUE' }),
};
const resumoFalha = await despacharPendentes(50, new Date(), falhando);
ok('falha permanente e descartada de uma vez', resumoFalha.descartadas === 1, resumoFalha);

const auditoria = await prisma.auditoria.findFirst({
  where: { entidade: 'notificacoes', acao: 'ENTREGA_DESCARTADA' },
  orderBy: { timestamp: 'desc' },
});
ok('descarte vira evento de governanca na trilha', auditoria !== null, auditoria);

const fila = await situacaoDaFila();
ok('situacao da fila responde com canais configurados', typeof fila.pendentes === 'number' && 'EMAIL' in fila.canaisConfigurados, fila);

const reenfileirar = await req('POST', '/api/v1/governanca-nao-existe', {});
ok('rota inexistente continua 404', reenfileirar.statusCode === 404, reenfileirar.statusCode);

// ------------------------------------------------ importacao CSV
const veiculo = await prisma.veiculo.findFirst({
  // veiculo ATIVO: inativo recusa abastecimento, e a recusa e a regra certa (secao 7.2)
  where: { deletedAt: null, unidadeId: matriz.id, status: 'ATIVO' },
  select: { id: true, placa: true, hodometroAtual: true },
});

if (!veiculo) {
  console.log('AVISO sem veiculo na matriz: a parte de importacao foi pulada');
} else {
  await prisma.motorista.updateMany({
    where: { veiculoPadraoId: veiculo.id },
    data: { status: 'ATIVO' },
  });

  const temMotorista = await prisma.motorista.findFirst({
    where: { veiculoPadraoId: veiculo.id, status: 'ATIVO', deletedAt: null },
  });

  if (!temMotorista) {
    await prisma.motorista.create({
      data: {
        id: novoId(),
        unidadeId: matriz.id,
        nome: `Motorista Import ${sufixo}`,
        cpf: String(Date.now()).padStart(11, '0').slice(-11),
        cnhNumero: '12345678901',
        cnhCategoria: 'E',
        cnhVencimento: new Date('2030-01-01'),
        veiculoPadraoId: veiculo.id,
      },
    });
  }

  const hodometro = Number(veiculo.hodometroAtual) + 500;
  const csv = [
    'Data;Placa;Litros;Valor Total;Hodômetro;Posto',
    `05/08/2026 09:15;${veiculo.placa};150,000;1.125,00;${hodometro};Posto interno`,
    `06/08/2026 09:15;${veiculo.placa};abc;1.125,00;${hodometro + 300};Posto interno`,
    `07/08/2026 09:15;XXX9Z99;100,000;750,00;${hodometro + 600};Posto interno`,
  ].join('\n');

  const conferencia = await req('POST', '/api/v1/integracoes/abastecimentos/importar', { conteudo: csv, dryRun: true });
  const c = conferencia.json();
  ok('conferencia acusa a linha invalida sem gravar nada', c.dryRun === true && c.conferencia.comErro === 1, c);
  ok('placa desconhecida vira rejeicao explicita', c.rejeitadas.length === 1, c.rejeitadas);
  ok('a linha boa seria importada', c.importadas === 1, c);

  const antes = await prisma.abastecimento.count();
  const importacao = await req('POST', '/api/v1/integracoes/abastecimentos/importar', { conteudo: csv, dryRun: false });
  const depois = await prisma.abastecimento.count();
  ok('importacao grava so a linha valida', importacao.json().importadas === 1 && depois === antes + 1, {
    resultado: importacao.json(), antes, depois,
  });

  const reenvio = await req('POST', '/api/v1/integracoes/abastecimentos/importar', { conteudo: csv, dryRun: false });
  const depoisDoReenvio = await prisma.abastecimento.count();
  ok('reenviar o mesmo arquivo nao duplica', reenvio.json().duplicadas === 1 && depoisDoReenvio === depois, {
    resultado: reenvio.json(), depois, depoisDoReenvio,
  });

  const semColuna = await req('POST', '/api/v1/integracoes/abastecimentos/importar', {
    conteudo: 'data;placa\n05/08/2026;ABC-1234',
    dryRun: true,
  });
  ok(
    'arquivo sem coluna obrigatoria diz o que falta e o que veio',
    /nao tem a\(s\) coluna\(s\): litros, hodometro/.test(semColuna.json().erros?.[0]?.mensagem ?? ''),
    semColuna.json().erros,
  );
}

await app.close();
await prisma.$disconnect();
process.exit(process.exitCode ?? 0);
