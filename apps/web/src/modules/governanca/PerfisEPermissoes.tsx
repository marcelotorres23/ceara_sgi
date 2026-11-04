import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldCheck } from 'lucide-react';
import { get, patch, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { usePermissao } from '../auth/useSessao';
import { porRecurso, type Perfil, type Permissao } from './tipos';

/**
 * Perfis e permissoes (secao 5.1).
 *
 * O que cada perfil pode e editavel aqui, nao no codigo — mas o catalogo de permissoes e
 * fechado, e o Administrador continua vedado de aprovar, receber e lancar nota. Essa
 * ultima regra vive no servidor: afrouxa-la em tela seria criar o proprio poder.
 */
export function PerfisEPermissoes({ aoErrar }: { aoErrar: (e: string | null) => void }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const podeEditar = usePermissao('perfil:editar');

  const perfis = useQuery({
    queryKey: ['governanca', 'perfis'],
    queryFn: () => get<{ itens: Perfil[] }>('/perfis'),
  });

  const permissoes = useQuery({
    queryKey: ['governanca', 'permissoes'],
    queryFn: () => get<{ itens: Permissao[] }>('/permissoes'),
    staleTime: 300_000,
  });

  const conflitos = useQuery({
    queryKey: ['governanca', 'sod'],
    queryFn: () => get<{ itens: Array<{ a: string; b: string; motivo: string }> }>('/sod/conflitos'),
    staleTime: 300_000,
  });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardTitulo>Perfis ({perfis.data?.itens.length ?? 0})</CardTitulo>
        <CardCorpo className="flex flex-col gap-3">
          {(perfis.data?.itens ?? []).map((perfil) => (
            <div key={perfil.id} className="rounded-card border border-ceara-borda">
              <button
                type="button"
                onClick={() => setAberto(aberto === perfil.id ? null : perfil.id)}
                aria-expanded={aberto === perfil.id}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span>
                  <span className="text-h3 text-ceara-azul">{perfil.nome}</span>
                  {perfil.sistema && (
                    <Badge tom="neutro" className="ml-2">
                      <Lock size={11} className="mr-1 inline" aria-hidden />
                      sistema
                    </Badge>
                  )}
                  <span className="block text-legenda text-ceara-texto2">{perfil.descricao}</span>
                </span>
                <span className="shrink-0 text-legenda text-ceara-texto2">{perfil.permissoes.length} permissoes</span>
              </button>

              {aberto === perfil.id && (
                <EditorDePermissoes
                  perfil={perfil}
                  catalogo={permissoes.data?.itens ?? []}
                  podeEditar={podeEditar}
                  aoErrar={aoErrar}
                />
              )}
            </div>
          ))}
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>
          <span className="flex items-center gap-2">
            <ShieldCheck size={16} aria-hidden />
            Matriz de conflitos (segregacao de funcoes)
          </span>
        </CardTitulo>
        <CardCorpo>
          <p className="mb-3 text-legenda italic text-ceara-texto2">
            Perfis que nao devem coexistir no mesmo usuario. O servidor recusa o acumulo no cadastro e barra a acao
            conflitante em tempo de execucao — nem para o Administrador.
          </p>
          <Table>
            <Thead>
              <Tr>
                <Th>Perfil</Th>
                <Th>Nao acumula com</Th>
                <Th>Motivo</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(conflitos.data?.itens ?? []).map((c) => (
                <Tr key={`${c.a}-${c.b}`}>
                  <Td>{c.a}</Td>
                  <Td>{c.b}</Td>
                  <Td className="text-ceara-texto2">{c.motivo}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardCorpo>
      </Card>
    </div>
  );
}

function EditorDePermissoes({
  perfil,
  catalogo,
  podeEditar,
  aoErrar,
}: {
  perfil: Perfil;
  catalogo: Permissao[];
  podeEditar: boolean;
  aoErrar: (e: string | null) => void;
}) {
  const cliente = useQueryClient();
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set(perfil.permissoes));

  const salvar = useMutation({
    mutationFn: () => patch(`/perfis/${perfil.id}`, { permissoes: [...selecionadas] }),
    onSuccess: async () => {
      aoErrar(null);
      await cliente.invalidateQueries({ queryKey: ['governanca'] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao salvar o perfil.'),
  });

  const chave = (p: Permissao) => `${p.recurso}:${p.acao}`;

  function alternar(c: string) {
    setSelecionadas((atuais) => {
      const nova = new Set(atuais);
      if (nova.has(c)) nova.delete(c);
      else nova.add(c);
      return nova;
    });
  }

  const mudou =
    selecionadas.size !== perfil.permissoes.length || perfil.permissoes.some((p) => !selecionadas.has(p));

  return (
    <div className="flex flex-col gap-4 border-t border-ceara-borda px-4 py-4">
      {porRecurso(catalogo).map(({ recurso, itens }) => (
        <div key={recurso}>
          <p className="mb-1 text-legenda font-semibold uppercase tracking-wide text-ceara-texto2">{recurso}</p>
          <div className="flex flex-wrap gap-2">
            {itens.map((p) => (
              <label
                key={p.id}
                title={p.descricao ?? undefined}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-ceara-borda px-3 py-1.5 text-corpo"
              >
                <input
                  type="checkbox"
                  disabled={!podeEditar}
                  className="h-4 w-4 accent-[var(--ceara-azul)]"
                  checked={selecionadas.has(chave(p))}
                  onChange={() => alternar(chave(p))}
                />
                {p.acao}
              </label>
            ))}
          </div>
        </div>
      ))}

      {podeEditar ? (
        <div className="flex items-center justify-end gap-2">
          {mudou && <span className="text-legenda italic text-ceara-texto2">Alteracoes nao salvas</span>}
          <Button disabled={!mudou} carregando={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar permissoes
          </Button>
        </div>
      ) : (
        <p className="text-legenda italic text-ceara-texto2">Somente leitura: seu perfil nao edita perfis.</p>
      )}
    </div>
  );
}
