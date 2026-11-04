import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { get } from '../../lib/api';
import { classeControle } from '../../design-system/components/Campo';
import { useVeTodasUnidades } from '../auth/useSessao';
import type { UnidadeFiltro } from './tipos';

/**
 * Filtro de unidade dos relatorios e listagens (secao 5.6).
 *
 * So aparece para quem opera a rede inteira. Para os demais, o backend ja prende
 * a consulta a unidade em operacao - mostrar um filtro inerte seria mentir sobre o alcance.
 */
export function FiltroUnidade({ valor, aoMudar }: { valor: string; aoMudar: (unidadeId: string) => void }) {
  const veTodas = useVeTodasUnidades();

  const { data } = useQuery({
    queryKey: ['relatorios', 'unidades'],
    queryFn: () => get<{ itens: UnidadeFiltro[]; todasAsUnidades: boolean }>('/relatorios/unidades'),
    enabled: veTodas,
    staleTime: 300_000,
  });

  if (!veTodas) return null;

  return (
    <label className="flex items-center gap-2 text-legenda text-ceara-texto2">
      <Building2 size={16} className="text-ceara-azul" aria-hidden />
      <span className="sr-only">Filtrar por unidade</span>
      <select className={classeControle()} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Todas as unidades</option>
        {data?.itens.map((u) => (
          <option key={u.id} value={u.id}>
            {u.codigo} · {u.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
