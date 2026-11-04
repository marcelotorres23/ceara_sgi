import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { ApiError, api, get, post } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo } from '../../design-system/components/Card';
import { ModalConfirmacao } from '../../design-system/components/ModalConfirmacao';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { classeControle } from '../../design-system/components/Campo';
import { useSessao } from '../auth/useSessao';
import { FormularioCadastro } from './FormularioCadastro';
import type { AcaoRegistro, DefinicaoCadastro } from './tipos';

interface Registro extends Record<string, unknown> {
  id: string;
  inativadoEm?: string | null;
  motivoInativacao?: string | null;
}

type Pendencia =
  | { tipo: 'acao'; acao: AcaoRegistro<Registro>; registro: Registro }
  | { tipo: 'inativar'; registro: Registro }
  | { tipo: 'reativar'; registro: Registro };

export function PaginaCadastro({ definicao }: { definicao: DefinicaoCadastro<Registro> }) {
  const cliente = useQueryClient();
  const permissoes = useSessao((s) => s.usuario?.permissoes ?? []);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [editando, setEditando] = useState<Registro | null>(null);
  const [criando, setCriando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const [pendencia, setPendencia] = useState<Pendencia | null>(null);

  const consulta = busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}&limite=50` : '?limite=50';

  const { data, isLoading } = useQuery({
    queryKey: [definicao.chaveQuery, busca],
    queryFn: () => get<{ itens: Registro[] }>(`${definicao.recurso}${consulta}`),
  });

  const aoConcluir = () => {
    setCriando(false);
    setEditando(null);
    setPendencia(null);
    setErroServidor(null);
    void cliente.invalidateQueries({ queryKey: [definicao.chaveQuery] });
  };

  const aoFalhar = (e: unknown) =>
    setErroServidor(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel concluir a operacao.');

  const criar = useMutation({
    mutationFn: (valores: Record<string, string | boolean>) => post(definicao.recurso, limpar(valores)),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  const editar = useMutation({
    mutationFn: ({ id, valores }: { id: string; valores: Record<string, string | boolean> }) =>
      api(`${definicao.recurso}/${id}`, { method: 'PATCH', body: JSON.stringify(limpar(valores)) }),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  const executar = useMutation({
    mutationFn: ({ caminho, motivo }: { caminho: string; motivo?: string }) =>
      post(`${definicao.recurso}${caminho}`, motivo ? { motivo } : undefined),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  const podeCriar = permissoes.includes(definicao.permissaoCriar);
  const podeEditar = permissoes.includes(definicao.permissaoEditar);

  const registros = (data?.itens ?? []).filter((r) => (mostrarInativos ? true : !r.inativadoEm));
  const inativos = (data?.itens ?? []).filter((r) => r.inativadoEm).length;
  const emFormulario = criando || editando !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">{definicao.titulo}</h1>
          <p className="text-legenda italic text-ceara-texto2">{definicao.descricao}</p>
        </div>

        {podeCriar && !emFormulario && (
          <Button onClick={() => { setCriando(true); setErroServidor(null); }}>
            <Plus size={16} aria-hidden /> Novo
          </Button>
        )}
      </div>

      {emFormulario && (
        <Card destaque="regra">
          <CardCorpo className="pt-4">
            <h2 className="h2-secao">{editando ? 'Editar registro' : 'Novo registro'}</h2>
            {editando && (
              <p className="mt-2 text-legenda italic text-ceara-texto2">
                A alteracao fica registrada na trilha com o valor anterior e o novo.
              </p>
            )}
            <div className="mt-4">
              <FormularioCadastro
                campos={definicao.campos}
                registro={editando}
                naoEditaveis={definicao.naoEditaveis}
                enviando={criar.isPending || editar.isPending}
                erroServidor={erroServidor}
                onCancelar={() => { setCriando(false); setEditando(null); setErroServidor(null); }}
                onEnviar={(v) =>
                  editando ? editar.mutate({ id: editando.id, valores: v }) : criar.mutate(v)
                }
              />
            </div>
          </CardCorpo>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="relative flex max-w-sm flex-1 items-center">
          <Search size={16} className="absolute left-3 text-ceara-texto2" aria-hidden />
          <span className="sr-only">Buscar</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar"
            className={`${classeControle()} w-full pl-9`}
          />
        </label>

        {inativos > 0 && (
          <label className="flex items-center gap-2 text-corpo">
            <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
            Mostrar inativos ({inativos})
          </label>
        )}
      </div>

      {erroServidor && !emFormulario && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-corpo text-ceara-vermelho">
          {erroServidor}
        </p>
      )}

      {isLoading && <p className="text-corpo text-ceara-texto2">Carregando...</p>}

      {data && registros.length === 0 && (
        <Card>
          <EstadoVazio titulo={definicao.vazio.titulo} descricao={definicao.vazio.descricao} />
        </Card>
      )}

      {registros.length > 0 && (
        <Table>
          <Thead>
            <Tr>
              {definicao.colunas.map((c) => (
                <Th key={c.chave} className={c.alinhamento === 'direita' ? 'text-right' : undefined}>
                  {c.rotulo}
                </Th>
              ))}
              {podeEditar && <Th className="text-right">Acoes</Th>}
            </Tr>
          </Thead>
          <Tbody>
            {registros.map((r) => {
              const inativo = Boolean(r.inativadoEm);
              return (
                <Tr key={r.id} className={cn(inativo && 'opacity-60')}>
                  {definicao.colunas.map((c, i) => (
                    <Td key={c.chave} className={c.alinhamento === 'direita' ? 'text-right' : undefined}>
                      {c.render ? c.render(r) : String(r[c.chave] ?? '—')}
                      {i === 0 && inativo && (
                        <p className="text-legenda italic text-ceara-vermelho">
                          Inativo: {String(r.motivoInativacao ?? 'sem motivo registrado')}
                        </p>
                      )}
                    </Td>
                  ))}
                  {podeEditar && (
                    <Td className="text-right">
                      <span className="flex justify-end gap-1">
                        {!inativo && (
                          <Button variante="texto" tamanho="sm" onClick={() => { setEditando(r); setCriando(false); setErroServidor(null); }}>
                            <Pencil size={13} aria-hidden /> Editar
                          </Button>
                        )}

                        {(definicao.acoes ?? [])
                          .filter((a) => (a.visivel ? a.visivel(r) : true))
                          .filter((a) => !a.permissao || permissoes.includes(a.permissao))
                          .filter(() => !inativo)
                          .map((a) => (
                            <Button
                              key={a.rotulo}
                              variante="texto"
                              tamanho="sm"
                              onClick={() =>
                                a.confirmar
                                  ? setPendencia({ tipo: 'acao', acao: a, registro: r })
                                  : executar.mutate({ caminho: a.caminho(r) })
                              }
                            >
                              {a.rotulo}
                            </Button>
                          ))}

                        {inativo ? (
                          <Button variante="texto" tamanho="sm" onClick={() => setPendencia({ tipo: 'reativar', registro: r })}>
                            <RotateCcw size={13} aria-hidden /> Reativar
                          </Button>
                        ) : (
                          <Button variante="destrutivo" tamanho="sm" onClick={() => setPendencia({ tipo: 'inativar', registro: r })}>
                            <Ban size={13} aria-hidden /> Inativar
                          </Button>
                        )}
                      </span>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}

      <ModalConfirmacao
        aberto={pendencia !== null}
        titulo={
          pendencia?.tipo === 'inativar' ? `Inativar ${definicao.titulo.toLowerCase().replace(/s$/, '')}`
          : pendencia?.tipo === 'reativar' ? 'Reativar registro'
          : (pendencia?.acao.confirmar?.titulo ?? '')
        }
        descricao={
          pendencia?.tipo === 'inativar' ? definicao.avisoInativacao
          : pendencia?.tipo === 'reativar' ? 'O registro volta a ficar disponivel para uso. O motivo fica na trilha.'
          : (pendencia?.acao.confirmar?.descricao ?? '')
        }
        rotuloConfirmar={pendencia?.tipo === 'inativar' ? 'Inativar' : 'Confirmar'}
        destrutivo={pendencia?.tipo === 'inativar'}
        exigirMotivo={pendencia?.tipo !== 'acao' || pendencia.acao.confirmar?.exigirMotivo}
        onCancelar={() => setPendencia(null)}
        onConfirmar={(motivo) => {
          if (!pendencia) return;
          const caminho =
            pendencia.tipo === 'inativar' ? `/${pendencia.registro.id}/inativar`
            : pendencia.tipo === 'reativar' ? `/${pendencia.registro.id}/reativar`
            : pendencia.acao.caminho(pendencia.registro);
          executar.mutate({ caminho, motivo });
        }}
      />
    </div>
  );
}

/** Campo vazio vira ausencia, nao string vazia: o servidor distingue os dois. */
function limpar(valores: Record<string, string | boolean>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(valores).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : v]),
  );
}
