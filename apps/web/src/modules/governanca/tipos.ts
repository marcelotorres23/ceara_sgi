export interface UsuarioDaLista {
  id: string;
  nome: string;
  email: string;
  /** nome de guerra no WinThor; preenchido, a pessoa entra com a senha do WinThor */
  loginWinthor: string | null;
  ativo: boolean;
  ultimoLoginEm: string | null;
  telefone: string | null;
  unidadeId: string | null;
  centroCustoId: string | null;
  unidadeNome: string | null;
  centroCustoRotulo: string | null;
  /** unidades que a pessoa alcanca; a lotacao entra sempre (secao 5.6) */
  unidades: string[];
  perfis: string[];
  /** conflitos de SoD ja apurados no servidor (secao 5.3) */
  conflitos: Array<{ a: string; b: string; motivo: string }>;
}

export interface Perfil {
  id: string;
  nome: string;
  descricao: string | null;
  sistema: boolean;
  permissoes: string[];
}

export interface Permissao {
  id: string;
  recurso: string;
  acao: string;
  descricao: string | null;
}

export interface FaixaDeAlcada {
  nivel: number;
  valorMin: string;
  valorMax: string | null;
  aprovador: string;
  propostasMinimas: number;
  slaHoras: number;
  ativo: boolean;
}

export interface Parametro {
  chave: string;
  valor: unknown;
  descricao: string | null;
  updatedAt: string;
}

export interface RegistroDeAuditoria {
  id: string;
  timestamp: string;
  entidade: string;
  entidadeId: string | null;
  acao: string;
  valorAnterior: unknown;
  valorNovo: unknown;
  ip: string | null;
  hash: string;
  usuario: { nome: string } | null;
}

/** Verificacao da cadeia de hash da trilha: cada registro encadeia o anterior. */
export interface Integridade {
  integro: boolean;
  quebraNoId?: string;
}

export const dataHoraBr = (iso: string | null): string =>
  iso === null ? 'nunca' : new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const moeda = (valor: string | number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor));

/** Faixa em texto: "de R$ 1.000,01 ate R$ 5.000,00" ou "acima de R$ 20.000,00". */
export function faixaBr(min: string, max: string | null): string {
  if (max === null) return `acima de ${moeda(min)}`;
  return `${moeda(min)} ate ${moeda(max)}`;
}

/** Agrupa as permissoes por recurso, que e como o perfil e lido em tela. */
export function porRecurso(permissoes: Permissao[]): Array<{ recurso: string; itens: Permissao[] }> {
  const mapa = new Map<string, Permissao[]>();
  for (const p of permissoes) {
    const atual = mapa.get(p.recurso) ?? [];
    atual.push(p);
    mapa.set(p.recurso, atual);
  }
  return [...mapa.entries()]
    .map(([recurso, itens]) => ({ recurso, itens }))
    .sort((a, b) => a.recurso.localeCompare(b.recurso));
}
