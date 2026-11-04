import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { get, put, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { classeControle } from '../../design-system/components/Campo';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { usePermissao } from '../auth/useSessao';
import { faixaBr, type FaixaDeAlcada, type Perfil } from './tipos';

interface LinhaEditavel {
  nivel: number;
  valorMin: string;
  valorMax: string;
  aprovador: string;
  propostasMinimas: number;
  slaHoras: number;
}

/**
 * Matriz de alcadas (secao 6.4).
 *
 * A matriz e salva inteira, nunca faixa a faixa: editar uma isolada abriria vao — um lote
 * de R$ 5.000,01 sem aprovador só aparece no dia em que alguem tenta submeter.
 */
export function Alcadas({ aoErrar }: { aoErrar: (e: string | null) => void }) {
  const cliente = useQueryClient();
  const podeEditar = usePermissao('alcada:editar');
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [editando, setEditando] = useState(false);

  const alcadas = useQuery({
    queryKey: ['governanca', 'alcadas'],
    queryFn: () => get<{ itens: FaixaDeAlcada[] }>('/alcadas'),
  });

  const perfis = useQuery({
    queryKey: ['governanca', 'perfis'],
    queryFn: () => get<{ itens: Perfil[] }>('/perfis'),
    staleTime: 300_000,
  });

  useEffect(() => {
    if (alcadas.data) {
      setLinhas(
        alcadas.data.itens.map((f) => ({
          nivel: f.nivel,
          valorMin: f.valorMin,
          valorMax: f.valorMax ?? '',
          aprovador: f.aprovador,
          propostasMinimas: f.propostasMinimas,
          slaHoras: f.slaHoras,
        })),
      );
    }
  }, [alcadas.data]);

  const salvar = useMutation({
    mutationFn: () =>
      put('/alcadas', {
        faixas: linhas.map((l) => ({
          nivel: l.nivel,
          valorMin: l.valorMin,
          valorMax: l.valorMax.trim() === '' ? null : l.valorMax,
          perfilAprovador: l.aprovador,
          propostasMinimas: l.propostasMinimas,
          slaHoras: l.slaHoras,
        })),
      }),
    onSuccess: async () => {
      aoErrar(null);
      setEditando(false);
      await cliente.invalidateQueries({ queryKey: ['governanca', 'alcadas'] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao salvar a matriz.'),
  });

  function mudar(indice: number, campo: keyof LinhaEditavel, valor: string) {
    setLinhas((atuais) =>
      atuais.map((l, i) =>
        i === indice
          ? {
              ...l,
              [campo]:
                campo === 'propostasMinimas' || campo === 'slaHoras' || campo === 'nivel' ? Number(valor) || 0 : valor,
            }
          : l,
      ),
    );
  }

  function adicionar() {
    const ultimo = linhas[linhas.length - 1];
    setLinhas([
      ...linhas,
      {
        nivel: (ultimo?.nivel ?? 0) + 1,
        valorMin: ultimo?.valorMax ? (Number(ultimo.valorMax) + 0.01).toFixed(2) : '0',
        valorMax: '',
        aprovador: perfis.data?.itens[0]?.nome ?? '',
        propostasMinimas: 3,
        slaHoras: 24,
      },
    ]);
  }

  if (!editando) {
    return (
      <Card>
        <CardTitulo
          acao={
            podeEditar && (
              <Button tamanho="sm" onClick={() => setEditando(true)}>
                Editar matriz
              </Button>
            )
          }
        >
          Matriz de alcadas
        </CardTitulo>
        <CardCorpo className="flex flex-col gap-3">
          <Table>
            <Thead>
              <Tr>
                <Th>Nivel</Th>
                <Th>Faixa de valor</Th>
                <Th>Aprovador</Th>
                <Th>Propostas minimas</Th>
                <Th>SLA</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(alcadas.data?.itens ?? []).map((f) => (
                <Tr key={f.nivel}>
                  <Td className="font-mono">{f.nivel}</Td>
                  <Td>{faixaBr(f.valorMin, f.valorMax)}</Td>
                  <Td>{f.aprovador}</Td>
                  <Td>{f.propostasMinimas}</Td>
                  <Td>{f.slaHoras === 0 ? 'imediato' : `${f.slaHoras}h uteis`}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <p className="text-legenda italic text-ceara-texto2">
            A faixa 1 admite autoaprovacao do comprador, sempre registrada como tal. Escolha divergente do menor
            preco sobe um nivel automaticamente.
          </p>
        </CardCorpo>
      </Card>
    );
  }

  return (
    <Card destaque="regra">
      <CardTitulo>Editando a matriz de alcadas</CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <p className="text-legenda italic text-ceara-texto2">
          A matriz e salva inteira e validada como conjunto: a primeira faixa comeca em 0, a ultima fica sem teto, e
          entre uma e outra o piso e o teto anterior mais um centavo. Vao ou sobreposicao sao recusados.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-tabela">
            <thead className="bg-ceara-azul text-left text-white">
              <tr>
                <th className="px-2 py-2">Nivel</th>
                <th className="px-2 py-2">Piso</th>
                <th className="px-2 py-2">Teto (vazio = sem teto)</th>
                <th className="px-2 py-2">Aprovador</th>
                <th className="px-2 py-2">Propostas</th>
                <th className="px-2 py-2">SLA (h)</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-b border-ceara-borda">
                  <td className="px-2 py-1">
                    <input
                      className={`${classeControle()} w-16`}
                      value={l.nivel}
                      onChange={(e) => mudar(i, 'nivel', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${classeControle()} w-32`}
                      value={l.valorMin}
                      onChange={(e) => mudar(i, 'valorMin', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${classeControle()} w-32`}
                      placeholder="sem teto"
                      value={l.valorMax}
                      onChange={(e) => mudar(i, 'valorMax', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      className={`${classeControle()} w-56`}
                      value={l.aprovador}
                      onChange={(e) => mudar(i, 'aprovador', e.target.value)}
                    >
                      {(perfis.data?.itens ?? []).map((p) => (
                        <option key={p.id} value={p.nome}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${classeControle()} w-20`}
                      value={l.propostasMinimas}
                      onChange={(e) => mudar(i, 'propostasMinimas', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${classeControle()} w-20`}
                      value={l.slaHoras}
                      onChange={(e) => mudar(i, 'slaHoras', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}
                      aria-label={`Remover faixa ${l.nivel}`}
                      className="grid h-9 w-9 place-items-center rounded-lg text-ceara-vermelho hover:bg-[rgba(192,57,43,0.08)]"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variante="secundario" tamanho="sm" iconeEsquerda={<Plus size={14} aria-hidden />} onClick={adicionar}>
            Adicionar faixa
          </Button>
          <span className="flex gap-2">
            <Button
              variante="texto"
              onClick={() => {
                setEditando(false);
                aoErrar(null);
              }}
            >
              Cancelar
            </Button>
            <Button carregando={salvar.isPending} onClick={() => salvar.mutate()}>
              Salvar matriz
            </Button>
          </span>
        </div>
      </CardCorpo>
    </Card>
  );
}
