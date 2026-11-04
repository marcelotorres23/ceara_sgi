import { novoId, prisma } from '../../core/db.js';
import type { AccessClaims } from '../../core/auth/tokens.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';
import { filtroUnidade, type FiltroUnidade } from '../../core/rbac/escopo.js';
import { MIMES_EVIDENCIA, salvarArquivo } from '../../core/storage/index.js';
import { despacharMensagemExterna } from '../../core/notifications/despacho.js';
import { telefoneE164 } from '../../core/notifications/entrega.js';
import type { Ator } from '../compras/service.js';
import {
  gerarFichaDeLargada,
  hodometroFormatado,
  telefoneFormatado,
  type FichaDeLargada,
} from './ficha-largada.js';

/**
 * Ficha de largada: montagem a partir do banco, guarda do documento e envio (secao 14.7).
 *
 * O layout mora em `ficha-largada.ts` e nao sabe o que e Prisma; aqui so se le, se grava
 * o anexo e se enfileira a mensagem. A separacao paga na hora de testar: a folha se
 * confere sem banco, e o envio se confere sem abrir PDF.
 */

const ENTIDADE = 'acessos_portaria';

/**
 * O `include` que a ficha precisa. Fica em um lugar so porque tres caminhos leem o mesmo
 * acesso: o download, o envio e o registro da largada.
 */
const INCLUDE_DA_FICHA = {
  unidade: { select: { nome: true, cidade: true, uf: true } },
  pontoAcesso: { select: { codigo: true, nome: true } },
  veiculo: { select: { placa: true, frotaNumero: true, marca: true, modelo: true } },
  motorista: {
    select: {
      id: true,
      nome: true,
      cpf: true,
      cnhNumero: true,
      cnhCategoria: true,
      cnhVencimento: true,
      telefone: true,
    },
  },
  rota: { select: { codigo: true, nome: true, fechamento: true, largada: true } },
  ocorrencias: { select: { gravidade: true, descricao: true }, orderBy: { createdAt: 'asc' } },
} as const;

type AcessoDaFicha = Awaited<ReturnType<typeof carregarAcesso>>;

async function carregarAcesso(acessoId: string, filtro: FiltroUnidade) {
  const acesso = await prisma.acessoPortaria.findFirst({
    where: { id: acessoId, deletedAt: null, ...filtro },
    include: INCLUDE_DA_FICHA,
  });
  if (!acesso) throw new NotFoundError('Acesso');
  return acesso;
}

/**
 * So o caminhao da casa tem largada. Pessoa a pe e veiculo de terceiro entram e saem -
 * imprimir "ficha de largada" para eles seria documento dizendo o que nao aconteceu.
 */
function garantirCaminhaoDaFrota(acesso: { tipo: string }): void {
  if (acesso.tipo !== 'VEICULO_PROPRIO') {
    throw new ValidationError('A ficha de largada existe para a saida do caminhao da frota.');
  }
}

/** Protocolo curto e o que a guarita le em voz alta; o id completo fica no rodape. */
const protocoloDe = (id: string, largadaEm: Date): string => {
  const dia = largadaEm.toISOString().slice(0, 10).replace(/-/g, '');
  return `LARGADA ${dia}-${id.slice(-6).toUpperCase()}`;
};

const nomeDoArquivo = (acesso: { id: string }, largadaEm: Date): string =>
  `ficha-largada-${largadaEm.toISOString().slice(0, 10)}-${acesso.id.slice(-6)}.pdf`;

function montarFicha(acesso: NonNullable<AcessoDaFicha>, registradoPor: string, agora: Date): FichaDeLargada {
  // a largada e o evento do portao; se por algum motivo nao houver, o registro serve de ancora
  const largadaEm = acesso.saidaEm ?? acesso.createdAt;

  return {
    protocolo: protocoloDe(acesso.id, largadaEm),
    acessoId: acesso.id,
    largadaEm,
    geradoEm: agora,
    unidade: acesso.unidade,
    guarita: acesso.pontoAcesso,
    registradoPor,
    motorista: acesso.motorista
      ? {
          nome: acesso.motorista.nome,
          cpf: acesso.motorista.cpf,
          cnhNumero: acesso.motorista.cnhNumero,
          cnhCategoria: acesso.motorista.cnhCategoria,
          cnhVencimento: acesso.motorista.cnhVencimento,
          telefone: acesso.motorista.telefone,
        }
      : null,
    veiculo: acesso.veiculo,
    rota: acesso.rota,
    hodometroSaida: acesso.hodometroSaida?.toString() ?? null,
    notaFiscal: acesso.notaFiscal,
    cargaDescricao: acesso.cargaDescricao,
    motivo: acesso.motivo,
    observacao: acesso.observacaoEntrada,
    ocorrencias: acesso.ocorrencias.map((o) => ({ gravidade: o.gravidade, descricao: o.descricao })),
  };
}

