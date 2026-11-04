import { useQuery } from '@tanstack/react-query';
import { AlertTriangle,  Fuel, Truck } from 'lucide-react';
import { get } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda, numero } from '../compras/tipos';

interface AlertaDocumento {
  id: string;
  tipo: string;
  origem: string;
  identificacao: string;
  situacao: 'VENCIDO' | 'VENCE_HOJE' | 'EM_ALERTA' | 'REGULAR';
  diasRestantes: number;
  janela: number | null;
  semaforo: 'vermelho' | 'ouro' | 'verde';
  mensagem: string;
}

interface PainelCcoDados {
  frota: Record<string, number>;
  documentos: { vencidos: number; venceHoje: number; emAlerta: number; lista: AlertaDocumento[] };
  abastecimento: {
    mesAtual: { registros: number; valorTotal: string; litros: string; consumoMedioKml: string | null };
    mesAnterior: { valorTotal: string; litros: string; consumoMedioKml: string | null };
    anomaliasNoMes: number;
  };
  pendentes: { pneusCriticos: number | null };
}

/**
 * A API devolve decimal com ponto ("2.802"). Exibir cru faz o leitor brasileiro
 * ler 2802 - o ponto e separador de milhar em pt-BR. Formatacao acontece so aqui,
 * na apresentacao (secao 13).
 */
