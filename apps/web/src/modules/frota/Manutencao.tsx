import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, ListPlus, Plus, Printer } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { ModalConfirmacao } from '../../design-system/components/ModalConfirmacao';
import { moeda } from '../compras/tipos';
import { FiltroUnidade } from './FiltroUnidade';
import { AbrirOs } from './AbrirOs';
import { ConcluirOs } from './ConcluirOs';
import { FolhaDaOs } from './FolhaDaOs';
import { ItensDaOs } from './ItensDaOs';
import { decimal, type OrdemServico, type PlanoNoPainel } from './tipos';

interface PainelPlanos {
  planos: PlanoNoPainel[];
  resumo: { vencidos: number; emAlerta: number; emDia: number };
}

interface Indicadores {
  ordens: number;
  custoTotal: string;
  custoPreventiva: string;
  custoCorretiva: string;
  indicePreventiva: number | null;
  mttrHoras: string | null;
  disponibilidadeMedia: number | null;
  memoriaDeCalculo: Record<string, string | number>;
}

const ROTULO_STATUS_OS: Record<OrdemServico['status'], string> = {
  ABERTA: 'Aberta',
  EM_EXECUCAO: 'Em execucao',
  AGUARDANDO_PECA: 'Aguardando peca',
  CONCLUIDA: 'Concluida',
  CANCELADA: 'Cancelada',
};

