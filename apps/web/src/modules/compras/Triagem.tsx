import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Layers, Undo2 } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { ModalConfirmacao } from '../../design-system/components/ModalConfirmacao';
import {
  COR_CRITICIDADE,
  ROTULO_STATUS,
  TOM_STATUS,
  dataBr,
  descricaoDoItem,
  quantidadeBr,
  type Solicitacao,
} from './solicitacao';

/** Ordem de urgencia: P1 primeiro. */
const ORDEM: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

/**
 * Fila de triagem do comprador (secao 6.1.4).
 *
 * Duas saidas: devolver ao solicitante com motivo (o que suspende o SLA) ou
 * agrupar em lote por familia/fornecedor. O lote nao mistura unidades, e quem
 * abriu a solicitacao nao pode cota-la - as duas regras sao do servidor.
 */
export function Triagem() {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [aDevolver, setADevolver] = useState<Solicitacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const fila = useQuery({
    queryKey: ['compras', 'triagem'],
    queryFn: () => get<{ itens: Solicitacao[] }>('/compras/solicitacoes?limite=100&status=ABERTA'),
    refetchInterval: 60_000,
  });

  const devolver = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      post(`/compras/solicitacoes/${id}/devolver`, { motivo }),
    onSuccess: async () => {
      setErro(null);
      setADevolver(null);
      await cliente.invalidateQueries({ queryKey: ['compras'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao devolver.'),
  });

  const agrupar = useMutation({
    mutationFn: () => post<{ numero: string }>('/compras/lotes', { solicitacaoIds: [...selecionadas] }),
    onSuccess: async (lote) => {
      setErro(null);
      setSelecionadas(new Set());
      await cliente.invalidateQueries({ queryKey: ['compras'] });
      navegar(`/compras?lote=${lote.numero}`);
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao criar o lote.'),
  });

  function alternar(id: string) {
    setSelecionadas((atuais) => {
      const nova = new Set(atuais);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });
  }

  const itens = [...(fila.data?.itens ?? [])].sort(
    (a, b) =>
      (ORDEM[a.criticidade] ?? 9) - (ORDEM[b.criticidade] ?? 9) ||
      new Date(a.dataLimite).getTime() - new Date(b.dataLimite).getTime(),
  );

  const centrosSelecionados = new Set(
    itens.filter((s) => selecionadas.has(s.id)).map((s) => s.centroCusto.codigo),
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Triagem</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Valide a especificacao em ate 4 horas uteis. Devolver ao solicitante suspende o SLA.
          </p>
        </div>

        <Button
          iconeEsquerda={<Layers size={16} aria-hidden />}
          disabled={selecionadas.size === 0}
          carregando={agrupar.isPending}
          onClick={() => agrupar.mutate()}
        >
          Agrupar em lote ({selecionadas.size})
        </Button>
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {selecionadas.size > 0 && (
        <p className="text-legenda text-ceara-texto2">
          {selecionadas.size} solicitacao(oes) selecionada(s) de {centrosSelecionados.size} centro(s) de custo. O SLA do
          lote nasce da criticidade mais alta do conjunto.
        </p>
      )}

      <Card>
        <CardTitulo>{itens.length} solicitacao(oes) aguardando triagem</CardTitulo>
        <CardCorpo>
          {fila.isLoading && <p className="text-corpo text-ceara-texto2">Carregando a fila...</p>}

          {itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <span className="sr-only">Selecionar</span>
                  </Th>
                  <Th>Numero</Th>
                  <Th>Itens</Th>
                  <Th>Centro de custo</Th>
                  <Th>Criticidade</Th>
                  <Th>Data-limite</Th>
                  <Th>Situacao</Th>
                  <Th>Acoes</Th>
                </Tr>
              </Thead>
              <Tbody>
                {itens.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <label className="flex items-center">
                        <span className="sr-only">Selecionar {s.numero}</span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--ceara-azul)]"
                          checked={selecionadas.has(s.id)}
                          onChange={() => alternar(s.id)}
                        />
                      </label>
                    </Td>
                    <Td className="whitespace-nowrap font-mono">{s.numero}</Td>
                    <Td className="max-w-[24rem]">
                      <p className="truncate">{s.itens.map(descricaoDoItem).join(' · ')}</p>
                      <p className="text-legenda text-ceara-texto2">
                        {s.itens.map((i) => `${quantidadeBr(i.quantidade)} ${i.unidadeMedida}`).join(', ')} ·{' '}
                        {s.origemDemanda}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap">{s.centroCusto.codigo}</Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className={`inline-block h-3 w-1 rounded ${COR_CRITICIDADE[s.criticidade]}`} aria-hidden />
                        {s.criticidade}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{dataBr(s.dataLimite)}</Td>
                    <Td>
                      <Badge tom={TOM_STATUS[s.status]}>{ROTULO_STATUS[s.status]}</Badge>
                    </Td>
                    <Td>
                      <Button
                        tamanho="sm"
                        variante="secundario"
                        iconeEsquerda={<Undo2 size={14} aria-hidden />}
                        onClick={() => setADevolver(s)}
                      >
                        Devolver
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            !fila.isLoading && (
              <EstadoVazio
                titulo="Fila de triagem vazia"
                descricao="Nenhuma solicitacao aguardando validacao de especificacao."
              />
            )
          )}
        </CardCorpo>
      </Card>

      <ModalConfirmacao
        aberto={aDevolver !== null}
        titulo={`Devolver a solicitacao ${aDevolver?.numero ?? ''}`}
        descricao="O solicitante e notificado com o motivo e o SLA fica suspenso ate ele responder. A solicitacao continua no sistema."
        rotuloConfirmar="Devolver ao solicitante"
        exigirMotivo
        onCancelar={() => setADevolver(null)}
        onConfirmar={(motivo) => aDevolver && devolver.mutate({ id: aDevolver.id, motivo: motivo! })}
      />
    </div>
  );
}
