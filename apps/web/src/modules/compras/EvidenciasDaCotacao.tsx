import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Image as Icone, Paperclip, Upload } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { classeControle } from '../../design-system/components/Campo';

/**
 * Evidencia da cotacao (secao 6.1.5): o print, o e-mail ou o PDF do orcamento que
 * o fornecedor mandou.
 *
 * O preco digitado e a palavra do comprador; a evidencia e o que sustenta o preco
 * numa auditoria seis meses depois. Por isso ela fica ao lado dos campos de preco,
 * e nao numa tela separada que ninguem abre.
 */

export interface Evidencia {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  anexadoPor: string;
  anexadoEm: string;
  hashSha256: string;
  url: string;
}

const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const TAMANHO_MAXIMO = 8 * 1024 * 1024;

const tamanhoBr = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Le o arquivo como base64 puro, sem o prefixo `data:` que o backend nao espera. */
function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => rejeitar(new Error('Nao foi possivel ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

export function EvidenciasDaCotacao({
  cotacaoId,
  loteId,
  somenteLeitura = false,
}: {
  cotacaoId: string;
  loteId: string;
  somenteLeitura?: boolean;
}) {
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const evidencias = useQuery({
    queryKey: ['compras', 'evidencias', cotacaoId],
    queryFn: () => get<{ itens: Evidencia[] }>(`/compras/cotacoes/${cotacaoId}/evidencias`),
  });

  const anexar = useMutation({
    mutationFn: async (arquivo: File) => {
      if (!MIMES.includes(arquivo.type)) {
        throw new Error('Formato nao aceito. Envie JPEG, PNG, WebP ou PDF.');
      }
      if (arquivo.size > TAMANHO_MAXIMO) {
        throw new Error(`Arquivo acima de ${TAMANHO_MAXIMO / 1024 / 1024} MB.`);
      }

      return post(`/compras/cotacoes/${cotacaoId}/evidencias`, {
        conteudoBase64: await lerBase64(arquivo),
        mime: arquivo.type,
        nome: arquivo.name,
        descricao: descricao.trim() || null,
      });
    },
    onSuccess: async () => {
      setErro(null);
      setDescricao('');
      if (entrada.current) entrada.current.value = '';
      await cliente.invalidateQueries({ queryKey: ['compras', 'evidencias', cotacaoId] });
      await cliente.invalidateQueries({ queryKey: ['compras', 'lote', loteId] });
    },
    onError: (falha) =>
      setErro(falha instanceof ApiError ? falha.erro.mensagem : (falha as Error).message),
  });

  const itens = evidencias.data?.itens ?? [];

  return (
    <section className="flex flex-col gap-3 rounded-card border border-ceara-borda bg-ceara-nevoa p-4">
      <div className="flex items-center gap-2">
        <Paperclip size={16} className="text-ceara-azul" aria-hidden />
        <p className="text-h3 text-ceara-texto">Evidencia da cotacao</p>
      </div>

      <p className="text-legenda italic text-ceara-texto2">
        Anexe o print da conversa, o e-mail ou o PDF do orcamento. O preco digitado sozinho e a sua palavra;
        a evidencia e o que sustenta o numero na auditoria.
      </p>

      {itens.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {itens.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-lg border border-ceara-borda bg-white px-3 py-2">
              {e.mime === 'application/pdf' ? (
                <FileText size={18} className="shrink-0 text-ceara-vermelho" aria-hidden />
              ) : (
                <Icone size={18} className="shrink-0 text-ceara-azul" aria-hidden />
              )}

              <div className="min-w-0 flex-1">
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-corpo text-ceara-azul hover:underline"
                >
                  {e.nome}
                </a>
                <p className="text-legenda text-ceara-texto2">
                  {tamanhoBr(e.tamanho)} · {e.anexadoPor} · {new Date(e.anexadoEm).toLocaleString('pt-BR')}
                </p>
              </div>

              <span className="hidden font-mono text-legenda text-ceara-texto2 sm:block" title="Hash SHA-256 do arquivo">
                {e.hashSha256.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-corpo text-ceara-texto2">
          {somenteLeitura ? 'Nenhuma evidencia anexada.' : 'Nenhuma evidencia ainda. Anexe antes de registrar os precos.'}
        </p>
      )}

      {erro && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-legenda text-ceara-vermelho">
          {erro}
        </p>
      )}

      {!somenteLeitura && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <input
            className={classeControle()}
            placeholder="O que e este arquivo? Ex.: orcamento por e-mail em 03/08"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />

          <input
            ref={entrada}
            type="file"
            accept={MIMES.join(',')}
            className="text-legenda text-ceara-texto2 file:mr-2 file:rounded-lg file:border file:border-ceara-azul file:bg-white file:px-3 file:py-1.5 file:text-legenda file:text-ceara-azul"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) anexar.mutate(arquivo);
            }}
          />

          <Button
            type="button"
            tamanho="sm"
            variante="secundario"
            iconeEsquerda={<Upload size={14} aria-hidden />}
            carregando={anexar.isPending}
            onClick={() => entrada.current?.click()}
          >
            Anexar
          </Button>
        </div>
      )}
    </section>
  );
}
