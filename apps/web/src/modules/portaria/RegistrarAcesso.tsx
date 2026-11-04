import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import {
  RECADO_DO_ENVIO,
  ROTULO_TIPO_ACESSO,
  ROTULO_TIPO_PESSOA,
  type AcessoRegistrado,
  type FichaLargadaEmitida,
  type FrotaDaGuarita,
  type PessoaExterna,
  type PontoAcesso,
  type TipoAcesso,
  type TipoPessoaExterna,
} from './tipos';
import { AcoesDaFicha } from './FichaDeLargada';

/**
 * Registro do movimento no portao (secao 14.2).
 *
 * Tres fluxos, um formulario: pessoa a pe, veiculo de terceiro e caminhao da casa saindo.
 * O que muda entre eles e o que a guarita precisa preencher — e o servidor recusa o que
 * faltar, porque quem confere identidade e a regra, nao a tela.
 */
export function RegistrarAcesso({ pontos, aoRegistrar }: { pontos: PontoAcesso[]; aoRegistrar: () => void }) {
  const cliente = useQueryClient();
  const [tipo, setTipo] = useState<TipoAcesso>('PESSOA');
  const [pontoAcessoId, setPontoAcessoId] = useState(pontos[0]?.id ?? '');
  const [pessoa, setPessoa] = useState<PessoaExterna | null>(null);
  const [busca, setBusca] = useState('');
  const [placaExterna, setPlaca] = useState('');
  const [transportadora, setTransportadora] = useState('');
  const [veiculoId, setVeiculoId] = useState('');
  const [motoristaId, setMotoristaId] = useState('');
  const [hodometroSaida, setHodometro] = useState('');
  const [rotaId, setRotaId] = useState('');
  const [notaFiscal, setNotaFiscal] = useState('');
  const [cargaDescricao, setCarga] = useState('');
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState('');
  const [cracha, setCracha] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /** alertas que o servidor devolveu no registro (hodometro fora do cadastro do veiculo) */
  const [alertas, setAlertas] = useState<string[]>([]);
  /**
   * Ficha da ultima largada registrada. Sobrevive a limpeza do formulario de proposito:
   * o motorista ainda esta no balcao, e e agora que a guarita imprime ou manda no
   * celular. So some quando a proxima saida e registrada.
   */
  const [ultimaLargada, setUltimaLargada] = useState<
    { acessoId: string; motorista: string | null; ficha: FichaLargadaEmitida | null } | null
  >(null);

  const pessoas = useQuery({
    queryKey: ['portaria', 'pessoas', busca],
    queryFn: () => get<{ itens: PessoaExterna[] }>(`/portaria/pessoas?limite=10&busca=${encodeURIComponent(busca)}`),
    enabled: busca.trim().length >= 3,
  });

  const frota = useQuery({
    queryKey: ['portaria', 'frota'],
    queryFn: () => get<FrotaDaGuarita>('/portaria/frota'),
    enabled: tipo === 'VEICULO_PROPRIO',
    staleTime: 300_000,
  });

  const veiculoEscolhido = frota.data?.veiculos.find((v) => v.id === veiculoId) ?? null;

  /*
   * Aviso na hora da digitacao, antes de gravar: o cadastro do veiculo ja veio nesta tela,
   * entao da para dizer que a leitura nao fecha enquanto o porteiro ainda olha o painel.
   * Quem decide de verdade e o servidor - aqui e so para nao gravar errado por descuido.
   */
  /*
   * Aviso antes de registrar, e nao depois de falhar o envio: motorista sem telefone no
   * cadastro so vira problema no momento em que a ficha precisa sair, com o caminhao ja
   * na saida. Aqui ainda da tempo de cadastrar o numero.
   */
  const motoristaSemTelefone =
    motoristaId !== '' && !frota.data?.motoristas.find((m) => m.id === motoristaId)?.telefone;

  const hodometroAbaixoDoCadastro =
    veiculoEscolhido !== null &&
    hodometroSaida.trim() !== '' &&
    Number(hodometroSaida) < Number(veiculoEscolhido.hodometroAtual);

  const registrar = useMutation({
    mutationFn: () =>
      post<AcessoRegistrado>('/portaria/acessos', {
        pontoAcessoId,
        tipo,
        pessoaExternaId: pessoa?.id ?? null,
        motoristaId: motoristaId || null,
        veiculoId: veiculoId || null,
        placaExterna: placaExterna.trim() || null,
        transportadora: transportadora.trim() || null,
        destino: destino.trim() || null,
        motivo,
        cracha: cracha.trim() || null,
        rotaId: rotaId || null,
        notaFiscal: notaFiscal.trim() || null,
        cargaDescricao: cargaDescricao.trim() || null,
        hodometroSaida: hodometroSaida.trim() || null,
        observacao: observacao.trim() || null,
      }),
    onSuccess: async (resposta) => {
      setErro(null);
      // o alerta sobrevive a limpeza do formulario: quem registrou precisa ler o que ficou
      setAlertas((resposta?.alertasHodometro ?? []).map((a) => a.mensagem));
      setUltimaLargada(
        resposta?.tipo === 'VEICULO_PROPRIO'
          ? {
              acessoId: resposta.id,
              motorista: frota.data?.motoristas.find((m) => m.id === motoristaId)?.nome ?? null,
              ficha: resposta.fichaLargada ?? null,
            }
          : null,
      );
      limpar();
      await cliente.invalidateQueries({ queryKey: ['portaria'] });
      aoRegistrar();
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar o acesso.'),
  });

  function limpar() {
    setPessoa(null);
    setBusca('');
    setPlaca('');
    setTransportadora('');
    setVeiculoId('');
    setMotoristaId('');
    setHodometro('');
    setRotaId('');
    setNotaFiscal('');
    setCarga('');
    setDestino('');
    setMotivo('');
    setCracha('');
    setObservacao('');
  }

  const exigePessoa = tipo !== 'VEICULO_PROPRIO';
  const pronto =
    pontoAcessoId !== '' &&
    motivo.trim().length >= 3 &&
    (tipo === 'PESSOA' ? pessoa !== null : true) &&
    (tipo === 'VEICULO_EXTERNO' ? placaExterna.trim().length >= 7 : true) &&
    (tipo === 'VEICULO_PROPRIO' ? veiculoId !== '' : true);

  return (
    <Card>
      <CardTitulo>Registrar movimento no portao</CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        {erro && (
          <p
            role="alert"
            className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho"
          >
            {erro}
          </p>
        )}

        {alertas.map((mensagem) => (
          <p
            key={mensagem}
            role="alert"
            className="rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto"
          >
            {mensagem}
          </p>
        ))}

        {ultimaLargada && <FichaDaUltimaLargada {...ultimaLargada} />}

        <div className="flex flex-wrap gap-2">
          {(Object.keys(ROTULO_TIPO_ACESSO) as TipoAcesso[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              aria-current={tipo === t}
              className={
                tipo === t
                  ? 'rounded-lg border border-ceara-azul bg-[var(--ceara-azul-10)] px-3 py-2 text-corpo font-medium text-ceara-azul'
                  : 'rounded-lg border border-ceara-borda px-3 py-2 text-corpo text-ceara-texto hover:border-ceara-azul'
              }
            >
              {ROTULO_TIPO_ACESSO[t]}
            </button>
          ))}
        </div>

        <p className="text-legenda italic text-ceara-texto2">
          {tipo === 'VEICULO_PROPRIO'
            ? 'O caminhao da casa comeca dentro: este registro e a saida para a rota, e o retorno fecha a viagem com o hodometro.'
            : 'Entrada de quem vem de fora. A saida e registrada no painel do patio, e o cracha e cobrado nela.'}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Guarita" htmlFor="ponto" obrigatorio>
            <select
              id="ponto"
              className={classeControle()}
              value={pontoAcessoId}
              onChange={(e) => setPontoAcessoId(e.target.value)}
            >
              <option value="">Selecione</option>
              {pontos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            rotulo="Motivo"
            htmlFor="motivo"
            obrigatorio
            ajuda="Registro de portaria sem motivo nao serve a ninguem depois."
          >
            <input
              id="motivo"
              className={classeControle()}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Campo>
        </div>

        {exigePessoa && (
          <BuscarPessoa
            busca={busca}
            aoBuscar={setBusca}
            resultados={pessoas.data?.itens ?? []}
            selecionada={pessoa}
            aoSelecionar={setPessoa}
            aoErrar={setErro}
          />
        )}

        {tipo === 'VEICULO_EXTERNO' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Placa do veiculo" htmlFor="placa" obrigatorio ajuda="Formato ABC1234 ou ABC1D23.">
              <input
                id="placa"
                className={classeControle()}
                value={placaExterna}
                onChange={(e) => setPlaca(e.target.value.toUpperCase())}
              />
            </Campo>
            <Campo rotulo="Transportadora" htmlFor="transportadora">
              <input
                id="transportadora"
                className={classeControle()}
                value={transportadora}
                onChange={(e) => setTransportadora(e.target.value)}
              />
            </Campo>
          </div>
        )}

        {tipo === 'VEICULO_PROPRIO' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Veiculo da frota" htmlFor="veiculo" obrigatorio>
                <select
                  id="veiculo"
                  className={classeControle()}
                  value={veiculoId}
                  onChange={(e) => {
                    setVeiculoId(e.target.value);
                    const v = frota.data?.veiculos.find((x) => x.id === e.target.value);
                    // o hodometro atual do veiculo e a leitura mais provavel: evita redigitar
                    if (v) setHodometro(String(v.hodometroAtual));
                  }}
                >
                  <option value="">Selecione</option>
                  {(frota.data?.veiculos ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.placa} {v.frotaNumero ? `· frota ${v.frotaNumero}` : ''}
                    </option>
                  ))}
                </select>
              </Campo>

              <Campo
                rotulo="Motorista"
                htmlFor="motorista"
                ajuda={
                  motoristaSemTelefone
                    ? 'Este motorista nao tem telefone no cadastro: a ficha de largada nao tera para onde ser enviada.'
                    : 'A ficha de largada vai para o WhatsApp do numero cadastrado.'
                }
              >
                <select
                  id="motorista"
                  className={classeControle()}
                  value={motoristaId}
                  onChange={(e) => setMotoristaId(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {(frota.data?.motoristas ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <Campo
                rotulo="Hodometro na saida"
                htmlFor="hodometro"
                ajuda={
                  hodometroAbaixoDoCadastro
                    ? `Menor que o cadastro do veiculo (${veiculoEscolhido?.hodometroAtual} km). Confira o painel.`
                    : undefined
                }
              >
                <input
                  id="hodometro"
                  inputMode="decimal"
                  aria-invalid={hodometroAbaixoDoCadastro}
                  className={cn(classeControle(), hodometroAbaixoDoCadastro && 'border-ceara-ouro')}
                  value={hodometroSaida}
                  onChange={(e) => setHodometro(e.target.value)}
                />
              </Campo>
              <Campo rotulo="Rota" htmlFor="rota" ajuda="Vem do cadastro de rotas.">
                <select
                  id="rota"
                  className={classeControle()}
                  value={rotaId}
                  onChange={(e) => setRotaId(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {(frota.data?.rotas ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Nota fiscal" htmlFor="nf">
                <input
                  id="nf"
                  className={classeControle()}
                  value={notaFiscal}
                  onChange={(e) => setNotaFiscal(e.target.value)}
                />
              </Campo>
              <Campo rotulo="Carga" htmlFor="carga">
                <input
                  id="carga"
                  className={classeControle()}
                  value={cargaDescricao}
                  onChange={(e) => setCarga(e.target.value)}
                />
              </Campo>
            </div>
          </>
        )}

        {tipo !== 'VEICULO_PROPRIO' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Destino" htmlFor="destino" ajuda="Setor ou pessoa que vai receber.">
              <input
                id="destino"
                className={classeControle()}
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Cracha entregue" htmlFor="cracha" ajuda="Sera cobrado na saida.">
              <input
                id="cracha"
                className={classeControle()}
                value={cracha}
                onChange={(e) => setCracha(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Observacao" htmlFor="obs">
              <input
                id="obs"
                className={classeControle()}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </Campo>
          </div>
        )}

        <div className="flex justify-end">
          <Button disabled={!pronto} carregando={registrar.isPending} onClick={() => registrar.mutate()}>
            {tipo === 'VEICULO_PROPRIO' ? 'Registrar saida do caminhao' : 'Registrar entrada'}
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}

// ---------------------------------------------------------------- busca e cadastro de pessoa

function BuscarPessoa({
  busca,
  aoBuscar,
  resultados,
  selecionada,
  aoSelecionar,
  aoErrar,
}: {
  busca: string;
  aoBuscar: (v: string) => void;
  resultados: PessoaExterna[];
  selecionada: PessoaExterna | null;
  aoSelecionar: (p: PessoaExterna | null) => void;
  aoErrar: (e: string | null) => void;
}) {
  const [cadastrando, setCadastrando] = useState(false);

  if (selecionada) {
    return (
      <Card destaque={selecionada.bloqueado ? 'risco' : 'ok'}>
        <CardCorpo className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <div>
            <p className="text-h3 text-ceara-azul">{selecionada.nome}</p>
            <p className="text-legenda text-ceara-texto2">
              {ROTULO_TIPO_PESSOA[selecionada.tipo]} · doc {selecionada.documento}
              {selecionada.empresa && ` · ${selecionada.empresa}`}
            </p>
            {selecionada.bloqueado && (
              <p className="mt-1 text-corpo font-medium text-ceara-vermelho">
                Lista restritiva: {selecionada.motivoBloqueio ?? 'sem motivo registrado'}. A entrada depende de
                desbloqueio, nao de decisao da guarita.
              </p>
            )}
          </div>
          <Button tamanho="sm" variante="secundario" onClick={() => aoSelecionar(null)}>
            Trocar pessoa
          </Button>
        </CardCorpo>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-ceara-borda p-4">
      <Campo
        rotulo="Quem esta entrando"
        htmlFor="busca-pessoa"
        ajuda="Busque por nome, documento ou empresa. Tres letras ja bastam."
      >
        <div className="flex items-center gap-2">
          <Search size={16} className="text-ceara-texto2" aria-hidden />
          <input
            id="busca-pessoa"
            className={`${classeControle()} flex-1`}
            value={busca}
            onChange={(e) => aoBuscar(e.target.value)}
          />
        </div>
      </Campo>

      {resultados.length > 0 && (
        <ul className="flex flex-col gap-1">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => aoSelecionar(p)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-ceara-borda px-3 py-2 text-left text-corpo hover:border-ceara-azul"
              >
                <span>
                  {p.nome}
                  <span className="ml-2 text-legenda text-ceara-texto2">
                    {ROTULO_TIPO_PESSOA[p.tipo]} · {p.documento}
                  </span>
                </span>
                {p.bloqueado && <Badge tom="vermelho">lista restritiva</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {busca.trim().length >= 3 && resultados.length === 0 && !cadastrando && (
        <p className="text-corpo text-ceara-texto2">
          Ninguem encontrado com “{busca}”.{' '}
          <button type="button" className="text-ceara-azul hover:underline" onClick={() => setCadastrando(true)}>
            Cadastrar agora
          </button>
        </p>
      )}

      {cadastrando && (
        <CadastrarPessoa
          nomeInicial={busca}
          aoCadastrar={(p) => {
            setCadastrando(false);
            aoSelecionar(p);
          }}
          aoErrar={aoErrar}
        />
      )}
    </div>
  );
}

function CadastrarPessoa({
  nomeInicial,
  aoCadastrar,
  aoErrar,
}: {
  nomeInicial: string;
  aoCadastrar: (p: PessoaExterna) => void;
  aoErrar: (e: string | null) => void;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [documento, setDocumento] = useState('');
  const [tipo, setTipo] = useState<TipoPessoaExterna>('VISITANTE');
  const [empresa, setEmpresa] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cnhNumero, setCnh] = useState('');
  const [cnhVencimento, setCnhVencimento] = useState('');

  const criar = useMutation({
    mutationFn: () =>
      post<PessoaExterna>('/portaria/pessoas', {
        nome,
        documento,
        tipo,
        empresa: empresa.trim() || null,
        telefone: telefone.trim() || null,
        cnhNumero: cnhNumero.trim() || null,
        cnhVencimento: cnhVencimento || null,
      }),
    onSuccess: (p) => {
      aoErrar(null);
      aoCadastrar(p);
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao cadastrar a pessoa.'),
  });

  const ehMotorista = tipo === 'MOTORISTA_EXTERNO';

  return (
    <div className="flex flex-col gap-3 rounded-card bg-ceara-nevoa p-3">
      <p className="flex items-center gap-2 text-h3 text-ceara-texto">
        <UserPlus size={16} aria-hidden />
        Cadastro rapido
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Nome" htmlFor="p-nome" obrigatorio>
          <input id="p-nome" className={classeControle()} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo rotulo="Documento" htmlFor="p-doc" obrigatorio ajuda="CPF, RG ou CNH. E a chave do cadastro.">
          <input
            id="p-doc"
            className={classeControle()}
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
          />
        </Campo>
        <Campo rotulo="Tipo" htmlFor="p-tipo" obrigatorio>
          <select
            id="p-tipo"
            className={classeControle()}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoPessoaExterna)}
          >
            {(Object.keys(ROTULO_TIPO_PESSOA) as TipoPessoaExterna[]).map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_PESSOA[t]}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Campo rotulo="Empresa" htmlFor="p-empresa">
          <input
            id="p-empresa"
            className={classeControle()}
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
          />
        </Campo>
        <Campo rotulo="Telefone" htmlFor="p-tel">
          <input
            id="p-tel"
            className={classeControle()}
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
          />
        </Campo>
        {ehMotorista && (
          <>
            <Campo rotulo="CNH" htmlFor="p-cnh">
              <input
                id="p-cnh"
                className={classeControle()}
                value={cnhNumero}
                onChange={(e) => setCnh(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Vencimento da CNH" htmlFor="p-cnh-venc" ajuda="CNH vencida barra quem vai dirigir.">
              <input
                id="p-cnh-venc"
                type="date"
                className={classeControle()}
                value={cnhVencimento}
                onChange={(e) => setCnhVencimento(e.target.value)}
              />
            </Campo>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          tamanho="sm"
          disabled={nome.trim().length < 3 || documento.trim().length < 3}
          carregando={criar.isPending}
          onClick={() => criar.mutate()}
        >
          Cadastrar e usar
        </Button>
      </div>
    </div>
  );
}

/**
 * A ficha da largada que acabou de ser registrada (secao 14.7).
 *
 * Aparece no lugar onde o porteiro ja esta olhando, e nao numa aba adiante: o motorista
 * continua no balcao por mais um minuto, e e nesse minuto que a folha e impressa ou
 * mandada no celular. O que o servidor nao conseguiu fazer sozinho vem escrito — a
 * emissao nao trava o portao, mas tambem nao some sem avisar.
 */
function FichaDaUltimaLargada({
  acessoId,
  motorista,
  ficha,
}: {
  acessoId: string;
  motorista: string | null;
  ficha: FichaLargadaEmitida | null;
}) {
  const envio = ficha?.envio ?? null;

  return (
    <section className="flex flex-col gap-3 rounded-card border border-ceara-borda bg-ceara-nevoa p-4">
      <div>
        <h3 className="text-h3 text-ceara-texto">Ficha de largada emitida</h3>
        <p className="text-legenda text-ceara-texto2">
          {motorista
            ? `Saida de ${motorista} registrada. Entregue a ficha antes que o caminhao deixe o patio.`
            : 'Saida registrada. Entregue a ficha antes que o caminhao deixe o patio.'}
        </p>
      </div>

      {envio && (
        <p role="status" className="text-legenda text-ceara-texto">
          {RECADO_DO_ENVIO[envio.situacao]} {motorista ?? 'o motorista'} — {envio.telefone}.
        </p>
      )}

      {(ficha?.avisos ?? []).map((aviso) => (
        <p key={aviso} role="alert" className="text-legenda text-ceara-vermelho">
          {aviso}
        </p>
      ))}

      <AcoesDaFicha acessoId={acessoId} motorista={motorista} />
    </section>
  );
}
