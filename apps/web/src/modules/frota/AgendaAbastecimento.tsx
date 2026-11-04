import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda } from '../compras/tipos';
import { decimal } from './tipos';

interface ItemDaAgenda {
  id: string;
  dataHora: string;
  veiculo: { placa: string; frotaNumero: string };
  motorista: { nome: string };
  posto: string;
  tipoCombustivel: string;
  litros: string;
  valorTotal: string;
  anomalia: boolean;
  confirmado: boolean;
  confirmadoEm: string | null;
}

interface Agenda {
  data: string;
  total: number;
  confirmados: number;
  itens: ItemDaAgenda[];
}

const horaBr = (iso: string): string => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Agenda do dia (secao 7.2): todo abastecimento lancado na data aparece aqui, e o gestor
 * de frota marca o check ao lado depois de conferir. Nao bloqueia nada — o abastecimento
 * ja esta valendo desde o registro — e um segundo olho, nao uma segunda aprovacao.
 */
export function AgendaAbastecimento({ unidadeId }: { unidadeId?: string }) {
  const cliente = useQueryClient();
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState<string | null>(null);

  const parametros = () => {
    const p = new URLSearchParams();
    p.set('data', new Date(`${data}T12:00:00`).toISOString());
    if (unidadeId) p.set('unidadeId', unidadeId);
    return p.toString();
  };

  const agenda = useQuery({
    queryKey: ['abastecimento', 'agenda', data, unidadeId],
    queryFn: () => get<Agenda>(`/transporte/abastecimentos/agenda?${parametros()}`),
  });

  const confirmar = useMutation({
    mutationFn: ({ id, confirmado }: { id: string; confirmado: boolean }) =>
      post(`/transporte/abastecimentos/${id}/confirmar`, { confirmado }),
    onMutate: () => setErro(null),
    onError: (e) => setErro(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel confirmar.'),
    onSettled: () => cliente.invalidateQueries({ queryKey: ['abastecimento', 'agenda'] }),
  });

  const itens = agenda.data?.itens ?? [];
  const hoje = data === new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitulo>Agenda do dia</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Campo rotulo="Data" htmlFor="agenda-data">
              <input
                id="agenda-data"
                type="date"
                className={classeControle()}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </Campo>
            <div className="flex gap-4 text-corpo text-ceara-texto2">
              <span>
                Total: <strong className="text-ceara-texto">{agenda.data?.total ?? 0}</strong>
              </span>
              <span>
                Confirmados: <strong className="text-ceara-verde">{agenda.data?.confirmados ?? 0}</strong>
              </span>
            </div>
          </div>

          {erro && (
            <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
              {erro}
            </p>
          )}

          {agenda.isLoading ? (
            <p className="text-corpo text-ceara-texto2">Carregando...</p>
          ) : itens.length === 0 ? (
            <EstadoVazio
              titulo={hoje ? 'Nenhum abastecimento hoje.' : 'Nenhum abastecimento nesta data.'}
              descricao="Assim que alguem registrar um abastecimento na data escolhida, ele aparece aqui para conferencia."
            />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Hora</Th>
                  <Th>Veiculo</Th>
                  <Th>Motorista</Th>
                  <Th>Posto</Th>
                  <Th>Combustivel</Th>
                  <Th className="text-right">Litros</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Anomalia</Th>
                  <Th className="text-center">Confirmado</Th>
                </Tr>
              </Thead>
              <Tbody>
                {itens.map((item) => (
                  <Tr key={item.id}>
                    <Td className="tabular-nums">{horaBr(item.dataHora)}</Td>
                    <Td>
                      {item.veiculo.placa} · {item.veiculo.frotaNumero}
                    </Td>
                    <Td>{item.motorista.nome}</Td>
                    <Td>{item.posto}</Td>
                    <Td>{item.tipoCombustivel}</Td>
                    <Td className="text-right tabular-nums">{decimal(item.litros, 3)}</Td>
                    <Td className="text-right tabular-nums">{moeda(item.valorTotal)}</Td>
                    <Td>{item.anomalia ? <Badge tom="vermelho">Anomalia</Badge> : <span className="text-ceara-texto2">—</span>}</Td>
                    <Td className="text-center">
                      <label className="inline-flex cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[var(--ceara-azul)] disabled:cursor-wait"
                          checked={item.confirmado}
                          disabled={confirmar.isPending && confirmar.variables?.id === item.id}
                          aria-label={item.confirmado ? 'Desfazer confirmacao' : 'Confirmar abastecimento'}
                          onChange={(e) => confirmar.mutate({ id: item.id, confirmado: e.target.checked })}
                        />
                      </label>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardCorpo>
      </Card>

      <p className="flex items-center gap-2 text-legenda italic text-ceara-texto2">
        <CalendarCheck size={16} className="shrink-0" />
        Confirmar aqui e uma conferencia, nao uma aprovacao: o abastecimento ja vale desde o registro.
      </p>
    </div>
  );
}
