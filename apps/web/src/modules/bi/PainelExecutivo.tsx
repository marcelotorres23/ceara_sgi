import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { get, post, baixarArquivo, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda } from '../compras/tipos';
import { FiltroUnidade } from '../frota/FiltroUnidade';

interface Variacao {
  atual: string;
  anterior: string;
  diferenca: string;
  percentual: number | null;
  sentido: 'ALTA' | 'QUEDA' | 'ESTAVEL';
}

interface Executivo {
  competencia: string;
  gasto: { total: string; acumuladoNoAno: string; comparativo: Variacao };
  compras: {
    lotes: number;
    savings: string;
    savingsPercentual: number | null;
    aderenciaSla: number | null;
    taxaEmergencial: number | null;
  };
  frota: { custoTotal: string; combustivel: string; manutencao: string; kmRodados: string; custoPorKm: string | null };
  estoque: { valorImobilizado: string; percentualSemGiro: number | null; itensSemGiro: number };
  fornecedores: {
    otif: number | null;
    indiceDivergencia: number | null;
    concentracao: 'FONTE_UNICA' | 'ALTA' | 'MODERADA' | 'DILUIDA' | null;
    hhi: number | null;
    top10: Array<{ fornecedorId: string; fornecedor: string; valor: string; participacao: number }>;
  };
  alertas: {
    lotesBloqueadosPorDivergencia: number;
    pedidosSemNotaHaMaisDe5Dias: number;
    contestacoesAguardandoDecisao: number;
  };
  dadosAtualizadosEm: Record<string, string | null>;
  memoriaDeCalculo: Record<string, string>;
}

interface Spend {
  porCategoria: Array<{ categoria: string; valor: string; participacao: number | null }>;
}

const competenciaAtual = (): string => new Date().toISOString().slice(0, 7);

