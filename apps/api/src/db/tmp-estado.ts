import { prisma } from '../core/db.js';
const unidades = await prisma.unidade.findMany({ select: { id: true, codigo: true, nome: true } });
const veiculos = await prisma.veiculo.count({ where: { deletedAt: null } });
const frio = await prisma.equipamentoFrio.count({ where: { deletedAt: null } });
const planos = await prisma.planoServicoPeriodico.findMany({ select: { tipo: true, modelo: true, intervalo: true, unidadeId: true } });
const execs = await prisma.servicoPeriodico.count({ where: { deletedAt: null } });
console.log(JSON.stringify({ unidades, veiculos, frio, execs, planos }, null, 1));
await prisma.$disconnect();
