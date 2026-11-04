/** Fumaca da entrada de combustivel por XML da NF-e (secao 7.9). */
import { criarApp } from '../app.js';
import { prisma } from '../core/db.js';

const ok = (nome: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'OK ' : 'FALHA'} ${nome}`, cond ? '' : JSON.stringify(extra));
  if (!cond) process.exitCode = 1;
};

const app = await criarApp();
const matriz = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
const login = await app.inject({
  method: 'POST', url: '/api/v1/auth/login',
  payload: { email: process.env.SEED_ADMIN_EMAIL, senha: process.env.SEED_ADMIN_PASSWORD, unidadeId: matriz.id },
});
const cookies = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: { cookie: cookies } });

const fornecedor = await prisma.fornecedor.findFirst({ where: { deletedAt: null } });
const cnpjConhecido = fornecedor?.cnpj ?? '12345678000199';

const numeroDaNota = String(Date.now()).slice(-8);
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00"><NFe><infNFe Id="NFe3526081234567800019955001000012345100012345" versao="4.00">
<ide><nNF>${numeroDaNota}</nNF><serie>1</serie><dhEmi>2026-08-15T09:30:00-03:00</dhEmi></ide>
<emit><CNPJ>${cnpjConhecido}</CNPJ><xNome>DISTRIBUIDORA TESTE LTDA</xNome></emit>
<det nItem="1"><prod><cProd>001</cProd><xProd>OLEO DIESEL B S10</xProd><uCom>LT</uCom><qCom>3000.000</qCom><vUnCom>6.2000</vUnCom><vProd>18600.00</vProd></prod></det>
<det nItem="2"><prod><cProd>999</cProd><xProd>FRETE</xProd><uCom>UN</uCom><qCom>1.000</qCom><vUnCom>500.0000</vUnCom><vProd>500.00</vProd></prod></det>
<total><ICMSTot><vNF>19100.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

const leitura = await req('POST', '/api/v1/transporte/tanques/entradas/ler-xml', {
  conteudoBase64: Buffer.from(xml, 'utf8').toString('base64'),
});
const r = leitura.json();
ok('le o XML da nota', leitura.statusCode === 200, r.erro);
ok('extrai litros so do combustivel', r.nota?.litrosDeCombustivel === '3000.000', r.nota?.litrosDeCombustivel);
ok('extrai o custo do litro', r.nota?.custoUnitarioMedio === '6.2000', r.nota?.custoUnitarioMedio);
ok('extrai o numero da nota', r.nota?.numero === numeroDaNota, r.nota?.numero);
ok('separa o frete do volume', r.nota?.itens?.filter((i: { ehCombustivel: boolean }) => !i.ehCombustivel).length === 1, r.nota?.itens?.length);
ok('avisa que o total da nota tem frete', r.nota?.avisos?.some((a: string) => a.includes('frete')), r.nota?.avisos);
if (fornecedor) ok('casa o fornecedor pelo CNPJ', r.fornecedor?.id === fornecedor.id, { achou: r.fornecedor?.id, esperado: fornecedor.id });
ok('nota inedita nao acusa duplicata', r.jaLancada === null, r.jaLancada);

const naoEhNota = '<?xml version="1.0" encoding="UTF-8"?><documento><cabecalho>isto nao e uma nota fiscal eletronica</cabecalho></documento>';
const lixo = await req('POST', '/api/v1/transporte/tanques/entradas/ler-xml', {
  conteudoBase64: Buffer.from(naoEhNota, 'utf8').toString('base64'),
});
ok('arquivo que nao e NF-e vira erro claro', lixo.statusCode === 400 && String(lixo.json().erro?.mensagem).includes('NF-e'), lixo.json());

// ---- lanca a entrada com o que o XML propos e confere a duplicata na segunda leitura
const tanque = await prisma.tanque.findFirst({
  where: { deletedAt: null, produto: { nome: { contains: 'iesel', mode: 'insensitive' } } },
});
if (tanque) {
  /*
   * O volume da nota do teste pode nao caber no tanque disponivel — a regra de capacidade e
   * do servico e esta correta. Aqui interessa provar o caminho do XML ate o lancamento,
   * entao o smoke lanca o que couber na folga do tanque.
   */
  const saldo = await prisma.tanque.findUniqueOrThrow({
    where: { id: tanque.id },
    select: { capacidadeLitros: true, saldoLitros: true },
  });
  const folga = Number(saldo.capacidadeLitros) - Number(saldo.saldoLitros);
  const volume = Math.max(Math.min(Number(r.nota.litrosDeCombustivel), folga - 1), 1).toFixed(3);

  const entrada = await req('POST', `/api/v1/transporte/tanques/${tanque.id}/entradas`, {
    litros: volume,
    custoUnitario: r.nota.custoUnitarioMedio,
    notaFiscal: r.nota.numero,
    fornecedorId: r.fornecedor?.id ?? null,
  });
  ok('lanca a entrada proposta pelo XML', entrada.statusCode === 201, entrada.json());

  const relendo = await req('POST', '/api/v1/transporte/tanques/entradas/ler-xml', {
    conteudoBase64: Buffer.from(xml, 'utf8').toString('base64'),
  });
  ok('reler a mesma nota avisa que ela ja foi lancada', relendo.json().jaLancada !== null, relendo.json().jaLancada);
} else {
  console.log('AVISO: sem tanque de diesel para exercitar o lancamento');
}

await app.close();
await prisma.$disconnect();
