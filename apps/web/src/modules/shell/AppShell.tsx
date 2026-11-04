import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BatteryCharging, BookMarked, Boxes, Building2, CircleDot, ClipboardCheck, DoorOpen, Droplet,
  Droplets, FileText, Gauge, Inbox, LayoutDashboard, LogOut, Menu, Search,
  ShieldCheck, Stamp, Sunrise, TrendingUp, Truck, Users, Wrench, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../design-system/cn';
import { useSessao } from '../auth/useSessao';
import { Notificacoes } from './Notificacoes';

interface ItemMenu {
  para: string;
  rotulo: string;
  Icone: typeof LayoutDashboard;
  /** menu so aparece com a permissao; o backend valida de novo em cada rota */
  permissao?: string;
  /** basta UMA das permissoes - usado onde a tela agrupa recursos diferentes */
  qualquerPermissao?: string[];
}

const MENU: ItemMenu[] = [
  { para: '/', rotulo: 'Painel', Icone: LayoutDashboard },
  { para: '/solicitacoes', rotulo: 'Solicitacoes', Icone: FileText, permissao: 'solicitacao:consultar' },
  { para: '/triagem', rotulo: 'Triagem', Icone: Inbox, permissao: 'solicitacao:triar' },
  { para: '/compras', rotulo: 'Compras', Icone: ClipboardCheck, permissao: 'lote:consultar' },
  { para: '/aprovacoes', rotulo: 'Aprovacoes', Icone: Stamp, permissao: 'lote:aprovar' },
  { para: '/frota', rotulo: 'Frota', Icone: Truck, permissao: 'veiculo:gerenciar' },
  { para: '/portaria', rotulo: 'Portaria', Icone: DoorOpen, qualquerPermissao: ['portaria:operar', 'portaria:consultar'] },
  { para: '/abastecimento', rotulo: 'Abastecimento', Icone: Droplet, permissao: 'abastecimento:registrar' },
  { para: '/pneus', rotulo: 'Pneus', Icone: CircleDot, permissao: 'pneu:gerenciar' },
  { para: '/oleo', rotulo: 'Oleo e lubrificacao', Icone: Droplets, permissao: 'preventiva:consultar' },
  { para: '/baterias', rotulo: 'Baterias', Icone: BatteryCharging, permissao: 'bateria:gerenciar' },
  { para: '/manutencao', rotulo: 'Manutencao', Icone: Wrench, permissao: 'os:gerenciar' },
  { para: '/almoxarifado', rotulo: 'Almoxarifado', Icone: Boxes, permissao: 'estoque:consultar' },
  { para: '/pessoas', rotulo: 'Pessoas', Icone: Users, permissao: 'colaborador:consultar' },
  { para: '/matinal', rotulo: 'Matinal', Icone: Sunrise },
  { para: '/executivo', rotulo: 'Executivo', Icone: TrendingUp, permissao: 'relatorio:executivo' },
  { para: '/indicadores', rotulo: 'Indicadores', Icone: Gauge, permissao: 'relatorio:operacional' },
  {
    para: '/cadastros',
    rotulo: 'Cadastros',
    Icone: BookMarked,
    qualquerPermissao: ['veiculo:gerenciar', 'motorista:gerenciar', 'solicitacao:consultar', 'estoque:consultar'],
  },
  { para: '/governanca', rotulo: 'Governanca', Icone: ShieldCheck, permissao: 'perfil:listar' },
];

/**
 * Seletor da unidade em operacao (secao 5.6). Aparece sempre, mesmo com uma unidade so:
 * quem opera precisa ver, o tempo todo, onde esta gravando.
 */
