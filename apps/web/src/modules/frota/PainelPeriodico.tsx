import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleDashed, Clock, Plus } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { useSessao } from '../auth/useSessao';

export type TipoServicoPeriodico =
  | 'LUBRIFICACAO'
  | 'OLEO_MOTOR'
  | 'OLEO_DIFERENCIAL'
  | 'OLEO_CAIXA_MARCHA'
  | 'OLEO_THERMO_KING'
  | 'ALINHAMENTO'
  | 'BALANCEAMENTO';

/** As cinco faixas da regua (ADR 0023); rotulo textual sempre junto da cor. */
type Situacao = 'VENCIDO' | 'CRITICO' | 'ATENCAO' | 'EM_DIA' | 'SEM_BASE';

export interface LinhaDoPainel {
  ativoId: string;
  identificacao: string;
  descricao: string;
  base: 'HODOMETRO' | 'HORIMETRO' | 'DIAS';
  intervalo: string;
  medicaoDaUltima: string | null;
  executadoEm: string | null;
  medicaoAtual: string | null;
  proxima: string | null;
  proximaEm: string | null;
  aVencer: string;
  vencido: string;
  severidade: Situacao;
  /** fracao do ciclo consumida, 0..1 */
  usado: number;
  motivo: string | null;
  alerta: string | null;
  semHistorico: boolean;
}

interface Painel {
  itens: LinhaDoPainel[];
  resumo: Record<Situacao | 'total', number>;
}

const ROTULO_SITUACAO: Record<Situacao, string> = {
  VENCIDO: 'vencido',
  CRITICO: 'critico',
  ATENCAO: 'atencao',
  EM_DIA: 'em dia',
  SEM_BASE: 'sem registro',
};

const TOM: Record<Situacao, 'vermelho' | 'ouro' | 'verde' | 'neutro'> = {
  VENCIDO: 'vermelho',
  CRITICO: 'vermelho',
  ATENCAO: 'ouro',
  EM_DIA: 'verde',
  SEM_BASE: 'neutro',
};

const inteiro = (valor: string | null): string =>
  valor === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(valor));

const dataBr = (iso: string | null): string =>
  iso === null ? '—' : new Date(iso).toLocaleDateString('pt-BR');

/**
 * Uma aba da antiga planilha de trocas (secao 7.10), calculada na hora.
 *
 * Serve tanto ao controle de oleo quanto ao alinhamento e balanceamento na tela de pneus:
 * a conta e a mesma, o que muda e o intervalo e a unidade — km ou hora.
 */
