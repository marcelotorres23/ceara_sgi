import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { novoId, prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, filtroUnidadeEm, unidadeDeEscrita, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { NotFoundError } from '../../core/errors/index.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import * as servico from './service.js';
import { agruparPor, totaisDoRelatorio, type LinhaDeAbastecimento } from './relatorio-abastecimento.js';

const decimalString = (campo: string) =>
  z.string().regex(/^\d+(\.\d{1,3})?$/, `${campo} deve ser um numero decimal positivo.`);

/**
 * Filtros do relatorio de abastecimento (secao 7.2).
 *
 * Sao os campos pelos quais a operacao realmente procura: periodo, veiculo, motorista,
 * onde abasteceu, o que abasteceu e se deu anomalia. Todos opcionais e combinaveis — o
 * relatorio sem filtro nenhum e o periodo inteiro, e isso tambem e uma pergunta valida.
 */
const filtrosDeAbastecimento = z.object({
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  veiculoId: z.string().optional(),
  motoristaId: z.string().optional(),
  /** true = so tanque proprio; false = so posto de rua; ausente = os dois */
  postoInterno: z.coerce.boolean().optional(),
  tipoCombustivel: z.string().trim().optional(),
  anomalia: z.coerce.boolean().optional(),
  /** casa com placa, numero de frota, posto ou nome do motorista */
  busca: z.string().trim().optional(),
  unidadeId: z.string().optional(),
});

const listagem = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  veiculoId: z.string().optional(),
  status: z.string().optional(),
  anomalia: z.coerce.boolean().optional(),
  busca: z.string().trim().optional(),
  /** recorte por unidade; so quem tem `unidade:todas` escolhe outra que nao a ativa */
  unidadeId: z.string().optional(),
});

const veiculoSchema = z.object({
  unidadeId: z.string().nullish(),
  placa: z.string().regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/, 'Placa invalida. Use o formato ABC-1234 ou ABC1D23.'),
  frotaNumero: z.string().min(1),
  renavam: z.string().nullish(),
  chassi: z.string().nullish(),
  tipo: z.enum([
    'TRUCK', 'TOCO', 'CARRETA', 'UTILITARIO', 'VAN', 'MOTO',
    'TRES_QUARTOS', 'TRUCK_TRES_QUARTOS', 'CACAMBA', 'SEMI_REBOQUE',
  ]),
  marca: z.string().nullish(),
  modelo: z.string().nullish(),
  ano: z.coerce.number().int().min(1950).max(2100).nullish(),
  configEixos: z.string().nullish(),
  capacidadeTanque: decimalString('Capacidade do tanque').nullish(),
  hodometroAtual: decimalString('Hodometro').default('0'),
  centroCustoId: z.string().nullish(),
  // dados da frota real (secao 7.1)
  propriedade: z.string().nullish(),
  cnpjProprietario: z.string().nullish(),
  capacidadeKg: decimalString('Capacidade de carga').nullish(),
  finalidade: z.string().nullish(),
  situacaoDescrita: z.string().nullish(),
  observacao: z.string().nullish(),
});

const motoristaSchema = z.object({
  unidadeId: z.string().nullish(),
  nome: z.string().min(3),
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 digitos, apenas numeros.'),
  cnhNumero: z.string().min(5),
  cnhCategoria: z.enum(['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE']),
  cnhVencimento: z.coerce.date(),
  // e por este numero que a ficha de largada chega no WhatsApp (secao 14.7)
  telefone: z.string().nullish(),
  toxicologicoVencimento: z.coerce.date().nullish(),
  asoVencimento: z.coerce.date().nullish(),
  veiculoPadraoId: z.string().nullish(),
  usuarioId: z.string().nullish(),
});

