import type { Prisma } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import type { AccessClaims } from '../../core/auth/tokens.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { filtroUnidade, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import { alertaDeHodometro, type AlertaHodometro } from '../transporte/hodometro.js';
import { registrarLeitura } from '../transporte/leitura.service.js';
import {
  avaliarEntrada,
  avaliarPermanencia,
  avaliarSaida,
  kmDaViagem,
  normalizarDocumento,
  normalizarPlaca,
  permanenciaEmMinutos,
  type ImpedimentoEntrada,
} from './regras.js';
import {
  ESTADOS_ABERTOS,
  statusInicial,
  validarTransicao,
  type StatusAcesso,
  type TipoAcesso,
} from './state-machine.js';
import { memoriaDeCalculo, montarLinha, totalizar, type AcessoParaRelatorio } from './relatorio.js';
import { emitirFichaDaLargada } from './ficha-largada.service.js';

/**
 * Portaria e controle de acesso (secao 14).
 *
 * Tudo que passa pelo portao vira registro: visitante, cliente, prestador, motorista de
 * terceiro e o caminhao da casa. O registro nao se apaga e nao muda de estado fora da
 * maquina de estados - a portaria e prova documental, nao caderno de anotacao.
 */

const requisicaoDe = (ator: Ator) => ({
  ip: ator.ip ?? null,
  userAgent: ator.userAgent ?? null,
});

/** Limite de permanencia, parametrizavel sem deploy (secao 5.5). */
export async function limitePermanenciaHoras(): Promise<number> {
  const p = await prisma.parametro.findUnique({
    where: { chave: 'portaria.limite_permanencia_horas' },
  });
  return Number(p?.valor ?? 12);
}

// ------------------------------------------------------------------ pessoas externas

export interface NovaPessoaExterna {
  unidadeId?: string | null;
  nome: string;
  documento: string;
  tipo: 'VISITANTE' | 'MOTORISTA_EXTERNO' | 'CLIENTE' | 'FORNECEDOR' | 'PRESTADOR';
  empresa?: string | null;
  telefone?: string | null;
  cnhNumero?: string | null;
  cnhVencimento?: Date | null;
  observacao?: string | null;
}

/**
 * Cadastro de quem vem de fora. O documento e a chave: na segunda visita, a guarita
 * acha a pessoa em vez de criar outra ficha - e o historico dela nao se parte em duas.
 */
