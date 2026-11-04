import { create } from 'zustand';
import { get, post } from '../../lib/api';

export interface UsuarioSessao {
  sub: string;
  nome: string;
  email: string;
  perfis: string[];
  permissoes: string[];
  unidadeId: string | null;
  centroCustoId: string | null;
  /** unidades que o usuario alcanca (secao 5.6) */
  unidades: string[];
  /** unidade que ele declarou estar operacionalizando */
  unidadeAtivaId: string | null;
  /** senha definida por terceiro: a aplicacao fica bloqueada ate o dono trocar (secao 5.1) */
  deveTrocarSenha?: boolean;
}

export interface Unidade {
  id: string;
  codigo: string;
  nome: string;
}

interface RespostaLogin {
  usuario?: UsuarioSessao;
  unidades?: Unidade[];
  /** o backend precisa saber em qual unidade este usuario vai operar antes de abrir a sessao */
  selecionarUnidade?: boolean;
}

interface EstadoSessao {
  usuario: UsuarioSessao | null;
  unidades: Unidade[];
  carregando: boolean;
  carregar: () => Promise<void>;
  /** devolve as unidades quando o backend exige a escolha antes de abrir a sessao */
  entrar: (login: string, senha: string, unidadeId?: string) => Promise<Unidade[] | null>;
  trocarUnidade: (unidadeId: string) => Promise<void>;
  sair: () => Promise<void>;
}

/**
 * Estado de UI da sessao. As permissoes e a unidade ativa vem do backend a cada carga -
 * a UI so esconde; a decisao continua no servidor.
 */
export const useSessao = create<EstadoSessao>((set) => ({
  usuario: null,
  unidades: [],
  carregando: true,

  carregar: async () => {
    try {
      const { usuario, unidades } = await get<{ usuario: UsuarioSessao; unidades: Unidade[] }>('/auth/me');
      set({ usuario, unidades: unidades ?? [], carregando: false });
    } catch {
      set({ usuario: null, unidades: [], carregando: false });
    }
  },

  entrar: async (login, senha, unidadeId) => {
    const resposta = await post<RespostaLogin>('/auth/login', { login, senha, unidadeId });

    if (resposta.selecionarUnidade) return resposta.unidades ?? [];

    set({ usuario: resposta.usuario ?? null, unidades: resposta.unidades ?? [] });
    return null;
  },

  trocarUnidade: async (unidadeId) => {
    const { usuario, unidades } = await post<{ usuario: UsuarioSessao; unidades: Unidade[] }>(
      '/auth/unidade-ativa',
      { unidadeId },
    );
    set({ usuario, unidades: unidades ?? [] });
  },

  sair: async () => {
    await post('/auth/logout');
    set({ usuario: null, unidades: [] });
  },
}));

/** Checagem de permissao para esconder elementos. Nunca substitui a validacao do backend. */
export const usePermissao = (permissao: string): boolean =>
  useSessao((s) => s.usuario?.permissoes.includes(permissao) ?? false);

/** True para quem opera a rede inteira - so esse perfil ve o filtro de unidade nos relatorios. */
export const useVeTodasUnidades = (): boolean => usePermissao('unidade:todas');