/** Nao basta ter a permissao: o veiculo precisa estar na unidade que o usuario opera. */
async function garantirVeiculoNoEscopo(req: Parameters<typeof usuarioDe>[0], veiculoId: string): Promise<void> {
  const veiculo = await prisma.veiculo.findFirst({
    where: { id: veiculoId, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
    select: { id: true },
  });
  if (!veiculo) throw new NotFoundError('Veiculo');
}

/**
 * Consulta unica do relatorio de abastecimento.
 *
 * Relatorio, agrupamentos e CSV precisam responder pelo **mesmo recorte** — se cada um
 * montasse o seu `where`, o total do topo deixaria de bater com a soma da tabela no dia em
 * que alguem mexesse num deles. O teto de linhas e do chamador: a tela pede menos, o
 * arquivo pede mais.
 */
async function linhasDoRelatorio(
  req: Parameters<typeof usuarioDe>[0],
  filtros: z.infer<typeof filtrosDeAbastecimento>,
  teto: number,
) {
  const busca = filtros.busca?.trim();

  return prisma.abastecimento.findMany({
    where: {
      deletedAt: null,
      // abastecimento nao tem unidade propria: herda a do veiculo
      ...filtroUnidadeEm(usuarioDe(req), 'veiculo', filtros.unidadeId),
      ...(filtros.veiculoId ? { veiculoId: filtros.veiculoId } : {}),
      ...(filtros.motoristaId ? { motoristaId: filtros.motoristaId } : {}),
      ...(filtros.postoInterno !== undefined ? { postoInterno: filtros.postoInterno } : {}),
      ...(filtros.tipoCombustivel ? { tipoCombustivel: filtros.tipoCombustivel } : {}),
      ...(filtros.anomalia !== undefined ? { anomalia: filtros.anomalia } : {}),
      ...(filtros.de || filtros.ate
        ? {
            dataHora: {
              ...(filtros.de ? { gte: filtros.de } : {}),
              ...(filtros.ate ? { lte: filtros.ate } : {}),
            },
          }
        : {}),
      ...(busca
        ? {
            OR: [
              { posto: { contains: busca, mode: 'insensitive' } },
              { veiculo: { placa: { contains: busca.toUpperCase() } } },
              { veiculo: { frotaNumero: { contains: busca, mode: 'insensitive' } } },
              { motorista: { nome: { contains: busca, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: {
      veiculo: { select: { id: true, placa: true, frotaNumero: true } },
      motorista: { select: { id: true, nome: true } },
    },
    orderBy: { dataHora: 'desc' },
    take: teto,
  });
}

export const transporteRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- veiculos
  app.post('/veiculos', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req, reply) => {
    const dados = veiculoSchema.parse(req.body);
    const ator = atorDe(req);
    const veiculo = await prisma.veiculo.create({
      data: {
        id: novoId(),
        ...dados,
        unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId),
        placa: dados.placa.toUpperCase(),
        renavam: dados.renavam ?? null,
        chassi: dados.chassi ?? null,
        marca: dados.marca ?? null,
        modelo: dados.modelo ?? null,
        ano: dados.ano ?? null,
        configEixos: dados.configEixos ?? null,
        capacidadeTanque: dados.capacidadeTanque ?? null,
        centroCustoId: dados.centroCustoId ?? null,
        propriedade: dados.propriedade ?? null,
        cnpjProprietario: dados.cnpjProprietario ?? null,
        capacidadeKg: dados.capacidadeKg ?? null,
        finalidade: dados.finalidade ?? null,
        situacaoDescrita: dados.situacaoDescrita ?? null,
        observacao: dados.observacao ?? null,
        createdBy: ator.usuarioId,
      },
    });
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'veiculos', entidadeId: veiculo.id, acao: 'CRIAR',
      valorNovo: { placa: veiculo.placa, frota: veiculo.frotaNumero },
    });
    return reply.status(201).send(veiculo);
  });

  /**
   * Equipamentos de refrigeracao (secao 7.1).
   *
   * Ativo proprio, e nao coluna do veiculo: o aparelho muda de caminhao, e o horimetro
   * dele conta a vida util em horas - nao nos km do veiculo que o carrega hoje.
   */
  app.get('/equipamentos-frio', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { cursor, limite, busca, unidadeId } = listagem.parse(req.query);
    const itens = await prisma.equipamentoFrio.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(busca
          ? {
              OR: [
                { marca: { contains: busca, mode: 'insensitive' } },
                { modelo: { contains: busca, mode: 'insensitive' } },
                { numeroSerie: { contains: busca.toUpperCase() } },
                { veiculo: { placa: { contains: busca.toUpperCase() } } },
              ],
            }
          : {}),
      },
      include: { veiculo: { select: { id: true, placa: true, frotaNumero: true } } },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  app.get('/veiculos', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { cursor, limite, status, busca, unidadeId } = listagem.parse(req.query);
    const itens = await prisma.veiculo.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(status ? { status: status as never } : {}),
        ...(busca ? { OR: [{ placa: { contains: busca.toUpperCase() } }, { frotaNumero: { contains: busca } }] } : {}),
      },
      include: {
        documentos: { where: { deletedAt: null } },
        centroCusto: { select: { codigo: true } },
        unidade: { select: { codigo: true, nome: true } },
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  app.get('/veiculos/:id', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const veiculo = await prisma.veiculo.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      include: {
        documentos: { where: { deletedAt: null }, orderBy: { vencimento: 'asc' } },
        posicoesPneu: { orderBy: { ordem: 'asc' } },
        abastecimentos: { where: { deletedAt: null }, orderBy: { dataHora: 'desc' }, take: 10 },
      },
    });
    if (!veiculo) throw new NotFoundError('Veiculo');
    return veiculo;
  });

  app.post('/veiculos/:id/documentos', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await garantirVeiculoNoEscopo(req, id);
    const dados = z.object({
      tipo: z.string().min(2),
      numero: z.string().nullish(),
      emissao: z.coerce.date().nullish(),
      vencimento: z.coerce.date(),
      anexoId: z.string().nullish(),
    }).parse(req.body);

    const doc = await prisma.veiculoDocumento.create({
      data: {
        id: novoId(), veiculoId: id, ...dados,
        numero: dados.numero ?? null, emissao: dados.emissao ?? null, anexoId: dados.anexoId ?? null,
      },
    });
    return reply.status(201).send(doc);
  });

  /** Mapa de rodagem: as posicoes de pneu do veiculo. Os pneus em si vivem em /transporte/pneus. */
  app.post('/veiculos/:id/posicoes-pneu', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await garantirVeiculoNoEscopo(req, id);
    const { posicoes } = z.object({
      posicoes: z.array(z.object({
        codigo: z.string().min(1),
        eixo: z.coerce.number().int().min(1),
        lado: z.enum(['ESQUERDO', 'DIREITO', 'ESTEPE']),
        ordem: z.coerce.number().int().min(1),
      })).min(1),
    }).parse(req.body);

    await prisma.posicaoPneu.createMany({
      data: posicoes.map((p) => ({ id: novoId(), veiculoId: id, ...p })),
      skipDuplicates: true,
    });
    const criadas = await prisma.posicaoPneu.findMany({ where: { veiculoId: id }, orderBy: { ordem: 'asc' } });
    return reply.status(201).send({ itens: criadas });
  });

  // ---------------------------------------------------------------- motoristas
  app.post('/motoristas', { preHandler: [app.autenticar, app.exigirPermissao('motorista:gerenciar')] }, async (req, reply) => {
    const dados = motoristaSchema.parse(req.body);
    const ator = atorDe(req);
    const motorista = await prisma.motorista.create({
      data: {
        id: novoId(), ...dados,
        unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId),
        telefone: dados.telefone?.trim() || null,
        toxicologicoVencimento: dados.toxicologicoVencimento ?? null,
        asoVencimento: dados.asoVencimento ?? null,
        veiculoPadraoId: dados.veiculoPadraoId ?? null,
        usuarioId: dados.usuarioId ?? null,
      },
    });
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'motoristas', entidadeId: motorista.id, acao: 'CRIAR', valorNovo: { nome: motorista.nome },
    });
    return reply.status(201).send(motorista);
  });

  app.get('/motoristas', { preHandler: [app.autenticar, app.exigirPermissao('motorista:gerenciar')] }, async (req) => {
    const { cursor, limite, status, unidadeId } = listagem.parse(req.query);
    const itens = await prisma.motorista.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(status ? { status: status as never } : {}),
      },
      include: { veiculoPadrao: { select: { placa: true } } },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  // ---------------------------------------------------------------- abastecimento
  app.post('/abastecimentos', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async (req, reply) => {
    const dados = z.object({
      veiculoId: z.string().min(1),
      motoristaId: z.string().min(1),
      dataHora: z.coerce.date(),
      posto: z.string().min(2),
      postoInterno: z.boolean().default(false),
      tipoCombustivel: z.string().min(2),
      litros: decimalString('Litros'),
      valorUnitario: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Valor unitario invalido.'),
      hodometro: decimalString('Hodometro'),
      horimetro: decimalString('Horimetro').nullish(),
      formaPagamento: z.string().nullish(),
      numeroCartao: z.string().nullish(),
      justificativa: z.string().nullish(),
      fotoPainelId: z.string().nullish(),
      fotoCupomId: z.string().nullish(),
      // ---- F11: abastecimento no tanque proprio (secao 7.9)
      tanqueId: z.string().nullish(),
      bicoId: z.string().nullish(),
      produtoId: z.string().nullish(),
      encerranteInicial: decimalString('Encerrante inicial').nullish(),
      encerranteFinal: decimalString('Encerrante final').nullish(),
      obraLocal: z.string().nullish(),
      rota: z.string().nullish(),
      turno: z.string().nullish(),
      osId: z.string().nullish(),
    }).parse(req.body);

    const { registro, apurado } = await servico.registrarAbastecimento(atorDe(req), {
      ...dados,
      horimetro: dados.horimetro ?? null,
      formaPagamento: dados.formaPagamento ?? null,
      numeroCartao: dados.numeroCartao ?? null,
      justificativa: dados.justificativa ?? null,
      tanqueId: dados.tanqueId ?? null,
      bicoId: dados.bicoId ?? null,
      produtoId: dados.produtoId ?? null,
      encerranteInicial: dados.encerranteInicial ?? null,
      encerranteFinal: dados.encerranteFinal ?? null,
      obraLocal: dados.obraLocal ?? null,
      rota: dados.rota ?? null,
      turno: dados.turno ?? null,
      osId: dados.osId ?? null,
      fotoPainelId: dados.fotoPainelId ?? null,
      fotoCupomId: dados.fotoCupomId ?? null,
    });

    return reply.status(201).send({
      abastecimento: registro,
      apuracao: {
        valorTotal: apurado.valorTotal.toFixed(2),
        kmPercorridos: apurado.kmPercorridos?.toFixed(1) ?? null,
        consumoKml: apurado.consumoKml?.toFixed(3) ?? null,
        custoPorKm: apurado.custoPorKm?.toFixed(4) ?? null,
        desvioPercentual: apurado.desvioPercentual?.times(100).toFixed(2) ?? null,
        anomalia: apurado.anomalia,
        tipos: apurado.tipos,
        mensagens: apurado.mensagens,
      },
    });
  });

  app.get('/abastecimentos', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async (req) => {
    const { cursor, limite } = listagem.parse(req.query);
    const filtros = filtrosDeAbastecimento.parse(req.query);
    const busca = filtros.busca?.trim();

    const itens = await prisma.abastecimento.findMany({
      where: {
        deletedAt: null,
        // abastecimento nao tem unidade propria: herda a do veiculo
        ...filtroUnidadeEm(usuarioDe(req), 'veiculo', filtros.unidadeId),
        ...(filtros.veiculoId ? { veiculoId: filtros.veiculoId } : {}),
        ...(filtros.motoristaId ? { motoristaId: filtros.motoristaId } : {}),
        ...(filtros.postoInterno !== undefined ? { postoInterno: filtros.postoInterno } : {}),
        ...(filtros.tipoCombustivel ? { tipoCombustivel: filtros.tipoCombustivel } : {}),
        ...(filtros.anomalia !== undefined ? { anomalia: filtros.anomalia } : {}),
        ...(filtros.de || filtros.ate
          ? { dataHora: { ...(filtros.de ? { gte: filtros.de } : {}), ...(filtros.ate ? { lte: filtros.ate } : {}) } }
          : {}),
        ...(busca
          ? {
              OR: [
                { posto: { contains: busca, mode: 'insensitive' } },
                { veiculo: { placa: { contains: busca.toUpperCase() } } },
                { motorista: { nome: { contains: busca, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        veiculo: { select: { placa: true, frotaNumero: true } },
        motorista: { select: { nome: true } },
      },
      orderBy: { id: 'desc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

/**
   * Relatorio de abastecimentos (secao 7.2).
   *
   * Devolve as linhas do periodo, os totais e os agrupamentos por veiculo, motorista, posto
   * e combustivel — tudo com o mesmo recorte de filtro, para o numero do topo bater com a
   * soma da tabela. O teto de linhas existe porque relatorio nao e exportacao: quem precisa
   * de tudo pede o arquivo, que sai pela mesma consulta.
   */
  app.get('/abastecimentos/relatorio', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async (req) => {
    const filtros = filtrosDeAbastecimento.parse(req.query);
    const linhas = await linhasDoRelatorio(req, filtros, 2000);

    const paraConta: LinhaDeAbastecimento[] = linhas.map((a) => ({
      litros: a.litros.toString(),
      valorTotal: a.valorTotal.toString(),
      kmPercorridos: a.kmPercorridos?.toString() ?? null,
      anomalia: a.anomalia,
      veiculo: a.veiculo.placa,
      motorista: a.motorista.nome,
      posto: a.posto,
      combustivel: a.tipoCombustivel,
    }));

    return {
      filtros,
      totais: totaisDoRelatorio(paraConta),
      porVeiculo: agruparPor(paraConta, 'veiculo'),
      porMotorista: agruparPor(paraConta, 'motorista'),
      porPosto: agruparPor(paraConta, 'posto'),
      porCombustivel: agruparPor(paraConta, 'combustivel'),
      itens: linhas.map((a) => ({
        id: a.id,
        dataHora: a.dataHora,
        veiculo: a.veiculo,
        motorista: a.motorista.nome,
        posto: a.posto,
        postoInterno: a.postoInterno,
        tipoCombustivel: a.tipoCombustivel,
        litros: a.litros.toString(),
        valorUnitario: a.valorUnitario.toString(),
        valorTotal: a.valorTotal.toString(),
        hodometro: a.hodometro.toString(),
        kmPercorridos: a.kmPercorridos?.toString() ?? null,
        consumoKml: a.consumoKml?.toString() ?? null,
        custoPorKm: a.custoPorKm?.toString() ?? null,
        anomalia: a.anomalia,
        anomaliaTipos: a.anomaliaTipos,
        justificativa: a.justificativa,
      })),
    };
  });

  /** Valores que existem de fato no historico, para a tela montar os seletores sem chutar. */
  app.get('/abastecimentos/opcoes-de-filtro', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async (req) => {
    const alcance = { deletedAt: null, ...filtroUnidadeEm(usuarioDe(req), 'veiculo') };

    const [combustiveis, postos] = await Promise.all([
      prisma.abastecimento.findMany({ where: alcance, select: { tipoCombustivel: true }, distinct: ['tipoCombustivel'] }),
      prisma.abastecimento.findMany({ where: alcance, select: { posto: true }, distinct: ['posto'], take: 100 }),
    ]);

    return {
      combustiveis: combustiveis.map((c) => c.tipoCombustivel).sort(),
      postos: postos.map((p) => p.posto).sort(),
    };
  });

  /** O mesmo relatorio em CSV, para quem vai continuar a analise na planilha. */
  app.get('/abastecimentos/relatorio.csv', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async (req, reply) => {
    const filtros = filtrosDeAbastecimento.parse(req.query);
    const linhas = await linhasDoRelatorio(req, filtros, 20000);

    const cabecalho = [
      'data', 'placa', 'frota', 'motorista', 'posto', 'interno', 'combustivel',
      'litros', 'valor_unitario', 'valor_total', 'hodometro', 'km_percorridos',
      'consumo_kml', 'custo_por_km', 'anomalia', 'justificativa',
    ];

    const corpo = linhas.map((a) =>
      [
        a.dataHora.toISOString(),
        a.veiculo.placa,
        a.veiculo.frotaNumero,
        a.motorista.nome,
        a.posto,
        a.postoInterno ? 'sim' : 'nao',
        a.tipoCombustivel,
        a.litros.toString(),
        a.valorUnitario.toString(),
        a.valorTotal.toString(),
        a.hodometro.toString(),
        a.kmPercorridos?.toString() ?? '',
        a.consumoKml?.toString() ?? '',
        a.custoPorKm?.toString() ?? '',
        a.anomalia ? 'sim' : 'nao',
        a.justificativa ?? '',
      ]
        // ponto e virgula e o separador que o Excel em pt-BR entende sem pedir importacao
        .map((campo) => `"${String(campo).replaceAll('"', '""')}"`)
        .join(';'),
    );

    await registrarAuditoria({
      usuarioId: atorDe(req).usuarioId, ip: req.ip, userAgent: req.headers['user-agent'] ?? null,
      entidade: 'abastecimentos', entidadeId: null, acao: 'EXPORTAR',
      valorNovo: { linhas: linhas.length, filtros },
    });

    // BOM na frente: sem ele o Excel abre acento quebrado
    const csv = '\ufeff' + [cabecalho.join(';'), ...corpo].join('\r\n');

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="abastecimentos-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(csv);
  });

  app.post('/abastecimentos/:id/justificativa', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { justificativa } = z.object({ justificativa: z.string().min(5) }).parse(req.body);
    return servico.justificarAnomalia(atorDe(req), id, justificativa);
  });

  /**
   * Agenda do dia (secao 7.2): abastecimentos do dia, para conferencia com um check ao lado.
   * `data` e opcional (padrao hoje) para dar para revisar um dia anterior sem trocar o
   * relogio do navegador.
   */
  app.get('/abastecimentos/agenda', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:confirmar')] }, async (req) => {
    const { data, unidadeId } = z.object({ data: z.coerce.date().optional(), unidadeId: z.string().optional() }).parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return servico.listarAgendaDoDia(data ?? new Date(), consultadas === 'TODAS' ? [] : consultadas);
  });

  app.post('/abastecimentos/:id/confirmar', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:confirmar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { confirmado } = z.object({ confirmado: z.boolean().default(true) }).parse(req.body ?? {});
    return servico.confirmarAbastecimento(atorDe(req), id, confirmado);
  });

  // ---------------------------------------------------------------- documentos e CCO
  app.get('/documentos', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { unidadeId } = listagem.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return {
      unidades: consultadas,
      ...(await servico.painelDocumentos(consultadas === 'TODAS' ? [] : consultadas)),
    };
  });

  app.get('/painel', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { unidadeId } = listagem.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return {
      unidades: consultadas,
      ...(await servico.painelCco(consultadas === 'TODAS' ? [] : consultadas)),
    };
  });
};
