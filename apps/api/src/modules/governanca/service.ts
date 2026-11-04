import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { gerarHashSenha, verificarSenha } from '../../core/auth/password.js';
import { avaliarSenha, gerarSenhaTemporaria } from '../../core/auth/politica-senha.js';
import { normalizarLoginWinthor, type EmpregadoWinthor } from '../../core/auth/winthor.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { chavePermissao } from '../../core/rbac/permissions.js';
import { paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import {
  validarMatrizDeAlcadas,
  validarParametro,
  validarPerfisDoUsuario,
  validarPermissoesDoPerfil,
  type FaixaEditavel,
} from './regras.js';

/**
 * Escrita da governanca (secoes 5.1 a 5.5).
 *
 * Tudo aqui muda as regras do jogo: quem pode o que, quanto cada faixa aprova, como o
 * sistema se comporta. Por isso nada passa sem validacao no servidor e sem auditoria com
 * valor anterior e novo - a trilha da governanca e a unica prova de quem afrouxou o que.
 */

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

const primeiroProblema = (problemas: Array<{ mensagem: string }>): void => {
  if (problemas.length > 0) throw new ValidationError(problemas.map((p) => p.mensagem).join(' '));
};

// ------------------------------------------------------------------ usuarios

export interface NovoUsuario {
  nome: string;
  email: string;
  loginWinthor?: string | null;
  telefone?: string | null;
  unidadeId?: string | null;
  centroCustoId?: string | null;
  unidades?: string[];
  perfis: string[];
}

/**
 * Cria o usuario com senha temporaria gerada pelo servidor.
 *
 * A senha nao e escolhida em tela: quem cadastra entrega a temporaria e o dono troca no
 * primeiro acesso. Assim a senha definitiva nunca passa pelas maos do administrador.
 */
export async function criarUsuario(ator: Ator, entrada: NovoUsuario) {
  const email = entrada.email.trim().toLowerCase();

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) throw new ConflictError(`Ja existe usuario com o e-mail ${email}.`);
  const loginWinthor = await loginWinthorLivre(entrada.loginWinthor);

  const perfis = await prisma.perfil.findMany({ where: { nome: { in: entrada.perfis }, deletedAt: null } });
  if (perfis.length !== entrada.perfis.length) throw new NotFoundError('Perfil');

  primeiroProblema(validarPerfisDoUsuario(perfis.map((p) => p.nome)));

  const escopo = await escopoDeUnidades(entrada.unidades, entrada.unidadeId ?? null);

  const senhaTemporaria = novaSenhaTemporaria();
  const usuario = await prisma.usuario.create({
    data: {
      id: novoId(),
      nome: entrada.nome.trim(),
      email,
      loginWinthor,
      senhaHash: await gerarHashSenha(senhaTemporaria),
      // nasce marcada: quem cadastra entrega a de passagem, o dono define a definitiva
      deveTrocarSenha: true,
      telefone: entrada.telefone?.trim() ?? null,
      unidadeId: entrada.unidadeId ?? null,
      centroCustoId: entrada.centroCustoId ?? null,
      createdBy: ator.usuarioId,
      perfis: { create: perfis.map((p) => ({ perfilId: p.id, escopo })) },
    },
    select: { id: true, nome: true, email: true, ativo: true },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'usuarios',
    entidadeId: usuario.id,
    acao: 'CRIAR',
    valorNovo: { nome: usuario.nome, email: usuario.email, loginWinthor, perfis: perfis.map((p) => p.nome) },
  });

  // a senha volta uma unica vez, para ser entregue a pessoa; nao fica em lugar nenhum
  return { ...usuario, senhaTemporaria };
}

/**
 * Vinculo com o WinThor: maiusculas e sem espacos nas pontas, como o login compara.
 * Vazio desfaz o vinculo. O mesmo nome de guerra em duas contas daria acesso ambiguo.
 */
