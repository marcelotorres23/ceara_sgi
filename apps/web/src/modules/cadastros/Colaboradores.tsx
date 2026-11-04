import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Camera, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { ApiError, api, get, post } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { ModalConfirmacao } from '../../design-system/components/ModalConfirmacao';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { useSessao } from '../auth/useSessao';

interface Colaborador {
  id: string;
  matricula: string;
  nome: string;
  cargo: string;
  setor: string;
  admissao: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  dataNascimento: string | null;
  fotoUrl: string | null;
  status: 'ATIVO' | 'AFASTADO' | 'DESLIGADO';
  inativadoEm: string | null;
  motivoInativacao: string | null;
  gestor: { nome: string } | null;
  unidade: { codigo: string };
}

const dataBr = (iso: string | null) => (iso === null ? '—' : new Date(iso).toLocaleDateString('pt-BR'));
const soDigitos = (v: string) => v.replace(/\D/g, '');

const cpfFormatado = (v: string | null): string => {
  if (!v) return '—';
  const d = soDigitos(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v;
};

/**
 * Cadastro de colaboradores (secao 9.1).
 *
 * Fica fora do formulario generico dos demais cadastros por causa da **foto**: o hub
 * declarativo monta campos de texto, e foto e outro fluxo — captura, redimensionamento no
 * navegador e upload proprio. E a foto importa aqui porque o painel de classificacao
 * mostra gente, e nao linha de planilha.
 */
export function Colaboradores() {
  const cliente = useQueryClient();
  const permissoes = useSessao((s) => s.usuario?.permissoes ?? []);
  const podeGerenciar = permissoes.includes('colaborador:gerenciar');

  const [busca, setBusca] = useState('');
  const [mostrarDesligados, setMostrarDesligados] = useState(false);
  const [editando, setEditando] = useState<Colaborador | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendencia, setPendencia] = useState<{ tipo: 'inativar' | 'reativar'; registro: Colaborador } | null>(null);

  const consulta = busca.trim() ? `?limite=100&busca=${encodeURIComponent(busca.trim())}` : '?limite=100';
  const { data, isLoading } = useQuery({
    queryKey: ['cadastro-colaboradores', busca],
    queryFn: () => get<{ itens: Colaborador[] }>(`/pessoas/colaboradores${consulta}`),
  });

  const aoConcluir = async () => {
    setErro(null);
    setCriando(false);
    setEditando(null);
    setPendencia(null);
    await cliente.invalidateQueries({ queryKey: ['cadastro-colaboradores'] });
    await cliente.invalidateQueries({ queryKey: ['pessoas'] });
  };

  const aoFalhar = (e: unknown) =>
    setErro(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel concluir a operacao.');

  const executar = useMutation({
    mutationFn: ({ caminho, motivo }: { caminho: string; motivo?: string }) =>
      post(`/pessoas/colaboradores${caminho}`, motivo ? { motivo } : undefined),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  const registros = (data?.itens ?? []).filter((c) => (mostrarDesligados ? true : !c.inativadoEm));
  const desligados = (data?.itens ?? []).filter((c) => c.inativadoEm).length;
  const emFormulario = criando || editando !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Colaboradores</h1>
          <p className="text-legenda italic text-ceara-texto2">
            Ficha de quem trabalha no setor. A foto aparece no painel de classificacao e na ficha individual.
          </p>
        </div>

        {podeGerenciar && !emFormulario && (
          <Button onClick={() => { setCriando(true); setErro(null); }}>
            <Plus size={16} aria-hidden /> Novo colaborador
          </Button>
        )}
      </div>

      {erro && !emFormulario && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {emFormulario && (
        <FormularioColaborador
          registro={editando}
          aoConcluir={aoConcluir}
          aoErrar={setErro}
          erroServidor={erro}
          aoFechar={() => { setCriando(false); setEditando(null); setErro(null); }}
        />
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="relative flex max-w-sm flex-1 items-center">
          <Search size={16} className="absolute left-3 text-ceara-texto2" aria-hidden />
          <span className="sr-only">Buscar</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome ou matricula"
            className={`${classeControle()} w-full pl-9`}
          />
        </label>

        {desligados > 0 && (
          <label className="flex items-center gap-2 text-corpo">
            <input type="checkbox" checked={mostrarDesligados} onChange={(e) => setMostrarDesligados(e.target.checked)} />
            Mostrar desligados ({desligados})
          </label>
        )}
      </div>

      {isLoading && <p className="text-corpo text-ceara-texto2">Carregando...</p>}

      {data && registros.length === 0 && (
        <Card>
          <EstadoVazio titulo="Nenhum colaborador cadastrado" descricao="Cadastre a equipe para acompanhar a pontuacao." />
        </Card>
      )}

      {registros.length > 0 && (
        <Table>
          <Thead>
            <Tr>
              <Th>Colaborador</Th>
              <Th>Matricula</Th>
              <Th>Cargo</Th>
              <Th>Setor</Th>
              <Th>Admissao</Th>
              <Th>Contato</Th>
              {podeGerenciar && <Th className="text-right">Acoes</Th>}
            </Tr>
          </Thead>
          <Tbody>
            {registros.map((c) => (
              <Tr key={c.id} className={cn(c.inativadoEm && 'opacity-60')}>
                <Td>
                  <span className="flex items-center gap-3">
                    <Retrato nome={c.nome} url={c.fotoUrl} />
                    <span>
                      {c.nome}
                      {c.inativadoEm && (
                        <p className="text-legenda italic text-ceara-vermelho">
                          Desligado: {c.motivoInativacao ?? 'sem motivo registrado'}
                        </p>
                      )}
                    </span>
                  </span>
                </Td>
                <Td className="font-mono">{c.matricula}</Td>
                <Td>{c.cargo}</Td>
                <Td>{c.setor}</Td>
                <Td>{dataBr(c.admissao)}</Td>
                <Td>
                  {c.telefone ?? '—'}
                  {c.email && <p className="text-legenda text-ceara-texto2">{c.email}</p>}
                </Td>
                {podeGerenciar && (
                  <Td className="text-right">
                    <span className="flex justify-end gap-1">
                      {!c.inativadoEm && (
                        <Button variante="texto" tamanho="sm" onClick={() => { setEditando(c); setCriando(false); setErro(null); }}>
                          <Pencil size={13} aria-hidden /> Editar
                        </Button>
                      )}
                      {c.inativadoEm ? (
                        <Button variante="texto" tamanho="sm" onClick={() => setPendencia({ tipo: 'reativar', registro: c })}>
                          <RotateCcw size={13} aria-hidden /> Readmitir
                        </Button>
                      ) : (
                        <Button variante="destrutivo" tamanho="sm" onClick={() => setPendencia({ tipo: 'inativar', registro: c })}>
                          <Ban size={13} aria-hidden /> Desligar
                        </Button>
                      )}
                    </span>
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <ModalConfirmacao
        aberto={pendencia !== null}
        titulo={pendencia?.tipo === 'inativar' ? 'Desligar colaborador' : 'Readmitir colaborador'}
        descricao={
          pendencia?.tipo === 'inativar'
            ? 'O colaborador sai do painel de classificacao e para de receber lancamento. A ficha e o historico de pontos continuam consultaveis — nada se apaga. O desligamento e recusado se houver contestacao aguardando decisao.'
            : 'O colaborador volta a aparecer no painel e a receber lancamento. O motivo fica na trilha.'
        }
        rotuloConfirmar={pendencia?.tipo === 'inativar' ? 'Desligar' : 'Readmitir'}
        destrutivo={pendencia?.tipo === 'inativar'}
        exigirMotivo
        onCancelar={() => setPendencia(null)}
        onConfirmar={(motivo) => {
          if (!pendencia) return;
          const acao = pendencia.tipo === 'inativar' ? 'inativar' : 'reativar';
          executar.mutate({ caminho: `/${pendencia.registro.id}/${acao}`, motivo });
        }}
      />
    </div>
  );
}

/** Foto do colaborador, com a inicial do nome enquanto nao houver retrato. */
export function Retrato({ nome, url, tamanho = 36 }: { nome: string; url: string | null; tamanho?: number }) {
  const inicial = nome.trim().charAt(0).toUpperCase() || '?';

  if (url) {
    return (
      <img
        src={url}
        alt={`Foto de ${nome}`}
        width={tamanho}
        height={tamanho}
        className="shrink-0 rounded-full object-cover"
        style={{ width: tamanho, height: tamanho }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--ceara-azul-10)] font-medium text-ceara-azul"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.4 }}
    >
      {inicial}
    </span>
  );
}

function FormularioColaborador({
  registro,
  aoConcluir,
  aoErrar,
  erroServidor,
  aoFechar,
}: {
  registro: Colaborador | null;
  aoConcluir: () => void;
  aoErrar: (e: string | null) => void;
  erroServidor: string | null;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(registro?.nome ?? '');
  const [matricula, setMatricula] = useState(registro?.matricula ?? '');
  const [cargo, setCargo] = useState(registro?.cargo ?? '');
  const [setor, setSetor] = useState(registro?.setor ?? '');
  const [admissao, setAdmissao] = useState(registro?.admissao?.slice(0, 10) ?? '');
  const [cpf, setCpf] = useState(registro?.cpf ?? '');
  const [telefone, setTelefone] = useState(registro?.telefone ?? '');
  const [email, setEmail] = useState(registro?.email ?? '');
  const [dataNascimento, setNascimento] = useState(registro?.dataNascimento?.slice(0, 10) ?? '');
  const [foto, setFoto] = useState<string | null>(registro?.fotoUrl ?? null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const corpo = () => ({
    nome,
    matricula,
    cargo,
    setor,
    admissao,
    cpf: soDigitos(cpf) || null,
    telefone: telefone.trim() || null,
    email: email.trim() || null,
    dataNascimento: dataNascimento || null,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const salvo = registro
        ? await api<Colaborador>(`/pessoas/colaboradores/${registro.id}`, { method: 'PATCH', body: JSON.stringify(corpo()) })
        : await post<Colaborador>('/pessoas/colaboradores', corpo());

      // a foto so pode subir depois de existir o registro: ela e anexada ao colaborador
      if (!registro && foto?.startsWith('data:')) await enviarFoto(salvo.id, foto);
      return salvo;
    },
    onSuccess: aoConcluir,
    onError: (e) => aoErrar(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel salvar o colaborador.'),
  });

  /**
   * Reduz a foto no navegador antes de enviar.
   *
   * Retrato de cadastro nao precisa de 4 MB: 480 px de lado bastam para a lista e para a
   * ficha, e o pátio nem sempre tem sinal bom para mandar o original da camera.
   */
  async function aoEscolher(f: File) {
    const bitmap = await createImageBitmap(f);
    const lado = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // recorta o centro em quadrado: retrato redondo na lista nao pode cortar a cabeca
    ctx.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, 480, 480);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    setFoto(dataUrl);

    // no registro que ja existe a foto sobe na hora; no novo, espera o cadastro nascer
    if (registro) {
      setEnviandoFoto(true);
      try {
        await enviarFoto(registro.id, dataUrl);
      } catch (e) {
        aoErrar(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel enviar a foto.');
      } finally {
        setEnviandoFoto(false);
      }
    }
  }

  const pronto =
    nome.trim().length >= 3 &&
    matricula.trim().length >= 1 &&
    cargo.trim().length >= 2 &&
    setor.trim().length >= 2 &&
    admissao !== '';

  return (
    <Card destaque="regra">
      <CardTitulo acao={<Button tamanho="sm" variante="texto" onClick={aoFechar}>Fechar</Button>}>
        {registro ? `Editar ${registro.nome}` : 'Novo colaborador'}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        {erroServidor && (
          <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-corpo text-ceara-vermelho">
            {erroServidor}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Retrato nome={nome || '?'} url={foto} tamanho={96} />
          <div className="flex flex-col gap-1">
            <input
              ref={arquivo}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void aoEscolher(f);
              }}
            />
            <Button variante="secundario" tamanho="sm" carregando={enviandoFoto} onClick={() => arquivo.current?.click()}>
              <Camera size={14} aria-hidden /> {foto ? 'Trocar foto' : 'Incluir foto'}
            </Button>
            <span className="text-legenda text-ceara-texto2">
              Opcional. A imagem e reduzida e recortada em quadrado no proprio navegador.
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Nome" htmlFor="c-nome" obrigatorio>
            <input id="c-nome" className={classeControle()} value={nome} onChange={(e) => setNome(e.target.value)} />
          </Campo>
          <Campo rotulo="Matricula" htmlFor="c-matricula" obrigatorio>
            <input id="c-matricula" className={classeControle()} value={matricula} onChange={(e) => setMatricula(e.target.value)} />
          </Campo>
          <Campo rotulo="CPF" htmlFor="c-cpf" ajuda="So numeros. Identifica a pessoa quando a matricula muda.">
            <input id="c-cpf" inputMode="numeric" className={classeControle()} value={cpf} onChange={(e) => setCpf(e.target.value)} />
          </Campo>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Campo rotulo="Cargo" htmlFor="c-cargo" obrigatorio>
            <input id="c-cargo" className={classeControle()} value={cargo} onChange={(e) => setCargo(e.target.value)} />
          </Campo>
          <Campo rotulo="Setor" htmlFor="c-setor" obrigatorio>
            <input id="c-setor" className={classeControle()} value={setor} onChange={(e) => setSetor(e.target.value)} />
          </Campo>
          <Campo rotulo="Admissao" htmlFor="c-admissao" obrigatorio>
            <input id="c-admissao" type="date" className={classeControle()} value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
          </Campo>
          <Campo rotulo="Nascimento" htmlFor="c-nasc">
            <input id="c-nasc" type="date" className={classeControle()} value={dataNascimento} onChange={(e) => setNascimento(e.target.value)} />
          </Campo>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Telefone" htmlFor="c-tel">
            <input id="c-tel" className={classeControle()} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          </Campo>
          <Campo rotulo="E-mail" htmlFor="c-email">
            <input id="c-email" type="email" className={classeControle()} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
        </div>

        {registro && (
          <p className="text-legenda italic text-ceara-texto2">
            CPF cadastrado: {cpfFormatado(registro.cpf)} · unidade {registro.unidade.codigo}
            {registro.gestor && ` · gestor ${registro.gestor.nome}`}. A alteracao fica na trilha com o valor anterior.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variante="texto" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={!pronto} carregando={salvar.isPending} onClick={() => salvar.mutate()}>
            {registro ? 'Salvar' : 'Cadastrar'}
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}

async function enviarFoto(colaboradorId: string, dataUrl: string): Promise<void> {
  await post(`/pessoas/colaboradores/${colaboradorId}/foto`, {
    conteudoBase64: dataUrl.split(',')[1] ?? '',
    mime: 'image/jpeg',
    nome: 'retrato.jpg',
  });
}
