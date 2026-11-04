import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { moeda } from './tipos';
import { itensDoLote, type Cotacao, type LoteDetalhado } from './lote';
import { EvidenciasDaCotacao } from './EvidenciasDaCotacao';

/**
 * Registro da proposta que o fornecedor mandou (secao 6.1.5).
 *
 * Nao e edicao: o servidor recusa segunda resposta na mesma cotacao, porque
 * sobrescrever apagaria os precos originais. Proposta corrigida exige nova rodada.
 * A tela diz isso antes, para o comprador nao descobrir depois de digitar tudo.
 */
export function RegistrarProposta({
  lote,
  cotacao,
  aoConcluir,
}: {
  lote: LoteDetalhado;
  cotacao: Cotacao;
  aoConcluir: () => void;
}) {
  const cliente = useQueryClient();
  const itens = itensDoLote(lote);

  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [condicaoPagamento, setCondicaoPagamento] = useState('30 dias');
  const [prazoDias, setPrazoDias] = useState('30');
  const [prazoEntregaDias, setPrazoEntregaDias] = useState('7');
  const [freteTipo, setFreteTipo] = useState<'CIF' | 'FOB'>('CIF');
  const [freteValor, setFreteValor] = useState('');
  const [descontoAvista, setDescontoAvista] = useState('');
  const [marcas, setMarcas] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  const registrar = useMutation({
    mutationFn: (corpo: unknown) => post(`/compras/cotacoes/${cotacao.id}/resposta`, corpo),
    onSuccess: async () => {
      setErro(null);
      await cliente.invalidateQueries({ queryKey: ['compras', 'lote', lote.id] });
      aoConcluir();
    },
    onError: (falha) =>
      setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a proposta.'),
  });

  const recusar = useMutation({
    mutationFn: (motivo: string) => post(`/compras/cotacoes/${cotacao.id}/recusa`, { motivo }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['compras', 'lote', lote.id] });
      aoConcluir();
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a recusa.'),
  });

  // total de face, so para o comprador conferir enquanto digita
  const totalItens = itens.reduce((soma, item) => {
    const preco = Number((precos[item.id] ?? '0').replace(',', '.'));
    return soma + (Number.isNaN(preco) ? 0 : preco * Number(item.quantidade));
  }, 0);
  const frete = Number((freteValor || '0').replace(',', '.')) || 0;
  const desconto = Number((descontoAvista || '0').replace(',', '.')) || 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();

    const informados = itens
      .filter((i) => (precos[i.id] ?? '').trim())
      .map((i) => ({
        solicitacaoItemId: i.id,
        precoUnitario: precos[i.id]!.replace(',', '.'),
        quantidade: i.quantidade,
        marcaOfertada: marcas[i.id]?.trim() || null,
      }));

    if (informados.length === 0) {
      setErro('Informe o preco de ao menos um item.');
      return;
    }

    registrar.mutate({
      condicaoPagamento,
      prazoDias: Number(prazoDias),
      prazoEntregaDias: Number(prazoEntregaDias),
      freteTipo,
      freteValor: freteValor ? freteValor.replace(',', '.') : null,
      descontoAvista: descontoAvista ? descontoAvista.replace(',', '.') : null,
      itens: informados,
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-card border border-ceara-borda bg-white p-4">
      <div>
        <p className="text-h3 text-ceara-texto">Proposta de {cotacao.fornecedor.razaoSocial}</p>
        <p className="text-legenda italic text-ceara-texto2">
          A proposta e registrada uma vez. Correcao do fornecedor exige nova rodada de cotacao — os precos
          originais nao se apagam.
        </p>
      </div>

      {erro && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-legenda text-ceara-vermelho">
          {erro}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {itens.map((item) => (
          <div key={item.id} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
            <div className="text-corpo">
              <p className="truncate">{item.descricaoLivre ?? 'Item do catalogo'}</p>
              <p className="text-legenda text-ceara-texto2">
                {item.solicitacao} · {item.quantidade} {item.unidadeMedida}
              </p>
            </div>

            <Campo rotulo="Preco unitario" htmlFor={`preco-${item.id}`}>
              <input
                id={`preco-${item.id}`}
                inputMode="decimal"
                placeholder="0,00"
                className={classeControle()}
                value={precos[item.id] ?? ''}
                onChange={(e) => setPrecos((p) => ({ ...p, [item.id]: e.target.value }))}
              />
            </Campo>

            <Campo rotulo="Marca ofertada" htmlFor={`marca-${item.id}`}>
              <input
                id={`marca-${item.id}`}
                className={classeControle()}
                value={marcas[item.id] ?? ''}
                onChange={(e) => setMarcas((m) => ({ ...m, [item.id]: e.target.value }))}
              />
            </Campo>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Condicao de pagamento" htmlFor="condicao" obrigatorio>
          <input
            id="condicao"
            required
            className={classeControle()}
            value={condicaoPagamento}
            onChange={(e) => setCondicaoPagamento(e.target.value)}
          />
        </Campo>

        <Campo rotulo="Prazo de pagamento (dias)" htmlFor="prazo" obrigatorio ajuda="Entra no calculo de valor presente.">
          <input
            id="prazo"
            type="number"
            min={0}
            required
            className={classeControle()}
            value={prazoDias}
            onChange={(e) => setPrazoDias(e.target.value)}
          />
        </Campo>

        <Campo rotulo="Prazo de entrega (dias)" htmlFor="entrega" obrigatorio>
          <input
            id="entrega"
            type="number"
            min={0}
            required
            className={classeControle()}
            value={prazoEntregaDias}
            onChange={(e) => setPrazoEntregaDias(e.target.value)}
          />
        </Campo>

        <Campo rotulo="Frete" htmlFor="frete-tipo">
          <select
            id="frete-tipo"
            className={classeControle()}
            value={freteTipo}
            onChange={(e) => setFreteTipo(e.target.value as 'CIF' | 'FOB')}
          >
            <option value="CIF">CIF · por conta do fornecedor</option>
            <option value="FOB">FOB · por nossa conta</option>
          </select>
        </Campo>

        <Campo rotulo="Valor do frete" htmlFor="frete-valor" ajuda="Somado ao total na comparacao.">
          <input
            id="frete-valor"
            inputMode="decimal"
            className={classeControle()}
            value={freteValor}
            onChange={(e) => setFreteValor(e.target.value)}
          />
        </Campo>

        <Campo rotulo="Desconto a vista" htmlFor="desconto" ajuda="Abatido do total.">
          <input
            id="desconto"
            inputMode="decimal"
            className={classeControle()}
            value={descontoAvista}
            onChange={(e) => setDescontoAvista(e.target.value)}
          />
        </Campo>
      </div>

      <EvidenciasDaCotacao cotacaoId={cotacao.id} loteId={lote.id} />

      <p className="text-corpo text-ceara-texto2">
        Total de face: <strong className="text-ceara-texto">{moeda((totalItens + frete - desconto).toFixed(2))}</strong>
        <span className="ml-2 text-legenda italic">
          O ranking usa valor presente, nao este numero: prazo maior vale desconto.
        </span>
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variante="destrutivo"
          tamanho="sm"
          carregando={recusar.isPending}
          onClick={() => {
            const motivo = window.prompt('Motivo da recusa ou da nao resposta do fornecedor:');
            if (motivo) recusar.mutate(motivo);
          }}
        >
          Registrar recusa
        </Button>
        <Button type="button" variante="texto" tamanho="sm" onClick={aoConcluir}>
          Fechar
        </Button>
        <Button type="submit" tamanho="sm" carregando={registrar.isPending}>
          Registrar proposta
        </Button>
      </div>
    </form>
  );
}