const percentual = (valor: number | null): string =>
  valor === null ? 'sem base' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(valor * 100)}%`;

/** Manutencao (secao 7.5): preventivas por gatilho e ordens de servico com custo rastreado. */
export function Manutencao() {
  const cliente = useQueryClient();
  const [unidadeId, setUnidadeId] = useState('');
  const [aCancelar, setACancelar] = useState<OrdemServico | null>(null);
  const [aConcluir, setAConcluir] = useState<OrdemServico | null>(null);
  const [aImprimir, setAImprimir] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [vendoItens, setVendoItens] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const consulta = unidadeId ? `?unidadeId=${unidadeId}` : '';

  const planos = useQuery({
    queryKey: ['manutencao', 'planos', unidadeId],
    queryFn: () => get<PainelPlanos>(`/transporte/manutencao/planos${consulta}`),
  });

  const ordens = useQuery({
    queryKey: ['manutencao', 'ordens', unidadeId],
    queryFn: () => get<{ itens: OrdemServico[] }>(`/transporte/manutencao/ordens?limite=50${unidadeId ? `&unidadeId=${unidadeId}` : ''}`),
  });

  const indicadores = useQuery({
    queryKey: ['manutencao', 'indicadores', unidadeId],
    queryFn: () => get<Indicadores>(`/transporte/manutencao/indicadores${consulta}`),
  });

  const acao = useMutation({
    mutationFn: ({ id, rota, corpo }: { id: string; rota: string; corpo?: unknown }) =>
      post(`/transporte/manutencao/ordens/${id}/${rota}`, corpo),
    onSuccess: async () => {
      setErro(null);
      setACancelar(null);
      await cliente.invalidateQueries({ queryKey: ['manutencao'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao atualizar a OS.'),
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Manutencao</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Preventiva por km, horas ou data. Peca requisitada na OS baixa o estoque e fica vinculada ao veiculo.
          </p>
        </div>
        <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {aviso && (
        <p className="rounded-card border-l-4 border-ceara-verde bg-[rgba(30,122,68,0.08)] px-4 py-3 text-corpo text-ceara-verde">
          {aviso}
        </p>
      )}

      {abrindo && (
        <AbrirOs
          aoFechar={() => setAbrindo(false)}
          aoAbrir={(numero) => {
            setAbrindo(false);
            setErro(null);
            setAviso(`${numero} aberta. Lance as pecas e servicos antes de concluir.`);
          }}
        />
      )}

      {vendoItens && <ItensDaOs osId={vendoItens} aoFechar={() => setVendoItens(null)} />}

      {aConcluir && (
        <ConcluirOs
          os={aConcluir}
          aoFechar={() => setAConcluir(null)}
          aoConcluir={(mensagem) => {
            setAConcluir(null);
            setErro(null);
            setAviso(mensagem);
          }}
        />
      )}

      {aImprimir && <FolhaDaOs osId={aImprimir} aoFechar={() => setAImprimir(null)} />}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Preventivas vencidas" valor={String(planos.data?.resumo.vencidos ?? 0)} destaque="risco" Icone={AlertTriangle} />
        <Kpi rotulo="Preventivas em alerta" valor={String(planos.data?.resumo.emAlerta ?? 0)} destaque="regra" Icone={Clock} />
        <Kpi rotulo="Custo de manutencao no mes" valor={moeda(indicadores.data?.custoTotal ?? '0')} />
        <Kpi
          rotulo="Indice de preventiva"
          valor={percentual(indicadores.data?.indicePreventiva ?? null)}
          destaque={(indicadores.data?.indicePreventiva ?? 0) >= 0.5 ? 'ok' : 'nenhum'}
          Icone={CheckCircle2}
        />
      </section>

      <Card>
        <CardTitulo>Planos preventivos</CardTitulo>
        <CardCorpo>
          {planos.data && planos.data.planos.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Veiculo</Th>
                  <Th>Plano</Th>
                  <Th>Situacao</Th>
                  <Th>Falta</Th>
                  <Th>Proximo</Th>
                </Tr>
              </Thead>
              <Tbody>
                {planos.data.planos.map((p) => (
                  <Tr key={p.planoId}>
                    <Td>
                      {p.frotaNumero} · {p.placa}
                    </Td>
                    <Td>{p.descricao}</Td>
                    <Td>
                      <Badge tom={p.situacao === 'VENCIDO' ? 'vermelho' : p.situacao === 'EM_ALERTA' ? 'ouro' : 'verde'}>
                        {p.situacao === 'VENCIDO' ? 'Vencida' : p.situacao === 'EM_ALERTA' ? 'Em alerta' : 'Em dia'}
                      </Badge>
                    </Td>
                    <Td className={p.situacao === 'VENCIDO' ? 'text-ceara-vermelho' : undefined}>
                      {decimal(p.faltam, 0)} {p.unidade}
                    </Td>
                    <Td>
                      {p.proximoValor
                        ? `${decimal(p.proximoValor, 0)} ${p.unidade}`
                        : p.proximoEm
                          ? new Date(p.proximoEm).toLocaleDateString('pt-BR')
                          : '—'}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio
              titulo="Nenhum plano preventivo cadastrado"
              descricao="Cadastre planos por km, horas ou data para o alerta chegar antes da quebra."
            />
          )}
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo
          acao={
            <Button tamanho="sm" iconeEsquerda={<Plus size={14} aria-hidden />} onClick={() => setAbrindo(true)}>
              Abrir OS
            </Button>
          }
        >
          Ordens de servico
        </CardTitulo>
        <CardCorpo>
          {ordens.data && ordens.data.itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Numero</Th>
                  <Th>Veiculo</Th>
                  <Th>Tipo</Th>
                  <Th>Descricao</Th>
                  <Th>Status</Th>
                  <Th>Pecas</Th>
                  <Th>Mao de obra</Th>
                  <Th>Total</Th>
                  <Th>Parado</Th>
                  <Th>Acoes</Th>
                </Tr>
              </Thead>
              <Tbody>
                {ordens.data.itens.map((os) => (
                  <Tr key={os.id}>
                    <Td className="font-mono">{os.numero}</Td>
                    <Td>
                      {os.veiculo.frotaNumero} · {os.veiculo.placa}
                    </Td>
                    <Td>
                      <Badge tom={os.tipo === 'PREVENTIVA' ? 'azul' : 'ouro'}>
                        {os.tipo === 'PREVENTIVA' ? 'Preventiva' : 'Corretiva'}
                      </Badge>
                    </Td>
                    <Td className="max-w-[22rem] truncate">
                      {os.descricao}
                    </Td>
                    <Td>
                      <Badge tom={os.status === 'CONCLUIDA' ? 'verde' : os.status === 'CANCELADA' ? 'neutro' : 'azul'}>
                        {ROTULO_STATUS_OS[os.status]}
                      </Badge>
                    </Td>
                    <Td>{moeda(os.custoPecas)}</Td>
                    <Td>{moeda(os.custoMaoObra)}</Td>
                    <Td className="font-medium">{moeda(os.custoTotal)}</Td>
                    <Td>{os.tempoParadoHoras ? `${decimal(os.tempoParadoHoras, 1)} h` : '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {/* a folha vai para a bancada em qualquer estagio, inclusive depois de concluida */}
                        <Button
                          tamanho="sm"
                          variante="secundario"
                          iconeEsquerda={<Printer size={13} aria-hidden />}
                          onClick={() => setAImprimir(os.id)}
                        >
                          Folha
                        </Button>
                        <Button
                          tamanho="sm"
                          variante="secundario"
                          iconeEsquerda={<ListPlus size={13} aria-hidden />}
                          onClick={() => setVendoItens(os.id)}
                        >
                          Itens ({os.itens.length})
                        </Button>
                        {os.status === 'ABERTA' && (
                          <Button
                            tamanho="sm"
                            variante="secundario"
                            onClick={() => acao.mutate({ id: os.id, rota: 'iniciar' })}
                          >
                            Iniciar
                          </Button>
                        )}
                        {(os.status === 'ABERTA' || os.status === 'EM_EXECUCAO' || os.status === 'AGUARDANDO_PECA') && (
                          <>
                            <Button tamanho="sm" onClick={() => setAConcluir(os)}>
                              Concluir
                            </Button>
                            <Button tamanho="sm" variante="destrutivo" onClick={() => setACancelar(os)}>
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio titulo="Nenhuma ordem de servico" descricao="As OS aparecem aqui assim que forem abertas." />
          )}
        </CardCorpo>
      </Card>

      {indicadores.data && (
        <Card>
          <CardTitulo>Memoria de calculo</CardTitulo>
          <CardCorpo>
            <dl className="grid gap-2 text-legenda text-ceara-texto2 sm:grid-cols-2">
              <p>
                MTTR: {indicadores.data.mttrHoras ? `${decimal(indicadores.data.mttrHoras, 2)} h` : 'sem base'} · Disponibilidade
                media: {percentual(indicadores.data.disponibilidadeMedia)}
              </p>
              {Object.entries(indicadores.data.memoriaDeCalculo).map(([chave, texto]) => (
                <p key={chave}>
                  <span className="font-medium text-ceara-texto">{chave}:</span> {String(texto)}
                </p>
              ))}
            </dl>
          </CardCorpo>
        </Card>
      )}

      <ModalConfirmacao
        aberto={aCancelar !== null}
        titulo={`Cancelar a OS ${aCancelar?.numero ?? ''}`}
        descricao="A OS nao e excluida: fica registrada como cancelada, com o motivo e o autor. OS que ja consumiu peca do estoque exige estorno antes."
        rotuloConfirmar="Cancelar OS"
        exigirMotivo
        destrutivo
        onCancelar={() => setACancelar(null)}
        onConfirmar={(motivo) => aCancelar && acao.mutate({ id: aCancelar.id, rota: 'cancelar', corpo: { motivo } })}
      />
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  destaque = 'nenhum',
  Icone,
}: {
  rotulo: string;
  valor: string;
  destaque?: 'nenhum' | 'regra' | 'risco' | 'ok';
  Icone?: typeof AlertTriangle;
}) {
  return (
    <Card destaque={destaque}>
      <CardCorpo className="flex items-center gap-3 pt-4">
        {Icone && <Icone size={20} className="text-ceara-azul" aria-hidden />}
        <div>
          <p className="text-legenda text-ceara-texto2">{rotulo}</p>
          <p className="text-h2 text-ceara-azul">{valor}</p>
        </div>
      </CardCorpo>
    </Card>
  );
}