async function loginWinthorLivre(bruto: string | null | undefined, usuarioId?: string): Promise<string | null> {
  const login = normalizarLoginWinthor(bruto ?? '');
  if (!login) return null;
  if (login.includes('@')) throw new ValidationError('O usuario do WinThor e o nome de guerra, sem @.');
  const dono = await prisma.usuario.findUnique({ where: { loginWinthor: login }, select: { id: true, nome: true } });
  if (dono && dono.id !== usuarioId) throw new ConflictError(`O usuario WinThor ${login} ja esta vinculado a ${dono.nome}.`);
  return login;
}

/** Perfil de quem entra pela primeira vez pelo WinThor: o de menor alcance. */
export const PERFIL_PADRAO_WINTHOR = 'Solicitante';

/**
 * Primeiro acesso pelo WinThor (ADR 0028): a senha ja foi conferida no Oracle, entao a conta
 * nasce aqui, com o perfil de menor alcance. Mais acesso e decisao do administrador, com trilha.
 * A unidade so e preenchida quando existe uma unica; com mais de uma, o administrador define.
 */
export async function provisionarUsuarioWinthor(empregado: EmpregadoWinthor) {
  const perfil = await prisma.perfil.findFirst({ where: { nome: PERFIL_PADRAO_WINTHOR, deletedAt: null } });
  if (!perfil) throw new NotFoundError('Perfil');

  const unidades = await prisma.unidade.findMany({ where: { ativo: true, deletedAt: null }, select: { id: true }, take: 2 });
  const unidadeId = unidades.length === 1 ? unidades[0]!.id : null;

  // e-mail do WinThor quando existe e esta livre; senao um endereco que nunca entrega
  const emailLivre =
    empregado.email && !(await prisma.usuario.findUnique({ where: { email: empregado.email } })) ? empregado.email : null;
  const email = emailLivre ?? `winthor.${empregado.matricula}@sem-email.invalid`;

  const usuario = await prisma.usuario.create({
    data: {
      id: novoId(),
      nome: empregado.nome,
      email,
      loginWinthor: empregado.nomeGuerra,
      // a senha local nunca e usada por conta do WinThor; o hash so ocupa o campo obrigatorio
      senhaHash: await gerarHashSenha(novaSenhaTemporaria()),
      unidadeId,
      perfis: { create: [{ perfilId: perfil.id, escopo: { unidades: unidadeId ? [unidadeId] : [] } }] },
    },
  });

  await registrarAuditoria({
    usuarioId: usuario.id,
    entidade: 'usuarios',
    entidadeId: usuario.id,
    acao: 'CRIAR',
    valorNovo: { nome: usuario.nome, email, loginWinthor: usuario.loginWinthor, perfis: [perfil.nome], origem: 'WINTHOR' },
  });

  return usuario;
}

const novaSenhaTemporaria = (): string =>
  gerarSenhaTemporaria((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));

/**
 * Escopo de unidades gravado no vinculo usuario-perfil (secao 5.6).
 *
 * A operacao e multiunidade: quem responde por matriz e filial precisa alcancar as duas e
 * trocar de unidade ativa sem trocar de conta. O login ja unia a lotacao com o que estivesse
 * no escopo dos perfis — o que faltava era por o escopo la.
 *
 * A lotacao entra sempre: seria absurdo alguem nao alcancar a propria unidade. Unidade
 * inexistente ou inativa e recusada aqui, e nao no login: escopo com id morto vira acesso
 * que some sem explicacao.
 */
/** Le a lista de unidades do escopo JSON, tolerando vinculo antigo gravado como `{}`. */
export function unidadesDoEscopo(escopo: unknown): string[] {
  const e = escopo as { unidades?: unknown } | null;
  if (!Array.isArray(e?.unidades)) return [];
  return e.unidades.filter((u): u is string => typeof u === 'string');
}

