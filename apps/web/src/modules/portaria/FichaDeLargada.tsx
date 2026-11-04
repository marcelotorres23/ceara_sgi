import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileDown, MessageCircle } from 'lucide-react';
import { post, baixarArquivo, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { RECADO_DO_ENVIO, type EnvioDaFicha } from './tipos';

/**
 * Ficha de largada: baixar e mandar para o motorista (secao 14.7).
 *
 * A ficha ja foi emitida e arquivada quando a saida foi registrada — estes dois botoes
 * so a entregam. Ficam juntos de proposito: quem esta na guarita com o motorista na
 * frente escolhe entre imprimir e mandar no celular, e nao entre dois fluxos diferentes.
 *
 * O envio nunca diz "enviado" por otimismo: o que aparece e o que o canal respondeu —
 * entregue, na fila, ou canal desligado (F10).
 */
export function AcoesDaFicha({
  acessoId,
  motorista,
}: {
  acessoId: string;
  /** nome do motorista, so para o recado depois do envio */
  motorista?: string | null;
}) {
  const [recado, setRecado] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);

  const baixar = useMutation({
    mutationFn: () =>
      baixarArquivo(`/portaria/acessos/${acessoId}/ficha-largada.pdf`, `ficha-largada-${acessoId.slice(-6)}.pdf`),
    onError: (falha) =>
      setRecado({
        tom: 'erro',
        texto: falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao gerar a ficha de largada.',
      }),
  });

  const enviar = useMutation({
    mutationFn: () => post<EnvioDaFicha>(`/portaria/acessos/${acessoId}/ficha-largada/whatsapp`),
    onSuccess: (envio) =>
      setRecado({
        tom: envio.situacao === 'ENTREGUE' ? 'ok' : 'erro',
        texto: `${RECADO_DO_ENVIO[envio.situacao]} ${motorista ?? 'o motorista'} — ${envio.telefone}.`,
      }),
    onError: (falha) =>
      setRecado({
        tom: 'erro',
        texto: falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao enviar a ficha ao motorista.',
      }),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          tamanho="sm"
          variante="secundario"
          iconeEsquerda={<FileDown size={14} aria-hidden />}
          carregando={baixar.isPending}
          onClick={() => baixar.mutate()}
        >
          Baixar ficha
        </Button>
        <Button
          tamanho="sm"
          variante="secundario"
          iconeEsquerda={<MessageCircle size={14} aria-hidden />}
          carregando={enviar.isPending}
          onClick={() => enviar.mutate()}
        >
          Enviar no WhatsApp
        </Button>
      </div>

      {recado && (
        <p
          role="status"
          className={
            recado.tom === 'ok'
              ? 'max-w-[28rem] text-legenda text-ceara-verde'
              : 'max-w-[28rem] text-legenda text-ceara-vermelho'
          }
        >
          {recado.texto}
        </p>
      )}
    </div>
  );
}
