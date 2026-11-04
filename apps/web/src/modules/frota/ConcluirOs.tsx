import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { type OrdemServico, type TipoConclusaoOs } from './tipos';

/**
 * Fechamento da OS (secao 7.5): a folha volta da bancada e o que esta nela entra aqui.
 *
 * Total x parcial nao e rotulo de relatorio. A parcial deixa trabalho para tras, exige
 * dizer o que ficou e, por padrao, abre a OS que carrega essa pendencia — do contrario
 * ela vira uma frase que ninguem mais consulta.
 */
export function ConcluirOs({
  os,
  aoFechar,
  aoConcluir,
}: {
  os: OrdemServico;
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const cliente = useQueryClient();
  const [tipo, setTipo] = useState<TipoConclusaoOs>('TOTAL');
  const [mecanico, setMecanico] = useState('');
  const [anotacoes, setAnotacoes] = useState('');
  const [pendencia, setPendencia] = useState('');
  const [hodometro, setHodometro] = useState('');
  const [abrirOsDeRetorno, setAbrirRetorno] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const concluir = useMutation({
    mutationFn: () =>
      post<{ retorno: { numero: string } | null }>(`/transporte/manutencao/ordens/${os.id}/concluir`, {
        tipo,
        mecanico,
        anotacoes: anotacoes.trim() || null,
        pendencia: tipo === 'PARCIAL' ? pendencia : null,
        hodometro: hodometro.trim() || null,
        abrirOsDeRetorno,
      }),
    onSuccess: async (r) => {
      setErro(null);
      // a lista de OS vive sob 'manutencao'; sem invalidar as duas, a linha fica com o
      // status velho na tela enquanto o banco ja registrou a conclusao
      await Promise.all([
        cliente.invalidateQueries({ queryKey: ['manutencao'] }),
        cliente.invalidateQueries({ queryKey: ['frota'] }),
      ]);
      aoConcluir(
        r?.retorno
          ? `OS concluida parcialmente. A pendencia seguiu na ${r.retorno.numero}.`
          : 'OS concluida.',
      );
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao concluir a OS.'),
  });

  const pronto = mecanico.trim().length >= 3 && (tipo === 'TOTAL' || pendencia.trim().length >= 5);

  return (
    <Card destaque="regra">
      <CardTitulo
        acao={
          <Button variante="texto" tamanho="sm" onClick={aoFechar}>
            Fechar
          </Button>
        }
      >
        Concluir {os.numero} · {os.veiculo.placa}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        {erro && (
          <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
            {erro}
          </p>
        )}

        <div>
          <p className="mb-2 text-h3 text-ceara-texto">O servico foi concluido</p>
          <div className="flex flex-wrap gap-2">
            {(['TOTAL', 'PARCIAL'] as TipoConclusaoOs[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                aria-current={tipo === t}
                className={
                  tipo === t
                    ? 'rounded-lg border border-ceara-azul bg-[var(--ceara-azul-10)] px-4 py-2 text-corpo font-medium text-ceara-azul'
                    : 'rounded-lg border border-ceara-borda px-4 py-2 text-corpo text-ceara-texto hover:border-ceara-azul'
                }
              >
                {t === 'TOTAL' ? 'Totalmente — nada pendente' : 'Parcialmente — ficou pendencia'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Quem executou" htmlFor="os-mecanico" obrigatorio ajuda="Mecanico da casa ou da oficina de terceiro.">
            <input id="os-mecanico" className={classeControle()} value={mecanico} onChange={(e) => setMecanico(e.target.value)} />
          </Campo>
          <Campo rotulo="Hodometro no fechamento" htmlFor="os-hodometro" ajuda="Atualiza a leitura do veiculo; so avanca.">
            <input id="os-hodometro" inputMode="decimal" className={classeControle()} value={hodometro} onChange={(e) => setHodometro(e.target.value)} />
          </Campo>
        </div>

        <Campo
          rotulo="Anotacoes do mecanico"
          htmlFor="os-anotacoes"
          ajuda="Transcreva o que veio escrito na folha: o que foi feito, o que se descobriu com a maquina aberta."
        >
          <textarea
            id="os-anotacoes"
            rows={4}
            className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
            value={anotacoes}
            onChange={(e) => setAnotacoes(e.target.value)}
          />
        </Campo>

        {tipo === 'PARCIAL' && (
          <div className="flex flex-col gap-3 rounded-card bg-ceara-nevoa p-3">
            <Campo
              rotulo="O que ficou pendente"
              htmlFor="os-pendencia"
              obrigatorio
              ajuda="Vira a descricao da OS de retorno. Sem isso, a pendencia se perde ate virar quebra na estrada."
            >
              <textarea
                id="os-pendencia"
                rows={2}
                className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
                value={pendencia}
                onChange={(e) => setPendencia(e.target.value)}
              />
            </Campo>

            <label className="flex items-center gap-2 text-corpo text-ceara-texto">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--ceara-azul)]"
                checked={abrirOsDeRetorno}
                onChange={(e) => setAbrirRetorno(e.target.checked)}
              />
              Abrir automaticamente a OS de retorno com esta pendencia
            </label>
          </div>
        )}

        <div className="flex justify-end">
          <Button disabled={!pronto} carregando={concluir.isPending} onClick={() => concluir.mutate()}>
            {tipo === 'PARCIAL' ? 'Concluir parcialmente' : 'Concluir'}
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}
