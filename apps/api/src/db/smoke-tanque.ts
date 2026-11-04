/** Fumaca da F11: tanque, comboio, abastecimento com baixa de estoque e afericao. */
import { criarApp } from '../app.js';
import { prisma, novoId } from '../core/db.js';
import { gerarHashSenha } from '../core/auth/password.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const sufixo = String(Date.now()).slice(-6);
const senha = 'Smoke#TQ-2026';
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });

const gestor = await prisma.usuario.create({
  data: {
    id: novoId(),
    nome: `Gestor Frota ${sufixo}`,
    email: `frota-${sufixo}@cearaalimentos.com.br`,
    senhaHash: await gerarHashSenha(senha),
    unidadeId: matriz.id,
  },
});
const perfil = await prisma.perfil.findFirstOrThrow({ where: { nome: 'Gestor de Frota' } });
await prisma.usuarioPerfil.create({
  data: { usuarioId: gestor.id, perfilId: perfil.id, escopo: { unidades: [matriz.id], centrosCusto: [] } },
});

const login = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { email: gestor.email, senha, unidadeId: matriz.id },
});
const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie } });

// ------------------------------------------------ cadastro
const produtos = await req('GET', '/api/v1/transporte/tanques/produtos');
ok('produtos semeados: diesel, arla e lubrificante', produtos.json().itens.length >= 4, produtos.json().itens?.length);
const diesel = produtos.json().itens.find((p: { codigo: string }) => p.codigo === 'DS10');

const tanque = await req('POST', '/api/v1/transporte/tanques', {
  codigo: `TQ-${sufixo}`,
  nome: 'Tanque do patio',
  tipo: 'FIXO',
  produtoId: diesel.id,
  capacidadeLitros: '15000',
});
ok('tanque fixo criado na unidade em operacao', tanque.statusCode === 201 && tanque.json().unidadeId === matriz.id, tanque.json());
const tanqueId = tanque.json().id;

const bico = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/bicos`, {
  codigo: 'B1',
  descricao: 'Bico 1 - diesel',
  encerranteAtual: '120000',
});
ok('bico cadastrado com encerrante inicial', bico.statusCode === 201, bico.json());
const bicoId = bico.json().id;

// ------------------------------------------------ entrada por compra
const semNota = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/entradas`, {
  litros: '5000',
  custoUnitario: '6.00',
  notaFiscal: '',
});
ok('entrada sem nota fiscal e recusada', semNota.statusCode === 400, semNota.json());

const primeira = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/entradas`, {
  litros: '5000',
  custoUnitario: '6.00',
  notaFiscal: 'NF-1001',
});
ok('entrada por compra registra saldo e custo', primeira.statusCode === 201 && Number(primeira.json().saldoApos) === 5000, primeira.json());

const segunda = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/entradas`, {
  litros: '5000',
  custoUnitario: '6.40',
  notaFiscal: 'NF-1002',
});
// 5.000 a 6,00 + 5.000 a 6,40 = 10.000 a 6,20
ok('custo medio ponderado apos a segunda nota', Number(segunda.json().custoMedioApos) === 6.2, segunda.json());

