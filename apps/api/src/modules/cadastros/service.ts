import { db, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import type { Ator } from '../compras/service.js';

/**
 * Edicao e inativacao dos cadastros.
 *
 * Regra de ouro 2: nada se exclui. Inativar registra motivo, autor e data, e o
 * registro continua consultavel - o mesmo padrao ja usado em `solicitacoes` e `lotes`.
 */

export type RecursoCadastro =
  | 'veiculo'
  | 'motorista'
  | 'item'
  | 'fornecedor'
  | 'almoxarifado'
  | 'rota'
  | 'colaborador';

interface Config {
  entidade: string;
  /** campos que podem ser alterados; o resto e ignorado mesmo se vier no corpo */
  editaveis: string[];
  /** como marcar inativo e como voltar */
  inativo: Record<string, unknown>;
  ativo: Record<string, unknown>;
  /** consulta que impede a inativacao quando o registro esta em uso */
  emUso?: (id: string) => Promise<string | null>;
  /**
   * Campos inteiros. O formulario generico manda tudo como texto, e coluna inteira nao
   * aceita "8": sem a conversao a edicao morre no banco, e nao na validacao.
   */
  inteiros?: string[];
}

const CONFIG: Record<RecursoCadastro, Config> = {
  veiculo: {
    entidade: 'veiculos',
    inteiros: ['ano'],
    editaveis: [
      'placa', 'frotaNumero', 'renavam', 'chassi', 'tipo', 'marca', 'modelo', 'ano', 'configEixos',
      'capacidadeTanque', 'centroCustoId',
      // dados da frota real (secao 7.1)
      'propriedade', 'cnpjProprietario', 'capacidadeKg', 'finalidade', 'situacaoDescrita', 'observacao',
    ],
    inativo: { status: 'INATIVO' },
    ativo: { status: 'ATIVO' },
    emUso: async (id) => {
      // servico periodico em aberto nao trava; o que trava e OS aberta no ativo
      const os = await prisma.ordemServico.findFirst({
        where: { veiculoId: id, status: { in: ['ABERTA', 'EM_EXECUCAO', 'AGUARDANDO_PECA'] }, deletedAt: null },
        select: { numero: true },
      });
      return os ? `Ha ordem de servico em aberto (${os.numero}) para este veiculo.` : null;
    },
  },
  motorista: {
    entidade: 'motoristas',
    editaveis: ['nome', 'cpf', 'telefone', 'cnhNumero', 'cnhCategoria', 'cnhVencimento', 'toxicologicoVencimento', 'asoVencimento', 'veiculoPadraoId'],
    inativo: { status: 'INATIVO' },
    ativo: { status: 'ATIVO' },
    emUso: async (id) => {
      // caminhao na rua com este motorista: inativar agora deixaria a viagem sem responsavel
      const naRua = await prisma.acessoPortaria.findFirst({
        where: { motoristaId: id, status: 'EM_TRANSITO', deletedAt: null },
        include: { veiculo: { select: { placa: true } } },
      });
      return naRua ? `Ha viagem em andamento com este motorista (${naRua.veiculo?.placa ?? 'sem placa'}).` : null;
    },
  },
  item: {
    entidade: 'itens',
    editaveis: ['codigo', 'descricao', 'especificacao', 'unidadeMedida', 'codigoFabricante', 'familiaId', 'critico', 'curvaAbc'],
    // item nao tem status proprio: a reprovacao da homologacao e o que o tira de circulacao
    inativo: { statusHomologacao: 'REPROVADO' },
    ativo: { statusHomologacao: 'EM_ANALISE' },
    emUso: async (id) => {
      const saldo = await prisma.saldo.findFirst({
        where: { itemId: id, quantidade: { gt: 0 } },
        include: { almoxarifado: { select: { codigo: true } } },
      });
      if (saldo) return `Ha saldo em estoque no almoxarifado ${saldo.almoxarifado.codigo}.`;

      const emLote = await prisma.solicitacaoItem.findFirst({
        where: { itemId: id, solicitacao: { status: { in: ['ABERTA', 'EM_TRIAGEM', 'EM_LOTE'] }, deletedAt: null } },
        include: { solicitacao: { select: { numero: true } } },
      });
      return emLote ? `Item consta na solicitacao ${emLote.solicitacao.numero}, ainda em andamento.` : null;
    },
  },
  fornecedor: {
    entidade: 'fornecedores',
    editaveis: ['razaoSocial', 'nomeFantasia', 'cnpj', 'ie', 'condicaoPadrao'],
    inativo: { status: 'BLOQUEADO' },
    ativo: { status: 'EM_ANALISE' },
    emUso: async (id) => {
      const pedido = await prisma.pedido.findFirst({
        where: { fornecedorId: id, status: { in: ['EMITIDO', 'CONFIRMADO', 'PARCIALMENTE_RECEBIDO'] }, deletedAt: null },
        select: { numero: true },
      });
      return pedido ? `Ha pedido em aberto (${pedido.numero}) com este fornecedor.` : null;
    },
  },
  colaborador: {
    entidade: 'colaboradores',
    editaveis: [
      'nome', 'matricula', 'cargo', 'setor', 'admissao', 'gestorId', 'usuarioId',
      'cpf', 'telefone', 'email', 'dataNascimento', 'fotoUrl',
    ],
    inativo: { status: 'DESLIGADO' },
    ativo: { status: 'ATIVO' },
    emUso: async (id) => {
      // contestacao aberta e defesa em curso: desligar agora deixaria a decisao sem dono
      const aberta = await prisma.ocorrencia.findFirst({
        where: { colaboradorId: id, status: 'CONTESTADA' },
        select: { competencia: true },
      });
      if (!aberta) return null;
      return `Ha contestacao aberta na competencia ${aberta.competencia} aguardando decisao.`;
    },
  },
  rota: {
    entidade: 'rotas',
    editaveis: ['codigo', 'nome', 'vendedores', 'diasPreVenda', 'fechamento', 'largada', 'observacao'],
    inteiros: ['vendedores', 'diasPreVenda'],
    inativo: { ativo: false },
    ativo: { ativo: true },
    emUso: async (id) => {
      // caminhao na rua nesta rota: inativar agora deixaria a viagem sem roteiro
      const aberto = await prisma.acessoPortaria.findFirst({
        where: { rotaId: id, status: { in: ['AGENDADO', 'NO_PATIO', 'EM_TRANSITO'] }, deletedAt: null },
        include: { veiculo: { select: { placa: true } } },
      });
      if (!aberto) return null;
      return `Ha caminhao em viagem nesta rota (${aberto.veiculo?.placa ?? 'placa nao registrada'}).`;
    },
  },
  almoxarifado: {
    entidade: 'almoxarifados',
    editaveis: ['codigo', 'nome', 'unidadeId', 'responsavelId'],
    inativo: { ativo: false },
    ativo: { ativo: true },
    emUso: async (id) => {
      const saldo = await prisma.saldo.findFirst({
        where: { almoxarifadoId: id, quantidade: { gt: 0 } },
        include: { item: { select: { codigo: true } } },
      });
      return saldo ? `Ha saldo em estoque, por exemplo o item ${saldo.item.codigo}.` : null;
    },
  },
};

/** Acesso tipado ao delegate do Prisma correspondente ao recurso. */
const delegate = (recurso: RecursoCadastro) => {
  switch (recurso) {
    case 'veiculo': return db.veiculo;
    case 'motorista': return db.motorista;
    case 'item': return db.item;
    case 'fornecedor': return db.fornecedor;
    case 'almoxarifado': return db.almoxarifado;
    case 'rota': return db.rota;
    case 'colaborador': return db.colaborador;
  }
};

const somenteLeitura = (recurso: RecursoCadastro) => {
  switch (recurso) {
    case 'veiculo': return prisma.veiculo;
    case 'motorista': return prisma.motorista;
    case 'item': return prisma.item;
    case 'fornecedor': return prisma.fornecedor;
    case 'almoxarifado': return prisma.almoxarifado;
    case 'rota': return prisma.rota;
    case 'colaborador': return prisma.colaborador;
  }
};

/**
 * Busca o registro e confere a unidade (secao 5.6): editar ou inativar cadastro
 * de outra unidade e negado, e responde 404 - quem nao alcanca o registro nao
 * precisa nem saber que ele existe.
 */
async function buscar(ator: Ator, recurso: RecursoCadastro, id: string): Promise<Record<string, unknown>> {
  const encontrado = await (somenteLeitura(recurso) as { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> })
    .findFirst({ where: { id, deletedAt: null } });
  if (!encontrado) throw new NotFoundError('Registro');

  const unidadeDoRegistro = encontrado.unidadeId;
  if (typeof unidadeDoRegistro === 'string' && !ator.todasUnidades && ator.unidadeId !== unidadeDoRegistro) {
    throw new NotFoundError('Registro');
  }

  return encontrado;
}

/** "8" vira 8; vazio vira ausencia. Texto que nao e numero e erro de quem enviou. */
function paraInteiro(campo: string, valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Math.trunc(valor);
  const n = Number(String(valor).trim());
  if (!Number.isFinite(n)) throw new ValidationError(`O campo ${campo} precisa ser um numero inteiro.`);
  return Math.trunc(n);
}

/** Serializa Decimal e Date para caber no JSONB da auditoria. */
const paraTrilha = (valor: unknown): unknown => {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object' && 'toString' in valor) return String(valor);
  return valor;
};

export async function editar(
  ator: Ator,
  recurso: RecursoCadastro,
  id: string,
  alteracoes: Record<string, unknown>,
) {
  const config = CONFIG[recurso];
  const atual = await buscar(ator, recurso, id);

  // so os campos declarados como editaveis; o resto e descartado em silencio
  const permitidas = Object.fromEntries(
    Object.entries(alteracoes)
      .filter(([campo]) => config.editaveis.includes(campo))
      .map(([campo, valor]) => [campo, config.inteiros?.includes(campo) ? paraInteiro(campo, valor) : valor]),
  );

  if (Object.keys(permitidas).length === 0) {
    throw new ValidationError('Nenhum campo editavel foi informado.');
  }

  // grava so o que mudou de fato - alteracao vazia nao deve poluir a trilha
  const diferentes = Object.fromEntries(
    Object.entries(permitidas).filter(([campo, novo]) => String(paraTrilha(atual[campo])) !== String(paraTrilha(novo))),
  );

  if (Object.keys(diferentes).length === 0) {
    throw new ConflictError('Nenhum valor foi alterado.');
  }

  const atualizado = await (delegate(recurso) as { update: (a: unknown) => Promise<Record<string, unknown>> })
    .update({ where: { id }, data: { ...diferentes, updatedBy: ator.usuarioId } });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: config.entidade,
    entidadeId: id,
    acao: 'EDITAR',
    valorAnterior: Object.fromEntries(Object.keys(diferentes).map((c) => [c, paraTrilha(atual[c])])),
    valorNovo: Object.fromEntries(Object.entries(diferentes).map(([c, v]) => [c, paraTrilha(v)])),
    severidade: 'ALERTA',
  });

  return atualizado;
}

