/**
 * Fumaca do controle de oleo e servicos de rodagem (secao 7.10).
 *
 * Percorre o caminho inteiro pela API, como a tela faz: painel por tipo, registro de
 * execucao, recusa de leitura menor, mudanca de intervalo e historico do ativo.
 */
import { criarApp } from '../app.js';
import { prisma } from '../core/db.js';

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
const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie: cookies } });

// ---- painel de cada tipo
const tipos = await req('GET', '/api/v1/transporte/periodicos/tipos');
ok('tipos com os seis da planilha mais a lubrificacao', tipos.json().itens?.length === 7, tipos.json());

const motor = await req('GET', '/api/v1/transporte/periodicos/painel?tipo=OLEO_MOTOR');
const painelMotor = motor.json();
ok('painel do motor abre com a frota', motor.statusCode === 200 && painelMotor.itens.length > 0, painelMotor.erro);
ok('painel traz o resumo por situacao', typeof painelMotor.resumo?.VENCIDA === 'number', painelMotor.resumo);

const thermo = await req('GET', '/api/v1/transporte/periodicos/painel?tipo=OLEO_THERMO_KING');
ok('thermo king conta em horas', thermo.json().itens.every((i: { base: string }) => i.base === 'HORIMETRO'), thermo.json().itens?.[0]);

const alinhamento = await req('GET', '/api/v1/transporte/periodicos/painel?tipo=ALINHAMENTO');
ok('alinhamento tem painel proprio', alinhamento.statusCode === 200 && alinhamento.json().itens.length > 0);

// ---- execucao em um veiculo com historico importado
const comHistorico = painelMotor.itens.find(
  (i: { medicaoDaUltima: string | null }) => i.medicaoDaUltima !== null,
);
ok('ha veiculo com troca de motor registrada', Boolean(comHistorico), painelMotor.itens.slice(0, 2));

const medicao = String(Number(comHistorico.medicaoAtual) + 10);
const execucao = await req('POST', '/api/v1/transporte/periodicos/execucoes', {
  tipo: 'OLEO_MOTOR',
  veiculoId: comHistorico.ativoId,
  medicao,
  quantidade: '12.000',
  custo: '480.00',
  oficina: 'Oficina interna',
  observacao: 'Smoke do controle de oleo.',
});
ok('registra a troca', execucao.statusCode === 201, execucao.json());
ok(
  'proxima troca sai da medicao mais o intervalo',
  execucao.json().proxima === (Number(medicao) + 20000).toFixed(1),
  execucao.json(),
);

const recusa = await req('POST', '/api/v1/transporte/periodicos/execucoes', {
  tipo: 'OLEO_MOTOR',
  veiculoId: comHistorico.ativoId,
  medicao: String(Number(medicao) - 500),
});
ok('recusa leitura menor que a da ultima troca', recusa.statusCode === 409, recusa.json());

const veiculo = await prisma.veiculo.findUniqueOrThrow({ where: { id: comHistorico.ativoId } });
ok('a leitura da troca avanca o hodometro do veiculo', veiculo.hodometroAtual.toString() === medicao, veiculo.hodometroAtual);

const depois = await req('GET', '/api/v1/transporte/periodicos/painel?tipo=OLEO_MOTOR');
const linha = depois.json().itens.find((i: { ativoId: string }) => i.ativoId === comHistorico.ativoId);
ok('o veiculo volta para em dia depois da troca', linha.situacao === 'EM_DIA', linha);

const historico = await req('GET', `/api/v1/transporte/periodicos/historico/${comHistorico.ativoId}?tipo=OLEO_MOTOR`);
ok('historico guarda a troca', historico.json().itens.length >= 1, historico.json());

// ---- plano
const plano = await req('PUT', '/api/v1/transporte/periodicos/planos', {
  tipo: 'OLEO_MOTOR',
  intervalo: '25000',
  avisarCom: '2500',
});
ok('parametriza o intervalo', plano.statusCode === 200 && Number(plano.json().intervalo) === 25000, plano.json());

const invalido = await req('PUT', '/api/v1/transporte/periodicos/planos', {
  tipo: 'OLEO_MOTOR',
  intervalo: '1000',
  avisarCom: '5000',
});
ok('recusa aviso maior que o proprio intervalo', invalido.statusCode === 400, invalido.json());