export async function cadastrarPessoaExterna(ator: Ator, entrada: NovaPessoaExterna) {
  const documento = normalizarDocumento(entrada.documento);
  if (documento.length < 3) throw new ValidationError('Informe o documento de identificacao.');

  const existente = await prisma.pessoaExterna.findUnique({
    where: { documento },
  });
  if (existente) {
    throw new ConflictError(
      `Documento ja cadastrado para ${existente.nome}. Use o cadastro existente em vez de criar outro.`,
    );
  }

  const pessoa = await prisma.pessoaExterna.create({
    data: {
      id: novoId(),
      unidadeId: entrada.unidadeId ?? null,
      nome: entrada.nome.trim(),
      documento,
      tipo: entrada.tipo,
      empresa: entrada.empresa?.trim() ?? null,
      telefone: entrada.telefone?.trim() ?? null,
      cnhNumero: entrada.cnhNumero?.trim() ?? null,
      cnhVencimento: entrada.cnhVencimento ?? null,
      observacao: entrada.observacao?.trim() ?? null,
      createdBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pessoas_externas',
    entidadeId: pessoa.id,
    acao: 'CADASTRAR',
    valorNovo: {
      nome: pessoa.nome,
      documento: pessoa.documento,
      tipo: pessoa.tipo,
    },
  });

  return pessoa;
}

/**
 * Lista restritiva (secao 14.3). Bloqueio e ato administrativo com motivo e autor -
 * a guarita cumpre, nao decide, e por isso o desbloqueio tambem passa por aqui.
 */
export async function bloquearPessoa(ator: Ator, pessoaId: string, motivo: string) {
  if (motivo.trim().length < 5) throw new ValidationError('Descreva o motivo do bloqueio.');

  const pessoa = await prisma.pessoaExterna.findFirst({
    where: { id: pessoaId, deletedAt: null },
  });
  if (!pessoa) throw new NotFoundError('Pessoa externa');

  const atualizada = await db.pessoaExterna.update({
    where: { id: pessoaId },
    data: {
      bloqueado: true,
      motivoBloqueio: motivo.trim(),
      bloqueadoEm: new Date(),
      bloqueadoPor: ator.usuarioId,
      updatedBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pessoas_externas',
    entidadeId: pessoaId,
    acao: 'BLOQUEAR',
    valorAnterior: { bloqueado: pessoa.bloqueado },
    valorNovo: { bloqueado: true, motivo: motivo.trim() },
  });

  return atualizada;
}

export async function desbloquearPessoa(ator: Ator, pessoaId: string, motivo: string) {
  if (motivo.trim().length < 5) throw new ValidationError('Descreva o motivo do desbloqueio.');

  const pessoa = await prisma.pessoaExterna.findFirst({
    where: { id: pessoaId, deletedAt: null },
  });
  if (!pessoa) throw new NotFoundError('Pessoa externa');

  const atualizada = await db.pessoaExterna.update({
    where: { id: pessoaId },
    data: {
      bloqueado: false,
      motivoBloqueio: null,
      bloqueadoEm: null,
      bloqueadoPor: null,
      updatedBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pessoas_externas',
    entidadeId: pessoaId,
    acao: 'DESBLOQUEAR',
    valorAnterior: { bloqueado: true, motivo: pessoa.motivoBloqueio },
    valorNovo: { bloqueado: false, motivo: motivo.trim() },
  });

  return atualizada;
}

// ------------------------------------------------------------------ acesso

export interface NovoAcesso {
  unidadeId: string;
  pontoAcessoId: string;
  tipo: TipoAcesso;
  pessoaExternaId?: string | null;
  motoristaId?: string | null;
  veiculoId?: string | null;
  placaExterna?: string | null;
  transportadora?: string | null;
  destino?: string | null;
  responsavelId?: string | null;
  motivo: string;
  /** visita marcada: nasce AGENDADO e so entra quando a guarita confirmar */
  previstoPara?: Date | null;
  cracha?: string | null;
  /** rota do roteiro comercial que o caminhao da casa vai cumprir (secao 14.2) */
  rotaId?: string | null;
  notaFiscal?: string | null;
  cargaDescricao?: string | null;
  hodometroSaida?: string | null;
  observacao?: string | null;
  /** liberacao consciente de impedimento liberavel (CNH vencida), com quem autorizou */
  autorizadoPorId?: string | null;
  justificativaLiberacao?: string | null;
}

/** Acessos ainda abertos da mesma pessoa, placa ou veiculo - o que impede duplicar registro. */
async function acessoAbertoDe(entrada: {
  pessoaExternaId?: string | null;
  veiculoId?: string | null;
  placaExterna?: string | null;
}) {
  const alvos: Prisma.AcessoPortariaWhereInput[] = [];
  if (entrada.pessoaExternaId) alvos.push({ pessoaExternaId: entrada.pessoaExternaId });
  if (entrada.veiculoId) alvos.push({ veiculoId: entrada.veiculoId });
  if (entrada.placaExterna) alvos.push({ placaExterna: entrada.placaExterna });
  if (alvos.length === 0) return null;

  return prisma.acessoPortaria.findFirst({
    where: {
      deletedAt: null,
      status: { in: [...ESTADOS_ABERTOS] as StatusAcesso[] },
      OR: alvos,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Registra o movimento no portao.
 *
 * Externo entra e fica NO_PATIO; caminhao da casa sai e fica EM_TRANSITO. Impedimento
 * nao liberavel (lista restritiva, acesso duplicado) e 409 com a razao dita por extenso;
 * impedimento liberavel passa se houver autorizacao e justificativa registradas.
 */
export async function registrarAcesso(ator: Ator, entrada: NovoAcesso) {
  const placaExterna = entrada.placaExterna ? normalizarPlaca(entrada.placaExterna) : null;

  const pessoa = entrada.pessoaExternaId
    ? await prisma.pessoaExterna.findFirst({
        where: { id: entrada.pessoaExternaId, deletedAt: null },
      })
    : null;
  if (entrada.pessoaExternaId && !pessoa) throw new NotFoundError('Pessoa externa');

  if (entrada.tipo === 'VEICULO_PROPRIO' && !entrada.veiculoId) {
    throw new ValidationError('Informe o veiculo da frota para registrar a saida.');
  }
  if (entrada.tipo === 'VEICULO_EXTERNO' && !placaExterna) {
    throw new ValidationError('Informe a placa do veiculo de terceiro.');
  }
  // rota vem do cadastro: a guarita escolhe, e rota inativa nao serve para saida nova
  if (entrada.rotaId) {
    const rota = await prisma.rota.findFirst({
      where: {
        id: entrada.rotaId,
        unidadeId: entrada.unidadeId,
        deletedAt: null,
      },
    });
    if (!rota) throw new NotFoundError('Rota');
    if (!rota.ativo) throw new ValidationError(`A rota ${rota.nome} esta inativa e nao aceita saida nova.`);
  }

  const aberto = await acessoAbertoDe({ ...entrada, placaExterna });

  const impedimentos = avaliarEntrada({
    tipo: entrada.tipo,
    pessoa: pessoa
      ? {
          nome: pessoa.nome,
          documento: pessoa.documento,
          bloqueado: pessoa.bloqueado,
          motivoBloqueio: pessoa.motivoBloqueio,
          cnhVencimento: pessoa.cnhVencimento,
        }
      : null,
    jaTemAcessoAberto: aberto !== null,
    motivo: entrada.motivo,
    aoVolante: entrada.tipo !== 'PESSOA',
    agora: new Date(),
  });

  garantirEntradaLiberada(impedimentos, entrada);

  const agendado = entrada.previstoPara != null;
  const status = statusInicial(entrada.tipo, agendado);
  const agora = new Date();
  // o portao registra o evento que aconteceu: externo entrou, caminhao da casa saiu
  const entradaEm = agendado ? null : entrada.tipo === 'VEICULO_PROPRIO' ? null : agora;
  const saidaEm = agendado ? null : entrada.tipo === 'VEICULO_PROPRIO' ? agora : null;

  const acesso = await prisma.acessoPortaria.create({
    data: {
      id: novoId(),
      unidadeId: entrada.unidadeId,
      pontoAcessoId: entrada.pontoAcessoId,
      tipo: entrada.tipo,
      status,
      pessoaExternaId: entrada.pessoaExternaId ?? null,
      motoristaId: entrada.motoristaId ?? null,
      veiculoId: entrada.veiculoId ?? null,
      placaExterna,
      transportadora: entrada.transportadora?.trim() ?? null,
      destino: entrada.destino?.trim() ?? null,
      responsavelId: entrada.responsavelId ?? null,
      autorizadoPorId: entrada.autorizadoPorId ?? null,
      motivo: entrada.motivo.trim(),
      previstoPara: entrada.previstoPara ?? null,
      entradaEm,
      saidaEm,
      cracha: entrada.cracha?.trim() ?? null,
      rotaId: entrada.rotaId ?? null,
      notaFiscal: entrada.notaFiscal?.trim() ?? null,
      cargaDescricao: entrada.cargaDescricao?.trim() ?? null,
      hodometroSaida: entrada.hodometroSaida ? paraBanco(entrada.hodometroSaida) : null,
      observacaoEntrada: entrada.observacao?.trim() ?? null,
      registradoEntradaPor: ator.usuarioId,
      createdBy: ator.usuarioId,
    },
    include: {
      pessoaExterna: true,
      veiculo: true,
      motorista: true,
      pontoAcesso: true,
      rota: true,
    },
  });

  await prisma.acessoTransicao.create({
    data: {
      id: novoId(),
      acessoId: acesso.id,
      de: status,
      para: status,
      motivo: entrada.justificativaLiberacao?.trim() ?? null,
      usuarioId: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'acessos_portaria',
    entidadeId: acesso.id,
    acao: 'REGISTRAR_ACESSO',
    valorNovo: {
      tipo: acesso.tipo,
      status: acesso.status,
      pessoa: acesso.pessoaExterna?.nome ?? null,
      placa: acesso.placaExterna ?? acesso.veiculo?.placa ?? null,
      rota: acesso.rota?.nome ?? null,
      hodometroSaida: acesso.hodometroSaida?.toString() ?? null,
      liberacao: entrada.justificativaLiberacao?.trim() ?? null,
    },
  });

  // a leitura do painel na guarita acerta o cadastro do veiculo - ou avisa que nao fecha
  const alertasHodometro = await conferirHodometro(ator, {
    veiculoId: acesso.veiculoId,
    informado: entrada.hodometroSaida,
    origem: 'saida na portaria',
    acesso,
  });

  /*
   * A largada vira documento (secao 14.7). Emitida aqui, depois da ocorrencia de
   * hodometro, para que a ficha ja saia com o que foi apontado na saida impresso nela.
   *
   * A emissao nunca derruba o registro: o caminhao ja passou pelo portao, e storage fora
   * do ar nao apaga o evento. O que falhar volta em `fichaLargada.avisos`.
   */
  const fichaLargada =
    acesso.tipo === 'VEICULO_PROPRIO' ? await emitirFichaDaLargada(ator, acesso.id) : null;

  return { ...acesso, alertasHodometro, fichaLargada };
}

/**
 * Confronta a leitura do portao com o cadastro do veiculo (secao 7.1 e 14.2).
 *
 * O cadastro do veiculo e a fonte da quilometragem: a guarita le dele e escreve nele.
 * Leitura menor que a registrada **nao passa calada** — vira ocorrencia da portaria, que
 * e onde a supervisao ja olha, e o cadastro fica com o valor maior. Leitura que avanca
 * atualiza o veiculo na hora, para o proximo checklist ja comparar contra o valor certo.
 */
async function conferirHodometro(
  ator: Ator,
  contexto: {
    veiculoId: string | null;
    informado: string | null | undefined;
    origem: 'saida na portaria' | 'retorno na portaria';
    acesso: { id: string; unidadeId: string; pontoAcessoId: string };
  },
): Promise<AlertaHodometro[]> {
  if (!contexto.veiculoId || !contexto.informado) return [];

  const veiculo = await prisma.veiculo.findFirst({
    where: { id: contexto.veiculoId, deletedAt: null },
    select: { id: true, placa: true, hodometroAtual: true },
  });
  if (!veiculo) return [];

  const registrado = veiculo.hodometroAtual.toString();
  const alerta = alertaDeHodometro({
    registrado,
    informado: contexto.informado,
    origem: contexto.origem,
    placa: veiculo.placa,
  });

  if (alerta) {
    await abrirOcorrencia(ator, {
      unidadeId: contexto.acesso.unidadeId,
      pontoAcessoId: contexto.acesso.pontoAcessoId,
      acessoId: contexto.acesso.id,
      gravidade: 'MEDIA',
      descricao: alerta.mensagem,
      ocorridoEm: new Date(),
    });
  }

  // a leitura da guarita entra no historico de medidor e so avanca o cadastro (ADR 0023)
  await registrarLeitura(ator, {
    unidadeId: contexto.acesso.unidadeId,
    tipo: 'ODOMETRO',
    valor: contexto.informado,
    origem: 'PORTARIA',
    veiculoId: veiculo.id,
    acessoPortariaId: contexto.acesso.id,
  });

  return alerta ? [alerta] : [];
}

/** Impedimento nao liberavel barra sempre; o liberavel exige autorizacao e justificativa. */
function garantirEntradaLiberada(impedimentos: ImpedimentoEntrada[], entrada: NovoAcesso): void {
  if (impedimentos.length === 0) return;

  const duros = impedimentos.filter((i) => !i.liberavel);
  if (duros.length > 0) throw new ConflictError(duros.map((i) => i.mensagem).join(' '));

  const justificada = (entrada.justificativaLiberacao?.trim().length ?? 0) >= 5 && Boolean(entrada.autorizadoPorId);
  if (!justificada) {
    throw new ConflictError(
      `${impedimentos.map((i) => i.mensagem).join(' ')} ` +
        'Para liberar assim mesmo, informe quem autorizou e a justificativa.',
    );
  }
}

export interface SaidaDoAcesso {
  crachaDevolvido?: boolean;
  hodometroRetorno?: string | null;
  observacao?: string | null;
  /** cracha nao devolvido so libera a saida com ocorrencia aberta */
  abrirOcorrencia?: boolean;
}

/**
 * Fecha o acesso: saida do externo, retorno do caminhao da casa.
 * Pendencia (cracha, hodometro) barra o fechamento - ou vira ocorrencia registrada.
 */
export async function registrarSaida(ator: Ator, acessoId: string, entrada: SaidaDoAcesso = {}) {
  const acesso = await prisma.acessoPortaria.findFirst({
    where: { id: acessoId, deletedAt: null },
    include: { pessoaExterna: true, veiculo: true },
  });
  if (!acesso) throw new NotFoundError('Acesso');

  const abertoEm = acesso.tipo === 'VEICULO_PROPRIO' ? acesso.saidaEm : acesso.entradaEm;
  const crachaDevolvido = entrada.crachaDevolvido ?? false;

  const pendencias = avaliarSaida({
    tipo: acesso.tipo,
    cracha: acesso.cracha,
    crachaDevolvido,
    hodometroSaida: acesso.hodometroSaida?.toString() ?? null,
    hodometroRetorno: entrada.hodometroRetorno ?? null,
    abertoEm,
  });

  const bloqueantes = pendencias.filter((p) => p.codigo !== 'CRACHA_NAO_DEVOLVIDO' || !entrada.abrirOcorrencia);
  if (bloqueantes.length > 0) throw new ConflictError(bloqueantes.map((p) => p.mensagem).join(' '));

  validarTransicao(acesso.status as StatusAcesso, 'ENCERRADO');

  const agora = new Date();
  const atualizado = await db.acessoPortaria.update({
    where: { id: acessoId },
    data: {
      status: 'ENCERRADO',
      // o evento que faltava: externo saiu, caminhao da casa voltou
      ...(acesso.tipo === 'VEICULO_PROPRIO' ? { entradaEm: agora } : { saidaEm: agora }),
      crachaDevolvido,
      hodometroRetorno: entrada.hodometroRetorno ? paraBanco(entrada.hodometroRetorno) : null,
      observacaoSaida: entrada.observacao?.trim() ?? null,
      registradoSaidaPor: ator.usuarioId,
      updatedBy: ator.usuarioId,
    },
  });

  await prisma.acessoTransicao.create({
    data: {
      id: novoId(),
      acessoId,
      de: acesso.status,
      para: 'ENCERRADO',
      motivo: entrada.observacao?.trim() ?? null,
      usuarioId: ator.usuarioId,
    },
  });

  /*
   * O hodometro do retorno acerta o cadastro do veiculo - mas so para frente. Antes o
   * retorno gravava a leitura como estava: um digito a menos baixava a quilometragem do
   * caminhao e levava junto consumo, CPK e plano de manutencao, sem ninguem saber.
   */
  const alertasHodometro =
    acesso.tipo === 'VEICULO_PROPRIO'
      ? await conferirHodometro(ator, {
          veiculoId: acesso.veiculoId,
          informado: entrada.hodometroRetorno,
          origem: 'retorno na portaria',
          acesso,
        })
      : [];

  if (pendencias.some((p) => p.codigo === 'CRACHA_NAO_DEVOLVIDO')) {
    await abrirOcorrencia(ator, {
      unidadeId: acesso.unidadeId,
      pontoAcessoId: acesso.pontoAcessoId,
      acessoId,
      gravidade: 'MEDIA',
      descricao: `Cracha ${acesso.cracha} nao devolvido na saida de ${acesso.pessoaExterna?.nome ?? 'acesso ' + acesso.id}.`,
      ocorridoEm: agora,
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'acessos_portaria',
    entidadeId: acessoId,
    acao: 'REGISTRAR_SAIDA',
    valorAnterior: { status: acesso.status },
    valorNovo: {
      status: 'ENCERRADO',
      crachaDevolvido,
      km: kmDaViagem(acesso.hodometroSaida?.toString() ?? null, entrada.hodometroRetorno ?? null)?.toString() ?? null,
    },
  });

  return { ...atualizado, alertasHodometro };
}

/** Confirma a chegada de uma visita agendada: AGENDADO -> NO_PATIO. */
export async function confirmarChegada(ator: Ator, acessoId: string, dados: { cracha?: string | null } = {}) {
  const acesso = await prisma.acessoPortaria.findFirst({
    where: { id: acessoId, deletedAt: null },
  });
  if (!acesso) throw new NotFoundError('Acesso');

  validarTransicao(acesso.status as StatusAcesso, 'NO_PATIO');

  const atualizado = await db.acessoPortaria.update({
    where: { id: acessoId },
    data: {
      status: 'NO_PATIO',
      entradaEm: new Date(),
      cracha: dados.cracha?.trim() ?? acesso.cracha,
      registradoEntradaPor: ator.usuarioId,
      updatedBy: ator.usuarioId,
    },
  });

  await prisma.acessoTransicao.create({
    data: {
      id: novoId(),
      acessoId,
      de: acesso.status,
      para: 'NO_PATIO',
      motivo: null,
      usuarioId: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'acessos_portaria',
    entidadeId: acessoId,
    acao: 'CONFIRMAR_CHEGADA',
    valorAnterior: { status: acesso.status },
    valorNovo: { status: 'NO_PATIO' },
  });

  return atualizado;
}

/** Recusa ou cancelamento da visita agendada. Ambos exigem motivo (maquina de estados). */
export async function encerrarSemEntrada(ator: Ator, acessoId: string, para: 'CANCELADO' | 'RECUSADO', motivo: string) {
  const acesso = await prisma.acessoPortaria.findFirst({
    where: { id: acessoId, deletedAt: null },
  });
  if (!acesso) throw new NotFoundError('Acesso');

  const transicao = validarTransicao(acesso.status as StatusAcesso, para, motivo);

  const atualizado = await db.acessoPortaria.update({
    where: { id: acessoId },
    data: {
      status: para,
      motivoEncerramento: transicao.motivo,
      updatedBy: ator.usuarioId,
    },
  });

  await prisma.acessoTransicao.create({
    data: {
      id: novoId(),
      acessoId,
      de: acesso.status,
      para,
      motivo: transicao.motivo,
      usuarioId: ator.usuarioId,
    },
  });

  // recusa e evento de seguranca: nasce como ocorrencia, nao como observacao solta
  if (para === 'RECUSADO') {
    await abrirOcorrencia(ator, {
      unidadeId: acesso.unidadeId,
      pontoAcessoId: acesso.pontoAcessoId,
      acessoId,
      gravidade: 'MEDIA',
      descricao: `Entrada recusada: ${transicao.motivo}`,
      ocorridoEm: new Date(),
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'acessos_portaria',
    entidadeId: acessoId,
    acao: para === 'RECUSADO' ? 'RECUSAR' : 'CANCELAR',
    valorAnterior: { status: acesso.status },
    valorNovo: { status: para, motivo: transicao.motivo },
  });

  return atualizado;
}

// ------------------------------------------------------------------ patio e consultas

export interface FiltrosDoPatio {
  unidadeId?: string | null;
  pontoAcessoId?: string | null;
}

/**
 * Quem esta dentro agora e quais caminhoes estao na rua (secao 14.3).
 *
 * E a tela que a guarita deixa aberta o dia inteiro: em emergencia, ela responde
 * quantas pessoas ha no site e quem sao.
 */
export async function patioAgora(claims: AccessClaims, filtros: FiltrosDoPatio = {}) {
  const [abertos, limiteHoras] = await Promise.all([
    prisma.acessoPortaria.findMany({
      where: {
        deletedAt: null,
        status: { in: ['NO_PATIO', 'EM_TRANSITO', 'AGENDADO'] },
        ...filtroUnidade(claims, filtros.unidadeId),
        ...(filtros.pontoAcessoId ? { pontoAcessoId: filtros.pontoAcessoId } : {}),
      },
      include: {
        pessoaExterna: {
          select: {
            id: true,
            nome: true,
            tipo: true,
            empresa: true,
            documento: true,
          },
        },
        veiculo: { select: { id: true, placa: true, frotaNumero: true } },
        motorista: { select: { id: true, nome: true } },
        pontoAcesso: { select: { id: true, codigo: true, nome: true } },
        responsavel: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    limitePermanenciaHoras(),
  ]);

  const agora = new Date();

  const itens = abertos.map((a) => {
    const abertoEm = a.tipo === 'VEICULO_PROPRIO' ? a.saidaEm : a.entradaEm;
    const minutos = permanenciaEmMinutos(abertoEm, null, agora);
    const permanencia = avaliarPermanencia(minutos, limiteHoras);
    return {
      id: a.id,
      tipo: a.tipo,
      status: a.status,
      quem: a.pessoaExterna?.nome ?? a.motorista?.nome ?? a.transportadora ?? 'nao identificado',
      documento: a.pessoaExterna?.documento ?? null,
      tipoPessoa: a.pessoaExterna?.tipo ?? null,
      empresa: a.pessoaExterna?.empresa ?? a.transportadora ?? null,
      placa: a.veiculo?.placa ?? a.placaExterna,
      frotaNumero: a.veiculo?.frotaNumero ?? null,
      ponto: a.pontoAcesso,
      destino: a.destino,
      responsavel: a.responsavel,
      motivo: a.motivo,
      cracha: a.cracha,
      previstoPara: a.previstoPara,
      abertoEm,
      minutos,
      permanencia: permanencia.estado,
      percentualDoLimite: permanencia.percentual,
    };
  });

  return {
    limitePermanenciaHoras: limiteHoras,
    resumo: {
      pessoasNoPatio: itens.filter((i) => i.status === 'NO_PATIO').length,
      veiculosNoPatio: itens.filter((i) => i.status === 'NO_PATIO' && i.placa !== null).length,
      caminhoesEmTransito: itens.filter((i) => i.status === 'EM_TRANSITO').length,
      agendadosPendentes: itens.filter((i) => i.status === 'AGENDADO').length,
      permanenciaExcedida: itens.filter((i) => i.permanencia === 'EXCEDIDA').length,
    },
    itens,
  };
}

export interface FiltrosDeAcesso {
  unidadeId?: string | null;
  status?: StatusAcesso | null;
  tipo?: TipoAcesso | null;
  pontoAcessoId?: string | null;
  de?: Date | null;
  ate?: Date | null;
  busca?: string | null;
  cursor?: string | null;
  limite: number;
}

/** Historico do portao, com paginacao por cursor e filtros no servidor (secao 13). */
export async function listarAcessos(claims: AccessClaims, filtros: FiltrosDeAcesso) {
  const busca = filtros.busca?.trim();

  const itens = await prisma.acessoPortaria.findMany({
    where: {
      deletedAt: null,
      ...filtroUnidade(claims, filtros.unidadeId),
      ...(filtros.status ? { status: filtros.status } : {}),
      ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
      ...(filtros.pontoAcessoId ? { pontoAcessoId: filtros.pontoAcessoId } : {}),
      ...(filtros.de || filtros.ate
        ? {
            createdAt: {
              ...(filtros.de ? { gte: filtros.de } : {}),
              ...(filtros.ate ? { lte: filtros.ate } : {}),
            },
          }
        : {}),
      ...(busca
        ? {
            OR: [
              {
                pessoaExterna: {
                  nome: { contains: busca, mode: 'insensitive' },
                },
              },
              {
                pessoaExterna: {
                  documento: { contains: normalizarDocumento(busca) },
                },
              },
              {
                placaExterna: {
                  contains: busca.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                },
              },
              { veiculo: { placa: { contains: busca.toUpperCase() } } },
              { transportadora: { contains: busca, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      pessoaExterna: {
        select: { id: true, nome: true, tipo: true, empresa: true },
      },
      veiculo: { select: { id: true, placa: true, frotaNumero: true } },
      motorista: { select: { id: true, nome: true } },
      pontoAcesso: { select: { id: true, codigo: true, nome: true } },
      rota: { select: { id: true, codigo: true, nome: true } },
    },
    orderBy: { id: 'desc' },
    take: filtros.limite + 1,
    ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
  });

  const temProxima = itens.length > filtros.limite;
  const pagina = temProxima ? itens.slice(0, filtros.limite) : itens;
  const agora = new Date();

  return {
    itens: pagina.map((a) => {
      const abertoEm = a.tipo === 'VEICULO_PROPRIO' ? a.saidaEm : a.entradaEm;
      const fechadoEm = a.tipo === 'VEICULO_PROPRIO' ? a.entradaEm : a.saidaEm;
      return {
        ...a,
        permanenciaMinutos: permanenciaEmMinutos(abertoEm, a.status === 'ENCERRADO' ? fechadoEm : null, agora),
        kmViagem:
          kmDaViagem(a.hodometroSaida?.toString() ?? null, a.hodometroRetorno?.toString() ?? null)?.toString() ?? null,
      };
    }),
    proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

/** Ficha do acesso com a trilha completa - o que a auditoria pede quando algo deu errado. */
export async function historicoDoAcesso(claims: AccessClaims, acessoId: string) {
  const acesso = await prisma.acessoPortaria.findFirst({
    where: { id: acessoId, deletedAt: null, ...filtroUnidade(claims) },
    include: {
      pessoaExterna: true,
      veiculo: { select: { id: true, placa: true, frotaNumero: true } },
      motorista: { select: { id: true, nome: true } },
      pontoAcesso: true,
      rota: { select: { id: true, codigo: true, nome: true } },
      responsavel: { select: { id: true, nome: true } },
      autorizadoPor: { select: { id: true, nome: true } },
      transicoes: { orderBy: { createdAt: 'asc' } },
      ocorrencias: { orderBy: { ocorridoEm: 'desc' } },
    },
  });
  if (!acesso) throw new NotFoundError('Acesso');

  const abertoEm = acesso.tipo === 'VEICULO_PROPRIO' ? acesso.saidaEm : acesso.entradaEm;
  const fechadoEm = acesso.tipo === 'VEICULO_PROPRIO' ? acesso.entradaEm : acesso.saidaEm;

  return {
    ...acesso,
    permanenciaMinutos: permanenciaEmMinutos(abertoEm, fechadoEm, new Date()),
    kmViagem:
      kmDaViagem(acesso.hodometroSaida?.toString() ?? null, acesso.hodometroRetorno?.toString() ?? null)?.toString() ??
      null,
  };
}

// ------------------------------------------------------------------ ocorrencias

export interface NovaOcorrencia {
  unidadeId: string;
  pontoAcessoId?: string | null;
  acessoId?: string | null;
  gravidade: 'BAIXA' | 'MEDIA' | 'ALTA';
  descricao: string;
  ocorridoEm?: Date;
  anexoId?: string | null;
}

/** Ocorrencia da guarita. Gravidade ALTA notifica quem responde por seguranca na hora. */
export async function abrirOcorrencia(ator: Ator, entrada: NovaOcorrencia) {
  if (entrada.descricao.trim().length < 5) throw new ValidationError('Descreva a ocorrencia.');

  const ocorrencia = await prisma.ocorrenciaPortaria.create({
    data: {
      id: novoId(),
      unidadeId: entrada.unidadeId,
      pontoAcessoId: entrada.pontoAcessoId ?? null,
      acessoId: entrada.acessoId ?? null,
      gravidade: entrada.gravidade,
      descricao: entrada.descricao.trim(),
      ocorridoEm: entrada.ocorridoEm ?? new Date(),
      anexoId: entrada.anexoId ?? null,
      registradoPor: ator.usuarioId,
    },
  });

  if (entrada.gravidade === 'ALTA') {
    await notificarPorPermissao('portaria:consultar', {
      titulo: 'Ocorrencia grave na portaria',
      corpo: ocorrencia.descricao,
      entidade: 'ocorrencias_portaria',
      entidadeId: ocorrencia.id,
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ocorrencias_portaria',
    entidadeId: ocorrencia.id,
    acao: 'ABRIR_OCORRENCIA',
    valorNovo: {
      gravidade: ocorrencia.gravidade,
      acessoId: ocorrencia.acessoId,
    },
  });

  return ocorrencia;
}

export async function listarOcorrencias(
  claims: AccessClaims,
  filtros: {
    unidadeId?: string | null;
    gravidade?: 'BAIXA' | 'MEDIA' | 'ALTA' | null;
    limite: number;
    cursor?: string | null;
  },
) {
  const itens = await prisma.ocorrenciaPortaria.findMany({
    where: {
      ...filtroUnidade(claims, filtros.unidadeId),
      ...(filtros.gravidade ? { gravidade: filtros.gravidade } : {}),
    },
    include: {
      pontoAcesso: { select: { codigo: true, nome: true } },
      acesso: {
        select: {
          id: true,
          motivo: true,
          pessoaExterna: { select: { nome: true } },
        },
      },
    },
    orderBy: { id: 'desc' },
    take: filtros.limite + 1,
    ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
  });

  const temProxima = itens.length > filtros.limite;
  const pagina = temProxima ? itens.slice(0, filtros.limite) : itens;
  return {
    itens: pagina,
    proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

// ------------------------------------------------------------------ indicadores

/**
 * Indicadores do portao na janela pedida (secao 14.5): movimento por tipo, permanencia
 * media dos encerrados, ocorrencias por gravidade e o que ficou aberto tempo demais.
 */
export async function indicadores(claims: AccessClaims, filtros: { unidadeId?: string | null; dias: number }) {
  const desde = new Date();
  desde.setDate(desde.getDate() - filtros.dias);

  const escopo = { ...filtroUnidade(claims, filtros.unidadeId) };

  const [acessos, ocorrencias, limiteHoras] = await Promise.all([
    prisma.acessoPortaria.findMany({
      where: { deletedAt: null, ...escopo, createdAt: { gte: desde } },
      select: {
        tipo: true,
        status: true,
        entradaEm: true,
        saidaEm: true,
        pessoaExterna: { select: { tipo: true } },
      },
    }),
    prisma.ocorrenciaPortaria.groupBy({
      by: ['gravidade'],
      where: { ...escopo, ocorridoEm: { gte: desde } },
      _count: true,
    }),
    limitePermanenciaHoras(),
  ]);

  const agora = new Date();
  const encerrados = acessos.filter((a) => a.status === 'ENCERRADO');
  const duracoes = encerrados
    .map((a) => {
      const abertoEm = a.tipo === 'VEICULO_PROPRIO' ? a.saidaEm : a.entradaEm;
      const fechadoEm = a.tipo === 'VEICULO_PROPRIO' ? a.entradaEm : a.saidaEm;
      return permanenciaEmMinutos(abertoEm, fechadoEm, agora);
    })
    .filter((m): m is number => m !== null);

  const porTipoPessoa = new Map<string, number>();
  for (const a of acessos) {
    const chave = a.pessoaExterna?.tipo ?? (a.tipo === 'VEICULO_PROPRIO' ? 'FROTA_PROPRIA' : 'NAO_IDENTIFICADO');
    porTipoPessoa.set(chave, (porTipoPessoa.get(chave) ?? 0) + 1);
  }

  return {
    janela: { dias: filtros.dias, desde },
    total: acessos.length,
    porTipo: {
      PESSOA: acessos.filter((a) => a.tipo === 'PESSOA').length,
      VEICULO_EXTERNO: acessos.filter((a) => a.tipo === 'VEICULO_EXTERNO').length,
      VEICULO_PROPRIO: acessos.filter((a) => a.tipo === 'VEICULO_PROPRIO').length,
    },
    porTipoPessoa: [...porTipoPessoa.entries()].map(([tipo, total]) => ({
      tipo,
      total,
    })),
    aindaAbertos: acessos.filter((a) => ESTADOS_ABERTOS.has(a.status as StatusAcesso)).length,
    recusados: acessos.filter((a) => a.status === 'RECUSADO').length,
    permanenciaMediaMinutos:
      duracoes.length > 0 ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : null,
    ocorrencias: ocorrencias.map((o) => ({
      gravidade: o.gravidade,
      total: o._count,
    })),
    limitePermanenciaHoras: limiteHoras,
    memoriaDeCalculo: {
      permanencia: 'Media dos acessos encerrados na janela, do evento de abertura ao de fechamento.',
      transito: 'Caminhao proprio conta do momento da saida ate o retorno registrado.',
      janela: `Considera acessos criados nos ultimos ${filtros.dias} dias.`,
    },
  };
}

export interface FiltrosDoRelatorio {
  unidadeId?: string | null;
  pontoAcessoId?: string | null;
  veiculoId?: string | null;
  rotaId?: string | null;
  motoristaId?: string | null;
  /** 'FROTA' so o caminhao da casa, 'TERCEIRO' so visitante motorizado. */
  frota?: 'FROTA' | 'TERCEIRO' | null;
  de: Date;
  ate: Date;
}

/** Teto de linhas do relatorio. Acima disso o periodo precisa ser fatiado. */
export const TETO_DO_RELATORIO = 5000;

/**
 * Relatorio de movimento de veiculos por periodo (secao 14.5).
 *
 * So veiculo: pessoa a pe tem o proprio historico e polui o relatorio de frota.
 * A consulta e recortada por periodo e limitada — relatorio nao varre a tabela
 * inteira em request sincrono (secao 13). Passando do teto, a resposta diz que
 * truncou em vez de entregar numero pela metade como se fosse o total.
 */
export async function relatorioDeMovimentos(claims: AccessClaims, filtros: FiltrosDoRelatorio) {
  if (filtros.ate < filtros.de) {
    throw new ValidationError('A data final do periodo e anterior a inicial.');
  }

  const tipos: TipoAcesso[] =
    filtros.frota === 'FROTA'
      ? ['VEICULO_PROPRIO']
      : filtros.frota === 'TERCEIRO'
        ? ['VEICULO_EXTERNO']
        : ['VEICULO_PROPRIO', 'VEICULO_EXTERNO'];

  const [acessos, limiteHoras] = await Promise.all([
    prisma.acessoPortaria.findMany({
      where: {
        deletedAt: null,
        tipo: { in: tipos },
        ...filtroUnidade(claims, filtros.unidadeId),
        ...(filtros.pontoAcessoId ? { pontoAcessoId: filtros.pontoAcessoId } : {}),
        ...(filtros.veiculoId ? { veiculoId: filtros.veiculoId } : {}),
        ...(filtros.rotaId ? { rotaId: filtros.rotaId } : {}),
        ...(filtros.motoristaId ? { motoristaId: filtros.motoristaId } : {}),
        createdAt: { gte: filtros.de, lte: filtros.ate },
      },
      include: {
        veiculo: { select: { placa: true, frotaNumero: true } },
        motorista: { select: { nome: true } },
        pessoaExterna: { select: { nome: true } },
        rota: { select: { codigo: true, nome: true } },
        pontoAcesso: { select: { codigo: true, nome: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: TETO_DO_RELATORIO + 1,
    }),
    limitePermanenciaHoras(),
  ]);

  const truncado = acessos.length > TETO_DO_RELATORIO;
  const agora = new Date();
  const linhas = (truncado ? acessos.slice(0, TETO_DO_RELATORIO) : acessos).map((a) =>
    montarLinha(a as unknown as AcessoParaRelatorio, agora),
  );

  return {
    periodo: { de: filtros.de, ate: filtros.ate },
    unidades: unidadesConsultadas(claims, filtros.unidadeId),
    limitePermanenciaHoras: limiteHoras,
    truncado,
    tetoDeLinhas: TETO_DO_RELATORIO,
    totais: totalizar(linhas),
    linhas,
    memoriaDeCalculo: memoriaDeCalculo(limiteHoras),
  };
}
