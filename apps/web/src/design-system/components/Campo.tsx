import type { ReactNode } from 'react';
import { cn } from '../cn';

interface Props {
  rotulo: string;
  erro?: string | null;
  ajuda?: string | null;
  obrigatorio?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/** Rotulo, ajuda e erro em volta de qualquer controle. Mantem o espaçamento consistente. */
export function Campo({ rotulo, erro, ajuda, obrigatorio, htmlFor, children, className }: Props) {
  const idAjuda = htmlFor ? `${htmlFor}-ajuda` : undefined;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-h3 text-ceara-texto">
        {rotulo}
        {obrigatorio && <span className="ml-1 text-ceara-vermelho" aria-hidden>*</span>}
      </label>
      {children}
      {(erro || ajuda) && (
        <p id={idAjuda} className={cn('text-legenda', erro ? 'text-ceara-vermelho' : 'italic text-ceara-texto2')}>
          {erro ?? ajuda}
        </p>
      )}
    </div>
  );
}

export const classeControle = (temErro?: boolean): string =>
  cn(
    'h-10 rounded-lg border bg-white px-3 text-corpo text-ceara-texto placeholder:text-ceara-texto2',
    temErro ? 'border-ceara-vermelho' : 'border-ceara-borda',
  );