export function PainelPeriodico({
  tipo,
  rotulo,
  unidadeId,
  ajuda,
}: {
  tipo: TipoServicoPeriodico;
  rotulo: string;
  unidadeId?: string;
  ajuda?: string;
}) {
  const permissoes = useSessao((s) => s.usuario?.permissoes ?? []);
  const podeRegistrar = permissoes.includes('preventiva:registrar');
  const [registrando, setRegistrando] = useState<LinhaDoPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const consulta = `?tipo=${tipo}${unidadeId ? `&unidadeId=${unidadeId}` : ''}`;
  const painel = useQuery({
    queryKey: ['periodicos', 'painel', tipo, unidadeId],
    queryFn: () => get<Painel>(`/transporte/periodicos/painel${consulta}`),
  });

  const unidade = (base: LinhaDoPainel['base']): string =>
    base === 'HORIMETRO' ? 'h' : base === 'DIAS' ? 'dias' : 'km';

  if (painel.isLoading) return <p className="text-corpo text-ceara-texto2">Carregando {rotulo.toLowerCase()}...</p>;
  const dados = painel.data;
  if (!dados) return null;

  /** Plano por dias nao tem leitura de painel: as colunas de medicao nao dizem nada ali. */
  const porDias = (dados.itens[0]?.base ?? 'HODOMETRO') === 'DIAS';

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-5">
        <Resumo rotulo="Vencidos" valor={dados.resumo.VENCIDO} tom="risco" Icone={AlertTriangle} />
        <Resumo rotulo="Criticos" valor={dados.resumo.CRITICO} tom="risco" Icone={AlertTriangle} />
        <Resumo rotulo="Em atencao" valor={dados.resumo.ATENCAO} tom="atencao" Icone={Clock} />
        <Resumo rotulo="Em dia" valor={dados.resumo.EM_DIA} tom="ok" Icone={Clock} />
        <Resumo rotulo="Sem registro" valor={dados.resumo.SEM_BASE} tom="neutro" Icone={CircleDashed} />
      </section>

      {ajuda && <p className="text-legenda italic text-ceara-texto2">{ajuda}</p>}

      {registrando && (
        <RegistrarExecucao
          tipo={tipo}
          linha={registrando}
          aoFechar={() => setRegistrando(null)}
          aoErrar={setErro}
        />
      )}

      {dados.itens.length === 0 ? (
        <Card>
          <EstadoVazio titulo="Nenhum ativo no controle" descricao="Cadastre a frota para acompanhar este servico." />
        </Card>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Ativo</Th>
              <Th>Modelo</Th>
              {!porDias && <Th className="text-right">Ultima</Th>}
              <Th>{porDias ? 'Ultima lubrificacao' : 'Data'}</Th>
              {!porDias && <Th className="text-right">Atual</Th>}
              <Th className={porDias ? undefined : "text-right"}>Proxima</Th>
              <Th className="text-right">A vencer</Th>
              <Th className="text-right">Vencido</Th>
              <Th>Situacao</Th>
              {podeRegistrar && <Th className="text-right">Acoes</Th>}
            </Tr>
          </Thead>
          <Tbody>
            {dados.itens.map((i) => (
              <Tr key={i.ativoId} className={cn(i.severidade === 'SEM_BASE' && 'opacity-70')}>
                <Td className="font-mono">{i.identificacao}</Td>
                <Td>{i.descricao}</Td>
                {!porDias && <Td className="text-right">{inteiro(i.medicaoDaUltima)}</Td>}
                <Td>{dataBr(i.executadoEm)}</Td>
                {!porDias && <Td className="text-right">{inteiro(i.medicaoAtual)}</Td>}
                <Td className={porDias ? undefined : 'text-right'}>
                  {porDias
                    ? dataBr(i.proximaEm)
                    : i.severidade === 'SEM_BASE'
                      ? '—'
                      : inteiro(i.proxima)}
                </Td>
                <Td className="text-right">
                  {i.severidade === 'SEM_BASE' ? '—' : `${inteiro(i.aVencer)} ${unidade(i.base)}`}
                </Td>
                <Td className={cn('text-right', Number(i.vencido) > 0 && i.severidade === 'VENCIDO' && 'text-ceara-vermelho')}>
                  {i.severidade === 'VENCIDO' ? `${inteiro(i.vencido)} ${unidade(i.base)}` : '—'}
                </Td>
                <Td>
                  <Badge tom={TOM[i.severidade]}>{ROTULO_SITUACAO[i.severidade]}</Badge>
                  {i.motivo && <p className="text-legenda text-ceara-texto2">{i.motivo}</p>}
                  {i.alerta && <p className="text-legenda text-ceara-ouro">{i.alerta}</p>}
                </Td>
                {podeRegistrar && (
                  <Td className="text-right">
                    <Button variante="texto" tamanho="sm" onClick={() => { setRegistrando(i); setErro(null); }}>
                      <Plus size={13} aria-hidden /> Registrar
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}

function Resumo({
  rotulo,
  valor,
  tom,
  Icone,
}: {
  rotulo: string;
  valor: number;
  tom: 'risco' | 'atencao' | 'ok' | 'neutro';
  Icone: typeof AlertTriangle;
}) {
  const cor =
    tom === 'risco' ? 'text-ceara-vermelho'
    : tom === 'atencao' ? 'text-ceara-ouro'
    : tom === 'ok' ? 'text-ceara-verde'
    : 'text-ceara-texto2';

  return (
    <Card destaque={tom === 'risco' && valor > 0 ? 'risco' : 'nenhum'}>
      <CardCorpo className="flex items-center justify-between gap-3 pt-4">
        <div>
          <p className="text-legenda text-ceara-texto2">{rotulo}</p>
          <p className={cn('text-h1', cor)}>{valor}</p>
        </div>
        <Icone size={20} className={cor} aria-hidden />
      </CardCorpo>
    </Card>
  );
}

/**
 * Registro da execucao.
 *
 * A leitura vem preenchida com a medicao corrente do ativo — que e a leitura mais provavel
 * de quem acabou de fazer a troca — mas continua editavel: quem trocou pode ter anotado
 * o painel na hora, e nao ao voltar para a mesa.
 */
function RegistrarExecucao({
  tipo,
  linha,
  aoFechar,
  aoErrar,
}: {
  tipo: TipoServicoPeriodico;
  linha: LinhaDoPainel;
  aoFechar: () => void;
  aoErrar: (e: string | null) => void;
}) {
  const cliente = useQueryClient();
  const [medicao, setMedicao] = useState(linha.medicaoAtual ?? '');
  const [executadoEm, setExecutadoEm] = useState(new Date().toISOString().slice(0, 10));
  const [quantidade, setQuantidade] = useState('');
  const [custo, setCusto] = useState('');
  const [oficina, setOficina] = useState('');
  const [observacao, setObservacao] = useState('');

  const registrar = useMutation({
    mutationFn: () =>
      post<{ proxima: string }>('/transporte/periodicos/execucoes', {
        tipo,
        // o Thermo King e o unico servico do aparelho de frio; o resto e do veiculo
        veiculoId: tipo === 'OLEO_THERMO_KING' ? null : linha.ativoId,
        equipamentoFrioId: tipo === 'OLEO_THERMO_KING' ? linha.ativoId : null,
        executadoEm,
        medicao: medicao.trim() || null,
        quantidade: quantidade.trim() || null,
        custo: custo.trim() || null,
        oficina: oficina.trim() || null,
        observacao: observacao.trim() || null,
      }),
    onSuccess: async () => {
      aoErrar(null);
      await cliente.invalidateQueries({ queryKey: ['periodicos'] });
      aoFechar();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a execucao.'),
  });

  const porDias = linha.base === 'DIAS';
  const medida = linha.base === 'HORIMETRO' ? 'Horimetro' : 'Hodometro';
  // no plano por dias o que marca o ciclo e a data; a leitura entra so como referencia
  const pronto = porDias ? executadoEm !== '' : /^\d+(\.\d)?$/.test(medicao.trim());

  const proximaPorDias = (): string => {
    if (executadoEm === '') return '—';
    const d = new Date(`${executadoEm}T12:00:00`);
    d.setDate(d.getDate() + Number(linha.intervalo));
    return d.toLocaleDateString('pt-BR');
  };

  return (
    <Card destaque="regra">
      <CardTitulo
        acao={
          <Button tamanho="sm" variante="texto" onClick={aoFechar}>
            Fechar
          </Button>
        }
      >
        Registrar em {linha.identificacao}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Campo
            rotulo={`${medida} na execucao`}
            htmlFor="medicao"
            obrigatorio={!porDias}
            ajuda={porDias ? 'Opcional: este plano vence por dias.' : 'Leitura do painel no momento do servico.'}
          >
            <input id="medicao" inputMode="decimal" className={classeControle()} value={medicao} onChange={(e) => setMedicao(e.target.value)} />
          </Campo>
          <Campo rotulo="Data" htmlFor="executado-em" obrigatorio>
            <input id="executado-em" type="date" className={classeControle()} value={executadoEm} onChange={(e) => setExecutadoEm(e.target.value)} />
          </Campo>
          <Campo rotulo="Quantidade" htmlFor="quantidade" ajuda="Litros de oleo, quando houver.">
            <input id="quantidade" inputMode="decimal" className={classeControle()} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </Campo>
          <Campo rotulo="Custo" htmlFor="custo">
            <input id="custo" inputMode="decimal" className={classeControle()} value={custo} onChange={(e) => setCusto(e.target.value)} />
          </Campo>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Oficina" htmlFor="oficina">
            <input id="oficina" className={classeControle()} value={oficina} onChange={(e) => setOficina(e.target.value)} />
          </Campo>
          <Campo rotulo="Observacao" htmlFor="obs-execucao">
            <input id="obs-execucao" className={classeControle()} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </Campo>
        </div>

        <p className="text-legenda italic text-ceara-texto2">
          {porDias ? (
            <>
              Registrando nesta data, a proxima vence em {proximaPorDias()} — {linha.intervalo} dias depois.
            </>
          ) : (
            <>
              Com esta leitura, a proxima vence em{' '}
              {pronto ? inteiro(String(Number(medicao) + Number(linha.intervalo))) : '—'}{' '}
              {linha.base === 'HORIMETRO' ? 'h' : 'km'}.
            </>
          )}
        </p>

        <div className="flex justify-end">
          <Button disabled={!pronto} carregando={registrar.isPending} onClick={() => registrar.mutate()}>
            Registrar execucao
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}