/** Percentual em pt-BR; `null` vira "sem base", nunca 0% (secao 10.3). */
const pct = (valor: number | null, casas = 1): string =>
  valor === null
    ? 'sem base'
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(valor * 100)}%`;

const ROTULO_CONCENTRACAO: Record<string, string> = {
  FONTE_UNICA: 'Fonte unica',
  ALTA: 'Alta',
  MODERADA: 'Moderada',
  DILUIDA: 'Diluida',
};

/** Painel executivo da Diretoria (secao 10.1). */
export function PainelExecutivo() {
  const cliente = useQueryClient();
  const [unidadeId, setUnidadeId] = useState('');
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [erro, setErro] = useState<string | null>(null);

  const consulta = new URLSearchParams({ competencia, ...(unidadeId ? { unidadeId } : {}) }).toString();

  const painel = useQuery({
    queryKey: ['bi', 'executivo', consulta],
    queryFn: () => get<Executivo>(`/relatorios/executivo?${consulta}`),
  });

  const spend = useQuery({
    queryKey: ['bi', 'spend', consulta],
    queryFn: () => get<Spend>(`/relatorios/compras/spend?${consulta}`),
  });

  const atualizar = useMutation({
    mutationFn: () => post('/relatorios/atualizar', {}),
    onSuccess: async () => {
      setErro(null);
      await cliente.invalidateQueries({ queryKey: ['bi'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao atualizar os dados.'),
  });

  const exportar = useMutation({
    mutationFn: (relatorio: string) => baixarArquivo(`/relatorios/exportar/${relatorio}?${consulta}`, `${relatorio}.xlsx`),
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao exportar.'),
  });

  const dados = painel.data;
  const maisAntiga = Object.values(dados?.dadosAtualizadosEm ?? {})
    .filter((v): v is string => Boolean(v))
    .sort()[0];

  const alertas = Object.entries(dados?.alertas ?? {}).filter(([, valor]) => valor > 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Painel executivo</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Gasto, savings, frota, estoque e fornecedores da competencia. Numeros vindos das views
            atualizadas por job, nunca calculados no clique.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Competencia" htmlFor="competencia">
            <input
              id="competencia"
              type="month"
              className={classeControle()}
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            />
          </Campo>
          <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
          <Button
            variante="secundario"
            iconeEsquerda={<RefreshCw size={16} aria-hidden />}
            carregando={atualizar.isPending}
            onClick={() => atualizar.mutate()}
          >
            Atualizar dados
          </Button>
        </div>
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {maisAntiga && (
        <p className="text-legenda italic text-ceara-texto2">
          Dados atualizados em {new Date(maisAntiga).toLocaleString('pt-BR')}.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Gasto na competencia"
          valor={moeda(dados?.gasto.total ?? '0')}
          rodape={`Acumulado no ano: ${moeda(dados?.gasto.acumuladoNoAno ?? '0')}`}
          variacao={dados?.gasto.comparativo}
        />
        <Kpi
          rotulo="Savings"
          valor={moeda(dados?.compras.savings ?? '0')}
          rodape={`${pct(dados?.compras.savingsPercentual ?? null)} do negociado · meta 5%`}
          destaque={(dados?.compras.savingsPercentual ?? 0) >= 0.05 ? 'ok' : 'nenhum'}
        />
        <Kpi
          rotulo="Aderencia ao SLA"
          valor={pct(dados?.compras.aderenciaSla ?? null)}
          rodape="meta 90%"
          destaque={
            dados?.compras.aderenciaSla == null ? 'nenhum' : dados.compras.aderenciaSla >= 0.9 ? 'ok' : 'risco'
          }
        />
        <Kpi
          rotulo="Custo por km da frota"
          valor={dados?.frota.custoPorKm ? `${moeda(dados.frota.custoPorKm)}/km` : 'sem base'}
          rodape={`Total ${moeda(dados?.frota.custoTotal ?? '0')} · ${dados?.frota.kmRodados ?? '0'} km`}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Estoque imobilizado"
          valor={moeda(dados?.estoque.valorImobilizado ?? '0')}
          rodape={`${pct(dados?.estoque.percentualSemGiro ?? null)} sem giro · ${dados?.estoque.itensSemGiro ?? 0} itens`}
        />
        <Kpi rotulo="OTIF consolidado" valor={pct(dados?.fornecedores.otif ?? null)} rodape="meta 90%" />
        <Kpi
          rotulo="Divergencia no recebimento"
          valor={pct(dados?.fornecedores.indiceDivergencia ?? null)}
          rodape="meta ate 3%"
        />
        <Kpi
          rotulo="Concentracao de fornecedores"
          valor={dados?.fornecedores.concentracao ? ROTULO_CONCENTRACAO[dados.fornecedores.concentracao]! : 'sem base'}
          rodape={`HHI ${dados?.fornecedores.hhi ?? '—'}`}
          destaque={dados?.fornecedores.concentracao === 'FONTE_UNICA' ? 'risco' : 'nenhum'}
        />
      </section>

      {alertas.length > 0 && (
        <Card destaque="risco">
          <CardTitulo>Alertas criticos abertos</CardTitulo>
          <CardCorpo>
            <ul className="flex flex-col gap-1 text-corpo">
              {alertas.map(([chave, valor]) => (
                <li key={chave} className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-ceara-vermelho" aria-hidden />
                  <strong className="text-ceara-vermelho">{valor}</strong> {rotuloDoAlerta(chave)}
                </li>
              ))}
            </ul>
          </CardCorpo>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitulo
            acao={
              <Button
                tamanho="sm"
                variante="secundario"
                iconeEsquerda={<Download size={14} aria-hidden />}
                onClick={() => exportar.mutate('spend')}
              >
                XLSX
              </Button>
            }
          >
            Gasto por categoria
          </CardTitulo>
          <CardCorpo>
            {spend.data && spend.data.porCategoria.length > 0 ? (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Categoria</Th>
                    <Th>Valor</Th>
                    <Th>Participacao</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {spend.data.porCategoria.map((c) => (
                    <Tr key={c.categoria}>
                      <Td>{c.categoria}</Td>
                      <Td>{moeda(c.valor)}</Td>
                      <Td>{pct(c.participacao)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : (
              <p className="text-corpo text-ceara-texto2">Sem pedidos emitidos nesta competencia.</p>
            )}
          </CardCorpo>
        </Card>

        <Card>
          <CardTitulo
            acao={
              <Button
                tamanho="sm"
                variante="secundario"
                iconeEsquerda={<Download size={14} aria-hidden />}
                onClick={() => exportar.mutate('fornecedores')}
              >
                XLSX
              </Button>
            }
          >
            Top fornecedores por volume
          </CardTitulo>
          <CardCorpo>
            {dados && dados.fornecedores.top10.length > 0 ? (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Fornecedor</Th>
                    <Th>Valor</Th>
                    <Th>Participacao</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {dados.fornecedores.top10.map((f) => (
                    <Tr key={f.fornecedorId}>
                      <Td>{f.fornecedor}</Td>
                      <Td>{moeda(f.valor)}</Td>
                      <Td>
                        {pct(f.participacao)}
                        {f.participacao >= 0.5 && (
                          <Badge tom="vermelho" className="ml-2">
                            dependencia
                          </Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : (
              <p className="text-corpo text-ceara-texto2">Sem fornecedores com pedido nesta competencia.</p>
            )}
          </CardCorpo>
        </Card>
      </div>

      <Card>
        <CardTitulo
          acao={
            <div className="flex gap-2">
              <Button
                tamanho="sm"
                variante="secundario"
                iconeEsquerda={<Download size={14} aria-hidden />}
                onClick={() => exportar.mutate('curva-abc')}
              >
                Curva ABC
              </Button>
              <Button
                tamanho="sm"
                variante="secundario"
                iconeEsquerda={<Download size={14} aria-hidden />}
                onClick={() => exportar.mutate('custo-frota')}
              >
                Custo de frota
              </Button>
            </div>
          }
        >
          Memoria de calculo
        </CardTitulo>
        <CardCorpo>
          <dl className="flex flex-col gap-1 text-legenda text-ceara-texto2">
            {Object.entries(dados?.memoriaDeCalculo ?? {}).map(([chave, texto]) => (
              <p key={chave}>
                <span className="font-medium text-ceara-texto">{chave}:</span> {texto}
              </p>
            ))}
          </dl>
        </CardCorpo>
      </Card>
    </div>
  );
}

const rotuloDoAlerta = (chave: string): string =>
  ({
    lotesBloqueadosPorDivergencia: 'lote(s) bloqueado(s) por divergencia de recebimento',
    pedidosSemNotaHaMaisDe5Dias: 'pedido(s) recebidos ha mais de 5 dias sem entrada fiscal',
    contestacoesAguardandoDecisao: 'contestacao(oes) de pontuacao aguardando decisao',
  })[chave] ?? chave;

function Kpi({
  rotulo,
  valor,
  rodape,
  destaque = 'nenhum',
  variacao,
}: {
  rotulo: string;
  valor: string;
  rodape?: string;
  destaque?: 'nenhum' | 'ok' | 'risco' | 'regra';
  variacao?: Variacao;
}) {
  return (
    <Card destaque={destaque}>
      <CardCorpo className="pt-4">
        <p className="text-legenda text-ceara-texto2">{rotulo}</p>
        <p className="text-h2 text-ceara-azul">{valor}</p>

        {variacao && (
          <p
            className={`mt-1 flex items-center gap-1 text-legenda ${
              variacao.sentido === 'ALTA' ? 'text-ceara-vermelho' : variacao.sentido === 'QUEDA' ? 'text-ceara-verde' : 'text-ceara-texto2'
            }`}
          >
            {variacao.sentido === 'ALTA' ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
            {variacao.percentual === null ? 'sem base no mes anterior' : `${pct(variacao.percentual)} vs. mes anterior`}
          </p>
        )}

        {rodape && <p className="mt-1 text-legenda text-ceara-texto2">{rodape}</p>}
      </CardCorpo>
    </Card>
  );
}
