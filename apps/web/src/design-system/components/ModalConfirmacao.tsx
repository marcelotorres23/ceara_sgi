import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';

/**
 * Acao irreversivel sempre passa por aqui (secao 4.4).
 * Quando `exigirMotivo`, o botao so libera com texto preenchido - a trilha exige o porque.
 */
export function ModalConfirmacao({
  aberto,
  titulo,
  descricao,
  rotuloConfirmar = 'Confirmar',
  exigirMotivo = false,
  destrutivo = false,
  onCancelar,
  onConfirmar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: string;
  rotuloConfirmar?: string;
  exigirMotivo?: boolean;
  destrutivo?: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo?: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const dialogo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) setMotivo('');
    else dialogo.current?.focus();
  }, [aberto]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && aberto) onCancelar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, onCancelar]);

  if (!aberto) return null;

  const motivoPendente = exigirMotivo && motivo.trim().length < 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,20,20,0.45)] p-4">
      <div
        ref={dialogo}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
        tabIndex={-1}
        className="w-full max-w-md rounded-card border border-ceara-borda bg-white shadow-card"
      >
        <div className="px-5 pt-5">
          <h2 id="modal-titulo" className="h2-secao">
            {titulo}
          </h2>
          <p className="mt-3 text-corpo text-ceara-texto">{descricao}</p>

          {exigirMotivo && (
            <div className="mt-4 flex flex-col gap-1">
              <label htmlFor="motivo" className="text-h3">
                Motivo
              </label>
              <textarea
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
                placeholder="Descreva o motivo. Este texto fica registrado na trilha."
              />
              {motivoPendente && (
                <p className="text-legenda text-ceara-vermelho">Informe o motivo para prosseguir.</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-ceara-borda px-5 py-3">
          <Button variante="texto" onClick={onCancelar}>
            Voltar
          </Button>
          <Button
            variante={destrutivo ? 'destrutivo' : 'primario'}
            disabled={motivoPendente}
            onClick={() => onConfirmar(exigirMotivo ? motivo.trim() : undefined)}
          >
            {rotuloConfirmar}
          </Button>
        </div>
      </div>
    </div>
  );
}
