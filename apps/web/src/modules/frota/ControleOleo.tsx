import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Droplet, Settings2 } from 'lucide-react';
import { get, put, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { classeControle } from '../../design-system/components/Campo';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { useSessao } from '../auth/useSessao';
import { FiltroUnidade } from './FiltroUnidade';
import { PainelPeriodico, type TipoServicoPeriodico } from './PainelPeriodico';
import { PatioManutencao } from './PatioManutencao';
import { ProgramacaoSemana } from './ProgramacaoSemana';

type BaseMedicao = 'HODOMETRO' | 'HORIMETRO' | 'DIAS';

const ROTULO_BASE: Record<BaseMedicao, string> = {
  HODOMETRO: 'quilometragem',
  HORIMETRO: 'horas do aparelho',
  DIAS: 'dias',
};

const UNIDADE_BASE: Record<BaseMedicao, string> = { HODOMETRO: 'km', HORIMETRO: 'h', DIAS: 'dias' };

/** Horimetro so vale para o aparelho de frio; dias vale para qualquer servico. */
const basesPermitidas = (tipo: TipoServicoPeriodico): BaseMedicao[] =>
  tipo === 'OLEO_THERMO_KING' ? ['HORIMETRO', 'DIAS'] : ['HODOMETRO', 'DIAS'];

const ABAS: Array<{ tipo: TipoServicoPeriodico; rotulo: string; ajuda: string }> = [
  {
    tipo: 'LUBRIFICACAO',
    rotulo: 'Lubrificacao',
    ajuda:
      'Engraxamento do chassi. Vence por calendario, e nao por rodagem: hoje a cada 10 dias, contados do dia da ' +
      'ultima lubrificacao. O intervalo — e ate a propria base, de dias para quilometragem — muda em "Intervalos".',
  },
  {
    tipo: 'OLEO_MOTOR',
    rotulo: 'Motor',
    ajuda: 'Troca a cada 20.000 km rodados, contados do hodometro da ultima troca.',
  },
  {
    tipo: 'OLEO_THERMO_KING',
    rotulo: 'Thermo King',
    ajuda:
      'Conta em horas do aparelho, e nao em km do caminhao: CARRIER a cada 1.000 h, THERMO KING a cada 2.000 h. ' +
      'O equipamento de frio e ativo proprio e leva o historico consigo quando muda de caminhao.',
  },
  {
    tipo: 'OLEO_DIFERENCIAL',
    rotulo: 'Diferencial',
    ajuda: 'Troca a cada 60.000 km rodados.',
  },
  {
    tipo: 'OLEO_CAIXA_MARCHA',
    rotulo: 'Caixa de marcha',
    ajuda: 'Troca a cada 60.000 km rodados.',
  },
];

/**
 * Controle de oleo (secao 7.10).
 *
 * Uma aba por tipo, como a planilha que a operacao mantinha — mas a conta e refeita a cada
 * abertura, a partir do hodometro do cadastro do veiculo e do horimetro do equipamento de
 * frio. Ninguem precisa arrastar formula, e nada envelhece por falta de atualizacao.
 */
export function ControleOleo() {
  const permissoes = useSessao((s) => s.usuario?.permissoes ?? []);
  // 'PATIO' e a visao cruzada, 'PROGRAMACAO' e a fila da semana; as demais sao um tipo cada (ADR 0023)
  const [aba, setAba] = useState<'PATIO' | 'PROGRAMACAO' | TipoServicoPeriodico>('PATIO');
  const [unidadeId, setUnidadeId] = useState('');
  const [parametrizando, setParametrizando] = useState(false);

  const atual = ABAS.find((a) => a.tipo === aba) ?? ABAS[0]!;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-h1 text-ceara-azul">
            <Droplet size={22} aria-hidden />
            Plano de manutencao
          </h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            O que vence por quilometragem, por hora de aparelho ou por dia de calendario. O patio mostra a frota
            inteira na ordem em que ela deve entrar no box; as demais abas abrem um servico de cada vez. A posicao e
            calculada na hora, a partir das leituras de medidor que a operacao ja registra.
          </p>
        </div>

        <div className="flex items-end gap-2">
          <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
          {permissoes.includes('preventiva:parametrizar') && (
            <Button variante="secundario" onClick={() => setParametrizando((v) => !v)}>
              <Settings2 size={16} aria-hidden /> Intervalos
            </Button>
          )}
        </div>
      </header>

      {parametrizando && <Planos unidadeId={unidadeId} />}

      <nav aria-label="Areas do plano de manutencao" className="flex flex-wrap gap-1 border-b border-ceara-borda">
        <button
          type="button"
          onClick={() => setAba('PATIO')}
          aria-current={aba === 'PATIO'}
          className={cn(
            'border-b-2 px-3 py-2 text-corpo transition-colors',
            aba === 'PATIO'
              ? 'border-ceara-ouro font-medium text-ceara-azul'
              : 'border-transparent text-ceara-texto2 hover:text-ceara-texto',
          )}
        >
          Patio
        </button>
        <button
          type="button"
          onClick={() => setAba('PROGRAMACAO')}
          aria-current={aba === 'PROGRAMACAO'}
          className={cn(
            'border-b-2 px-3 py-2 text-corpo transition-colors',
            aba === 'PROGRAMACAO'
              ? 'border-ceara-ouro font-medium text-ceara-azul'
              : 'border-transparent text-ceara-texto2 hover:text-ceara-texto',
          )}
        >
          Programacao
        </button>
        {ABAS.map((a) => (
          <button
            key={a.tipo}
            type="button"
            onClick={() => setAba(a.tipo)}
            aria-current={aba === a.tipo}
            className={cn(
              'border-b-2 px-3 py-2 text-corpo transition-colors',
              aba === a.tipo
                ? 'border-ceara-ouro font-medium text-ceara-azul'
                : 'border-transparent text-ceara-texto2 hover:text-ceara-texto',
            )}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === 'PATIO' ? (
        <PatioManutencao unidadeId={unidadeId} />
      ) : aba === 'PROGRAMACAO' ? (
        <ProgramacaoSemana unidadeId={unidadeId} />
      ) : (
        <PainelPeriodico tipo={atual.tipo} rotulo={atual.rotulo} unidadeId={unidadeId} ajuda={atual.ajuda} />
      )}
    </div>
  );
}

interface Plano {
  id: string;
  tipo: TipoServicoPeriodico;
  base: BaseMedicao;
  intervalo: string;
  avisarCom: string;
  modelo: string | null;
}

const ROTULO_TIPO: Record<TipoServicoPeriodico, string> = {
  LUBRIFICACAO: 'Lubrificacao',
  OLEO_MOTOR: 'Oleo do motor',
  OLEO_DIFERENCIAL: 'Oleo do diferencial',
  OLEO_CAIXA_MARCHA: 'Oleo da caixa de marcha',
  OLEO_THERMO_KING: 'Oleo do Thermo King',
  ALINHAMENTO: 'Alinhamento',
  BALANCEAMENTO: 'Balanceamento',
};

/**
 * Intervalos por tipo. Mudar aqui vale do proximo registro em diante: execucao ja feita
 * guarda o intervalo da epoca, para o historico nao mudar de sentido depois.
 */
function Planos({ unidadeId }: { unidadeId: string }) {
  const cliente = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Plano | null>(null);
  const [base, setBase] = useState<BaseMedicao>('HODOMETRO');
  const [intervalo, setIntervalo] = useState('');
  const [avisarCom, setAvisarCom] = useState('');

  const planos = useQuery({
    queryKey: ['periodicos', 'planos', unidadeId],
    queryFn: () => get<{ itens: Plano[] }>(`/transporte/periodicos/planos${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  });

  const salvar = useMutation({
    mutationFn: (plano: Plano) =>
      put('/transporte/periodicos/planos', {
        unidadeId: unidadeId || null,
        tipo: plano.tipo,
        modelo: plano.modelo,
        base,
        intervalo: intervalo.trim(),
        avisarCom: avisarCom.trim(),
      }),
    onSuccess: async () => {
      setErro(null);
      setEditando(null);
      await cliente.invalidateQueries({ queryKey: ['periodicos'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao salvar o intervalo.'),
  });

  return (
    <Card destaque="regra">
      <CardTitulo>Intervalos dos planos</CardTitulo>
      <CardCorpo className="flex flex-col gap-3">
        {erro && (
          <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
            {erro}
          </p>
        )}

        <p className="text-legenda italic text-ceara-texto2">
          A alteracao vale do proximo registro em diante: cada execucao ja feita guarda o intervalo aplicado na epoca.
          Trocar "lembrar por" muda o que conta o vencimento — de quilometragem para dias de calendario, ou o contrario.
        </p>

        <Table>
          <Thead>
            <Tr>
              <Th>Tipo</Th>
              <Th>Modelo</Th>
              <Th>Lembrar por</Th>
              <Th className="text-right">Intervalo</Th>
              <Th className="text-right">Avisar com</Th>
              <Th className="text-right">Acoes</Th>
            </Tr>
          </Thead>
          <Tbody>
            {(planos.data?.itens ?? []).map((p) => {
              const emEdicao = editando?.id === p.id;
              const unidade = UNIDADE_BASE[emEdicao ? base : p.base];
              return (
                <Tr key={p.id}>
                  <Td>{ROTULO_TIPO[p.tipo]}</Td>
                  <Td>{p.modelo ?? 'todos'}</Td>
                  <Td>
                    {emEdicao ? (
                      <select
                        aria-label="Lembrar por"
                        className={classeControle()}
                        value={base}
                        onChange={(e) => setBase(e.target.value as BaseMedicao)}
                      >
                        {basesPermitidas(p.tipo).map((b) => (
                          <option key={b} value={b}>
                            {ROTULO_BASE[b]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROTULO_BASE[p.base]
                    )}
                  </Td>
                  <Td className="text-right">
                    {emEdicao ? (
                      <input
                        aria-label="Intervalo"
                        inputMode="decimal"
                        className={`${classeControle()} w-28 text-right`}
                        value={intervalo}
                        onChange={(e) => setIntervalo(e.target.value)}
                      />
                    ) : (
                      `${Number(p.intervalo).toLocaleString('pt-BR')} ${unidade}`
                    )}
                  </Td>
                  <Td className="text-right">
                    {emEdicao ? (
                      <input
                        aria-label="Antecedencia do aviso"
                        inputMode="decimal"
                        className={`${classeControle()} w-28 text-right`}
                        value={avisarCom}
                        onChange={(e) => setAvisarCom(e.target.value)}
                      />
                    ) : (
                      `${Number(p.avisarCom).toLocaleString('pt-BR')} ${unidade}`
                    )}
                  </Td>
                  <Td className="text-right">
                    {emEdicao ? (
                      <span className="flex justify-end gap-1">
                        <Button tamanho="sm" carregando={salvar.isPending} onClick={() => salvar.mutate(p)}>
                          Salvar
                        </Button>
                        <Button tamanho="sm" variante="texto" onClick={() => setEditando(null)}>
                          Cancelar
                        </Button>
                      </span>
                    ) : (
                      <Button
                        tamanho="sm"
                        variante="texto"
                        onClick={() => {
                          setEditando(p);
                          setBase(p.base);
                          setIntervalo(String(Number(p.intervalo)));
                          setAvisarCom(String(Number(p.avisarCom)));
                          setErro(null);
                        }}
                      >
                        Editar
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </CardCorpo>
    </Card>
  );
}