async function escopoDeUnidades(
  unidades: string[] | undefined,
  lotacao: string | null,
): Promise<{ unidades: string[]; centrosCusto: never[] }> {
  const pedidas = new Set(unidades ?? []);
  if (lotacao) pedidas.add(lotacao);
  if (pedidas.size === 0) return { unidades: [], centrosCusto: [] };

  const existentes = await prisma.unidade.findMany({
    where: { id: { in: [...pedidas] }, ativo: true, deletedAt: null },
    select: { id: true },
  });
  if (existentes.length !== pedidas.size) {
    throw new NotFoundError('Unidade');
  }

  return { unidades: existentes.map((u) => u.id), centrosCusto: [] };
}

export interface EdicaoDeUsuario {
  nome?: string;
  loginWinthor?: string | null;
  telefone?: string | null;
  unidadeId?: string | null;
  centroCustoId?: string | null;
  perfis?: string[];
  unidades?: string[];
}

export async function editarUsuario(ator: Ator, usuarioId: string, entrada: EdicaoDeUsuario) {
  const atual = await prisma.usuario.findFirst({
    where: { id: usuarioId, deletedAt: null },
    include: { perfis: { include: { perfil: true } } },
  });
  if (!atual) throw new NotFoundError('Usuario');

  const perfisAtuais = atual.perfis.map((p) => p.perfil.nome);
  let perfisNovos = perfisAtuais;
  const loginWinthor =
    entrada.loginWinthor !== undefined ? await loginWinthorLivre(entrada.loginWinthor, usuarioId) : atual.loginWinthor;

  /*
   * O escopo de unidades e do usuario, e nao de cada perfil: a tela oferece uma lista so, e
   * ela e replicada em todos os vinculos. O login ja faz a uniao, entao o efeito e o mesmo —
   * e evita uma matriz perfil x unidade que ninguem pediu e que so teria como resposta
   * "marque tudo em todos".
   */
  const lotacao = entrada.unidadeId !== undefined ? entrada.unidadeId : atual.unidadeId;
  const unidadesAtuais = [
    ...new Set(atual.perfis.flatMap((v) => unidadesDoEscopo(v.escopo))),
  ];
  const escopo = await escopoDeUnidades(entrada.unidades ?? unidadesAtuais, lotacao);

  if (entrada.perfis) {
    const perfis = await prisma.perfil.findMany({ where: { nome: { in: entrada.perfis }, deletedAt: null } });
    if (perfis.length !== entrada.perfis.length) throw new NotFoundError('Perfil');
    if (perfis.length === 0) throw new ValidationError('O usuario precisa de ao menos um perfil.');

    perfisNovos = perfis.map((p) => p.nome);
    primeiroProblema(validarPerfisDoUsuario(perfisNovos));

    // vinculo e lista fechada: apaga e regrava dentro da transacao, sem estado intermediario
    await prisma.$transaction([
      prisma.usuarioPerfil.deleteMany({ where: { usuarioId } }),
      prisma.usuarioPerfil.createMany({ data: perfis.map((p) => ({ usuarioId, perfilId: p.id, escopo })) }),
    ]);
  } else if (entrada.unidades) {
    await prisma.usuarioPerfil.updateMany({ where: { usuarioId }, data: { escopo } });
  }

  const usuario = await db.usuario.update({
    where: { id: usuarioId },
    data: {
      ...(entrada.nome !== undefined ? { nome: entrada.nome.trim() } : {}),
      ...(entrada.telefone !== undefined ? { telefone: entrada.telefone?.trim() ?? null } : {}),
      ...(entrada.unidadeId !== undefined ? { unidadeId: entrada.unidadeId } : {}),
      ...(entrada.centroCustoId !== undefined ? { centroCustoId: entrada.centroCustoId } : {}),
      loginWinthor,
      updatedBy: ator.usuarioId,
    },
    select: { id: true, nome: true, email: true, ativo: true },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'usuarios',
    entidadeId: usuarioId,
    acao: 'EDITAR',
    valorAnterior: { nome: atual.nome, loginWinthor: atual.loginWinthor, perfis: perfisAtuais },
    valorNovo: { nome: usuario.nome, loginWinthor, perfis: perfisNovos },
  });

  return usuario;
}

