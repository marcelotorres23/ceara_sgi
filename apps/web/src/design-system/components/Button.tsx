import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

type Variante = 'primario' | 'secundario' | 'destrutivo' | 'texto';
type Tamanho = 'md' | 'sm';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  iconeEsquerda?: ReactNode;
  carregando?: boolean;
}

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-ceara-azul text-white hover:bg-ceara-fundo border border-transparent',
  secundario: 'bg-white text-ceara-azul border border-ceara-azul hover:bg-[var(--ceara-azul-10)]',
  destrutivo: 'bg-white text-ceara-vermelho border border-ceara-vermelho hover:bg-[rgba(192,57,43,0.08)]',
  texto: 'bg-transparent text-ceara-azul border border-transparent hover:underline',
};

const TAMANHOS: Record<Tamanho, string> = {
  md: 'h-10 px-4 text-corpo',
  sm: 'h-8 px-3 text-legenda',
};

export function Button({
  variante = 'primario',
  tamanho = 'md',
  iconeEsquerda,
  carregando = false,
  className,
  disabled,
  children,
  ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || carregando}
      aria-busy={carregando}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTES[variante],
        TAMANHOS[tamanho],
        className,
      )}
    >
      {iconeEsquerda}
      {carregando ? 'Processando...' : children}
    </button>
  );
}
