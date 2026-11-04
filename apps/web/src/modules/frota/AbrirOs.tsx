import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { type ApoioDaOs } from './tipos';

/**
 * Abertura manual da OS (secao 7.5).
 *
 * A maioria das corretivas nasce sozinha — inspecao de pneu, anomalia de abastecimento, plano
 * vencido. Esta tela cobre o resto: o gestor que viu o problema e precisa abrir a ordem
 * sem esperar um evento acontecer.
 */
export function AbrirOs({ aoFechar, aoAbrir }: { aoFechar: () => void; aoAbrir: (numero: string) => void }) {
  const cliente = useQueryClient();
  const [veiculoId, setVeiculoId] = useState('');
  const [tipo, setTipo] = useState<'CORRETIVA' | 'PREVENTIVA'>('CORRETIVA');
  const [descricao, setDescricao] = useState('');
  const [oficina, setOficina] = useState('');
  const [terceiro, setTerceiro] = useState(false);
  const [hodometro, setHodometro] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const apoio = useQuery({
    queryKey: ['frota', 'apoio-os'],
    queryFn: () => get<ApoioDaOs>('/transporte/manutencao/apoio'),
    staleTime: 300_000,
  });

  const abrir = useMutation({
    mutationFn: () =>
      post<{ numero: string }>('/transporte/manutencao/ordens', {
        veiculoId,
        tipo,
        descricao,
        oficina: oficina.trim() || null,
        terceiro,
        hodometro: hodometro.trim() || null,
      }),
    onSuccess: async (os) => {
      setErro(null);
      await cliente.invalidateQueries({ queryKey: ['manutencao'] });
      aoAbrir(os.numero);
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao abrir a OS.'),
  });

  const veiculo = apoio.data?.veiculos.find((v) => v.id === veiculoId);
  const pronto = veiculoId !== '' && descricao.trim().length >= 5;

  return (
    <Card destaque="regra">
      <CardTitulo
        acao={
          <Button variante="texto" tamanho="sm" onClick={aoFechar}>
            Fechar
          </Button>
        }
      >
        Abrir ordem de servico
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        {erro && (
          <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
            {erro}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Veiculo" htmlFor="os-veiculo" obrigatorio>
            <select
              id="os-veiculo"
              className={classeControle()}
              value={veiculoId}
              onChange={(e) => {
                setVeiculoId(e.target.value);
                const v = apoio.data?.veiculos.find((x) => x.id === e.target.value);
                // o hodometro atual e a leitura mais provavel na abertura
                if (v) setHodometro(String(v.hodometroAtual));
              }}
            >
              <option value="">Selecione</option>
              {(apoio.data?.veiculos ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa} {v.frotaNumero ? `· frota ${v.frotaNumero}` : ''}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Tipo" htmlFor="os-tipo" obrigatorio ajuda="Preventiva sem plano vinculado tambem vale — o plano marca o ciclo, nao a OS.">
            <select
              id="os-tipo"
              className={classeControle()}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as 'CORRETIVA' | 'PREVENTIVA')}
            >
              <option value="CORRETIVA">Corretiva</option>
              <option value="PREVENTIVA">Preventiva</option>
            </select>
          </Campo>
        </div>

        <Campo
          rotulo="Defeito ou servico"
          htmlFor="os-descricao"
          obrigatorio
          ajuda="Descreva o sintoma como ele foi relatado. E o que o mecanico vai ler na folha."
        >
          <textarea
            id="os-descricao"
            rows={3}
            className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_12rem]">
          <Campo rotulo="Oficina" htmlFor="os-oficina">
            <input id="os-oficina" className={classeControle()} value={oficina} onChange={(e) => setOficina(e.target.value)} />
          </Campo>

          <label className="flex items-center gap-2 self-end pb-2 text-corpo text-ceara-texto">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--ceara-azul)]"
              checked={terceiro}
              onChange={(e) => setTerceiro(e.target.checked)}
            />
            Oficina de terceiro
          </label>

          <Campo
            rotulo="Hodometro"
            htmlFor="os-hodometro-abertura"
            ajuda={veiculo ? `Atual: ${veiculo.hodometroAtual}` : undefined}
          >
            <input
              id="os-hodometro-abertura"
              inputMode="decimal"
              className={classeControle()}
              value={hodometro}
              onChange={(e) => setHodometro(e.target.value)}
            />
          </Campo>
        </div>

        <div className="flex justify-end">
          <Button disabled={!pronto} carregando={abrir.isPending} onClick={() => abrir.mutate()}>
            Abrir OS
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}