const consumoFormatado = (valor: string | null): string =>
  valor === null
    ? 'sem base'
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(valor))} km/L`;

const ROTULO_STATUS: Record<string, string> = {
  ATIVO: 'Ativos',
  MANUTENCAO: 'Em manutencao',
  INATIVO: 'Inativos',
  VENDIDO: 'Vendidos',
};

export function PainelCco() {
  const { data, isLoading } = useQuery({
    queryKey: ['transporte', 'painel'],
    queryFn: () => get<PainelCcoDados>('/transporte/painel'),
    refetchInterval: 120_000,
  });

  const consumoAtual = data?.abastecimento.mesAtual.consumoMedioKml;
  const consumoAnterior = data?.abastecimento.mesAnterior.consumoMedioKml;
  const variacao =
    consumoAtual && consumoAnterior && Number(consumoAnterior) > 0
      ? ((Number(consumoAtual) - Number(consumoAnterior)) / Number(consumoAnterior)) * 100
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ceara-azul">Centro de controle da frota</h1>
        <p className="text-legenda italic text-ceara-texto2">
          Situacao dos veiculos, documentos a vencer e consumo do mes.
        </p>
      </div>

      {isLoading && <p className="text-corpo text-ceara-texto2">Carregando painel...</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          icone={<Truck size={16} aria-hidden />}
          rotulo="Veiculos ativos"
          valor={data ? numero(data.frota.ATIVO ?? 0) : '—'}
        />
        <Indicador
          icone={<AlertTriangle size={16} aria-hidden />}
          rotulo="Documentos vencidos"
          valor={data ? numero(data.documentos.vencidos) : '—'}
          tom={data && data.documentos.vencidos > 0 ? 'ruim' : 'bom'}
        />

        <Indicador
          icone={<Fuel size={16} aria-hidden />}
          rotulo="Anomalias no mes"
          valor={data ? numero(data.abastecimento.anomaliasNoMes) : '—'}
          tom={data && data.abastecimento.anomaliasNoMes > 0 ? 'ruim' : 'bom'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitulo>Frota por situacao</CardTitulo>
          <CardCorpo>
            {data && Object.keys(data.frota).length > 0 ? (
              <ul className="flex flex-col gap-2">
                {Object.entries(data.frota).map(([status, quantidade]) => (
                  <li key={status} className="flex items-center justify-between border-b border-ceara-borda pb-1 last:border-0">
                    <span className="text-corpo">{ROTULO_STATUS[status] ?? status}</span>
                    <span className="font-mono text-corpo">{numero(quantidade)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-legenda italic text-ceara-texto2">Nenhum veiculo cadastrado.</p>
            )}
          </CardCorpo>
        </Card>

        <Card>
          <CardTitulo>Abastecimento do mes</CardTitulo>
          <CardCorpo className="flex flex-col gap-2">
            <Linha rotulo="Registros" valor={data ? numero(data.abastecimento.mesAtual.registros) : '—'} />
            <Linha rotulo="Valor gasto" valor={data ? moeda(data.abastecimento.mesAtual.valorTotal) : '—'} />
            <Linha rotulo="Litros" valor={data ? numero(Number(data.abastecimento.mesAtual.litros)) : '—'} />
            <Linha rotulo="Consumo medio" valor={consumoFormatado(consumoAtual ?? null)} />
            {variacao !== null && (
              <p className={cn('text-legenda', variacao >= 0 ? 'text-ceara-verde' : 'text-ceara-vermelho')}>
                {variacao >= 0 ? '▲' : '▼'} {Math.abs(variacao).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                {' '}em relacao ao mes anterior ({consumoFormatado(consumoAnterior ?? null)})
              </p>
            )}
            {consumoAtual && !consumoAnterior && (
              <p className="text-legenda italic text-ceara-texto2">
                Sem base do mes anterior para comparar.
              </p>
            )}
          </CardCorpo>
        </Card>
      </div>

      <Card destaque={data && data.documentos.vencidos > 0 ? 'risco' : 'nenhum'}>
        <CardTitulo>Documentos que exigem atencao</CardTitulo>
        <CardCorpo>
          {data && data.documentos.lista.length === 0 ? (
            <EstadoVazio titulo="Nenhum documento vencendo" descricao="Veiculos e motoristas com documentacao em dia." />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Situacao</Th>
                  <Th>Documento</Th>
                  <Th>Origem</Th>
                  <Th>Identificacao</Th>
                  <Th className="text-right">Prazo</Th>
                </Tr>
              </Thead>
              <Tbody>
                {(data?.documentos.lista ?? []).map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          d.semaforo === 'vermelho' && 'bg-[rgba(192,57,43,0.10)] text-ceara-vermelho',
                          d.semaforo === 'ouro' && 'bg-[var(--ceara-ouro-15)] text-[#8a6300]',
                          d.semaforo === 'verde' && 'bg-[rgba(30,122,68,0.10)] text-ceara-verde',
                        )}
                      >
                        {d.situacao === 'VENCIDO' ? 'Vencido' : d.situacao === 'VENCE_HOJE' ? 'Vence hoje' : `D-${d.janela}`}
                      </span>
                    </Td>
                    <Td>{d.tipo}</Td>
                    <Td className="capitalize">{d.origem}</Td>
                    <Td className="font-mono">{d.identificacao}</Td>
                    <Td className="text-right font-mono">
                      {d.diasRestantes < 0 ? `${Math.abs(d.diasRestantes)} d atras` : `${d.diasRestantes} d`}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardCorpo>
      </Card>

      <p className="text-legenda italic text-ceara-texto2">
        Pneus em estado critico entram no painel na fase F7.
      </p>
    </div>
  );
}

function Indicador({
  icone, rotulo, valor, tom = 'neutro',
}: { icone: React.ReactNode; rotulo: string; valor: string; tom?: 'bom' | 'ruim' | 'neutro' }) {
  return (
    <Card>
      <CardCorpo className="py-3">
        <span className="flex items-center gap-2 text-ceara-texto2">
          {icone}
          <span className="text-[11px] uppercase tracking-wide">{rotulo}</span>
        </span>
        <p
          className={cn(
            'mt-1 font-mono text-[22px] leading-none',
            tom === 'bom' && 'text-ceara-verde',
            tom === 'ruim' && 'text-ceara-vermelho',
            tom === 'neutro' && 'text-ceara-texto',
          )}
        >
          {valor}
        </p>
      </CardCorpo>
    </Card>
  );
}

const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <span className="flex items-center justify-between border-b border-ceara-borda pb-1 last:border-0">
    <span className="text-corpo text-ceara-texto2">{rotulo}</span>
    <span className="font-mono text-corpo">{valor}</span>
  </span>
);
