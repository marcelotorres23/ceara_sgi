/**
 * Seed de F0: permissoes do catalogo, 11 perfis padrao (secao 5.2),
 * matriz de alcadas (secao 6.4), parametros do sistema (secao 5.5) e usuario administrador.
 * Idempotente - pode rodar novamente sem duplicar.
 */
import { prisma, novoId } from '../core/db.js';
import { env } from '../core/env.js';
import { PERMISSOES, chavePermissao, TODAS_PERMISSOES } from '../core/rbac/permissions.js';
import { gerarHashSenha } from '../core/auth/password.js';
import { registrarAuditoria } from '../core/audit/index.js';
import { validarPermissoesDoPerfil } from '../modules/governanca/regras.js';
import { PERFIS_PADRAO, permissoesDoPerfil } from '../modules/governanca/perfis-padrao.js';

const PARAMETROS: Array<{ chave: string; valor: unknown; descricao: string }> = [
  { chave: 'compras.taxa_mensal_valor_presente', valor: 0.015, descricao: 'Taxa mensal usada no calculo de valor presente do mapa de cotacao.' },
  { chave: 'compras.tolerancia_divergencia_preco_nfe', valor: 0.02, descricao: 'Tolerancia percentual de divergencia de preco na NF-e antes do bloqueio.' },
  { chave: 'compras.exigir_evidencia_cotacao', valor: true, descricao: 'Exige print, e-mail ou PDF do orcamento anexado antes de registrar os precos da proposta.' },
  { chave: 'compras.dias_alerta_pre_entrega', valor: 2, descricao: 'Antecedencia do alerta de follow-up (D-2).' },
  { chave: 'compras.sla_horas_por_criticidade', valor: { P1: 4, P2: 24, P3: 40, P4: 80 }, descricao: 'SLA em horas uteis de abertura ate pedido, por criticidade.' },
  { chave: 'compras.horario_expediente', valor: { inicio: '08:00', fim: '18:00', almoco: ['12:00', '13:00'], dias: [1, 2, 3, 4, 5] }, descricao: 'Calendario de expediente para calculo de horas uteis.' },
  { chave: 'compras.feriados', valor: [], descricao: 'Feriados (ISO yyyy-mm-dd) considerados no calculo de horas uteis.' },
  { chave: 'frota.desvio_consumo_percentual', valor: 0.15, descricao: 'Desvio de consumo que caracteriza anomalia de abastecimento.' },
  { chave: 'frota.janela_minima_abastecimento_horas', valor: 2, descricao: 'Intervalo minimo entre dois abastecimentos do mesmo veiculo antes de virar anomalia.' },
  { chave: 'frota.janelas_alerta_documento', valor: [30, 15, 7], descricao: 'Dias de antecedencia para alertar vencimento de documento de veiculo e motorista.' },
  { chave: 'frota.sulco_alerta_mm', valor: { verde: 6, amarelo: 4, legal: 1.6 }, descricao: 'Faixas de sulco do mapa de rodagem e limite legal de circulacao, em mm.' },
  { chave: 'frota.tolerancia_afericao_tanque', valor: 0.005, descricao: 'Perda tolerada na afericao do tanque (evaporacao e imprecisao da regua). Acima disso, exige justificativa.' },
  { chave: 'frota.km_rodizio_pneu', valor: 20000, descricao: 'Km na mesma posicao a partir dos quais o pneu vira candidato a rodizio.' },
  { chave: 'almoxarifado.dias_sem_giro', valor: 180, descricao: 'Dias sem movimentacao para classificar item como sem giro.' },
  { chave: 'almoxarifado.meta_acuracidade', valor: 0.95, descricao: 'Meta de acuracidade de inventario.' },
  { chave: 'pessoas.pontos_base_mensal', valor: 100, descricao: 'Pontuacao inicial de cada colaborador no mes.' },
  { chave: 'pessoas.dias_uteis_contestacao', valor: 5, descricao: 'Prazo para o colaborador contestar uma ocorrencia.' },
  { chave: 'pessoas.visibilidade_ranking', valor: 'APENAS_GESTOR', descricao: 'PUBLICO | APENAS_GESTOR | ANONIMIZADO.' },
  { chave: 'portaria.limite_permanencia_horas', valor: 12, descricao: 'Permanencia a partir da qual o acesso aberto vira alerta no patio - quase sempre e saida que ninguem registrou.' },
  { chave: 'portaria.enviar_ficha_largada_whatsapp', valor: false, descricao: 'Envia a ficha de largada ao WhatsApp do motorista assim que a saida do caminhao e registrada. Desligado, a ficha so sai pelo botao da guarita.' },
  { chave: 'notificacoes.canais_ativos', valor: ['IN_APP', 'EMAIL'], descricao: 'Canais de notificacao habilitados. WhatsApp e canal de saida apenas.' },
];

/**
 * Criterios de pontuacao (secao 9.1). Peso e descricao sao editaveis em tela;
 * o codigo e estavel porque e o que o sistema usa para sugerir ocorrencia por evento.
 */
