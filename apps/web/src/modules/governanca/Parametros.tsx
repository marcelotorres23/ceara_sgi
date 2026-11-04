import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { usePermissao } from '../auth/useSessao';
import { dataHoraBr, type Parametro } from './tipos';

/**
 * Parametros do sistema (secao 5.5): tudo que muda comportamento sem deploy.
 *
 * O tipo do parametro nao muda na edicao — trocar numero por texto derruba o calculo
 * la na frente, e o servidor recusa. Aqui a tela so ajuda a escrever o valor certo.
 */
export function Parametros({ aoErrar }: { aoErrar: (e: string | null) => void }) {
  const [busca, setBusca] = useState('');
  const podeEditar = usePermissao('parametro:editar');

  const parametros = useQuery({
    queryKey: ['governanca', 'parametros'],
    queryFn: () => get<{ itens: Parametro[] }>('/parametros'),
  });

  const itens = (parametros.data?.itens ?? []).filter(
    (p) =>
      busca.trim() === '' ||
      p.chave.toLowerCase().includes(busca.toLowerCase()) ||
      (p.descricao ?? '').toLowerCase().includes(busca.toLowerCase()),
  );

  // agrupa pelo prefixo da chave: compras, frota, almoxarifado, pessoas, portaria
  const grupos = [...new Set(itens.map((p) => p.chave.split('.')[0] ?? 'geral'))].sort();

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardCorpo className="pt-4">
          <label className="flex flex-col gap-1">
            <span className="text-h3 text-ceara-texto">Buscar parametro</span>
            <input className={classeControle()} value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
        </CardCorpo>
      </Card>

      {itens.length === 0 ? (
        <EstadoVazio titulo="Nenhum parametro" descricao="Nenhum parametro encontrado com esta busca." />
      ) : (
        grupos.map((grupo) => (
          <Card key={grupo}>
            <CardTitulo>{grupo}</CardTitulo>
            <CardCorpo>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Chave</Th>
                    <Th>Valor</Th>
                    <Th>Alterado em</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {itens
                    .filter((p) => p.chave.startsWith(`${grupo}.`) || (grupo === 'geral' && !p.chave.includes('.')))
                    .map((p) => (
                      <Tr key={p.chave}>
                        <Td>
                          <span className="font-mono text-legenda">{p.chave}</span>
                          <span className="block text-legenda text-ceara-texto2">{p.descricao}</span>
                        </Td>
                        <Td>
                          <EditorDeValor parametro={p} podeEditar={podeEditar} aoErrar={aoErrar} />
                        </Td>
                        <Td className="whitespace-nowrap">{dataHoraBr(p.updatedAt)}</Td>
                      </Tr>
                    ))}
                </Tbody>
              </Table>
            </CardCorpo>
          </Card>
        ))
      )}
    </div>
  );
}

function EditorDeValor({
  parametro,
  podeEditar,
  aoErrar,
}: {
  parametro: Parametro;
  podeEditar: boolean;
  aoErrar: (e: string | null) => void;
}) {
  const cliente = useQueryClient();
  const original = JSON.stringify(parametro.valor);
  const [texto, setTexto] = useState(original);
  const [editando, setEditando] = useState(false);

  const salvar = useMutation({
    mutationFn: () => patch(`/parametros/${parametro.chave}`, { valor: JSON.parse(texto) as unknown }),
    onSuccess: async () => {
      aoErrar(null);
      setEditando(false);
      await cliente.invalidateQueries({ queryKey: ['governanca', 'parametros'] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao salvar o parametro.'),
  });

  let jsonValido = true;
  try {
    JSON.parse(texto);
  } catch {
    jsonValido = false;
  }

  if (!editando) {
    return (
      <span className="flex items-center gap-2">
        <code className="rounded bg-ceara-nevoa px-2 py-1 text-legenda">{original}</code>
        {podeEditar && (
          <Button tamanho="sm" variante="texto" onClick={() => setEditando(true)}>
            Editar
          </Button>
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <input
        className={`${classeControle(!jsonValido)} w-full min-w-[16rem] font-mono text-legenda`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      {!jsonValido && <span className="text-legenda text-ceara-vermelho">JSON invalido.</span>}
      <span className="flex gap-1">
        <Button
          tamanho="sm"
          disabled={!jsonValido || texto === original}
          carregando={salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar
        </Button>
        <Button
          tamanho="sm"
          variante="texto"
          onClick={() => {
            setTexto(original);
            setEditando(false);
            aoErrar(null);
          }}
        >
          Cancelar
        </Button>
      </span>
    </span>
  );
}
