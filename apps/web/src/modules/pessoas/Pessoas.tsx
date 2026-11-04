import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Info, ThumbsDown, ThumbsUp, Users } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { usePermissao } from '../auth/useSessao';
import { FiltroUnidade } from '../frota/FiltroUnidade';
import { Retrato } from '../cadastros/Colaboradores';
import {
  comSinal,
  competenciaAtual,
  competenciaLegivel,
  deslocarCompetencia,
  ROTULO_STATUS,
  tomDoStatus,
  type Colaborador,
  type Criterio,
  type FichaColaborador,
  type PainelSetor,
} from './tipos';

/**
 * Pessoas (secao 9). Ficha do colaborador, lancamento de ocorrencia e painel do setor.
 * O aviso de uso da pontuacao acompanha o numero, por exigencia da secao 9.2.
 */
export function Pessoas() {
  const [unidadeId, setUnidadeId] = useState('');
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const podeLancar = usePermissao('ocorrencia:lancar');
  const podeDecidir = usePermissao('ocorrencia:decidir');

  const consulta = new URLSearchParams({ competencia, ...(unidadeId ? { unidadeId } : {}) }).toString();

  const colaboradores = useQuery({
    queryKey: ['pessoas', 'colaboradores', unidadeId],
    queryFn: () => get<{ itens: Colaborador[] }>(`/pessoas/colaboradores?limite=100${unidadeId ? `&unidadeId=${unidadeId}` : ''}`),
  });

  const painel = useQuery({
    queryKey: ['pessoas', 'painel', consulta],
    queryFn: () => get<PainelSetor>(`/pessoas/painel?${consulta}`),
  });

  const ficha = useQuery({
    queryKey: ['pessoas', 'ficha', selecionado, competencia],
    queryFn: () => get<FichaColaborador>(`/pessoas/colaboradores/${selecionado}?competencia=${competencia}`),
    enabled: Boolean(selecionado),
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Pessoas</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Pontuacao mensal por criterio objetivo, com evidencia, prazo de contestacao e trilha.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Competencia" htmlFor="competencia">
            {/* mes a mes: o gestor compara periodos sem digitar data */}
            <span className="flex items-center gap-1">
              <Button
                variante="secundario"
                tamanho="sm"
                onClick={() => setCompetencia(deslocarCompetencia(competencia, -1))}
                aria-label="Mes anterior"
              >
                <ChevronLeft size={16} aria-hidden />
              </Button>
              <input
                id="competencia"
                type="month"
                className={classeControle()}
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
              />
              <Button
                variante="secundario"
                tamanho="sm"
                disabled={competencia >= competenciaAtual()}
                onClick={() => setCompetencia(deslocarCompetencia(competencia, 1))}
                aria-label="Proximo mes"
              >
                <ChevronRight size={16} aria-hidden />
              </Button>
            </span>
          </Campo>
          <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
        </div>
      </header>

      {painel.data && (
        <p className="flex items-start gap-2 rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto">
          <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
          {painel.data.aviso}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Colaboradores" valor={String(painel.data?.painel.colaboradores ?? 0)} />
        <Kpi rotulo="Media do setor" valor={painel.data?.painel.media?.toString() ?? '—'} />
        <Kpi rotulo="Mediana" valor={painel.data?.painel.mediana?.toString() ?? '—'} />
        <Kpi
          rotulo="Abaixo da base"
          valor={String(painel.data?.painel.abaixoDaBase ?? 0)}
          destaque={(painel.data?.painel.abaixoDaBase ?? 0) > 0 ? 'regra' : 'nenhum'}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardTitulo>Classificacao de {competenciaLegivel(competencia)}</CardTitulo>
          <CardCorpo>
            {painel.data?.ranking === null ? (
              <p className="text-corpo text-ceara-texto2">
                O ranking esta configurado como visivel apenas para a gestao. Consulte a ficha individual.
              </p>
            ) : painel.data && painel.data.ranking && painel.data.ranking.length > 0 ? (
              <Table>
                <Thead>
                  <Tr>
                    <Th>#</Th>
                    <Th>Colaborador</Th>
                    <Th className="text-right">
                      <ThumbsUp size={14} className="inline text-ceara-verde" aria-label="Pontos positivos" />
                    </Th>
                    <Th className="text-right">
                      <ThumbsDown size={14} className="inline text-ceara-vermelho" aria-label="Pontos negativos" />
                    </Th>
                    <Th className="text-right">Pontos</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {painel.data.ranking.map((linha, i) => (
                    <Tr key={linha.colaboradorId}>
                      <Td className={cn('font-medium', i < 3 && 'text-ceara-ouro')}>{i + 1}</Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <Retrato nome={linha.nome} url={linha.fotoUrl ?? null} tamanho={32} />
                          <span>
                            <button
                              type="button"
                              className="text-ceara-azul hover:underline disabled:no-underline"
                              onClick={() => setSelecionado(linha.colaboradorId)}
                              disabled={painel.data?.visibilidade === 'ANONIMIZADO'}
                            >
                              {linha.nome}
                            </button>
                            <p className="text-legenda text-ceara-texto2">
                              {[linha.cargo, linha.setor].filter(Boolean).join(' · ')}
                            </p>
                          </span>
                        </span>
                      </Td>
                      <Td className="text-right text-ceara-verde">
                        {linha.pontosPositivos ? `+${linha.pontosPositivos}` : '—'}
                      </Td>
                      <Td className="text-right text-ceara-vermelho">
                        {linha.pontosNegativos ? `-${linha.pontosNegativos}` : '—'}
                      </Td>
                      <Td className="text-right font-medium">{linha.pontosFinal}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : (
              <EstadoVazio
                titulo="Nenhum colaborador cadastrado"
                descricao="Cadastre os colaboradores do setor para acompanhar a pontuacao mensal."
              />
            )}
          </CardCorpo>
        </Card>

        <Card>
          <CardTitulo
            acao={
              <select
                className={classeControle()}
                value={selecionado ?? ''}
                onChange={(e) => setSelecionado(e.target.value || null)}
                aria-label="Colaborador"
              >
                <option value="">Selecione o colaborador</option>
                {colaboradores.data?.itens.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.matricula} · {c.nome}
                  </option>
                ))}
              </select>
            }
          >
            Ficha do colaborador
          </CardTitulo>
          <CardCorpo>
            {!selecionado && (
              <div className="flex items-center gap-3 text-corpo text-ceara-texto2">
                <Users size={20} aria-hidden />
                Selecione um colaborador para ver o extrato e as ocorrencias da competencia.
              </div>
            )}

            {ficha.data && (
              <Ficha
                ficha={ficha.data}
                competencia={competencia}
                podeLancar={podeLancar}
                podeDecidir={podeDecidir}
              />
            )}
          </CardCorpo>
        </Card>
      </div>
    </div>
  );
}

function Ficha({
  ficha,
  competencia,
  podeLancar,
  podeDecidir,
}: {
  ficha: FichaColaborador;
  competencia: string;
  podeLancar: boolean;
  podeDecidir: boolean;
}) {
  const cliente = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const decidir = useMutation({
    mutationFn: ({ id, manter, justificativa }: { id: string; manter: boolean; justificativa: string }) =>
      post(`/pessoas/ocorrencias/${id}/decidir`, { manter, justificativa }),
    onSuccess: async () => {
      setErro(null);
      await cliente.invalidateQueries({ queryKey: ['pessoas'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a decisao.'),
  });

  const { extrato } = ficha;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Retrato nome={ficha.colaborador.nome} url={ficha.colaborador.fotoUrl ?? null} tamanho={48} />
        <div>
          <p className="text-h3 text-ceara-texto">{ficha.colaborador.nome}</p>
          <p className="text-legenda text-ceara-texto2">
            {ficha.colaborador.cargo} · {ficha.colaborador.setor}
            {ficha.fechado && <span className="ml-2 text-ceara-azul">competencia fechada</span>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero rotulo="Base" valor={String(extrato.pontosBase)} />
        <Numero rotulo="Positivos" valor={`+${extrato.pontosPositivos}`} cor="text-ceara-verde" />
        <Numero rotulo="Negativos" valor={`-${extrato.pontosNegativos}`} cor="text-ceara-vermelho" />
        <Numero rotulo="Final" valor={String(extrato.pontosFinal)} cor="text-ceara-azul" />
      </div>

      {extrato.ocorrenciasIgnoradas > 0 && (
        <p className="text-legenda italic text-ceara-texto2">
          {extrato.ocorrenciasIgnoradas} ocorrencia(s) fora da conta: sugeridas ainda nao validadas, revertidas ou descartadas.
        </p>
      )}

      {erro && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-legenda text-ceara-vermelho">
          {erro}
        </p>
      )}

      {ficha.ocorrencias.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th><span className="sr-only">Tipo</span></Th>
              <Th>Criterio</Th>
              <Th className="text-right">Pontos</Th>
              <Th>Situacao</Th>
              <Th>Fato</Th>
              <Th>Acoes</Th>
            </Tr>
          </Thead>
          <Tbody>
            {ficha.ocorrencias.map((o) => (
              <Tr key={o.id}>
                {/* o sinal do fato antes do numero: verde para cima, vermelho para baixo */}
                <Td>
                  {o.tipo === 'POSITIVO' ? (
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(30,122,68,0.10)]"
                      title="Aspecto positivo"
                    >
                      <ThumbsUp size={15} className="text-ceara-verde" aria-label="Aspecto positivo" />
                    </span>
                  ) : (
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(192,57,43,0.10)]"
                      title="Aspecto negativo"
                    >
                      <ThumbsDown size={15} className="text-ceara-vermelho" aria-label="Aspecto negativo" />
                    </span>
                  )}
                </Td>
                <Td>{o.criterio}</Td>
                <Td
                  className={cn(
                    'text-right font-medium',
                    o.tipo === 'POSITIVO' ? 'text-ceara-verde' : 'text-ceara-vermelho',
                  )}
                >
                  {comSinal(o.pontos)}
                </Td>
                <Td>
                  <Badge tom={tomDoStatus(o.status, o.pontos)}>{ROTULO_STATUS[o.status]}</Badge>
                </Td>
                <Td className="max-w-[20rem]">
                  <p className="truncate">{o.descricao}</p>
                  {o.contestacaoTexto && (
                    <p className="mt-1 truncate text-legenda italic text-ceara-texto2">Defesa: {o.contestacaoTexto}</p>
                  )}
                  {o.decisao && <p className="mt-1 truncate text-legenda text-ceara-texto2">Decisao: {o.decisao}</p>}
                </Td>
                <Td>
                  {podeDecidir && o.status === 'CONTESTADA' && (
                    <div className="flex gap-2">
                      <Button
                        tamanho="sm"
                        variante="secundario"
                        onClick={() => {
                          const justificativa = window.prompt('Justifique a decisao de manter a ocorrencia:');
                          if (justificativa) decidir.mutate({ id: o.id, manter: true, justificativa });
                        }}
                      >
                        Manter
                      </Button>
                      <Button
                        tamanho="sm"
                        variante="destrutivo"
                        onClick={() => {
                          const justificativa = window.prompt('Justifique a reversao da ocorrencia:');
                          if (justificativa) decidir.mutate({ id: o.id, manter: false, justificativa });
                        }}
                      >
                        Reverter
                      </Button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : (
        <p className="text-corpo text-ceara-texto2">Nenhuma ocorrencia nesta competencia.</p>
      )}

      {podeLancar && !ficha.fechado && (
        <LancarOcorrencia colaboradorId={ficha.colaborador.id} competencia={competencia} />
      )}

      {ficha.historico.length > 0 && (
        <div>
          <p className="text-h3 text-ceara-texto">Historico</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ficha.historico.map((h) => (
              <span key={h.competencia} className="rounded-lg border border-ceara-borda px-2 py-1 text-legenda">
                {h.competencia}: <strong className="text-ceara-azul">{h.pontosFinal}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Lancamento de ocorrencia (secao 9.3): criterio, evidencia e descricao factual. */
function LancarOcorrencia({ colaboradorId, competencia }: { colaboradorId: string; competencia: string }) {
  const cliente = useQueryClient();
  const [criterioId, setCriterioId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [evidenciaTipo, setEvidenciaTipo] = useState('');
  const [evidenciaId, setEvidenciaId] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const criterios = useQuery({
    queryKey: ['pessoas', 'criterios'],
    queryFn: () => get<{ itens: Criterio[] }>('/pessoas/criterios'),
    staleTime: 300_000,
  });

  const lancar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => post('/pessoas/ocorrencias', corpo),
    onSuccess: async () => {
      setErro(null);
      setDescricao('');
      setEvidenciaId('');
      await cliente.invalidateQueries({ queryKey: ['pessoas'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao lancar a ocorrencia.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    lancar.mutate({
      colaboradorId,
      criterioId,
      competencia,
      descricao,
      evidenciaTipo: evidenciaTipo || null,
      evidenciaId: evidenciaId || null,
    });
  }

  const selecionado = criterios.data?.itens.find((c) => c.id === criterioId);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 border-t border-ceara-borda pt-4">
      <p className="text-h3 text-ceara-texto">Lancar ocorrencia</p>

      <Campo rotulo="Criterio" htmlFor="criterio" obrigatorio>
        <select id="criterio" required className={classeControle()} value={criterioId} onChange={(e) => setCriterioId(e.target.value)}>
          <option value="">Selecione</option>
          {criterios.data?.itens.map((c) => (
            <option key={c.id} value={c.id}>
              {c.tipo === 'POSITIVO' ? '+' : '-'}
              {c.peso} · {c.descricao}
            </option>
          ))}
        </select>
      </Campo>

      {selecionado && (
        <p className="text-legenda italic text-ceara-texto2">
          Pontos: {selecionado.tipo === 'POSITIVO' ? `+${selecionado.peso}` : `-${selecionado.peso}`}. O valor fica congelado
          no lancamento: mudar o peso depois nao reescreve competencia passada.
        </p>
      )}

      <Campo rotulo="Fato" htmlFor="descricao" obrigatorio ajuda="Descreva o que aconteceu, sem juizo de valor.">
        <textarea
          id="descricao"
          required
          rows={3}
          className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tipo de evidencia" htmlFor="evidencia-tipo" ajuda="Ex.: abastecimentos, multas, ordens de servico.">
          <input id="evidencia-tipo" className={classeControle()} value={evidenciaTipo} onChange={(e) => setEvidenciaTipo(e.target.value)} />
        </Campo>
        <Campo rotulo="Identificador da evidencia" htmlFor="evidencia-id" obrigatorio>
          <input id="evidencia-id" required className={classeControle()} value={evidenciaId} onChange={(e) => setEvidenciaId(e.target.value)} />
        </Campo>
      </div>

      {erro && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-legenda text-ceara-vermelho">
          {erro}
        </p>
      )}

      <Button type="submit" tamanho="sm" carregando={lancar.isPending}>
        Lancar ocorrencia
      </Button>
    </form>
  );
}

function Kpi({ rotulo, valor, destaque = 'nenhum' }: { rotulo: string; valor: string; destaque?: 'nenhum' | 'regra' }) {
  return (
    <Card destaque={destaque}>
      <CardCorpo className="pt-4">
        <p className="text-legenda text-ceara-texto2">{rotulo}</p>
        <p className="text-h2 text-ceara-azul">{valor}</p>
      </CardCorpo>
    </Card>
  );
}

function Numero({ rotulo, valor, cor = 'text-ceara-texto' }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div className="rounded-lg border border-ceara-borda px-3 py-2">
      <p className="text-legenda text-ceara-texto2">{rotulo}</p>
      <p className={`text-h3 ${cor}`}>{valor}</p>
    </div>
  );
}