const CRITERIOS: Array<{
  codigo: string;
  tipo: 'POSITIVO' | 'NEGATIVO';
  descricao: string;
  peso: number;
  automatico?: boolean;
  eventoGatilho?: string;
}> = [
  { codigo: 'ZERO_ANOMALIA_ABASTECIMENTO', tipo: 'POSITIVO', descricao: 'Zero anomalia de abastecimento no mes', peso: 8, automatico: true, eventoGatilho: 'fechamento.sem_anomalia' },
  { codigo: 'ZERO_MULTA', tipo: 'POSITIVO', descricao: 'Zero multa no mes', peso: 8, automatico: true, eventoGatilho: 'fechamento.sem_multa' },
  { codigo: 'SUGESTAO_IMPLANTADA', tipo: 'POSITIVO', descricao: 'Sugestao de melhoria implantada', peso: 10 },
  { codigo: 'FALHA_PREVENIDA', tipo: 'POSITIVO', descricao: 'Identificacao preventiva de falha que evitou parada', peso: 12 },
  { codigo: 'SLA_ACIMA_DA_META', tipo: 'POSITIVO', descricao: 'Cumprimento de SLA acima da meta (compradores)', peso: 10 },
  { codigo: 'COBERTURA_DE_COLEGA', tipo: 'POSITIVO', descricao: 'Substituicao ou cobertura de colega', peso: 5 },

  { codigo: 'ANOMALIA_NAO_JUSTIFICADA', tipo: 'NEGATIVO', descricao: 'Anomalia de abastecimento nao justificada', peso: 8, automatico: true, eventoGatilho: 'abastecimento.anomalia_sem_justificativa' },
  // peso base; grave vira -15 e gravissima -20 no calculo (secao 9.1)
  { codigo: 'MULTA_INFRACAO', tipo: 'NEGATIVO', descricao: 'Multa por infracao de transito', peso: 10, automatico: true, eventoGatilho: 'multa.condutor_indicado' },
  { codigo: 'AVARIA_MA_OPERACAO', tipo: 'NEGATIVO', descricao: 'Avaria por ma operacao', peso: 15 },
  { codigo: 'REQUISICAO_SEM_VINCULO', tipo: 'NEGATIVO', descricao: 'Requisicao de peca sem vinculo a veiculo ou OS', peso: 5, automatico: true, eventoGatilho: 'almoxarifado.requisicao_sem_vinculo' },
  { codigo: 'ATRASO_ENTRADA_FISCAL', tipo: 'NEGATIVO', descricao: 'Atraso na entrada fiscal acima de 48h', peso: 8, automatico: true, eventoGatilho: 'fiscal.atraso_48h' },
  { codigo: 'COMPRA_FORA_DO_SISTEMA', tipo: 'NEGATIVO', descricao: 'Descumprimento do POP: compra fora do sistema', peso: 20 },
];

