/**
 * Usuarios e cadastros de demonstracao para exercitar o ciclo de compras.
 * NAO roda em producao - existe para validar o fluxo F1 ponta a ponta com
 * pessoas diferentes em cada papel, como a segregacao de funcoes exige.
 */
import { novoId, prisma } from '../core/db.js';
import { env } from '../core/env.js';
import { gerarHashSenha } from '../core/auth/password.js';

const SENHA_DEMO = 'Demo@12345';

const PESSOAS: Array<{ nome: string; email: string; perfis: string[] }> = [
  { nome: 'Solicitante Manutencao', email: 'solicitante@cearaalimentos.com.br', perfis: ['Solicitante'] },
  { nome: 'Comprador Tecnico', email: 'comprador@cearaalimentos.com.br', perfis: ['Comprador'] },
  { nome: 'Coordenador de Suprimentos', email: 'coordenador@cearaalimentos.com.br', perfis: ['Coordenador de Suprimentos'] },
  { nome: 'Gerente da Unidade', email: 'gerencia@cearaalimentos.com.br', perfis: ['Gerencia'] },
  { nome: 'Almoxarife Central', email: 'almoxarife@cearaalimentos.com.br', perfis: ['Almoxarife'] },
  { nome: 'Analista Fiscal', email: 'fiscal@cearaalimentos.com.br', perfis: ['Fiscal/Financeiro'] },
  { nome: 'Gestor de Frota', email: 'gestor.frota@cearaalimentos.com.br', perfis: ['Gestor de Frota'] },
  { nome: 'Motorista Demonstracao', email: 'motorista@cearaalimentos.com.br', perfis: ['Motorista'] },
  { nome: 'Porteiro da Guarita', email: 'porteiro@cearaalimentos.com.br', perfis: ['Porteiro'] },
  // administra a governanca sem usar a conta do seed de producao, que tem senha propria
  { nome: 'Administrador de Demonstracao', email: 'admin.demo@cearaalimentos.com.br', perfis: ['Administrador'] },
  // Combinacoes que a matriz de conflitos sinaliza. Existem para provar que o SoD
  // bloqueia em runtime mesmo quando o RBAC ja concedeu a permissao.
  { nome: 'Perfis Acumulados', email: 'acumulado@cearaalimentos.com.br', perfis: ['Solicitante', 'Comprador'] },
  { nome: 'Gerente Almoxarife', email: 'gerente.almoxarife@cearaalimentos.com.br', perfis: ['Gerencia', 'Almoxarife'] },
];

const FORNECEDORES = [
  { razaoSocial: 'Distribuidora Alfa Pecas LTDA', cnpj: '11222333000181', condicaoPadrao: '28 dias' },
  { razaoSocial: 'Beta Suprimentos Industriais SA', cnpj: '44555666000172', condicaoPadrao: '56 dias' },
  { razaoSocial: 'Gama Comercio de Filtros ME', cnpj: '77888999000163', condicaoPadrao: 'a vista' },
];

const ITENS = [
  { codigo: 'PN-0001', descricao: 'Pneu 275/80 R22.5 borrachudo', unidadeMedida: 'UN', critico: true },
  { codigo: 'FL-0002', descricao: 'Filtro de oleo motor MB OM-457', unidadeMedida: 'UN', critico: true },
  { codigo: 'LB-0003', descricao: 'Oleo lubrificante 15W40 balde 20L', unidadeMedida: 'BD', critico: false },
];

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed-demo nao pode rodar em producao.');
  }

  const unidade = await prisma.unidade.findUniqueOrThrow({ where: { codigo: 'MATRIZ' } });
  const centroCusto = await prisma.centroCusto.findUniqueOrThrow({ where: { codigo: '3021' } });
  const senhaHash = await gerarHashSenha(SENHA_DEMO);

  for (const p of PESSOAS) {
    const usuario = await prisma.usuario.upsert({
      where: { email: p.email },
      update: {},
      create: {
        id: novoId(),
        nome: p.nome,
        email: p.email,
        senhaHash,
        unidadeId: unidade.id,
        centroCustoId: centroCusto.id,
      },
    });
    for (const nomePerfil of p.perfis) {
      const perfil = await prisma.perfil.findUniqueOrThrow({ where: { nome: nomePerfil } });
      await prisma.usuarioPerfil.upsert({
        where: { usuarioId_perfilId: { usuarioId: usuario.id, perfilId: perfil.id } },
        update: {},
        create: { usuarioId: usuario.id, perfilId: perfil.id, escopo: {} },
      });
    }
  }

  for (const f of FORNECEDORES) {
    const validade = new Date();
    validade.setFullYear(validade.getFullYear() + 1);
    await prisma.fornecedor.upsert({
      where: { cnpj: f.cnpj },
      update: {},
      create: {
        id: novoId(),
        razaoSocial: f.razaoSocial,
        cnpj: f.cnpj,
        condicaoPadrao: f.condicaoPadrao,
        status: 'HOMOLOGADO',
        homologadoEm: new Date(),
        homologacaoValidaAte: validade,
      },
    });
  }

  for (const i of ITENS) {
    await prisma.item.upsert({
      where: { codigo: i.codigo },
      update: {},
      create: { id: novoId(), ...i, statusHomologacao: 'HOMOLOGADO' },
    });
  }

  console.log(`Seed demo concluido. Senha de todos os usuarios de demonstracao: ${SENHA_DEMO}`);
  console.log(PESSOAS.map((p) => `  ${p.perfis.join(' + ').padEnd(28)} ${p.email}`).join('\n'));
}

main()
  .catch((erro) => {
    console.error('Falha no seed demo:', erro);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
