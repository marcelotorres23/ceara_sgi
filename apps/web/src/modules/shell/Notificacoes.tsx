import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { get, post } from '../../lib/api';
import { cn } from '../../design-system/cn';

interface Notificacao {
  id: string;
  titulo: string;
  corpo: string;
  lidaEm: string | null;
  createdAt: string;
}

export function Notificacoes() {
  const [aberto, setAberto] = useState(false);
  const cliente = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notificacoes'],
    queryFn: () => get<{ itens: Notificacao[]; naoLidas: number }>('/notificacoes?limite=20'),
    refetchInterval: 60_000,
  });

  const marcarTodas = useMutation({
    mutationFn: () => post('/notificacoes/lidas'),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['notificacoes'] }),
  });

  const naoLidas = data?.naoLidas ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        /* 44px: alvo de toque minimo no celular, onde se opera com o polegar */
        className="relative grid h-11 w-11 place-items-center rounded-lg hover:bg-ceara-nevoa"
        aria-label={naoLidas > 0 ? `Notificacoes, ${naoLidas} nao lidas` : 'Notificacoes'}
        aria-expanded={aberto}
      >
        <Bell size={18} className="text-ceara-azul" aria-hidden />
        {naoLidas > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ceara-vermelho px-1 text-[10px] font-semibold text-white">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {/* no celular o painel nao pode ser mais largo que a tela, ou empurra o layout */}
      {aberto && (
        <div className="absolute right-0 z-40 mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-card border border-ceara-borda bg-white shadow-card">
          <header className="flex items-center justify-between border-b border-ceara-borda px-3 py-2">
            <span className="text-h3 text-ceara-azul">Notificacoes</span>
            {naoLidas > 0 && (
              <button onClick={() => marcarTodas.mutate()} className="text-legenda text-ceara-azul hover:underline">
                Marcar todas como lidas
              </button>
            )}
          </header>

          <ul className="max-h-80 overflow-y-auto">
            {(data?.itens ?? []).map((n) => (
              <li
                key={n.id}
                className={cn('border-b border-ceara-borda px-3 py-2 last:border-0', !n.lidaEm && 'bg-[var(--ceara-azul-10)]')}
              >
                <p className="text-legenda font-semibold text-ceara-texto">{n.titulo}</p>
                <p className="text-legenda text-ceara-texto2">{n.corpo}</p>
                <p className="mt-0.5 text-[11px] italic text-ceara-texto2">
                  {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(n.createdAt))}
                </p>
              </li>
            ))}
            {(data?.itens.length ?? 0) === 0 && (
              <li className="px-3 py-6 text-center text-legenda italic text-ceara-texto2">Nenhuma notificacao.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
