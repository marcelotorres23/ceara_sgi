import { useDroppable } from '@dnd-kit/core';
import { cn } from '../../design-system/cn';
import { CardLote } from './CardLote';
import { moeda } from './tipos';
import type { CardKanban, ColunaKanban as Coluna } from './tipos';

export function ColunaKanban({
  coluna,
  onAbrirCard,
  destinoValido,
  arrastando,
}: {
  coluna: Coluna;
  onAbrirCard: (card: CardKanban) => void;
  destinoValido: boolean;
  arrastando: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.status });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${coluna.rotulo}, ${coluna.total} lotes`}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-card border bg-ceara-nevoa/60',
        isOver && destinoValido && 'border-ceara-azul bg-[var(--ceara-azul-10)]',
        arrastando && !destinoValido ? 'border-dashed border-ceara-borda opacity-50' : 'border-ceara-borda',
      )}
    >
      <header className="sticky top-0 z-10 rounded-t-card border-b border-ceara-borda bg-white px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="text-h3 text-ceara-azul">{coluna.rotulo}</h2>
          <span className="rounded-full bg-ceara-nevoa px-2 py-0.5 text-[11px] font-semibold text-ceara-texto2">
            {coluna.total}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-ceara-texto2">{moeda(coluna.valor)}</p>
      </header>

      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {coluna.cards.map((card) => (
          <CardLote key={card.id} card={card} onAbrir={onAbrirCard} />
        ))}
        {coluna.total === 0 && (
          <p className="px-2 py-6 text-center text-legenda italic text-ceara-texto2">Nenhum lote nesta etapa.</p>
        )}
      </div>
    </section>
  );
}
