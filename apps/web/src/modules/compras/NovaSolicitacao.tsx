import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { useSessao } from '../auth/useSessao';
import {
  CRITICIDADES,
  hojeIso,
  type CentroCusto,
  type Criticidade,
  type TipoDemanda,
  type ItemCatalogo,
} from './solicitacao';

interface LinhaDoFormulario {
  /** chave local da linha, so para o React */
  chave: number;
  itemId: string;
  descricaoLivre: string;
  quantidade: string;
  unidadeMedida: string;
  observacao: string;
}

const linhaVazia = (chave: number): LinhaDoFormulario => ({
  chave,
  itemId: '',
  descricaoLivre: '',
  quantidade: '',
  unidadeMedida: '',
  observacao: '',
});

/**
 * Abertura de solicitacao de compra (secao 6.1.3).
 *
 * Item vem do catalogo curado; descricao livre existe para o que ainda nao esta
 * catalogado e entra pela fila de homologacao (secao 6.1.1). O que nao existe
 * aqui, de proposito: excluir. Solicitacao aberta so se cancela, com motivo.
 */
export function NovaSolicitacao() {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const usuario = useSessao((s) => s.usuario);

  const [centroCustoId, setCentroCustoId] = useState('');
  const [tipo, setTipo] = useState<TipoDemanda>('MATERIAL');
  const [criticidade, setCriticidade] = useState<Criticidade>('P3');
  const [origemDemanda, setOrigemDemanda] = useState('');
  const [dataLimite, setDataLimite] = useState('');
  const [linhas, setLinhas] = useState<LinhaDoFormulario[]>([linhaVazia(1)]);
  const [erro, setErro] = useState<string | null>(null);

  const centros = useQuery({
    queryKey: ['centros-custo'],
    queryFn: () => get<{ itens: CentroCusto[] }>('/centros-custo'),
    staleTime: 300_000,
  });

  const catalogo = useQuery({
    queryKey: ['compras', 'itens'],
    queryFn: () => get<{ itens: ItemCatalogo[] }>('/compras/itens?limite=100'),
    staleTime: 300_000,
  });

  const abrir = useMutation({
    mutationFn: (corpo: unknown) => post<{ id: string; numero: string }>('/compras/solicitacoes', corpo),
    onSuccess: async (criada) => {
      await cliente.invalidateQueries({ queryKey: ['compras', 'solicitacoes'] });
      navegar(`/solicitacoes?nova=${criada.numero}`);
    },
    onError: (falha) =>
      setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao abrir a solicitacao.'),
  });

  // o centro de custo define a unidade; so faz sentido oferecer os da unidade em operacao
  const centrosDaUnidade = (centros.data?.itens ?? []).filter(
    (c) => !usuario?.unidadeAtivaId || c.unidadeId === usuario.unidadeAtivaId,
  );

  function atualizar(chave: number, campo: keyof LinhaDoFormulario, valor: string) {
    setLinhas((atuais) =>
      atuais.map((l) => {
        if (l.chave !== chave) return l;
        const atualizada = { ...l, [campo]: valor };

        // item do catalogo ja traz a unidade de medida - digitar de novo so gera divergencia
        if (campo === 'itemId' && valor) {
          const item = catalogo.data?.itens.find((i) => i.id === valor);
          if (item) {
            atualizada.unidadeMedida = item.unidadeMedida;
            atualizada.descricaoLivre = '';
          }
        }
        return atualizada;
      }),
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    const itens = linhas
      .filter((l) => l.itemId || l.descricaoLivre.trim())
      .map((l) => ({
        itemId: l.itemId || null,
        descricaoLivre: l.itemId ? null : l.descricaoLivre.trim(),
        quantidade: l.quantidade.replace(',', '.'),
        unidadeMedida: l.unidadeMedida.trim(),
        observacao: l.observacao.trim() || null,
      }));

    if (itens.length === 0) {
      setErro('Informe ao menos um item: escolha no catalogo ou descreva o que precisa.');
      return;
    }

    abrir.mutate({ centroCustoId, tipo, criticidade, origemDemanda, dataLimite, itens });
  }

  const slaDaCriticidade = CRITICIDADES.find((c) => c.valor === criticidade)?.sla;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <header>
        <h1 className="text-h1 text-ceara-azul">Nova solicitacao de compra</h1>
        <p className="mt-1 text-legenda italic text-ceara-texto2">
          O que nao esta no sistema nao existe. Depois de aberta, a solicitacao nao se apaga: cancela-se com motivo.
        </p>
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      <Card>
        <CardTitulo>Dados da solicitacao</CardTitulo>
        <CardCorpo className="grid gap-4 sm:grid-cols-2">
          {/*
            O tipo abre o formulario porque muda o resto: servico nao tem catalogo de item
            nem entrada em estoque, e fecha com NFS-e no lugar de NF-e (secao 6.1.11).
          */}
          <Campo
            rotulo="O que voce precisa"
            htmlFor="tipo-demanda"
            obrigatorio
            ajuda={
              tipo === 'SERVICO'
                ? 'Servico fecha com NFS-e e nao entra no estoque. Descreva o servico nos itens.'
                : 'Material entra no estoque e fecha com NF-e.'
            }
          >
            <select
              id="tipo-demanda"
              required
              className={classeControle()}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoDemanda)}
            >
              <option value="MATERIAL">Compra de material</option>
              <option value="SERVICO">Contratacao de servico</option>
            </select>
          </Campo>

          <Campo
            rotulo="Centro de custo"
            htmlFor="centro-custo"
            obrigatorio
            ajuda="Define de onde sai o custo e a qual unidade a solicitacao pertence."
          >
            <select
              id="centro-custo"
              required
              className={classeControle()}
              value={centroCustoId}
              onChange={(e) => setCentroCustoId(e.target.value)}
            >
              <option value="">Selecione</option>
              {centrosDaUnidade.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Criticidade" htmlFor="criticidade" obrigatorio ajuda={slaDaCriticidade}>
            <select
              id="criticidade"
              required
              className={classeControle()}
              value={criticidade}
              onChange={(e) => setCriticidade(e.target.value as Criticidade)}
            >
              {CRITICIDADES.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            rotulo="Origem da demanda"
            htmlFor="origem"
            obrigatorio
            ajuda="De onde nasceu a necessidade: OS, parada de maquina, reposicao de estoque, projeto."
          >
            <input
              id="origem"
              required
              minLength={3}
              className={classeControle()}
              value={origemDemanda}
              onChange={(e) => setOrigemDemanda(e.target.value)}
            />
          </Campo>

          <Campo rotulo="Data-limite" htmlFor="data-limite" obrigatorio ajuda="Quando o material precisa estar em maos.">
            <input
              id="data-limite"
              type="date"
              required
              min={hojeIso()}
              className={classeControle()}
              value={dataLimite}
              onChange={(e) => setDataLimite(e.target.value)}
            />
          </Campo>
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo
          acao={
            <Button
              type="button"
              tamanho="sm"
              variante="secundario"
              iconeEsquerda={<Plus size={14} aria-hidden />}
              onClick={() => setLinhas((a) => [...a, linhaVazia(Date.now())])}
            >
              Adicionar item
            </Button>
          }
        >
          Itens
        </CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          {linhas.map((linha, indice) => (
            <fieldset key={linha.chave} className="rounded-card border border-ceara-borda p-4">
              <legend className="px-2 text-legenda text-ceara-texto2">Item {indice + 1}</legend>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Do catalogo" htmlFor={`item-${linha.chave}`} ajuda="Preferivel: mantem o preco historico e o estoque corretos.">
                  <select
                    id={`item-${linha.chave}`}
                    className={classeControle()}
                    value={linha.itemId}
                    onChange={(e) => atualizar(linha.chave, 'itemId', e.target.value)}
                  >
                    <option value="">Nao esta no catalogo</option>
                    {catalogo.data?.itens.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.codigo} · {i.descricao}
                        {i.statusHomologacao !== 'HOMOLOGADO' ? ' (em homologacao)' : ''}
                      </option>
                    ))}
                  </select>
                </Campo>

                <Campo
                  rotulo="Descricao"
                  htmlFor={`descricao-${linha.chave}`}
                  ajuda={linha.itemId ? 'Preenchida pelo catalogo.' : 'Descreva com especificacao: entra na fila de homologacao.'}
                >
                  <input
                    id={`descricao-${linha.chave}`}
                    className={classeControle()}
                    disabled={Boolean(linha.itemId)}
                    value={
                      linha.itemId
                        ? (catalogo.data?.itens.find((i) => i.id === linha.itemId)?.descricao ?? '')
                        : linha.descricaoLivre
                    }
                    onChange={(e) => atualizar(linha.chave, 'descricaoLivre', e.target.value)}
                  />
                </Campo>

                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="Quantidade" htmlFor={`qtd-${linha.chave}`} obrigatorio>
                    <input
                      id={`qtd-${linha.chave}`}
                      required
                      inputMode="decimal"
                      className={classeControle()}
                      value={linha.quantidade}
                      onChange={(e) => atualizar(linha.chave, 'quantidade', e.target.value)}
                    />
                  </Campo>
                  <Campo rotulo="Unidade" htmlFor={`um-${linha.chave}`} obrigatorio>
                    <input
                      id={`um-${linha.chave}`}
                      required
                      placeholder="UN, KG, L"
                      className={classeControle()}
                      value={linha.unidadeMedida}
                      onChange={(e) => atualizar(linha.chave, 'unidadeMedida', e.target.value.toUpperCase())}
                    />
                  </Campo>
                </div>

                <Campo rotulo="Observacao" htmlFor={`obs-${linha.chave}`}>
                  <input
                    id={`obs-${linha.chave}`}
                    className={classeControle()}
                    value={linha.observacao}
                    onChange={(e) => atualizar(linha.chave, 'observacao', e.target.value)}
                  />
                </Campo>
              </div>

              {linhas.length > 1 && (
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    tamanho="sm"
                    variante="texto"
                    iconeEsquerda={<Trash2 size={14} aria-hidden />}
                    onClick={() => setLinhas((a) => a.filter((l) => l.chave !== linha.chave))}
                  >
                    Remover item
                  </Button>
                </div>
              )}
            </fieldset>
          ))}
        </CardCorpo>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variante="texto" onClick={() => navegar('/solicitacoes')}>
          Cancelar
        </Button>
        <Button type="submit" carregando={abrir.isPending}>
          Abrir solicitacao
        </Button>
      </div>
    </form>
  );
}
