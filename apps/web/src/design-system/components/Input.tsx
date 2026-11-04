import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string;
  erro?: string;
  ajuda?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { rotulo, erro, ajuda, className, id, ...props },
  ref,
) {
  const inputId = id ?? props.name ?? rotulo.toLowerCase().replace(/\s+/g, '-');
  const ajudaId = `${inputId}-ajuda`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-h3 text-ceara-texto">
        {rotulo}
      </label>
      <input
        {...props}
        id={inputId}
        ref={ref}
        aria-invalid={Boolean(erro)}
        aria-describedby={erro || ajuda ? ajudaId : undefined}
        className={cn(
          'h-10 rounded-lg border bg-white px-3 text-corpo text-ceara-texto placeholder:text-ceara-texto2',
          erro ? 'border-ceara-vermelho' : 'border-ceara-borda',
          className,
        )}
      />
      {(erro || ajuda) && (
        <p id={ajudaId} className={cn('text-legenda', erro ? 'text-ceara-vermelho' : 'italic text-ceara-texto2')}>
          {erro ?? ajuda}
        </p>
      )}
    </div>
  );
});