const estouro = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/entradas`, {
  litros: '10000',
  custoUnitario: '6.00',
  notaFiscal: 'NF-1003',
});
ok('entrada acima da capacidade e recusada', estouro.statusCode === 409, estouro.json());

// ------------------------------------------------ comboio e transferencia
const veiculo = await prisma.veiculo.findFirst({
  where: { deletedAt: null, unidadeId: matriz.id, status: 'ATIVO' },
  select: { id: true, placa: true },
});

const comboio = await req('POST', '/api/v1/transporte/tanques', {
  codigo: `CB-${sufixo}`,
  nome: 'Comboio 01',
  tipo: 'MOVEL',
  produtoId: diesel.id,
  capacidadeLitros: '3000',
  veiculoId: veiculo?.id ?? null,
});
ok('comboio criado como tanque movel', comboio.statusCode === 201 && comboio.json().tipo === 'MOVEL', comboio.json());
const comboioId = comboio.json().id;

const transferencia = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/transferencias`, {
  destinoId: comboioId,
  litros: '2000',
  motivo: 'Abastecimento da frente de servico',
});
ok(
  'transferencia sai de um tanque e entra no outro',
  transferencia.statusCode === 201 &&
    Number(transferencia.json().saida.saldoApos) === 8000 &&
    Number(transferencia.json().entrada.saldoApos) === 2000,
  transferencia.json(),
);
ok(
  'o combustivel nao muda de valor por mudar de tanque',
  Number(transferencia.json().entrada.custoUnitario) === 6.2,
  transferencia.json().entrada,
);

const arla = produtos.json().itens.find((p: { codigo: string }) => p.codigo === 'ARLA');
const tanqueArla = await req('POST', '/api/v1/transporte/tanques', {
  codigo: `AR-${sufixo}`, nome: 'Tanque Arla', produtoId: arla.id, capacidadeLitros: '1000',
});
const misturar = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/transferencias`, {
  destinoId: tanqueArla.json().id,
  litros: '100',
});
ok('nao transfere diesel para tanque de arla', misturar.statusCode === 400, misturar.json());

// ------------------------------------------------ abastecimento com baixa de tanque
const motorista = await prisma.motorista.findFirst({
  where: { deletedAt: null, status: 'ATIVO', unidadeId: matriz.id },
  select: { id: true },
});

if (!veiculo || !motorista) {
  console.log('AVISO sem veiculo ou motorista ativo: a parte de abastecimento foi pulada');
} else {
  // o hodometro parte do atual do veiculo: rodar o smoke duas vezes nao pode
  // "retroceder" o contador, porque a regra (secao 7.2) recusa - e com razao
  const atual = await prisma.veiculo.findUniqueOrThrow({ where: { id: veiculo.id }, select: { hodometroAtual: true } });
  const hodometro = Math.ceil(Number(atual.hodometroAtual)) + 500;

  const encerranteErrado = await req('POST', '/api/v1/transporte/abastecimentos', {
    veiculoId: veiculo.id,
    motoristaId: motorista.id,
    dataHora: new Date().toISOString(),
    posto: 'Tanque do patio',
    tipoCombustivel: 'DIESEL_S10',
    litros: '200',
    valorUnitario: '6.00',
    hodometro: String(hodometro),
    tanqueId,
    bicoId,
    encerranteInicial: '120000',
    encerranteFinal: '120150',
  });
  ok('volume que nao bate com o encerrante e recusado', encerranteErrado.statusCode === 400, encerranteErrado.json());

  const saldoAntes = await prisma.tanque.findUniqueOrThrow({ where: { id: tanqueId } });

  const abastecimento = await req('POST', '/api/v1/transporte/abastecimentos', {
    veiculoId: veiculo.id,
    motoristaId: motorista.id,
    dataHora: new Date().toISOString(),
    posto: 'Tanque do patio',
    tipoCombustivel: 'DIESEL_S10',
    litros: '150',
    valorUnitario: '9.99',
    hodometro: String(hodometro),
    tanqueId,
    bicoId,
    encerranteInicial: '120000',
    encerranteFinal: '120150',
    obraLocal: 'Obra Norte',
  });
  ok('abastecimento no tanque proprio e aceito', abastecimento.statusCode === 201, abastecimento.json());

  const registro = abastecimento.json().abastecimento;
  ok(
    'o custo do litro vem do tanque, nao do valor digitado',
    Number(registro.valorUnitario) === 6.2,
    { informado: '9.99', gravado: registro.valorUnitario },
  );
  ok('o turno sai do horario quando nao informado', Boolean(registro.turno), registro.turno);

  const saldoDepois = await prisma.tanque.findUniqueOrThrow({ where: { id: tanqueId } });
  ok(
    'o abastecimento baixa o tanque na mesma transacao',
    Number(saldoAntes.saldoLitros) - Number(saldoDepois.saldoLitros) === 150,
    { antes: saldoAntes.saldoLitros.toString(), depois: saldoDepois.saldoLitros.toString() },
  );

  const bicoDepois = await prisma.bico.findUniqueOrThrow({ where: { id: bicoId } });
  ok('o encerrante do bico avanca', Number(bicoDepois.encerranteAtual) === 120150, bicoDepois.encerranteAtual.toString());

  const semSaldo = await req('POST', '/api/v1/transporte/abastecimentos', {
    veiculoId: veiculo.id,
    motoristaId: motorista.id,
    dataHora: new Date().toISOString(),
    posto: 'Tanque do patio',
    tipoCombustivel: 'DIESEL_S10',
    litros: '99999',
    valorUnitario: '6.00',
    hodometro: String(hodometro + 100),
    tanqueId,
  });
  ok('abastecimento acima do saldo do tanque e recusado', semSaldo.statusCode === 409, semSaldo.json());
}

// ------------------------------------------------ afericao
const dentro = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/afericoes`, {
  saldoMedido: (await prisma.tanque.findUniqueOrThrow({ where: { id: tanqueId } })).saldoLitros.toString(),
});
ok('afericao que bate com o sistema e conforme', dentro.json().apuracao?.resultado === 'CONFORME', dentro.json().apuracao);

