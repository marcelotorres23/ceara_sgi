import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Plus } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { ModalConfirmacao } from '../../design-system/components/ModalConfirmacao';
import { usePermissao } from '../auth/useSessao';
import {
  COR_CRITICIDADE,
  ROTULO_TIPO,
  ROTULO_STATUS,
  TOM_STATUS,
  dataBr,
  descricaoDoItem,
  quantidadeBr,
  type Solicitacao,
  type StatusSolicitacao,
} from './solicitacao';

const FILTROS: Array<{ valor: string; rotulo: string }> = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'ABERTA', rotulo: 'Abertas' },
  { valor: 'EM_TRIAGEM', rotulo: 'Em triagem' },
  { valor: 'DEVOLVIDA', rotulo: 'Devolvidas' },
  { valor: 'EM_LOTE', rotulo: 'Em cotacao' },
  { valor: 'ATENDIDA', rotulo: 'Atendidas' },
  { valor: 'CANCELADA', rotulo: 'Canceladas' },
];

/** Estados em que ainda cabe cancelar (o backend confirma). */
const CANCELAVEL: StatusSolicitacao[] = ['ABERTA', 'EM_TRIAGEM', 'DEVOLVIDA'];

/** Acompanhamento das proprias solicitacoes (secao 6.1.3). */
export function MinhasSolicitacoes() {
  const cliente = useQueryClient();
  const [parametros, setParametros] = useSearchParams();
  const [status, setStatus] = useState('');
  const [apenasMeus, setApenasMeus] = useState(true);
  const [aCancelar, setACancelar] = useState<Solicitacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const podeCriar = usePermissao('solicitacao:criar');
  const novaCriada = parametros.get('nova');

  const consulta = new URLSearchParams({
    limite: '50',
    ...(status ? { status } : {}),
    ...(apenasMeus ? { apenasMeus: 'true' } : {}),
  }).toString();

  const solicitacoes = useQuery({
    queryKey: ['compras', 'solicitacoes', consulta],
    queryFn: () => get<{ itens: Solicitacao[] }>(`/compras/solicitacoes?${consulta}`),
  });

  const cancelar = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      post(`/compras/solicitacoes/${id}/cancelar`, { motivo }),
    onSuccess: async () => {
      setErro(null);
      setACancelar(null);
      await cliente.invalidateQueries({ queryKey: ['compras', 'solicitacoes'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao cancelar.'),
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Solicitacoes de compra</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Acompanhe o que voce pediu, do aberto ao atendido.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-legenda text-ceara-texto2">
            <input
              type="checkbox"
              checked={apenasMeus}
              onChange={(e) => setApenasMeus(e.target.checked)}
              className="h-4 w-4 accent-[var(--ceara-azul)]"
            />
            So as minhas
          </label>

          <label className="flex items-center gap-2">
            <span className="sr-only">Filtrar por situacao</span>
            <select className={classeControle()} value={status} onChange={(e) => setStatus(e.target.value)}>
              {FILTROS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.rotulo}
                </option>
              ))}
            </select>
          </label>

          {podeCriar && (
            <Link to="/solicitacoes/nova">
              <Button iconeEsquerda={<Plus size={16} aria-hidden />}>Nova solicitacao</Button>
            </Link>
          )}
        </div>
      </header>

      {novaCriada && (
        <p className="flex items-center gap-2 rounded-card border-l-4 border-ceara-verde bg-[rgba(30,122,68,0.08)] px-4 py-3 text-corpo text-ceara-verde">
          <CheckCircle2 size={18} aria-hidden />
          Solicitacao {novaCriada} aberta. O comprador tem 4 horas uteis para triar.
          <button type="button" className="ml-auto underline" onClick={() => setParametros({})}>
            fechar
          </button>
        </p>
      )}

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      <Card>
        <CardTitulo>{solicitacoes.data?.itens.length ?? 0} solicitacao(oes)</CardTitulo>
        <CardCorpo>
          {solicitacoes.isLoading && <p className="text-corpo text-ceara-texto2">Carregando...</p>}

          {solicitacoes.data && solicitacoes.data.itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Numero</Th>
                  <Th>Tipo</Th>
                  <Th>Itens</Th>
                  <Th>Centro de custo</Th>
                  <Th>Criticidade</Th>
                  <Th>Data-limite</Th>
                  <Th>Situacao</Th>
                  <Th>Acoes</Th>
                </Tr>
              </Thead>
              <Tbody>
                {solicitacoes.data.itens.map((s) => (
                  <Tr key={s.id}>
                    <Td className="whitespace-nowrap font-mono">{s.numero}</Td>
                    <Td>
                      <Badge tom={s.tipo === 'SERVICO' ? 'ouro' : 'neutro'}>{ROTULO_TIPO[s.tipo]}</Badge>
                    </Td>
                    <Td className="max-w-[24rem]">
                      <p className="truncate">{s.itens.map(descricaoDoItem).join(' · ')}</p>
                      <p className="text-legenda text-ceara-texto2">
                        {s.itens.length} item(ns) ·{' '}
                        {s.itens.map((i) => `${quantidadeBr(i.quantidade)} ${i.unidadeMedida}`).join(', ')}
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
                      {s.motivoDevolucao && s.status === 'DEVOLVIDA' && (
                        <p className="mt-1 max-w-[16rem] text-legenda italic text-ceara-texto2">
                          {s.motivoDevolucao}
                        </p>
                      )}
                      {s.motivoCancelamento && (
                        <p className="mt-1 max-w-[16rem] text-legenda italic text-ceara-texto2">
                          {s.motivoCancelamento}
                        </p>
                      )}
                    </Td>
                    <Td>
                      {CANCELAVEL.includes(s.status) && (
                        <Button tamanho="sm" variante="destrutivo" onClick={() => setACancelar(s)}>
                          Cancelar
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            !solicitacoes.isLoading && (
              <EstadoVazio
                titulo="Nenhuma solicitacao por aqui"
                descricao="Abra uma solicitacao para que a compra entre no fluxo, com prazo e responsavel."
                acao={
                  podeCriar ? (
                    <Link to="/solicitacoes/nova">
                      <Button tamanho="sm">Nova solicitacao</Button>
                    </Link>
                  ) : undefined
                }
              />
            )
          )}
        </CardCorpo>
      </Card>

      <ModalConfirmacao
        aberto={aCancelar !== null}
        titulo={`Cancelar a solicitacao ${aCancelar?.numero ?? ''}`}
        descricao="A solicitacao nao e excluida: fica registrada como cancelada, com o motivo, o autor e a data. O solicitante e notificado."
        rotuloConfirmar="Cancelar solicitacao"
        exigirMotivo
        destrutivo
        onCancelar={() => setACancelar(null)}
        onConfirmar={(motivo) => aCancelar && cancelar.mutate({ id: aCancelar.id, motivo: motivo! })}
      />
    </div>
  );
}
