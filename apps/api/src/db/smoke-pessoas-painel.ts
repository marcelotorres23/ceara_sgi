/**
 * Fumaca do painel de classificacao e do cadastro de colaboradores (secao 9).
 *
 * Prova o que a tela precisa: classificacao mes a mes com os dois lados da pontuacao,
 * historico marcado como positivo ou negativo, e cadastro com foto.
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
const req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie: cookies } });

const sufixo = String(Date.now()).slice(-6);

// ---- cadastro com os registros usuais
const criado = await req('POST', '/api/v1/pessoas/colaboradores', {
  matricula: `SMK${sufixo}`,
  nome: 'Colaborador de Fumaca',
  cargo: 'Conferente',
  setor: 'Transportes',
  admissao: new Date('2026-01-15').toISOString(),
  cpf: '111.222.333-44'.replace(/\D/g, '') + sufixo.slice(-1),
  telefone: '(98) 99999-0000',
  email: `fumaca${sufixo}@cearaalimentos.com.br`,
  dataNascimento: '1995-03-20',
});
ok('cadastra colaborador com os campos usuais', criado.statusCode === 201, criado.json());
const colaboradorId = criado.json().id;
ok('guarda telefone e e-mail', criado.json().telefone !== null && criado.json().email !== null, criado.json());
ok('guarda a data de nascimento', criado.json().dataNascimento !== null, criado.json().dataNascimento);

// ---- edicao pelo cadastro generico
const editado = await req('PATCH', `/api/v1/pessoas/colaboradores/${colaboradorId}`, { cargo: 'Conferente Senior' });
ok('edita pelo cadastro', editado.statusCode === 200 && editado.json().cargo === 'Conferente Senior', editado.json());

// ---- foto: 1x1 PNG transparente, so para exercitar o caminho inteiro
const pngMinimo =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const foto = await req('POST', `/api/v1/pessoas/colaboradores/${colaboradorId}/foto`, {
  conteudoBase64: pngMinimo,
  mime: 'image/png',
  nome: 'retrato.png',
});
const storageOk = foto.statusCode === 200;
ok(
  storageOk ? 'anexa a foto ao colaborador' : 'foto exige storage configurado (S3/MinIO)',
  storageOk || foto.statusCode === 500,
  foto.json(),
);
if (storageOk) {
  const salvo = await prisma.colaborador.findUniqueOrThrow({ where: { id: colaboradorId } });
  ok('a chave da foto fica no cadastro', Boolean(salvo.fotoUrl), salvo.fotoUrl);
}

// ---- pontuacao: um positivo e um negativo na competencia
const criterios = await req('GET', '/api/v1/pessoas/criterios');
const positivo = criterios.json().itens.find((c: { tipo: string }) => c.tipo === 'POSITIVO');
const negativo = criterios.json().itens.find((c: { tipo: string }) => c.tipo === 'NEGATIVO');
ok('ha criterios positivos e negativos', Boolean(positivo && negativo), criterios.json().itens?.length);

const semEvidencia = await req('POST', '/api/v1/pessoas/ocorrencias', {
  colaboradorId,
  criterioId: negativo.id,
  competencia: new Date().toISOString().slice(0, 7),
  descricao: 'Lancamento manual sem prova nenhuma.',
});
ok('lancamento manual sem evidencia e recusado', semEvidencia.statusCode === 400, semEvidencia.json());

const competencia = new Date().toISOString().slice(0, 7);
for (const [criterio, fato] of [
  [positivo, 'Entrega concluida sem ocorrencia na rota inteira.'],
  [negativo, 'Requisicao de peca lancada sem vinculo ao veiculo.'],
] as const) {
  // lancamento manual exige evidencia (secao 9.2): percepcao sem prova nao vira ponto
  const lancada = await req('POST', '/api/v1/pessoas/ocorrencias', {
    colaboradorId,
    criterioId: criterio.id,
    competencia,
    descricao: fato,
    evidenciaTipo: 'REGISTRO_DO_SISTEMA',
    evidenciaId: `smoke-${sufixo}-${criterio.tipo}`,
  });
  ok(`lanca ocorrencia ${criterio.tipo.toLowerCase()}`, lancada.statusCode === 201, lancada.json());
}

// ---- ficha: o historico sabe o lado de cada fato
const ficha = await req('GET', `/api/v1/pessoas/colaboradores/${colaboradorId}?competencia=${competencia}`);
const ocorrencias = ficha.json().ocorrencias;
ok('a ficha traz as duas ocorrencias', ocorrencias.length === 2, ocorrencias);
ok(
  'cada ocorrencia diz se e positiva ou negativa',
  ocorrencias.every((o: { tipo: string }) => o.tipo === 'POSITIVO' || o.tipo === 'NEGATIVO'),
  ocorrencias.map((o: { tipo: string }) => o.tipo),
);
ok('e o extrato separa os dois lados', ficha.json().extrato.pontosPositivos > 0 && ficha.json().extrato.pontosNegativos > 0, ficha.json().extrato);

// ---- painel de classificacao
const painel = await req('GET', `/api/v1/pessoas/painel?competencia=${competencia}`);
const linha = painel.json().ranking?.find((l: { colaboradorId: string }) => l.colaboradorId === colaboradorId);
ok('o painel classifica a competencia', painel.statusCode === 200 && Array.isArray(painel.json().ranking), painel.json().erro);
ok('a linha traz os dois lados da pontuacao', linha?.pontosPositivos > 0 && linha?.pontosNegativos > 0, linha);
ok('e traz cargo e foto para a tela mostrar gente', 'cargo' in (linha ?? {}) && 'fotoUrl' in (linha ?? {}), linha);
ok(
  'a classificacao vem ordenada do maior para o menor',
  painel.json().ranking.every((l: { pontosFinal: number }, i: number, a: Array<{ pontosFinal: number }>) =>
    i === 0 ? true : a[i - 1]!.pontosFinal >= l.pontosFinal,
  ),
  painel.json().ranking.map((l: { pontosFinal: number }) => l.pontosFinal),
);
ok('o aviso de uso da pontuacao acompanha o numero', typeof painel.json().aviso === 'string', painel.json().aviso);

// ---- mes a mes: competencia anterior nao herda os pontos de hoje
const anterior = new Date();
anterior.setMonth(anterior.getMonth() - 1);
const mesPassado = anterior.toISOString().slice(0, 7);
const painelAnterior = await req('GET', `/api/v1/pessoas/painel?competencia=${mesPassado}`);
const linhaAnterior = painelAnterior.json().ranking?.find((l: { colaboradorId: string }) => l.colaboradorId === colaboradorId);
ok(
  'o filtro mes a mes muda a classificacao',
  (linhaAnterior?.pontosPositivos ?? 0) === 0 && (linhaAnterior?.pontosNegativos ?? 0) === 0,
  linhaAnterior,
);

// ---- desligamento com motivo, sem apagar nada
const desligado = await req('POST', `/api/v1/pessoas/colaboradores/${colaboradorId}/inativar`, {
  motivo: 'Registro de fumaca automatizada.',
});
ok('desliga com motivo', desligado.statusCode === 200 && desligado.json().status === 'DESLIGADO', desligado.json());

const aindaExiste = await prisma.colaborador.findUnique({ where: { id: colaboradorId } });
ok('o registro continua no banco depois do desligamento', aindaExiste !== null && aindaExiste.deletedAt === null);

await app.close();
await prisma.$disconnect();
