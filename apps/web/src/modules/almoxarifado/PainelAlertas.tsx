import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { get } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Card, CardCorpo } from '../../design-system/components/Card';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda, numero } from '../compras/tipos';

type Nivel = 'RUPTURA' | 'ABAIXO_DO_MINIMO' | 'NO_PONTO_DE_PEDIDO' | 'COBERTURA_BAIXA' | 'EXCESSO' | 'SEM_GIRO' | 'NORMAL';

interface Alerta {
  itemId: string;
  codigo: string;
  descricao: string;
  almoxarifado: string;
  nivel: Nivel;
  semaforo: 'vermelho' | 'amarelo' | 'azul' | 'preto' | 'verde';
  mensagem: string;
  saldo: string;
  cobertura: number | null;
  quantidadeSugerida: string;
  valorImobilizado: string;
}

interface Painel {
  alertas: Alerta[];
  resumo: Record<Nivel, number>;
}

/** Cores do semaforo da secao 8.3, dentro da paleta da marca. */
const SEMAFORO: Record<Alerta['semaforo'], { ponto: string; texto: string; rotulo: string }> = {
  vermelho: { ponto: 'bg-ceara-vermelho', texto: 'text-ceara-vermelho', rotulo: 'Critico' },
  amarelo: { ponto: 'bg-ceara-ouro', texto: 'text-[#8a6300]', rotulo: 'Atencao' },
  azul: { ponto: 'bg-ceara-azul', texto: 'text-ceara-azul', rotulo: 'Excesso' },
  preto: { ponto: 'bg-ceara-texto', texto: 'text-ceara-texto', rotulo: 'Sem giro' },
  verde: { ponto: 'bg-ceara-verde', texto: 'text-ceara-verde', rotulo: 'Normal' },
};

const ROTULO_NIVEL: Record<Nivel, string> = {
  RUPTURA: 'Ruptura',
  ABAIXO_DO_MINIMO: 'Abaixo do minimo',
  NO_PONTO_DE_PEDIDO: 'No ponto de pedido',
  COBERTURA_BAIXA: 'Cobertura baixa',
  EXCESSO: 'Excesso',
  SEM_GIRO: 'Sem giro',
  NORMAL: 'Normal',
};

export function PainelAlertas() {
  const [soCriticos, setSoCriticos] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['almoxarifado', 'alertas'],
    queryFn: () => get<Painel>('/almoxarifado/alertas'),
    refetchInterval: 120_000,
  });

  const alertas = (data?.alertas ?? []).filter((a) => (soCriticos ? a.nivel !== 'NORMAL' : true));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ceara-azul">Alertas de estoque</h1>
        <p className="text-legenda italic text-ceara-texto2">
          O sistema sugere a reposicao; a decisao de comprar continua sendo do gestor.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {(Object.keys(ROTULO_NIVEL) as Nivel[]).map((nivel) => {
          const quantidade = data?.resumo[nivel] ?? 0;
          const semaforo =
            nivel === 'RUPTURA' || nivel === 'ABAIXO_DO_MINIMO' ? 'vermelho'
            : nivel === 'NO_PONTO_DE_PEDIDO' || nivel === 'COBERTURA_BAIXA' ? 'amarelo'
            : nivel === 'EXCESSO' ? 'azul'
            : nivel === 'SEM_GIRO' ? 'preto' : 'verde';

          return (
            <Card key={nivel}>
              <CardCorpo className="py-3">
                <span className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', SEMAFORO[semaforo].ponto)} aria-hidden />
                  <span className="text-[11px] uppercase tracking-wide text-ceara-texto2">{ROTULO_NIVEL[nivel]}</span>
                </span>
                <p className={cn('mt-1 font-mono text-[22px] leading-none', quantidade > 0 ? SEMAFORO[semaforo].texto : 'text-ceara-texto2')}>
                  {data ? numero(quantidade) : '—'}
                </p>
              </CardCorpo>
            </Card>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-corpo">
        <input type="checkbox" checked={soCriticos} onChange={(e) => setSoCriticos(e.target.checked)} />
        Mostrar apenas itens que exigem acao
      </label>

      {isLoading && <p className="text-corpo text-ceara-texto2">Carregando alertas...</p>}

      {data && alertas.length === 0 && (
        <Card>
          <EstadoVazio
            titulo="Nenhum item exige reposicao"
            descricao="Todos os saldos estao dentro dos parametros definidos."
          />
        </Card>
      )}

      {alertas.length > 0 && (
        <Table>
          <Thead>
            <Tr>
              <Th>Situacao</Th>
              <Th>Almoxarifado</Th>
              <Th>Codigo</Th>
              <Th>Item</Th>
              <Th className="text-right">Saldo</Th>
              <Th className="text-right">Cobertura</Th>
              <Th className="text-right">Sugerido</Th>
              <Th className="text-right">Imobilizado</Th>
            </Tr>
          </Thead>
          <Tbody>
            {alertas.map((a) => (
              <Tr key={`${a.almoxarifado}-${a.itemId}`}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', SEMAFORO[a.semaforo].ponto)} aria-hidden />
                    <span className={cn('font-medium', SEMAFORO[a.semaforo].texto)}>{ROTULO_NIVEL[a.nivel]}</span>
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-ceara-texto2">{a.almoxarifado}</Td>
                <Td className="font-mono">{a.codigo}</Td>
                <Td>
                  {a.descricao}
                  <p className="text-legenda italic text-ceara-texto2">{a.mensagem}</p>
                </Td>
                <Td className="text-right font-mono">{numero(Number(a.saldo))}</Td>
                <Td className="text-right font-mono">{a.cobertura === null ? '—' : `${a.cobertura} d`}</Td>
                <Td className="text-right font-mono">
                  {Number(a.quantidadeSugerida) > 0 ? numero(Number(a.quantidadeSugerida)) : '—'}
                </Td>
                <Td className="text-right font-mono">{moeda(a.valorImobilizado)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <p className="flex items-start gap-2 text-legenda italic text-ceara-texto2">
        <Package size={14} className="mt-0.5 shrink-0" aria-hidden />
        A quantidade sugerida usa o lote economico quando definido; sem ele, o que falta ate o estoque maximo.
      </p>
    </div>
  );
}