/** Nome de quem registrou a largada. Usuario apagado nao pode derrubar o documento. */
async function nomeDoRegistrador(usuarioId: string | null): Promise<string> {
  if (!usuarioId) return '—';
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } });
  return usuario?.nome ?? '—';
}

// ------------------------------------------------------------------ geracao

export interface FichaGerada {
  nome: string;
  conteudo: Buffer;
  ficha: FichaDeLargada;
}

/** Gera a ficha sem gravar nada - e o que o download usa. */
export async function fichaDoAcesso(claims: AccessClaims, acessoId: string): Promise<FichaGerada> {
  const acesso = await carregarAcesso(acessoId, filtroUnidade(claims));
  garantirCaminhaoDaFrota(acesso);

  const ficha = montarFicha(acesso, await nomeDoRegistrador(acesso.registradoEntradaPor), new Date());
  return { nome: nomeDoArquivo(acesso, ficha.largadaEm), conteudo: await gerarFichaDeLargada(ficha), ficha };
}

export interface FichaArquivada {
  anexoId: string;
  nome: string;
  chave: string;
}

/**
 * Gera a ficha e guarda como anexo do acesso.
 *
 * O documento fica arquivado porque ele **e** o comprovante: quem conferir a viagem seis
 * meses depois precisa da folha que o motorista levou, e nao de uma reimpressao com dados
 * que ja mudaram de lugar. O hash no nome da chave deduplica a reemissao identica.
 */
export async function arquivarFicha(
  ator: Ator,
  acessoId: string,
  filtro: FiltroUnidade = {},
): Promise<FichaArquivada> {
  const acesso = await carregarAcesso(acessoId, filtro);
  garantirCaminhaoDaFrota(acesso);

  const ficha = montarFicha(acesso, await nomeDoRegistrador(acesso.registradoEntradaPor), new Date());
  const conteudo = await gerarFichaDeLargada(ficha);
  const nome = nomeDoArquivo(acesso, ficha.largadaEm);

  const salvo = await salvarArquivo({
    conteudo,
    mime: 'application/pdf',
    pasta: `portaria/largadas/${ficha.largadaEm.toISOString().slice(0, 7).replace('-', '/')}`,
    nome,
    mimesAceitos: MIMES_EVIDENCIA,
  });

  const anexo = await prisma.anexo.create({
    data: {
      id: novoId(),
      entidade: ENTIDADE,
      entidadeId: acesso.id,
      nome,
      mime: 'application/pdf',
      tamanho: salvo.tamanho,
      url: salvo.url,
      hashSha256: salvo.hashSha256,
      usuarioId: ator.usuarioId,
    },
  });

  return { anexoId: anexo.id, nome, chave: salvo.chave };
}

// ------------------------------------------------------------------ envio ao motorista

export type SituacaoDoEnvio = 'ENTREGUE' | 'NA_FILA' | 'CANAL_NAO_CONFIGURADO';

export interface ResultadoDoEnvio {
  mensagemId: string;
  anexoId: string;
  situacao: SituacaoDoEnvio;
  telefone: string;
  /** motivo da ultima falha, quando a mensagem ficou na fila em vez de sair */
  detalhe: string | null;
}

/** Texto que chega no celular. Curto: o documento e o anexo, nao a mensagem. */
function corpoDaMensagem(ficha: FichaDeLargada): string {
  const linhas = [
    `Largada registrada em ${ficha.largadaEm.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`,
    '',
    `Rota: ${ficha.rota ? `${ficha.rota.codigo} — ${ficha.rota.nome}` : 'nao informada'}`,
    `Veiculo: ${ficha.veiculo?.placa ?? 'nao informado'}`,
    `Hodometro na saida: ${hodometroFormatado(ficha.hodometroSaida)}`,
  ];

  if (ficha.notaFiscal) linhas.push(`Nota fiscal: ${ficha.notaFiscal}`);
  if (ficha.cargaDescricao) linhas.push(`Carga: ${ficha.cargaDescricao}`);

  linhas.push(
    '',
    'A ficha em PDF segue anexa. Confira rota, carga e a leitura do hodometro antes de sair.',
    'Mensagem automatica da portaria; nao responda por aqui.',
  );

  return linhas.join('\n');
}

/**
 * Envia a ficha ao WhatsApp do motorista.
 *
 * Tres recusas antes de qualquer envio, porque mensagem para o numero errado e pior do
 * que mensagem nao enviada: precisa ser caminhao da frota, precisa ter motorista
 * identificado e o telefone do cadastro precisa formar um numero brasileiro valido.
 *
 * Depois disso o envio e **tentado na hora** e, se o canal falhar, a mensagem fica na
 * fila de saida com backoff (F10) - a guarita ve "na fila", nunca "enviado" otimista.
 */
