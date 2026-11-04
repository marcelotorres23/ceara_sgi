import { prisma, novoId } from '../core/db.js';

const FORNECEDORES = [
  ['Norte Pecas e Equipamentos LTDA', 'Norte Pecas', '12000001000101', '28 dias'],
  ['Ceara Suprimentos Industriais LTDA', 'Ceara Suprimentos', '12000002000102', '30 dias'],
  ['Litoral Materiais Operacionais LTDA', 'Litoral Materiais', '12000003000103', '21 dias'],
  ['Fortaleza Ferramentas e Servicos LTDA', 'Fortaleza Ferramentas', '12000004000104', '35 dias'],
  ['Sertao Autopecas Comerciais LTDA', 'Sertao Autopecas', '12000005000105', '28 dias'],
  ['Matriz Office e Tecnologia LTDA', 'Matriz Office', '12000006000106', '14 dias'],
  ['Atlante Logistica e Abastecimento LTDA', 'Atlante Logistica', '12000007000107', '30 dias'],
  ['Planalto Uniformes Profissionais LTDA', 'Planalto Uniformes', '12000008000108', '45 dias'],
  ['Via Industrial Lubrificantes LTDA', 'Via Industrial', '12000009000109', '21 dias'],
  ['Alvorada Servicos de Manutencao LTDA', 'Alvorada Manutencao', '12000010000100', '30 dias'],
] as const;

async function main(): Promise<void> {
  for (const [razaoSocial, nomeFantasia, cnpj, condicaoPadrao] of FORNECEDORES) {
    await prisma.fornecedor.upsert({
      where: { cnpj },
      update: {},
      create: {
        id: novoId(),
        razaoSocial,
        nomeFantasia,
        cnpj,
        condicaoPadrao,
        status: 'EM_ANALISE',
      },
    });
  }

  const total = await prisma.fornecedor.count({ where: { cnpj: { in: FORNECEDORES.map(([, , cnpj]) => cnpj) } } });
  console.log(`Fornecedores de demonstracao cadastrados: ${total}`);
}

main()
  .catch((erro) => {
    console.error('Falha ao cadastrar fornecedores:', erro);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());