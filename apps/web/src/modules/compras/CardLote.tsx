import { useDraggable } from '@dnd-kit/core';
import { Lock, Paperclip, MessageSquare, Timer } from 'lucide-react';
import { cn } from '../../design-system/cn';
import { moedaOuTraco } from './tipos';
import type { CardKanban } from './tipos';

/** Barra lateral por criticidade: P1 vermelho, P2 dourado, P3 azul, P4 cinza (secao 6.3). */
const BARRA: Record<CardKanban['cor'], string> = {
  vermelho: 'bg-ceara-vermelho',
  ouro: 'bg-ceara-ouro',
  azul: 'bg-ceara-azul',
  cinza: 'bg-ceara-texto2',
};

const PILL_CRITICIDADE: Record<CardKanban['cor'], string> = {
  vermelho: 'bg-[rgba(192,57,43,0.10)] text-ceara-vermelho',
  ouro: 'bg-[var(--ceara-ouro-15)] text-[#8a6300]',
  azul: 'bg-[var(--ceara-azul-10)] text-ceara-azul',
  cinza: 'bg-ceara-nevoa text-ceara-texto2',
};

export function CardLote({ card, onAbrir }: { card: CardKanban; onAbrir: (card: CardKanban) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, data: { card } });

  const estilo = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;

  const slaLargura = Math.min(100, card.sla.percentual);

  return (
    <article
      ref={setNodeRef}
      style={estilo}
      {...listeners}
      {...attributes}
      onDoubleClick={() => onAbrir(card)}
      tabIndex={0}
      aria-roledescription="Card arrastavel. Pressione espaco para pegar e as setas para escolher a coluna."
      aria-label={`Lote ${card.numero}, criticidade ${card.criticidade}, ${card.sla.rotulo}`}
      className={cn(
        'relative flex cursor-grab flex-col gap-2 overflow-hidden rounded-card border bg-white p-3 shadow-card',
        'active:cursor-grabbing',
        card.sla.vencido ? 'border-ceara-vermelho animate-sla-pulso' : 'border-ceara-borda',
        isDragging && 'opacity-60',
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', BARRA[card.cor])} aria-hidden />

      <header className="flex items-center justify-between gap-2 pl-2">
        <span className="font-mono text-legenda font-medium text-ceara-texto">{card.numero}</span>
        <span className="flex items-center gap-1">
          {card.bloqueado && <Lock size={13} className="text-ceara-vermelho" aria-label="Bloqueado por divergencia" />}
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', PILL_CRITICIDADE[card.cor])}>
            {card.criticidade}
          </span>
        </span>
      </header>

      <p className="pl-2 text-legenda text-ceara-texto">
        {card.quantidadeItens} {card.quantidadeItens === 1 ? 'item' : 'itens'} · {moedaOuTraco(card.valor)}
        {card.valor === null && <span className="text-ceara-texto2"> (nao cotado)</span>}
      </p>

      <p className="pl-2 text-legenda text-ceara-texto2">
        Solicitante: {card.solicitante} · CC {card.centroCusto}
      </p>

      <div className="pl-2">
        <div className="flex items-center justify-between text-[11px] text-ceara-texto2">
          <span className="flex items-center gap-1">
            <Timer size={12} aria-hidden />
            {card.sla.rotulo}
          </span>
          <span>{card.sla.percentual}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ceara-nevoa" role="presentation">
          <div
            className={cn('h-full rounded-full', card.sla.vencido ? 'bg-ceara-vermelho' : slaLargura > 75 ? 'bg-ceara-ouro' : 'bg-ceara-azul')}
            style={{ width: `${slaLargura}%` }}
          />
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-[11px] text-ceara-texto2">
        {card.anexos > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip size={12} aria-hidden />
            {card.anexos}
          </span>
        )}
        {card.notas > 0 && (
          <span className="flex items-center gap-1">
            <MessageSquare size={12} aria-hidden />
            {card.notas}
          </span>
        )}
        {card.aging.exibir && (
          <span className={cn(card.aging.critico && 'font-semibold text-ceara-vermelho')}>
            {card.aging.dias} dias em aberto
          </span>
        )}
      </footer>

      <p className="pl-2 text-[11px] text-ceara-texto2">
        Fornecedor: {card.fornecedor ?? '—'} · Aprovador: {card.aprovador ?? '—'}
      </p>
    </article>
  );
}