/**
 * Inativa com motivo. Recusa quando o registro esta em uso - inativar um veiculo
 * com checklist aberto, ou um almoxarifado com saldo, deixaria o sistema incoerente.
 */
export async function inativar(ator: Ator, recurso: RecursoCadastro, id: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da inativacao para prosseguir.');

  const config = CONFIG[recurso];
  const atual = await buscar(ator, recurso, id);

  if (atual.inativadoEm) throw new ConflictError('Este registro ja esta inativo.');

  const impedimento = await config.emUso?.(id);
  if (impedimento) throw new ConflictError(`${impedimento} Regularize antes de inativar.`);

  const inativado = await (delegate(recurso) as { update: (a: unknown) => Promise<Record<string, unknown>> })
    .update({
      where: { id },
      data: {
        ...config.inativo,
        inativadoEm: new Date(),
        inativadoPor: ator.usuarioId,
        motivoInativacao: texto,
      },
    });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: config.entidade,
    entidadeId: id,
    acao: 'INATIVAR',
    valorAnterior: Object.fromEntries(Object.keys(config.inativo).map((c) => [c, paraTrilha(atual[c])])),
    valorNovo: { ...config.inativo, motivo: texto },
    severidade: 'ALERTA',
  });

  return inativado;
}

export async function reativar(ator: Ator, recurso: RecursoCadastro, id: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da reativacao para prosseguir.');

  const config = CONFIG[recurso];
  const atual = await buscar(ator, recurso, id);

  if (!atual.inativadoEm) throw new ConflictError('Este registro ja esta ativo.');

  const reativado = await (delegate(recurso) as { update: (a: unknown) => Promise<Record<string, unknown>> })
    .update({
      where: { id },
      data: {
        ...config.ativo,
        inativadoEm: null,
        inativadoPor: null,
        // o motivo da inativacao anterior fica na trilha, nao no registro
        motivoInativacao: null,
      },
    });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: config.entidade,
    entidadeId: id,
    acao: 'REATIVAR',
    valorAnterior: { inativadoEm: paraTrilha(atual.inativadoEm), motivo: atual.motivoInativacao },
    valorNovo: { ...config.ativo, motivo: texto },
    severidade: 'ALERTA',
  });

  return reativado;
}

export const camposEditaveis = (recurso: RecursoCadastro): string[] => [...CONFIG[recurso].editaveis];