function SeletorDeUnidade() {
  const usuario = useSessao((s) => s.usuario);
  const unidades = useSessao((s) => s.unidades);
  const trocarUnidade = useSessao((s) => s.trocarUnidade);
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atual = unidades.find((u) => u.id === usuario?.unidadeAtivaId);

  async function trocar(unidadeId: string) {
    if (!unidadeId || unidadeId === usuario?.unidadeAtivaId) return;
    setTrocando(true);
    setErro(null);
    try {
      await trocarUnidade(unidadeId);
      // as listagens dependem da unidade ativa; recarregar evita mostrar dado da unidade anterior
      window.location.reload();
    } catch {
      setErro('Nao foi possivel trocar de unidade.');
    } finally {
      setTrocando(false);
    }
  }

  if (unidades.length === 0) {
    return (
      <span className="hidden items-center gap-2 text-legenda text-ceara-vermelho md:flex">
        <Building2 size={16} aria-hidden />
        Sem unidade vinculada
      </span>
    );
  }

  if (unidades.length === 1) {
    return (
      <span className="hidden items-center gap-2 text-legenda text-ceara-texto2 md:flex" title={atual?.nome}>
        <Building2 size={16} aria-hidden />
        {atual?.codigo ?? '—'}
      </span>
    );
  }

  return (
    <div className="hidden items-center gap-2 md:flex">
      <Building2 size={16} className="text-ceara-azul" aria-hidden />
      <label className="sr-only" htmlFor="unidade-ativa">Unidade em operacao</label>
      <select
        id="unidade-ativa"
        value={usuario?.unidadeAtivaId ?? ''}
        disabled={trocando}
        onChange={(e) => void trocar(e.target.value)}
        className="h-9 rounded-lg border border-ceara-borda bg-white px-2 text-legenda text-ceara-texto"
        title={erro ?? atual?.nome}
      >
        {unidades.map((u) => (
          <option key={u.id} value={u.id}>
            {u.codigo}
          </option>
        ))}
      </select>
      {erro && <span role="alert" className="text-legenda text-ceara-vermelho">{erro}</span>}
    </div>
  );
}

/** Item de menu, com o mesmo visual na barra lateral e na gaveta do celular. */
function ItemMenuLink({
  item,
  aoNavegar,
}: {
  item: ItemMenu;
  aoNavegar?: () => void;
}) {
  const { para, rotulo, Icone } = item;
  return (
    <NavLink
      to={para}
      end={para === '/'}
      onClick={aoNavegar}
      className={({ isActive }) =>
        cn(
          // alvo de toque de 44px: no patio se opera de luva, com o celular na mao
          'flex min-h-[44px] items-center gap-3 border-l-[3px] px-5 py-2.5 text-corpo transition-colors',
          isActive
            ? 'border-l-ceara-ouro bg-white/10 font-medium text-white'
            : 'border-l-transparent text-white/80 hover:bg-white/5',
        )
      }
    >
      <Icone size={18} aria-hidden />
      {rotulo}
    </NavLink>
  );
}