async function main(): Promise<void> {
  console.log('Seed SGI Ceara - inicio');

  // 1. permissoes
  for (const [recurso, acao, descricao] of PERMISSOES) {
    await prisma.permissao.upsert({
      where: { recurso_acao: { recurso, acao } },
      update: { descricao },
      create: { id: novoId(), recurso, acao, descricao },
    });
  }
  const todas = await prisma.permissao.findMany();
  const porChave = new Map(todas.map((p) => [chavePermissao(p.recurso, p.acao), p.id]));

  // 2. perfis
  for (const def of PERFIS_PADRAO) {
    const perfil = await prisma.perfil.upsert({
      where: { nome: def.nome },
      update: { descricao: def.descricao },
      create: { id: novoId(), nome: def.nome, descricao: def.descricao, sistema: true },
    });

    const chaves = permissoesDoPerfil(def);

    /*
     * O seed passa pela mesma validacao da tela.
     *
     * Sem isto as duas portas divergem em silencio: a tela recusa gravar um perfil que o
     * seed acabou de criar, e a regra so aparece quando alguem tenta editar. Era o caso do
     * Administrador — semeado com a cadeia de compras inteira que `validarPermissoesDoPerfil`
     * proibe. Falhar aqui e barulhento de proposito.
     */
    const problemas = validarPermissoesDoPerfil(def.nome, chaves, TODAS_PERMISSOES);
    if (problemas.length > 0) {
      throw new Error(
        `Perfil "${def.nome}" invalido no seed:\n  ${problemas.map((p) => `${p.codigo}: ${p.mensagem}`).join('\n  ')}`,
      );
    }

    // o vinculo e reescrito a cada seed para refletir o catalogo corrente
    await prisma.perfilPermissao.deleteMany({ where: { perfilId: perfil.id } });
    await prisma.perfilPermissao.createMany({
      data: chaves
        .map((c) => porChave.get(c))
        .filter((id): id is string => Boolean(id))
        .map((permissaoId) => ({ perfilId: perfil.id, permissaoId })),
      skipDuplicates: true,
    });
  }

  // 3. alcadas (secao 6.4)
  const perfilPorNome = new Map((await prisma.perfil.findMany()).map((p) => [p.nome, p.id]));
  const alcadas = [
    { nivel: 1, valorMin: '0.00', valorMax: '1000.00', aprovador: 'Comprador', propostas: 2, sla: 0 },
    { nivel: 2, valorMin: '1000.01', valorMax: '5000.00', aprovador: 'Coordenador de Suprimentos', propostas: 3, sla: 8 },
    { nivel: 3, valorMin: '5000.01', valorMax: '20000.00', aprovador: 'Gerencia', propostas: 3, sla: 24 },
    { nivel: 4, valorMin: '20000.01', valorMax: null, aprovador: 'Diretoria', propostas: 3, sla: 48 },
  ];
  for (const a of alcadas) {
    const perfilAprovadorId = perfilPorNome.get(a.aprovador);
    if (!perfilAprovadorId) throw new Error(`Perfil aprovador ausente: ${a.aprovador}`);
    await prisma.alcada.upsert({
      where: { nivel: a.nivel },
      update: { valorMin: a.valorMin, valorMax: a.valorMax, perfilAprovadorId, propostasMinimas: a.propostas, slaHoras: a.sla },
      create: {
        id: novoId(), nivel: a.nivel, valorMin: a.valorMin, valorMax: a.valorMax,
        perfilAprovadorId, propostasMinimas: a.propostas, slaHoras: a.sla,
      },
    });
  }

  // 4. parametros
  for (const p of PARAMETROS) {
    await prisma.parametro.upsert({
      where: { chave: p.chave },
      update: { descricao: p.descricao },
      create: { id: novoId(), chave: p.chave, valor: p.valor as never, descricao: p.descricao },
    });
  }

  // 4b. criterios de pontuacao (secao 9.1)
  // o peso NAO e sobrescrito no update: a gestao ajusta em tela e o seed nao pode desfazer
  for (const c of CRITERIOS) {
    await prisma.criterioPontuacao.upsert({
      where: { codigo: c.codigo },
      update: { automatico: c.automatico ?? false, eventoGatilho: c.eventoGatilho ?? null },
      create: {
        id: novoId(),
        codigo: c.codigo,
        tipo: c.tipo,
        descricao: c.descricao,
        peso: c.peso,
        automatico: c.automatico ?? false,
        eventoGatilho: c.eventoGatilho ?? null,
      },
    });
  }

  // 4c. produtos de abastecimento (secao 7.9)
  const PRODUTOS: Array<{ codigo: string; nome: string; tipo: 'DIESEL_S10' | 'DIESEL_S500' | 'ARLA32' | 'LUBRIFICANTE' }> = [
    { codigo: 'DS10', nome: 'Diesel S10', tipo: 'DIESEL_S10' },
    { codigo: 'DS500', nome: 'Diesel S500', tipo: 'DIESEL_S500' },
    { codigo: 'ARLA', nome: 'Arla 32', tipo: 'ARLA32' },
    { codigo: 'LUB15W40', nome: 'Oleo lubrificante 15W40', tipo: 'LUBRIFICANTE' },
  ];

  for (const p of PRODUTOS) {
    await prisma.produtoCombustivel.upsert({
      where: { codigo: p.codigo },
      update: { nome: p.nome },
      create: { id: novoId(), codigo: p.codigo, nome: p.nome, tipo: p.tipo },
    });
  }

  // 5. unidade, centro de custo e administrador
  const unidade = await prisma.unidade.upsert({
    where: { codigo: 'MATRIZ' },
    update: {},
    create: { id: novoId(), codigo: 'MATRIZ', nome: 'Ceara Alimentos - Matriz', cidade: 'Sao Luis', uf: 'MA' },
  });

  await prisma.centroCusto.upsert({
    where: { codigo: '3021' },
    update: {},
    create: { id: novoId(), codigo: '3021', nome: 'Manutencao de Frota', unidadeId: unidade.id },
  });

  const admin = await prisma.usuario.upsert({
    where: { email: env.SEED_ADMIN_EMAIL.toLowerCase() },
    update: {},
    create: {
      id: novoId(),
      nome: 'Administrador do Sistema',
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      senhaHash: await gerarHashSenha(env.SEED_ADMIN_PASSWORD),
      unidadeId: unidade.id,
    },
  });

  const perfilAdminId = perfilPorNome.get('Administrador')!;
  await prisma.usuarioPerfil.upsert({
    where: { usuarioId_perfilId: { usuarioId: admin.id, perfilId: perfilAdminId } },
    update: {},
    create: { usuarioId: admin.id, perfilId: perfilAdminId, escopo: { unidades: [], centrosCusto: [] } },
  });

  await registrarAuditoria({
    usuarioId: admin.id,
    entidade: 'sistema',
    entidadeId: null,
    acao: 'SEED',
    valorNovo: { perfis: PERFIS_PADRAO.length, permissoes: PERMISSOES.length, alcadas: alcadas.length, parametros: PARAMETROS.length, criterios: CRITERIOS.length },
  });

  console.log(`Seed concluido. Administrador: ${admin.email}`);
  console.log('Troque a senha do administrador no primeiro acesso.');
}

main()
  .catch((erro) => {
    console.error('Falha no seed:', erro);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