const congelado = await prisma.servicoPeriodico.findUniqueOrThrow({ where: { id: execucao.json().execucao.id } });
ok(
  'mudar o plano nao reescreve execucao ja registrada',
  congelado.intervalo.toString() === '20000',
  congelado.intervalo.toString(),
);

// volta o intervalo para o da planilha, para o smoke nao deixar rastro de parametro
await req('PUT', '/api/v1/transporte/periodicos/planos', { tipo: 'OLEO_MOTOR', intervalo: '20000', avisarCom: '2000' });

// ---- lubrificacao: vence por calendario
const lub = await req('GET', '/api/v1/transporte/periodicos/painel?tipo=LUBRIFICACAO');
const painelLub = lub.json();
ok('lubrificacao abre com a frota', lub.statusCode === 200 && painelLub.itens.length > 0, painelLub.erro);
ok('lubrificacao conta por dias', painelLub.itens.every((i: { base: string }) => i.base === 'DIAS'), painelLub.itens?.[0]);
const semRegistro = painelLub.itens.filter((i: { executadoEm: string | null }) => i.executadoEm === null);
ok(
  'veiculo nunca lubrificado nao aparece como em dia',
  semRegistro.every((i: { situacao: string }) => i.situacao === 'SEM_REGISTRO'),
  semRegistro[0],
);

// prefere um que nunca foi lubrificado; rodar o smoke duas vezes nao pode mudar o que ele prova
const alvo = semRegistro[0] ?? painelLub.itens[0];
const hoje = new Date();
const registroLub = await req('POST', '/api/v1/transporte/periodicos/execucoes', {
  tipo: 'LUBRIFICACAO',
  veiculoId: alvo.ativoId,
  executadoEm: hoje.toISOString(),
  observacao: 'Smoke da lubrificacao.',
});
ok('registra lubrificacao sem informar leitura de painel', registroLub.statusCode === 201, registroLub.json());

const previsto = new Date(hoje.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
ok(
  'a proxima lubrificacao cai 10 dias depois',
  registroLub.json().proximaEm?.slice(0, 10) === previsto,
  registroLub.json(),
);

const depoisLub = await req('GET', '/api/v1/transporte/periodicos/painel?tipo=LUBRIFICACAO');
const linhaLub = depoisLub.json().itens.find((i: { ativoId: string }) => i.ativoId === alvo.ativoId);
ok('o veiculo lubrificado fica em dia', linhaLub.situacao === 'EM_DIA', linhaLub);
ok('e o painel mostra a data do proximo engraxamento', linhaLub.proximaEm?.slice(0, 10) === previsto, linhaLub);

// o gestor troca o lembrete de dias para quilometragem
const paraKm = await req('PUT', '/api/v1/transporte/periodicos/planos', {
  tipo: 'LUBRIFICACAO',
  base: 'HODOMETRO',
  intervalo: '5000',
  avisarCom: '500',
});
ok('o gestor troca o lembrete de dias para km', paraKm.statusCode === 200 && paraKm.json().base === 'HODOMETRO', paraKm.json());

const porKm = await req('GET', '/api/v1/transporte/periodicos/painel?tipo=LUBRIFICACAO');
ok('o painel passa a contar em km', porKm.json().itens.every((i: { base: string }) => i.base === 'HODOMETRO'), porKm.json().itens?.[0]);

const horimetroNoVeiculo = await req('PUT', '/api/v1/transporte/periodicos/planos', {
  tipo: 'LUBRIFICACAO',
  base: 'HORIMETRO',
  intervalo: '500',
  avisarCom: '50',
});
ok('horimetro nao vale para servico de veiculo', horimetroNoVeiculo.statusCode === 400, horimetroNoVeiculo.json());

// volta o plano ao padrao da operacao: de 10 em 10 dias
const volta = await req('PUT', '/api/v1/transporte/periodicos/planos', {
  tipo: 'LUBRIFICACAO',
  base: 'DIAS',
  intervalo: '10',
  avisarCom: '2',
});
ok('volta para o padrao de 10 dias', volta.statusCode === 200 && volta.json().base === 'DIAS', volta.json());

await app.close();
await prisma.$disconnect();
