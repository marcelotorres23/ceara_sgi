import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, ShieldAlert, UserPlus } from 'lucide-react';
import { get, post, patch, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { usePermissao } from '../auth/useSessao';
import { dataHoraBr, type Perfil, type UsuarioDaLista } from './tipos';

/**
 * Usuarios e seus perfis (secoes 5.1 a 5.3).
 *
 * A conta nunca e apagada — quem registrou uma troca ou aprovou um lote continua
 * respondendo por isso. Inativar tira do login e mantem o historico de pe.
 */
export function Usuarios({ aoErrar }: { aoErrar: (e: string | null) => void }) {
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<UsuarioDaLista | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ nome: string; senha: string } | null>(null);

  const podeCriar = usePermissao('usuario:criar');
  const podeEditar = usePermissao('usuario:editar');
  const podeInativar = usePermissao('usuario:inativar');

  const usuarios = useQuery({
    queryKey: ['governanca', 'usuarios', busca],
    queryFn: () => get<{ itens: UsuarioDaLista[] }>(`/usuarios?limite=100${busca ? `&busca=${encodeURIComponent(busca)}` : ''}`),
  });

  const perfis = useQuery({
    queryKey: ['governanca', 'perfis'],
    queryFn: () => get<{ itens: Perfil[] }>('/perfis'),
    staleTime: 300_000,
  });

  const itens = usuarios.data?.itens ?? [];
  const comConflito = itens.filter((u) => u.conflitos.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {senhaGerada && (
        <Card destaque="regra">
          <CardCorpo className="flex flex-col gap-2 pt-4">
            <p className="text-h3 text-ceara-texto">Senha temporaria de {senhaGerada.nome}</p>
            <p className="font-mono text-h2 text-ceara-azul">{senhaGerada.senha}</p>
            <p className="text-legenda italic text-ceara-texto2">
              Anote agora e entregue a pessoa: ela nao volta a ser exibida. O sistema fica bloqueado para ela ate
              que troque por uma senha propria, e as sessoes que estavam abertas ja foram encerradas.
            </p>
            <div className="flex justify-end">
              <Button tamanho="sm" variante="secundario" onClick={() => setSenhaGerada(null)}>
                Ja anotei
              </Button>
            </div>
          </CardCorpo>
        </Card>
      )}

      {comConflito.length > 0 && (
        <Card destaque="risco">
          <CardCorpo className="flex items-start gap-2 pt-4">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-ceara-vermelho" aria-hidden />
            <div>
              <p className="text-corpo font-medium text-ceara-vermelho">
                {comConflito.length} usuario(s) acumulam perfis em conflito de segregacao de funcoes.
              </p>
              <p className="text-legenda text-ceara-texto2">
                {comConflito.map((u) => u.nome).join(', ')}. O servidor bloqueia a acao conflitante em tempo de
                execucao, mas o acumulo nao deveria existir no cadastro.
              </p>
            </div>
          </CardCorpo>
        </Card>
      )}

      <Card>
        <CardTitulo
          acao={
            podeCriar && (
              <Button tamanho="sm" iconeEsquerda={<UserPlus size={14} aria-hidden />} onClick={() => setCriando(true)}>
                Novo usuario
              </Button>
            )
          }
        >
          Usuarios ({itens.length})
        </CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <Campo rotulo="Buscar" htmlFor="busca-usuario" ajuda="Nome ou e-mail.">
            <input id="busca-usuario" className={classeControle()} value={busca} onChange={(e) => setBusca(e.target.value)} />
          </Campo>

          {criando && (
            <FormularioDeUsuario
              perfis={perfis.data?.itens ?? []}
              aoErrar={aoErrar}
              aoFechar={() => setCriando(false)}
              aoCriar={(nome, senha) => {
                setCriando(false);
                setSenhaGerada({ nome, senha });
              }}
            />
          )}

          {editando && (
            /*
             * `key` pelo id do usuario: sem ela, clicar em "Editar" numa segunda linha com o
             * formulario ja aberto reaproveitava a mesma instancia — e os `useState` do
             * formulario, que so rodam na montagem, seguiam mostrando os dados do usuario
             * anterior. Salvar ali gravava o nome e os perfis de um por cima do outro.
             */
            <FormularioDeUsuario
              key={editando.id}
              usuario={editando}
              perfis={perfis.data?.itens ?? []}
              aoErrar={aoErrar}
              aoFechar={() => setEditando(null)}
              aoCriar={() => setEditando(null)}
            />
          )}

          {itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Nome</Th>
                  <Th>E-mail</Th>
                  <Th>Perfis</Th>
                  <Th>Unidade</Th>
                  <Th>Ultimo acesso</Th>
                  <Th>Situacao</Th>
                  <Th>Acoes</Th>
                </Tr>
              </Thead>
              <Tbody>
                {itens.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      {u.nome}
                      {u.conflitos.length > 0 && (
                        <span className="mt-0.5 flex items-center gap-1 text-legenda text-ceara-vermelho">
                          <AlertTriangle size={12} aria-hidden />
                          {u.conflitos.map((c) => `${c.a} + ${c.b}`).join(', ')}
                        </span>
                      )}
                    </Td>
                    <Td className="font-mono text-legenda">
                      {u.email}
                      {u.loginWinthor && <span className="block text-ceara-azul">WinThor: {u.loginWinthor}</span>}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {u.perfis.map((p) => (
                          <Badge key={p} tom="azul">
                            {p}
                          </Badge>
                        ))}
                      </span>
                    </Td>
                    <Td>
                      {u.unidadeNome ?? <span className="text-ceara-texto2">sem unidade</span>}
                      {u.unidades.length > 1 && (
                        <span className="block text-legenda text-ceara-texto2">
                          alcanca {u.unidades.length} unidades
                        </span>
                      )}
                      {u.centroCustoRotulo && (
                        <span className="block text-legenda text-ceara-texto2">{u.centroCustoRotulo}</span>
                      )}
                    </Td>
                    <Td>{dataHoraBr(u.ultimoLoginEm)}</Td>
                    <Td>
                      <Badge tom={u.ativo ? 'verde' : 'neutro'}>{u.ativo ? 'ativo' : 'inativo'}</Badge>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {podeEditar && (
                          <Button tamanho="sm" variante="texto" onClick={() => setEditando(u)}>
                            Editar
                          </Button>
                        )}
                        {podeEditar && <RedefinirSenha usuario={u} aoErrar={aoErrar} aoGerar={setSenhaGerada} />}
                        {podeInativar && <AlternarSituacao usuario={u} aoErrar={aoErrar} />}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio titulo="Nenhum usuario" descricao="Nenhum usuario encontrado com esta busca." />
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- formulario

function FormularioDeUsuario({
  usuario,
  perfis,
  aoErrar,
  aoFechar,
  aoCriar,
}: {
  usuario?: UsuarioDaLista;
  perfis: Perfil[];
  aoErrar: (e: string | null) => void;
  aoFechar: () => void;
  aoCriar: (nome: string, senha: string) => void;
}) {
  const cliente = useQueryClient();
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [loginWinthor, setLoginWinthor] = useState(usuario?.loginWinthor ?? '');
  const [telefone, setTelefone] = useState(usuario?.telefone ?? '');
  const [unidadeId, setUnidadeId] = useState(usuario?.unidadeId ?? '');
  const [centroCustoId, setCentroCustoId] = useState(usuario?.centroCustoId ?? '');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set(usuario?.perfis ?? []));
  const [unidadesAlcancadas, setUnidadesAlcancadas] = useState<Set<string>>(new Set(usuario?.unidades ?? []));

  // o formulario abre acima da tabela; numa lista longa, quem clica "Editar" numa linha
  // de baixo nao veria nada acontecer
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caixa.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const unidades = useQuery({
    queryKey: ['governanca', 'unidades'],
    queryFn: () => get<{ itens: Array<{ id: string; nome: string; cidade: string; uf: string }> }>('/unidades'),
    staleTime: 300_000,
  });

  const centros = useQuery({
    queryKey: ['governanca', 'centros-custo'],
    queryFn: () => get<{ itens: Array<{ id: string; rotulo: string; unidadeId: string }> }>('/centros-custo'),
    staleTime: 300_000,
  });

  // centro de custo pertence a uma unidade: oferecer os de outra so produz erro no salvar
  const centrosDaUnidade = (centros.data?.itens ?? []).filter((c) => !unidadeId || c.unidadeId === unidadeId);

  const salvar = useMutation({
    mutationFn: async () => {
      const comuns = {
        nome,
        loginWinthor: loginWinthor.trim() || null,
        telefone: telefone.trim() || null,
        unidadeId: unidadeId || null,
        centroCustoId: centroCustoId || null,
        perfis: [...selecionados],
        unidades: [...unidadesAlcancadas],
      };
      if (usuario) {
        await patch(`/usuarios/${usuario.id}`, comuns);
        return null;
      }
      return post<{ nome: string; senhaTemporaria: string }>('/usuarios', { ...comuns, email });
    },
    onSuccess: async (r) => {
      aoErrar(null);
      await cliente.invalidateQueries({ queryKey: ['governanca'] });
      aoCriar(r?.nome ?? nome, r?.senhaTemporaria ?? '');
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao salvar o usuario.'),
  });

  function alternar(nomePerfil: string) {
    setSelecionados((atuais) => {
      const nova = new Set(atuais);
      if (nova.has(nomePerfil)) nova.delete(nomePerfil);
      else nova.add(nomePerfil);
      return nova;
    });
  }

  const pronto = nome.trim().length >= 3 && (usuario || email.includes('@')) && selecionados.size > 0;

  return (
    <div ref={caixa} className="flex flex-col gap-4 rounded-card border border-ceara-azul bg-[var(--ceara-azul-10)] p-4">
      <p className="text-h3 text-ceara-azul">{usuario ? `Editar ${usuario.nome}` : 'Novo usuario'}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome" htmlFor="u-nome" obrigatorio>
          <input id="u-nome" className={classeControle()} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo
          rotulo="E-mail"
          htmlFor="u-email"
          obrigatorio={!usuario}
          ajuda={usuario ? 'O e-mail identifica a conta e nao muda.' : 'Sera o login. A senha temporaria e gerada pelo sistema.'}
        >
          <input
            id="u-email"
            type="email"
            disabled={Boolean(usuario)}
            className={`${classeControle()} disabled:bg-ceara-nevoa disabled:text-ceara-texto2`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Campo>

        <Campo
          rotulo="Usuario WinThor"
          htmlFor="u-winthor"
          ajuda="Nome de guerra no WinThor. Preenchido, a pessoa entra com a senha do WinThor."
        >
          <input
            id="u-winthor"
            className={`${classeControle()} uppercase`}
            value={loginWinthor}
            onChange={(e) => setLoginWinthor(e.target.value)}
          />
        </Campo>

        <Campo rotulo="Telefone" htmlFor="u-telefone" ajuda="Usado no aviso de senha entregue por telefone.">
          <input
            id="u-telefone"
            className={classeControle()}
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
          />
        </Campo>

        <Campo
          rotulo="Unidade"
          htmlFor="u-unidade"
          ajuda="Recorta o que a pessoa enxerga e onde ela grava, salvo perfil que alcanca a rede."
        >
          <select
            id="u-unidade"
            className={classeControle()}
            value={unidadeId}
            onChange={(e) => {
              setUnidadeId(e.target.value);
              // trocar de unidade invalida o centro escolhido, que era da anterior
              setCentroCustoId('');
            }}
          >
            <option value="">Sem unidade definida</option>
            {(unidades.data?.itens ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome} — {u.cidade}/{u.uf}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          rotulo="Centro de custo"
          htmlFor="u-centro"
          ajuda={unidadeId ? 'Centros da unidade escolhida.' : 'Escolha a unidade para filtrar os centros.'}
        >
          <select
            id="u-centro"
            className={classeControle()}
            value={centroCustoId}
            onChange={(e) => setCentroCustoId(e.target.value)}
          >
            <option value="">Sem centro de custo</option>
            {centrosDaUnidade.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <div>
        <p className="mb-1 text-h3 text-ceara-texto">Unidades que alcanca</p>
        <p className="mb-2 text-legenda italic text-ceara-texto2">
          Marque quantas a pessoa precisar gerir. Ela escolhe qual esta operando no cabecalho e troca sem sair da
          conta; tudo que grava vai para a unidade ativa no momento. A lotacao entra sempre, mesmo desmarcada.
        </p>
        <div className="flex flex-wrap gap-2">
          {(unidades.data?.itens ?? []).map((u) => {
            const ehLotacao = u.id === unidadeId;
            return (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-ceara-borda bg-white px-3 py-2 text-corpo"
                title={ehLotacao ? 'Lotacao do cadastro: sempre alcancada.' : undefined}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--ceara-azul)]"
                  checked={ehLotacao || unidadesAlcancadas.has(u.id)}
                  disabled={ehLotacao}
                  onChange={() =>
                    setUnidadesAlcancadas((atuais) => {
                      const nova = new Set(atuais);
                      if (nova.has(u.id)) nova.delete(u.id);
                      else nova.add(u.id);
                      return nova;
                    })
                  }
                />
                {u.nome}
                {ehLotacao && <span className="text-legenda text-ceara-texto2">(lotacao)</span>}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-h3 text-ceara-texto">Perfis</p>
        <div className="flex flex-wrap gap-2">
          {perfis.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-ceara-borda bg-white px-3 py-2 text-corpo"
              title={p.descricao ?? undefined}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--ceara-azul)]"
                checked={selecionados.has(p.nome)}
                onChange={() => alternar(p.nome)}
              />
              {p.nome}
            </label>
          ))}
        </div>
        <p className="mt-1 text-legenda italic text-ceara-texto2">
          Perfis em conflito de segregacao de funcoes sao recusados pelo servidor — quem solicita nao cota, quem
          cota nao aprova, quem aprova nao recebe.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variante="texto" onClick={aoFechar}>
          Cancelar
        </Button>
        <Button disabled={!pronto} carregando={salvar.isPending} onClick={() => salvar.mutate()}>
          {usuario ? 'Salvar' : 'Criar usuario'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- acoes de linha

/**
 * Redefinicao da senha pelo administrador (secao 5.1).
 *
 * Duas formas: gerada pelo sistema (padrao) ou definida por quem administra, quando a
 * entrega e por telefone. Nos dois casos a senha vale so para entrar — a troca no primeiro
 * acesso e obrigatoria, e as sessoes abertas caem na hora.
 */
function RedefinirSenha({
  usuario,
  aoErrar,
  aoGerar,
}: {
  usuario: UsuarioDaLista;
  aoErrar: (e: string | null) => void;
  aoGerar: (s: { nome: string; senha: string }) => void;
}) {
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  // a recusa precisa aparecer ao lado do campo: no topo da pagina ela fica fora da tela
  // de quem esta no meio da tabela, e a impressao e que o botao nao fez nada
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [exigirTroca, setExigirTroca] = useState(true);

  const redefinir = useMutation({
    mutationFn: (definir: boolean) =>
      post<{ senhaTemporaria: string }>(
        `/usuarios/${usuario.id}/redefinir-senha`,
        definir ? { senha, exigirTroca } : {},
      ),
    onSuccess: async (r) => {
      aoErrar(null);
      setErroLocal(null);
      setAberto(false);
      setSenha('');
      setExigirTroca(true);
      await cliente.invalidateQueries({ queryKey: ['governanca', 'usuarios'] });
      aoGerar({ nome: usuario.nome, senha: r.senhaTemporaria });
    },
    onError: (falha) => setErroLocal(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao redefinir a senha.'),
  });

  if (!aberto) {
    return (
      <Button
        tamanho="sm"
        variante="texto"
        onClick={() => setAberto(true)}
        iconeEsquerda={<KeyRound size={13} aria-hidden />}
        title="Redefinir a senha e encerrar as sessoes abertas"
      >
        Senha
      </Button>
    );
  }

  const definindo = senha.trim().length > 0;

  return (
    <span className="flex min-w-[16rem] flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1">
        <input
          type="text"
          className={`h-8 w-44 rounded-lg border px-2 text-legenda ${erroLocal ? 'border-ceara-vermelho' : 'border-ceara-borda'}`}
          placeholder="deixe vazio para gerar"
          value={senha}
          onChange={(e) => {
            setSenha(e.target.value);
            setErroLocal(null);
          }}
          aria-label={`Nova senha de ${usuario.nome}`}
          aria-invalid={Boolean(erroLocal)}
        />
        <Button tamanho="sm" carregando={redefinir.isPending} onClick={() => redefinir.mutate(definindo)}>
          {definindo ? 'Definir' : 'Gerar'}
        </Button>
        <Button
          tamanho="sm"
          variante="texto"
          onClick={() => {
            setAberto(false);
            setSenha('');
            setErroLocal(null);
            aoErrar(null);
          }}
        >
          Cancelar
        </Button>
      </span>

      {erroLocal && (
        <span role="alert" className="text-legenda text-ceara-vermelho">
          {erroLocal}
        </span>
      )}

      {definindo && (
        <>
          <label className="flex items-center gap-2 text-legenda text-ceara-texto2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--ceara-azul)]"
              checked={!exigirTroca}
              onChange={(e) => setExigirTroca(!e.target.checked)}
            />
            Ja e a senha definitiva — nao pedir troca no primeiro acesso
          </label>
          {!erroLocal && (
            <span className="text-legenda italic text-ceara-texto2">
              Ao menos 8 caracteres. Nao pode ser apenas o nome ou o e-mail da pessoa.
            </span>
          )}
        </>
      )}
    </span>
  );
}

function AlternarSituacao({ usuario, aoErrar }: { usuario: UsuarioDaLista; aoErrar: (e: string | null) => void }) {
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [pedindoMotivo, setPedindoMotivo] = useState(false);

  const alternar = useMutation({
    mutationFn: () =>
      usuario.ativo
        ? post(`/usuarios/${usuario.id}/inativar`, { motivo })
        : post(`/usuarios/${usuario.id}/reativar`, {}),
    onSuccess: async () => {
      aoErrar(null);
      setPedindoMotivo(false);
      setMotivo('');
      await cliente.invalidateQueries({ queryKey: ['governanca', 'usuarios'] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao mudar a situacao.'),
  });

  if (!usuario.ativo) {
    return (
      <Button tamanho="sm" variante="texto" carregando={alternar.isPending} onClick={() => alternar.mutate()}>
        Reativar
      </Button>
    );
  }

  if (!pedindoMotivo) {
    return (
      <Button tamanho="sm" variante="texto" onClick={() => setPedindoMotivo(true)}>
        Inativar
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        className="h-8 w-40 rounded-lg border border-ceara-borda px-2 text-legenda"
        placeholder="Motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      <Button
        tamanho="sm"
        variante="destrutivo"
        disabled={motivo.trim().length < 5}
        carregando={alternar.isPending}
        onClick={() => alternar.mutate()}
      >
        Confirmar
      </Button>
      <Button tamanho="sm" variante="texto" onClick={() => setPedindoMotivo(false)}>
        Cancelar
      </Button>
    </span>
  );
}