export function AppShell() {
  const usuario = useSessao((s) => s.usuario);
  const sair = useSessao((s) => s.sair);
  const { pathname } = useLocation();
  const [gavetaAberta, setGavetaAberta] = useState(false);

  const permissoes = usuario?.permissoes ?? [];
  const visiveis = MENU.filter((m) => {
    if (m.permissao) return permissoes.includes(m.permissao);
    if (m.qualquerPermissao) return m.qualquerPermissao.some((p) => permissoes.includes(p));
    return true;
  });
  const atual = visiveis.find((m) => (m.para === '/' ? pathname === '/' : pathname.startsWith(m.para)));

  // navegar fecha a gaveta; sem isso o menu cobre a tela que o usuario acabou de abrir
  useEffect(() => setGavetaAberta(false), [pathname]);

  useEffect(() => {
    if (!gavetaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGavetaAberta(false);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [gavetaAberta]);

  return (
    <div className="flex min-h-screen bg-ceara-nevoa">
      {/* Sidebar: azul de fundo, item ativo com barra dourada de 3px */}
      <aside className="hidden w-60 shrink-0 flex-col bg-ceara-fundo text-white md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="inline-block h-7 w-1.5 rounded bg-ceara-ouro" aria-hidden />
          <div className="leading-tight">
            <p className="font-display text-h3 tracking-wide">SGI CEARA</p>
            <p className="text-legenda text-white/70">Ceara Alimentos</p>
          </div>
        </div>

        <nav className="mt-2 flex-1" aria-label="Menu principal">
          {visiveis.map((item) => (
            <ItemMenuLink key={item.para} item={item} />
          ))}
        </nav>

        <button
          onClick={() => void sair()}
          className="flex items-center gap-3 border-t border-white/10 px-5 py-3 text-corpo text-white/80 hover:bg-white/5"
        >
          <LogOut size={18} aria-hidden />
          Sair
        </button>
      </aside>

      {/*
        Gaveta do celular: abaixo de md a barra lateral nao cabe, e sem ela o motorista
        no patio nao tem como chegar ao registro do dia. Mesmo menu, mesma marca.
      */}
      {gavetaAberta && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setGavetaAberta(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col overflow-y-auto bg-ceara-fundo text-white pb-[env(safe-area-inset-bottom)]"
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-block h-7 w-1.5 rounded bg-ceara-ouro" aria-hidden />
                <div className="leading-tight">
                  <p className="font-display text-h3 tracking-wide">SGI CEARA</p>
                  <p className="text-legenda text-white/70">{usuario?.nome}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGavetaAberta(false)}
                aria-label="Fechar menu"
                className="grid h-11 w-11 place-items-center rounded-lg text-white/80 hover:bg-white/10"
              >
                <X size={20} aria-hidden />
              </button>
            </div>

            <nav className="flex-1" aria-label="Menu principal do celular">
              {visiveis.map((item) => (
                <ItemMenuLink key={item.para} item={item} aoNavegar={() => setGavetaAberta(false)} />
              ))}
            </nav>

            <button
              onClick={() => void sair()}
              className="flex min-h-[44px] items-center gap-3 border-t border-white/10 px-5 py-3 text-corpo text-white/80 hover:bg-white/5"
            >
              <LogOut size={18} aria-hidden />
              Sair
            </button>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar: branca, filete azul inferior */}
        <header className="flex h-14 items-center gap-3 border-b border-ceara-azul/20 bg-white px-3 shadow-[0_1px_0_0_var(--ceara-azul)] sm:gap-4 sm:px-5">
          <button
            type="button"
            onClick={() => setGavetaAberta(true)}
            aria-label="Abrir menu"
            aria-expanded={gavetaAberta}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ceara-azul hover:bg-ceara-nevoa md:hidden"
          >
            <Menu size={22} aria-hidden />
          </button>

          <nav aria-label="Trilha" className="min-w-0 flex-1 truncate text-legenda text-ceara-texto2">
            SGI Ceara <span aria-hidden>/</span> {atual?.rotulo ?? 'Painel'}
          </nav>

          <label className="relative hidden items-center sm:flex">
            <Search size={16} className="absolute left-3 text-ceara-texto2" aria-hidden />
            <span className="sr-only">Busca global</span>
            <input
              type="search"
              placeholder="Buscar lote, pedido, item, placa"
              className="h-9 w-72 rounded-lg border border-ceara-borda bg-ceara-nevoa pl-9 pr-3 text-corpo"
            />
          </label>

          <SeletorDeUnidade />

          <Notificacoes />

          <div className="flex items-center gap-2">
            <span
              className="grid h-8 w-8 place-items-center rounded-full bg-ceara-azul text-legenda font-semibold text-white"
              aria-hidden
            >
              {usuario?.nome.slice(0, 2).toUpperCase()}
            </span>
            <div className="hidden leading-tight sm:block">
              <p className="text-legenda font-medium text-ceara-texto">{usuario?.nome}</p>
              <p className="text-legenda text-ceara-texto2">{usuario?.perfis.join(' · ')}</p>
            </div>
          </div>
        </header>

        {/* padding menor no celular, e respeito a area segura do iPhone */}
        <main className="min-w-0 flex-1 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
