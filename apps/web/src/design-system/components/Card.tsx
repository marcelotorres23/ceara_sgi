import type { ReactNode } from 'react';
import { cn } from '../cn';

type Destaque = 'nenhum' | 'regra' | 'risco' | 'ok';

const BORDA_ESQUERDA: Record<Destaque, string> = {
  nenhum: '',
  regra: 'border-l-4 border-l-ceara-ouro',
  risco: 'border-l-4 border-l-ceara-vermelho',
  ok: 'border-l-4 border-l-ceara-verde',
};

export function Card({
  destaque = 'nenhum',
  className,
  children,
}: {
  destaque?: Destaque;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('bg-white border border-ceara-borda rounded-card shadow-card', BORDA_ESQUERDA[destaque], className)}>
      {children}
    </div>
  );
}

export function CardTitulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      <h2 className="h2-secao">{children}</h2>
      {acao}
    </div>
  );
}

export function CardCorpo({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 pb-4 pt-2', className)}>{children}</div>;
}