/**
 * Inativacao, nunca exclusao (regra de ouro 2): o usuario responde por lotes, aprovacoes e
 * checklists que continuam existindo. Some do login, permanece no historico.
 */
export async function inativarUsuario(ator: Ator, usuarioId: string, motivo: string) {
  if (motivo.trim().length < 5) throw new ValidationError('Descreva o motivo da inativacao.');
  if (usuarioId === ator.usuarioId) throw new ConflictError('Voce nao pode inativar o proprio usuario.');

  const atual = await prisma.usuario.findFirst({ where: { id: usuarioId, deletedAt: null } });
  if (!atual) throw new NotFoundError('Usuario');

  const usuario = await db.usuario.update({
    where: { id: usuarioId },
    data: { ativo: false, updatedBy: ator.usuarioId },
    select: { id: true, nome: true, ativo: true },
  });

  // sessao aberta de quem foi inativado continuaria valendo ate expirar
  await prisma.sessao.deleteMany({ where: { usuarioId } });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'usuarios',
    entidadeId: usuarioId,
    acao: 'INATIVAR',
    valorAnterior: { ativo: true },
    valorNovo: { ativo: false, motivo: motivo.trim() },
  });

  return usuario;
}

export async function reativarUsuario(ator: Ator, usuarioId: string) {
  const atual = await prisma.usuario.findFirst({ where: { id: usuarioId, deletedAt: null } });
  if (!atual) throw new NotFoundError('Usuario');

  const usuario = await db.usuario.update({
    where: { id: usuarioId },
    data: { ativo: true, updatedBy: ator.usuarioId },
    select: { id: true, nome: true, ativo: true },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'usuarios',
    entidadeId: usuarioId,
    acao: 'REATIVAR',
    valorAnterior: { ativo: false },
    valorNovo: { ativo: true },
  });

  return usuario;
}

/**
 * Redefinicao da senha pelo administrador (secao 5.1).
 *
 * Duas formas, o mesmo efeito: senha gerada pelo sistema (padrao) ou definida por quem
 * administra, quando a entrega e por telefone e a temporaria aleatoria atrapalha. Nos dois
 * casos a senha nasce **marcada para troca** e as sessoes abertas caem — quem tinha a senha
 * antiga perde o acesso na hora, que e o motivo de existir um reset.
 *
 * O administrador nunca ve a senha que a pessoa vai usar depois: ele entrega uma de
 * passagem, e o dono a substitui no primeiro acesso.
 */
export async function redefinirSenha(
  ator: Ator,
  usuarioId: string,
  senhaDefinida?: string | null,
  exigirTroca = true,
) {
  const atual = await prisma.usuario.findFirst({ where: { id: usuarioId, deletedAt: null } });
  if (!atual) throw new NotFoundError('Usuario');

  const definida = senhaDefinida?.trim();
  if (definida) {
    const problemas = avaliarSenha(definida, { nome: atual.nome, email: atual.email });
    primeiroProblema(problemas);
  }

  const senha = definida || novaSenhaTemporaria();

  /*
   * A troca no primeiro acesso e o padrao, e continua sendo: senha que passou pela mao de
   * outra pessoa nao e senha. Mas quando o administrador define e entrega a senha
   * deliberadamente - base de teste, usuario que nao acessa sozinho - exigir a troca so
   * empurra a pessoa para uma tela de bloqueio. A escolha fica com quem administra, e
   * qual foi a decisao entra na trilha.
   */
  const trocaObrigatoria = definida ? exigirTroca : true;

  await db.usuario.update({
    where: { id: usuarioId },
    data: {
      senhaHash: await gerarHashSenha(senha),
      deveTrocarSenha: trocaObrigatoria,
      updatedBy: ator.usuarioId,
    },
  });
  await prisma.sessao.deleteMany({ where: { usuarioId } });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'usuarios',
    entidadeId: usuarioId,
    acao: 'REDEFINIR_SENHA',
    // a senha em si jamais entra na trilha - so o fato, o alvo e a consequencia
    valorNovo: {
      alvo: atual.email,
      origem: definida ? 'DEFINIDA_PELO_ADMINISTRADOR' : 'GERADA_PELO_SISTEMA',
      sessoesEncerradas: true,
      trocaObrigatoria,
    },
  });

  return {
    id: usuarioId,
    senhaTemporaria: senha,
    definidaPeloAdministrador: Boolean(definida),
    trocaObrigatoria,
  };
}

