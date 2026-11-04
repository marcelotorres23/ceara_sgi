import type { ReactNode } from 'react';
import { cn } from '../cn';

export type TomBadge = 'azul' | 'ouro' | 'verde' | 'vermelho' | 'neutro';

/** Pill: fundo em tint 10% da cor + texto na cor cheia (secao 4.4). */
const TONS: Record<TomBadge, string> = {
  azul: 'bg-[var(--ceara-azul-10)] text-ceara-azul',
  ouro: 'bg-[var(--ceara-ouro-15)] text-[#8a6300]',
  verde: 'bg-[rgba(30,122,68,0.10)] text-ceara-verde',
  vermelho: 'bg-[rgba(192,57,43,0.10)] text-ceara-vermelho',
  neutro: 'bg-ceara-nevoa text-ceara-texto2',
};

export function Badge({ tom = 'neutro', children, className }: { tom?: TomBadge; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-legenda font-medium', TONS[tom], className)}>
      {children}
    </span>
  );
}

/** Criticidade P1-P4 com as cores fixadas na secao 6.3. */
export const TOM_POR_CRITICIDADE: Record<'P1' | 'P2' | 'P3' | 'P4', TomBadge> = {
  P1: 'vermelho',
  P2: 'ouro',
  P3: 'azul',
  P4: 'neutro',
};
