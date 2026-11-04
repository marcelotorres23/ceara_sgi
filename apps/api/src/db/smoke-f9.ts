/** Fumaca da F9: views materializadas, painel executivo, recorte por unidade e XLSX. */
import ExcelJS from 'exceljs';
import { criarApp } from '../app.js';
import { prisma } from '../core/db.js';
import { atualizarViews } from '../modules/relatorios/bi.service.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });

const refresh = await atualizarViews();
ok('as quatro views atualizam', refresh.length === 4, refresh);
ok('refresh roda concorrente, sem bloquear leitura', refresh.every((r) => r.concorrente), refresh);

const login = await app.inject({
  method: 'POST',
  url: '/api/v1/auth/login',
  payload: { email: process.env.SEED_ADMIN_EMAIL, senha: process.env.SEED_ADMIN_PASSWORD, unidadeId: matriz.id },
});
const cookies = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie: cookies } });

const competencia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Fortaleza',
  year: 'numeric',
  month: '2-digit',
})
  .format(new Date())
  .slice(0, 7);

// ------------------------------------------------ painel executivo
const executivo = await req('GET', `/api/v1/relatorios/executivo?competencia=${competencia}`);
const painel = executivo.json();
ok('painel executivo responde', executivo.statusCode === 200, painel);
ok(
  'painel traz gasto, compras, frota, estoque e fornecedores',
  ['gasto', 'compras', 'frota', 'estoque', 'fornecedores', 'alertas'].every((c) => c in painel),
  Object.keys(painel),
);
ok('painel diz de quando e o numero', painel.dadosAtualizadosEm !== undefined, painel.dadosAtualizadosEm);
ok('painel traz memoria de calculo', Boolean(painel.memoriaDeCalculo?.origem), painel.memoriaDeCalculo);

// ------------------------------------------------ KPIs e sem-base
const kpis = await req('GET', `/api/v1/relatorios/compras/kpis?competencia=1999-01`);
const semBase = kpis.json().kpis;
ok('competencia sem lote devolve null, nao zero', semBase.aderenciaSla.valor === null, semBase.aderenciaSla);
ok('KPI carrega a propria formula', typeof semBase.aderenciaSla.formula === 'string', semBase.aderenciaSla);

// ------------------------------------------------ spend e estoque
const spend = await req('GET', `/api/v1/relatorios/compras/spend?competencia=${competencia}`);
ok('spend analysis responde com concentracao', spend.statusCode === 200 && 'concentracao' in spend.json(), spend.json());

const estoque = await req('GET', '/api/v1/relatorios/almoxarifado/posicao');
const posicao = estoque.json();
ok('posicao de estoque traz curva ABC', estoque.statusCode === 200 && Array.isArray(posicao.curva?.itens), posicao.resumo);

const somaFaixas =
  posicao.curva.resumo.A.itens + posicao.curva.resumo.B.itens + posicao.curva.resumo.C.itens;
ok('todo item cai em exatamente uma faixa', somaFaixas === posicao.curva.itens.length, {
  somaFaixas,
  itens: posicao.curva.itens.length,
});

// ------------------------------------------------ escopo por unidade
const outraUnidade = await prisma.unidade.findFirst({ where: { codigo: { not: 'MATRIZ' } } });
if (outraUnidade) {
  const daFilial = await req('GET', `/api/v1/relatorios/executivo?competencia=${competencia}&unidadeId=${outraUnidade.id}`);
  ok('admin com unidade:todas recorta por unidade', daFilial.statusCode === 200, daFilial.json());
}

const inexistente = await req('GET', `/api/v1/relatorios/executivo?unidadeId=nao-existe`);
ok('unidade inexistente e recusada, em vez de relatorio zerado', inexistente.statusCode === 404, inexistente.json());

// ------------------------------------------------ exportacao XLSX
const desconhecido = await req('GET', '/api/v1/relatorios/exportar/inventado');
ok('relatorio sem exportacao responde 400 com a lista', desconhecido.statusCode === 400, desconhecido.json());

const xlsx = await req('GET', `/api/v1/relatorios/exportar/estoque?competencia=${competencia}`);
ok(
  'exportacao devolve xlsx com nome de arquivo',
  xlsx.statusCode === 200 &&
    Boolean(xlsx.headers['content-type']?.toString().includes('spreadsheetml')) &&
    Boolean(xlsx.headers['content-disposition']?.toString().includes('.xlsx')),
  { status: xlsx.statusCode, headers: xlsx.headers },
);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
const abas = wb.worksheets.map((w) => w.name);
ok('planilha tem a aba de memoria de calculo', abas.includes('Memoria de calculo'), abas);

const primeira = wb.worksheets[0]!;
ok(
  'cabecalho traz a marca e o recorte',
  String(primeira.getCell(1, 1).value).includes('CEARA ALIMENTOS') &&
    String(primeira.getCell(4, 1).value).includes('gerado por'),
  { titulo: primeira.getCell(1, 1).value, recorte: primeira.getCell(4, 1).value },
);

const memoria = wb.getWorksheet('Memoria de calculo')!;
ok('memoria de calculo tem conteudo', memoria.rowCount > 2, memoria.rowCount);

// ------------------------------------------------ atualizacao manual
const manual = await req('POST', '/api/v1/relatorios/atualizar', {});
ok('atualizacao manual das views funciona', manual.statusCode === 200 && manual.json().atualizadas?.length === 4, manual.json());

await app.close();
await prisma.$disconnect();
process.exit(process.exitCode ?? 0);
