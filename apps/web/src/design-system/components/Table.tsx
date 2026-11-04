import type { ReactNode } from 'react';
import { cn } from '../cn';

/** Cabecalho azul com texto branco, zebra em nevoa, sticky, densidade compacta (secao 4.4). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-ceara-borda bg-white">
      <table className={cn('w-full border-collapse text-tabela', className)}>{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-ceara-azul text-white text-left">{children}</thead>;
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2 font-semibold whitespace-nowrap', className)}>{children}</th>;
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="[&>tr:nth-child(even)]:bg-ceara-nevoa">{children}</tbody>;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('border-b border-ceara-borda last:border-0', className)}>{children}</tr>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2 align-middle', className)}>{children}</td>;
}

/** Estado vazio: traco azul + frase objetiva, sem adjetivo vago (secao 4.4). */
export function EstadoVazio({ titulo, descricao, acao }: { titulo: string; descricao: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="var(--ceara-azul)" strokeWidth="1.5" aria-hidden>
        <rect x="8" y="12" width="40" height="32" rx="4" />
        <path d="M8 22h40M18 12v10" />
      </svg>
      <p className="text-h3 text-ceara-texto">{titulo}</p>
      <p className="text-legenda italic text-ceara-texto2">{descricao}</p>
      {acao}
    </div>
  );
}