/**
 * Troca da propria senha (secao 5.1). Exige a senha atual mesmo com sessao aberta:
 * sessao esquecida em maquina de terceiro nao pode virar troca de dono da conta.
 *
 * E o unico caminho que encerra `deveTrocarSenha` - o administrador marca, so o dono tira.
 */
export async function trocarPropriaSenha(
  ator: Ator,
  entrada: { senhaAtual: string; senhaNova: string },
) {
  const usuario = await prisma.usuario.findFirst({ where: { id: ator.usuarioId, deletedAt: null } });
  if (!usuario) throw new NotFoundError('Usuario');

  if (!(await verificarSenha(usuario.senhaHash, entrada.senhaAtual))) {
    await registrarAuditoria({
      usuarioId: ator.usuarioId,
      ...requisicaoDe(ator),
      entidade: 'usuarios',
      entidadeId: ator.usuarioId,
      acao: 'TROCAR_SENHA_FALHA',
      severidade: 'ALERTA',
    });
    throw new ValidationError('Senha atual incorreta.');
  }

  const igualAAtual = await verificarSenha(usuario.senhaHash, entrada.senhaNova);
  primeiroProblema(
    avaliarSenha(entrada.senhaNova, { nome: usuario.nome, email: usuario.email, igualAAtual }),
  );

  await db.usuario.update({
    where: { id: usuario.id },
    data: {
      senhaHash: await gerarHashSenha(entrada.senhaNova),
      deveTrocarSenha: false,
      senhaTrocadaEm: new Date(),
      updatedBy: usuario.id,
    },
  });

  // toda sessao cai, inclusive a de quem trocou: se a troca foi por suspeita de acesso
  // indevido, manter qualquer sessao viva anularia o motivo da troca. A tela pede login.
  await prisma.sessao.deleteMany({ where: { usuarioId: usuario.id } });

  await registrarAuditoria({
    usuarioId: usuario.id,
    ...requisicaoDe(ator),
    entidade: 'usuarios',
    entidadeId: usuario.id,
    acao: 'TROCAR_SENHA',
    valorNovo: { trocadaPeloProprioDono: true },
  });

  return { trocada: true };
}

// ------------------------------------------------------------------ perfis

export interface EdicaoDePerfil {
  descricao?: string;
  permissoes?: string[];
}

/**
 * Edicao do perfil (secao 5.1). O catalogo de permissoes e fechado, e o Administrador
 * continua vedado de aprovar, receber e lancar nota - nem por esta tela.
 */