export async function enviarFichaPorWhatsapp(
  ator: Ator,
  acessoId: string,
  filtro: FiltroUnidade = {},
): Promise<ResultadoDoEnvio> {
  const acesso = await carregarAcesso(acessoId, filtro);
  garantirCaminhaoDaFrota(acesso);

  if (!acesso.motorista) {
    throw new ValidationError('A saida foi registrada sem motorista identificado; nao ha para quem enviar a ficha.');
  }

  const numero = telefoneE164(acesso.motorista.telefone);
  if (!numero) {
    throw new ValidationError(
      `O motorista ${acesso.motorista.nome} nao tem telefone valido no cadastro. ` +
        'Cadastre o numero com DDD em Cadastros → Motoristas para enviar a ficha.',
    );
  }

  const arquivada = await arquivarFicha(ator, acessoId, filtro);
  const ficha = montarFicha(acesso, await nomeDoRegistrador(acesso.registradoEntradaPor), new Date());

  const mensagem = await prisma.mensagemExterna.create({
    data: {
      id: novoId(),
      canal: 'WHATSAPP',
      titulo: `Ficha de largada · ${ficha.rota ? ficha.rota.codigo : acesso.veiculo?.placa ?? 'saida'}`,
      corpo: corpoDaMensagem(ficha),
      destinatarioNome: acesso.motorista.nome,
      destinatarioTelefone: acesso.motorista.telefone,
      entidade: ENTIDADE,
      entidadeId: acesso.id,
      anexoId: arquivada.anexoId,
      createdBy: ator.usuarioId,
    },
  });

  // uma tentativa imediata: a guarita esta com o motorista na frente e precisa saber
  // agora se a ficha chegou. O que falhar aqui o job da fila reprocessa depois.
  const { registro, resultado } = await despacharMensagemExterna(mensagem.id);

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: ENTIDADE,
    entidadeId: acesso.id,
    acao: 'ENVIAR_FICHA_LARGADA',
    valorNovo: {
      motorista: acesso.motorista.nome,
      telefone: telefoneFormatado(acesso.motorista.telefone),
      anexoId: arquivada.anexoId,
      mensagemId: mensagem.id,
      entregue: registro.enviadaEm !== null,
      erro: registro.ultimoErro,
    },
  });

  // o estado vem do adaptador, e nao do texto do erro: canal desligado nao e falha de
  // entrega, e a guarita precisa ver a diferenca entre "vai sair" e "ninguem configurou"
  const situacao: SituacaoDoEnvio =
    resultado.estado === 'ENTREGUE' ? 'ENTREGUE' : resultado.estado === 'NAO_CONFIGURADO' ? 'CANAL_NAO_CONFIGURADO' : 'NA_FILA';

  return {
    mensagemId: mensagem.id,
    anexoId: arquivada.anexoId,
    situacao,
    telefone: telefoneFormatado(acesso.motorista.telefone),
    detalhe: registro.ultimoErro,
  };
}

/** Envio automatico ao registrar a largada, ligavel sem deploy (secao 5.5). */
export async function envioAutomaticoLigado(): Promise<boolean> {
  const p = await prisma.parametro.findUnique({ where: { chave: 'portaria.enviar_ficha_largada_whatsapp' } });
  return p?.valor === true;
}

/**
 * Emissao da ficha no ato da largada (secao 14.7).
 *
 * Chamada pelo registro do acesso e **nao pode derrubar o registro**: o portao ja se
 * abriu, o caminhao ja saiu, e um bucket fora do ar nao apaga o evento. O que falha
 * aqui volta como aviso na tela da guarita, com o botao de reemitir do lado.
 */
export interface EmissaoDaLargada {
  anexoId: string | null;
  nome: string | null;
  envio: ResultadoDoEnvio | null;
  avisos: string[];
}

const motivoDe = (erro: unknown): string =>
  erro instanceof Error ? erro.message : 'Falha ao emitir a ficha de largada.';

export async function emitirFichaDaLargada(ator: Ator, acessoId: string): Promise<EmissaoDaLargada> {
  const avisos: string[] = [];

  if (await envioAutomaticoLigado()) {
    try {
      // o envio ja arquiva a ficha: gerar duas vezes criaria dois comprovantes da mesma saida
      const envio = await enviarFichaPorWhatsapp(ator, acessoId);
      return { anexoId: envio.anexoId, nome: null, envio, avisos };
    } catch (erro) {
      avisos.push(`Ficha nao enviada ao motorista: ${motivoDe(erro)}`);
    }
  }

  try {
    const arquivada = await arquivarFicha(ator, acessoId);
    return { anexoId: arquivada.anexoId, nome: arquivada.nome, envio: null, avisos };
  } catch (erro) {
    avisos.push(`Ficha de largada nao pode ser arquivada: ${motivoDe(erro)}`);
    return { anexoId: null, nome: null, envio: null, avisos };
  }
}