const saldoAtual = Number((await prisma.tanque.findUniqueOrThrow({ where: { id: tanqueId } })).saldoLitros);

const semJustificativa = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/afericoes`, {
  saldoMedido: String(saldoAtual - 300),
});
ok('perda acima da tolerancia exige justificativa', semJustificativa.statusCode === 400, semJustificativa.json());

const comJustificativa = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/afericoes`, {
  saldoMedido: String(saldoAtual - 300),
  motivo: 'Vazamento na mangueira do bico 1, identificado e reparado nesta data.',
  acertarSaldo: true,
});
ok(
  'com justificativa a afericao passa e marca fora da tolerancia',
  comJustificativa.statusCode === 201 && comJustificativa.json().apuracao.dentroDaTolerancia === false,
  comJustificativa.json().apuracao,
);

const aposAcerto = await prisma.tanque.findUniqueOrThrow({ where: { id: tanqueId } });
ok('o acerto iguala o sistema a medicao', Number(aposAcerto.saldoLitros) === saldoAtual - 300, aposAcerto.saldoLitros.toString());

// ------------------------------------------------ painel e consumo
const painel = await req('GET', '/api/v1/transporte/tanques');
ok(
  'painel traz saldo, valor em estoque e memoria de calculo',
  painel.statusCode === 200 && painel.json().itens.length >= 2 && Boolean(painel.json().memoriaDeCalculo?.saldo),
  painel.json().resumo,
);

const extrato = await req('GET', `/api/v1/transporte/tanques/${tanqueId}/extrato`);
ok('extrato lista cada movimentacao do tanque', extrato.json().movimentacoes.length >= 4, extrato.json().movimentacoes?.length);

for (const recorte of ['veiculo', 'motorista', 'turno', 'obra']) {
  const consumo = await req('GET', `/api/v1/transporte/tanques/consumo/${recorte}`);
  ok(`consumo por ${recorte} responde`, consumo.statusCode === 200 && Array.isArray(consumo.json().itens), consumo.statusCode);
}

// ------------------------------------------------ inativacao
const comSaldo = await req('POST', `/api/v1/transporte/tanques/${tanqueId}/inativar`, {
  motivo: 'Teste de inativacao com saldo em tanque.',
});
ok('tanque com saldo nao se inativa', comSaldo.statusCode === 409, comSaldo.json());

await app.close();
await prisma.$disconnect();
process.exit(process.exitCode ?? 0);