export async function editarPerfil(ator: Ator, perfilId: string, entrada: EdicaoDePerfil) {
  const perfil = await prisma.perfil.findFirst({
    where: { id: perfilId, deletedAt: null },
    include: { permissoes: { include: { permissao: true } } },
  });
  if (!perfil) throw new NotFoundError('Perfil');

  const anteriores = perfil.permissoes.map((p) => chavePermissao(p.permissao.recurso, p.permissao.acao));

  if (entrada.permissoes) {
    const catalogo = await prisma.permissao.findMany();
    const chaves = catalogo.map((p) => chavePermissao(p.recurso, p.acao));
    primeiroProblema(validarPermissoesDoPerfil(perfil.nome, entrada.permissoes, chaves));

    const porChave = new Map(catalogo.map((p) => [chavePermissao(p.recurso, p.acao), p.id]));
    const ids = [...new Set(entrada.permissoes)].map((c) => porChave.get(c)!).filter(Boolean);

    await prisma.$transaction([
      prisma.perfilPermissao.deleteMany({ where: { perfilId } }),
      prisma.perfilPermissao.createMany({ data: ids.map((permissaoId) => ({ perfilId, permissaoId })) }),
    ]);
  }

  if (entrada.descricao !== undefined) {
    await db.perfil.update({ where: { id: perfilId }, data: { descricao: entrada.descricao.trim() } });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'perfis',
    entidadeId: perfilId,
    acao: 'EDITAR',
    valorAnterior: { permissoes: anteriores.sort() },
    valorNovo: { permissoes: [...(entrada.permissoes ?? anteriores)].sort() },
  });

  return { id: perfilId, nome: perfil.nome, permissoes: entrada.permissoes ?? anteriores };
}

// ------------------------------------------------------------------ alcadas

/**
 * Substitui a matriz inteira, nao faixa a faixa (secao 6.4).
 *
 * Editar uma faixa isolada abre vao ou sobreposicao no meio do caminho: a matriz so faz
 * sentido como conjunto continuo, e e assim que ela e validada e gravada.
 */
export async function salvarMatrizDeAlcadas(ator: Ator, faixas: FaixaEditavel[]) {
  primeiroProblema(validarMatrizDeAlcadas(faixas));

  const perfis = await prisma.perfil.findMany({
    where: { nome: { in: faixas.map((f) => f.perfilAprovador) }, deletedAt: null },
  });
  const porNome = new Map(perfis.map((p) => [p.nome, p.id]));

  const semPerfil = faixas.filter((f) => !porNome.has(f.perfilAprovador));
  if (semPerfil.length > 0) {
    throw new NotFoundError(`Perfil aprovador ${semPerfil.map((f) => f.perfilAprovador).join(', ')}`);
  }

  const anteriores = await prisma.alcada.findMany({ orderBy: { nivel: 'asc' }, include: { perfilAprovador: true } });

  await prisma.$transaction([
    prisma.alcada.deleteMany({}),
    prisma.alcada.createMany({
      data: faixas.map((f) => ({
        id: novoId(),
        nivel: f.nivel,
        valorMin: paraBanco(f.valorMin),
        valorMax: f.valorMax === null ? null : paraBanco(f.valorMax),
        perfilAprovadorId: porNome.get(f.perfilAprovador)!,
        propostasMinimas: f.propostasMinimas,
        slaHoras: f.slaHoras,
        ativo: true,
      })),
    }),
  ]);

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'alcadas',
    entidadeId: null,
    acao: 'SALVAR_MATRIZ',
    valorAnterior: {
      faixas: anteriores.map((a) => ({
        nivel: a.nivel,
        min: a.valorMin.toString(),
        max: a.valorMax?.toString() ?? null,
        aprovador: a.perfilAprovador.nome,
      })),
    },
    valorNovo: {
      faixas: faixas.map((f) => ({
        nivel: f.nivel,
        min: String(f.valorMin),
        max: f.valorMax === null ? null : String(f.valorMax),
        aprovador: f.perfilAprovador,
      })),
    },
  });

  return { faixas: faixas.length };
}

// ------------------------------------------------------------------ parametros

/** Edicao do parametro (secao 5.5). O tipo e imutavel: so o valor muda. */
export async function editarParametro(ator: Ator, chave: string, valor: unknown) {
  const atual = await prisma.parametro.findUnique({ where: { chave } });
  if (!atual) throw new NotFoundError('Parametro');

  primeiroProblema(validarParametro(atual.valor, valor));

  const parametro = await db.parametro.update({
    where: { chave },
    data: { valor: valor as never, updatedBy: ator.usuarioId },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'parametros',
    entidadeId: chave,
    acao: 'EDITAR',
    valorAnterior: { valor: atual.valor },
    valorNovo: { valor },
  });

  return parametro;
}
