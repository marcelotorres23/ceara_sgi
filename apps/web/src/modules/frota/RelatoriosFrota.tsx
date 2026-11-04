import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda } from '../compras/tipos';
import { FiltroUnidade } from './FiltroUnidade';
import { decimal } from './tipos';

interface CustoPorVeiculo {
  unidades: string[] | 'TODAS';
  periodo: { de: string; ate: string };
  itens: Array<{
    veiculoId: string;
    placa: string;
    frotaNumero: string;
    unidade: string;
    combustivel: string;
    manutencao: string;
    pneus: string;
    custoTotal: string;
    kmRodados: string;
    custoPorKm: string | null;
    consumoMedioKml: string | null;
  }>;
  totais: { combustivel: string; manutencao: string; pneus: string; custoTotal: string; kmRodados: string };
  memoriaDeCalculo: Record<string, string>;
}

interface ConsumoPorMotorista {
  itens: Array<{
    motoristaId: string;
    nome: string;
    unidade: string;
    abastecimentos: number;
    litros: string;
    kmRodados: string;
    consumoMedioKml: string | null;
    anomalias: number;
  }>;
}

const isoDoDia = (data: Date): string => data.toISOString().slice(0, 10);

/** Relatorios de frota (secao 7.8), sempre com recorte de periodo e de unidade. */
export function RelatoriosFrota() {
  const hoje = new Date();
  const [unidadeId, setUnidadeId] = useState('');
  const [de, setDe] = useState(isoDoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [ate, setAte] = useState(isoDoDia(hoje));

  const parametros = new URLSearchParams({ de, ate, ...(unidadeId ? { unidadeId } : {}) }).toString();

  const custos = useQuery({
    queryKey: ['relatorios', 'custo-veiculo', parametros],
    queryFn: () => get<CustoPorVeiculo>(`/relatorios/frota/custo-por-veiculo?${parametros}`),
  });

  const consumo = useQuery({
    queryKey: ['relatorios', 'consumo-motorista', parametros],
    queryFn: () => get<ConsumoPorMotorista>(`/relatorios/frota/consumo-por-motorista?${parametros}`),
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Relatorios de frota</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Custo por veiculo, custo por km e consumo por motorista, no periodo e na unidade escolhidos.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="De" htmlFor="de">
            <input id="de" type="date" className={classeControle()} value={de} onChange={(e) => setDe(e.target.value)} />
          </Campo>
          <Campo rotulo="Ate" htmlFor="ate">
            <input id="ate" type="date" className={classeControle()} value={ate} onChange={(e) => setAte(e.target.value)} />
          </Campo>
          <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
        </div>
      </header>

      <Card>
        <CardTitulo>Custo por veiculo</CardTitulo>
        <CardCorpo>
          {custos.data && custos.data.itens.length > 0 ? (
            <>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Veiculo</Th>
                    <Th>Unidade</Th>
                    <Th>Combustivel</Th>
                    <Th>Manutencao</Th>
                    <Th>Pneus</Th>
                    <Th>Total</Th>
                    <Th>Km</Th>
                    <Th>Custo por km</Th>
                    <Th>Consumo</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {custos.data.itens.map((v) => (
                    <Tr key={v.veiculoId}>
                      <Td>
                        {v.frotaNumero} · {v.placa}
                      </Td>
                      <Td>{v.unidade}</Td>
                      <Td>{moeda(v.combustivel)}</Td>
                      <Td>{moeda(v.manutencao)}</Td>
                      <Td>{moeda(v.pneus)}</Td>
                      <Td className="font-medium">{moeda(v.custoTotal)}</Td>
                      <Td>{decimal(v.kmRodados, 1)}</Td>
                      <Td>{v.custoPorKm ? `${moeda(v.custoPorKm)}/km` : 'sem base'}</Td>
                      <Td>{v.consumoMedioKml ? `${decimal(v.consumoMedioKml, 3)} km/L` : 'sem base'}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-ceara-nevoa font-medium">
                    <Td>Total</Td>
                    <Td>—</Td>
                    <Td>{moeda(custos.data.totais.combustivel)}</Td>
                    <Td>{moeda(custos.data.totais.manutencao)}</Td>
                    <Td>{moeda(custos.data.totais.pneus)}</Td>
                    <Td>{moeda(custos.data.totais.custoTotal)}</Td>
                    <Td>{decimal(custos.data.totais.kmRodados, 1)}</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                  </Tr>
                </Tbody>
              </Table>

              <dl className="mt-3 flex flex-col gap-1 text-legenda italic text-ceara-texto2">
                {Object.entries(custos.data.memoriaDeCalculo).map(([chave, texto]) => (
                  <p key={chave}>
                    <span className="not-italic font-medium text-ceara-texto">{chave}:</span> {texto}
                  </p>
                ))}
              </dl>
            </>
          ) : (
            <EstadoVazio titulo="Sem custos no periodo" descricao="Ajuste o periodo ou a unidade para ver os lancamentos." />
          )}
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>Consumo por motorista</CardTitulo>
        <CardCorpo>
          {consumo.data && consumo.data.itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Motorista</Th>
                  <Th>Unidade</Th>
                  <Th>Abastecimentos</Th>
                  <Th>Litros</Th>
                  <Th>Km</Th>
                  <Th>Consumo</Th>
                  <Th>Anomalias</Th>
                </Tr>
              </Thead>
              <Tbody>
                {consumo.data.itens.map((m) => (
                  <Tr key={m.motoristaId}>
                    <Td>{m.nome}</Td>
                    <Td>{m.unidade}</Td>
                    <Td>{m.abastecimentos}</Td>
                    <Td>{decimal(m.litros, 3)}</Td>
                    <Td>{decimal(m.kmRodados, 1)}</Td>
                    <Td>{m.consumoMedioKml ? `${decimal(m.consumoMedioKml, 3)} km/L` : 'sem base'}</Td>
                    <Td className={m.anomalias > 0 ? 'text-ceara-vermelho' : undefined}>{m.anomalias}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio titulo="Sem abastecimentos no periodo" descricao="Nenhum registro para os filtros atuais." />
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}
