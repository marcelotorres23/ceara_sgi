import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, LogOut, ShieldAlert, Truck, Users } from 'lucide-react';
import { get, post, baixarArquivo, ApiError } from '../../lib/api';
import { AcoesDaFicha } from './FichaDeLargada';
import { Badge, type TomBadge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { usePermissao } from '../auth/useSessao';
import { RegistrarAcesso } from './RegistrarAcesso';
import {
  ROTULO_STATUS,
  ROTULO_TIPO_ACESSO,
  ROTULO_TIPO_PESSOA,
  dataHoraBr,
  duracaoBr,
  horaBr,
  type AcessoNaLista,
  type Gravidade,
  type ItemDoPatio,
  type OcorrenciaPortaria,
  type Patio,
  type RelatorioDeMovimentos,
  type PontoAcesso,
} from './tipos';

type Aba = 'patio' | 'registrar' | 'historico' | 'relatorio' | 'ocorrencias';

const TOM_PERMANENCIA: Record<string, TomBadge> = {
  NORMAL: 'verde',
  ATENCAO: 'ouro',
  EXCEDIDA: 'vermelho',
};
const TOM_GRAVIDADE: Record<Gravidade, TomBadge> = {
  BAIXA: 'neutro',
  MEDIA: 'ouro',
  ALTA: 'vermelho',
};

/**
 * Portaria e controle de acesso (secao 14).
 *
 * O painel do patio e a tela que fica aberta na guarita o dia inteiro: em emergencia,
 * ela responde quantas pessoas ha no site, quem sao e quais caminhoes estao na rua.
 */
export function Portaria() {
  const [aba, setAba] = useState<Aba>('patio');
  const [erro, setErro] = useState<string | null>(null);
  /** divergencia de hodometro: nao barra o movimento, mas fica na tela ate ser lida */
  const [alerta, setAlerta] = useState<string | null>(null);

  const pontos = useQuery({
    queryKey: ['portaria', 'pontos'],
    queryFn: () => get<{ itens: PontoAcesso[] }>('/portaria/pontos'),
    staleTime: 300_000,
  });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-h1 text-ceara-azul">Portaria</h1>
        <p className="mt-1 text-legenda italic text-ceara-texto2">
          Entrada e saida de visitantes, clientes, prestadores, motoristas de terceiros e o trafego dos caminhoes da
          casa. Nada se apaga: cada movimento fica registrado com quem, quando e por quem foi liberado.
        </p>
      </header>

      {erro && (
        <p
          role="alert"
          className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho"
        >
          {erro}
        </p>
      )}

      {alerta && (
        <p
          role="alert"
          className="rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto"
        >
          {alerta}
        </p>
      )}

      {pontos.data?.itens.length === 0 && <CadastrarPonto aoErrar={setErro} />}

      <nav className="flex gap-1 border-b border-ceara-borda" aria-label="Areas da portaria">
        {(
          [
            ['patio', 'Patio agora'],
            ['registrar', 'Registrar movimento'],
            ['historico', 'Historico'],
            ['relatorio', 'Relatorio por periodo'],
            ['ocorrencias', 'Ocorrencias'],
          ] as Array<[Aba, string]>
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            onClick={() => setAba(chave)}
            aria-current={aba === chave}
            className={
              aba === chave
                ? 'border-b-2 border-ceara-ouro px-4 py-2 text-corpo font-medium text-ceara-azul'
                : 'border-b-2 border-transparent px-4 py-2 text-corpo text-ceara-texto2 hover:text-ceara-azul'
            }
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === 'patio' && <AbaPatio aoErrar={setErro} aoAlertar={setAlerta} />}
      {aba === 'registrar' && <RegistrarAcesso pontos={pontos.data?.itens ?? []} aoRegistrar={() => setAba('patio')} />}
      {aba === 'historico' && <AbaHistorico />}
      {aba === 'relatorio' && <AbaRelatorio aoErrar={setErro} />}
      {aba === 'ocorrencias' && <AbaOcorrencias pontos={pontos.data?.itens ?? []} aoErrar={setErro} />}
    </div>
  );
}

/**
 * Cadastro da guarita, aberto so a quem tem `portaria:gerenciar`.
 *
 * Aparece exatamente quando falta: sem ponto de acesso nao ha o que registrar, e mandar
 * o porteiro procurar a tela de cadastro no meio do turno e mandar ele nao registrar.
 */
function CadastrarPonto({ aoErrar }: { aoErrar: (e: string | null) => void }) {
  const cliente = useQueryClient();
  const podeGerenciar = usePermissao('portaria:gerenciar');
  const [codigo, setCodigo] = useState('');
  const [nome, setNome] = useState('');

  const criar = useMutation({
    mutationFn: () => post('/portaria/pontos', { codigo, nome }),
    onSuccess: async () => {
      aoErrar(null);
      setCodigo('');
      setNome('');
      await cliente.invalidateQueries({ queryKey: ['portaria'] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao cadastrar a guarita.'),
  });

  return (
    <Card destaque="regra">
      <CardCorpo className="flex flex-col gap-4 pt-4">
        <p className="text-corpo text-ceara-texto">
          Nenhuma guarita cadastrada nesta unidade. O movimento e registrado por ponto de acesso — sem ele, o relatorio
          nao sabe por onde a pessoa entrou.
        </p>

        {podeGerenciar ? (
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
            <Campo rotulo="Codigo" htmlFor="ponto-codigo" obrigatorio>
              <input
                id="ponto-codigo"
                className={classeControle()}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              />
            </Campo>
            <Campo rotulo="Nome da guarita" htmlFor="ponto-nome" obrigatorio>
              <input
                id="ponto-nome"
                className={classeControle()}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </Campo>
            <Button
              disabled={codigo.trim().length < 1 || nome.trim().length < 3}
              carregando={criar.isPending}
              onClick={() => criar.mutate()}
            >
              Cadastrar guarita
            </Button>
          </div>
        ) : (
          <p className="text-legenda italic text-ceara-texto2">
            Peca a quem administra a portaria para cadastrar o ponto de acesso.
          </p>
        )}
      </CardCorpo>
    </Card>
  );
}

// ---------------------------------------------------------------- patio

function AbaPatio({
  aoErrar,
  aoAlertar,
}: {
  aoErrar: (e: string | null) => void;
  aoAlertar: (a: string | null) => void;
}) {
  const [saindo, setSaindo] = useState<ItemDoPatio | null>(null);

  const patio = useQuery({
    queryKey: ['portaria', 'patio'],
    queryFn: () => get<Patio>('/portaria/patio'),
    refetchInterval: 30_000,
  });

  if (patio.isLoading) return <p className="text-corpo text-ceara-texto2">Carregando o patio...</p>;
  const dados = patio.data;
  if (!dados) return null;

  const dentro = dados.itens.filter((i) => i.status === 'NO_PATIO');
  const transito = dados.itens.filter((i) => i.status === 'EM_TRANSITO');
  const agendados = dados.itens.filter((i) => i.status === 'AGENDADO');

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-4 sm:grid-cols-4">
        <Kpi rotulo="Pessoas no patio" valor={String(dados.resumo.pessoasNoPatio)} Icone={Users} />
        <Kpi rotulo="Veiculos no patio" valor={String(dados.resumo.veiculosNoPatio)} Icone={Truck} />
        <Kpi rotulo="Caminhoes na rua" valor={String(dados.resumo.caminhoesEmTransito)} Icone={Truck} />
        <Kpi
          rotulo="Permanencia excedida"
          valor={String(dados.resumo.permanenciaExcedida)}
          rodape={`limite de ${dados.limitePermanenciaHoras}h`}
          Icone={AlertTriangle}
          destaque={dados.resumo.permanenciaExcedida > 0 ? 'risco' : 'nenhum'}
        />
      </section>

      <ListaDoPatio
        titulo={`Dentro agora (${dentro.length})`}
        vazio="Ninguem de fora esta no patio neste momento."
        itens={dentro}
        aoSair={setSaindo}
      />

      <ListaDoPatio
        titulo={`Caminhoes da casa na rua (${transito.length})`}
        vazio="Nenhum caminhao da frota fora no momento."
        itens={transito}
        aoSair={setSaindo}
        rotuloAcao="Registrar retorno"
        comFichaDeLargada
      />

      {agendados.length > 0 && (
        <ListaDoPatio
          titulo={`Visitas agendadas (${agendados.length})`}
          vazio=""
          itens={agendados}
          aoSair={setSaindo}
          rotuloAcao="—"
        />
      )}

      {saindo && (
        <RegistrarSaida item={saindo} aoFechar={() => setSaindo(null)} aoErrar={aoErrar} aoAlertar={aoAlertar} />
      )}
    </div>
  );
}

function ListaDoPatio({
  titulo,
  vazio,
  itens,
  aoSair,
  rotuloAcao = 'Registrar saida',
  comFichaDeLargada = false,
}: {
  titulo: string;
  vazio: string;
  itens: ItemDoPatio[];
  aoSair: (i: ItemDoPatio) => void;
  rotuloAcao?: string;
  /**
   * Caminhao da frota: reimprimir e reenviar a ficha de largada (secao 14.7). Ficha
   * perdida no caminho e caso comum — celular sem sinal, papel esquecido no balcao — e
   * a alternativa a este botao e o motorista voltar sem documento nenhum.
   */
  comFichaDeLargada?: boolean;
}) {
  return (
    <Card>
      <CardTitulo>{titulo}</CardTitulo>
      <CardCorpo>
        {itens.length === 0 ? (
          vazio ? (
            <EstadoVazio titulo="Nada aqui" descricao={vazio} />
          ) : null
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Quem</Th>
                <Th>Tipo</Th>
                <Th>Placa</Th>
                <Th>Destino / motivo</Th>
                <Th>Desde</Th>
                <Th>Permanencia</Th>
                <Th>Cracha</Th>
                <Th>Acao</Th>
              </Tr>
            </Thead>
            <Tbody>
              {itens.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <span className="font-medium">{i.quem}</span>
                    {i.empresa && <span className="block text-legenda text-ceara-texto2">{i.empresa}</span>}
                  </Td>
                  <Td>
                    <Badge tom="azul">
                      {i.tipoPessoa ? ROTULO_TIPO_PESSOA[i.tipoPessoa] : ROTULO_TIPO_ACESSO[i.tipo]}
                    </Badge>
                  </Td>
                  <Td className="font-mono">{i.placa ?? '—'}</Td>
                  <Td>
                    {i.destino ?? '—'}
                    <span className="block text-legenda text-ceara-texto2">{i.motivo}</span>
                  </Td>
                  <Td>
                    {i.abertoEm ? horaBr(i.abertoEm) : i.previstoPara ? `previsto ${horaBr(i.previstoPara)}` : '—'}
                  </Td>
                  <Td>
                    <Badge tom={TOM_PERMANENCIA[i.permanencia] ?? 'neutro'}>{duracaoBr(i.minutos)}</Badge>
                  </Td>
                  <Td>{i.cracha ?? '—'}</Td>
                  <Td>
                    {i.status === 'AGENDADO' ? (
                      <ConfirmarChegada acessoId={i.id} />
                    ) : (
                      <div className="flex flex-col gap-2">
                        <Button
                          tamanho="sm"
                          variante="secundario"
                          iconeEsquerda={<LogOut size={14} aria-hidden />}
                          onClick={() => aoSair(i)}
                        >
                          {rotuloAcao}
                        </Button>
                        {comFichaDeLargada && <AcoesDaFicha acessoId={i.id} motorista={i.quem} />}
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardCorpo>
    </Card>
  );
}

function ConfirmarChegada({ acessoId }: { acessoId: string }) {
  const cliente = useQueryClient();
  const confirmar = useMutation({
    mutationFn: () => post(`/portaria/acessos/${acessoId}/chegada`, {}),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['portaria'] }),
  });
  return (
    <Button tamanho="sm" carregando={confirmar.isPending} onClick={() => confirmar.mutate()}>
      Confirmar chegada
    </Button>
  );
}

function RegistrarSaida({
  item,
  aoFechar,
  aoErrar,
  aoAlertar,
}: {
  item: ItemDoPatio;
  aoFechar: () => void;
  aoErrar: (e: string | null) => void;
  aoAlertar: (a: string | null) => void;
}) {
  const cliente = useQueryClient();
  const [crachaDevolvido, setDevolvido] = useState(!item.cracha);
  const [hodometroRetorno, setHodometro] = useState('');
  const [observacao, setObservacao] = useState('');
  const [abrirOcorrencia, setAbrirOcorrencia] = useState(false);

  const registrar = useMutation({
    mutationFn: () =>
      post<{ alertasHodometro?: Array<{ mensagem: string }> }>(`/portaria/acessos/${item.id}/saida`, {
        crachaDevolvido,
        hodometroRetorno: hodometroRetorno.trim() || null,
        observacao: observacao.trim() || null,
        abrirOcorrencia,
      }),
    onSuccess: async (resposta) => {
      aoErrar(null);
      // o painel do retorno fecha; o alerta fica em cima da tela do patio
      aoAlertar(resposta?.alertasHodometro?.[0]?.mensagem ?? null);
      aoFechar();
      await cliente.invalidateQueries({ queryKey: ['portaria'] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a saida.'),
  });

  const ehCaminhaoProprio = item.tipo === 'VEICULO_PROPRIO';

  return (
    <Card destaque="regra">
      <CardTitulo
        acao={
          <Button tamanho="sm" variante="texto" onClick={aoFechar}>
            Fechar
          </Button>
        }
      >
        {ehCaminhaoProprio ? 'Retorno de' : 'Saida de'} {item.quem}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {ehCaminhaoProprio && (
            <Campo
              rotulo="Hodometro no retorno"
              htmlFor="hodo-retorno"
              ajuda="Fecha a viagem e atualiza o hodometro do veiculo. Leitura menor que a da saida e recusada."
            >
              <input
                id="hodo-retorno"
                inputMode="decimal"
                className={classeControle()}
                value={hodometroRetorno}
                onChange={(e) => setHodometro(e.target.value)}
              />
            </Campo>
          )}

          <Campo rotulo="Observacao" htmlFor="obs-saida">
            <input
              id="obs-saida"
              className={classeControle()}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </Campo>
        </div>

        {item.cracha && (
          <div className="flex flex-col gap-2 rounded-card bg-ceara-nevoa p-3">
            <label className="flex items-center gap-2 text-corpo">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--ceara-azul)]"
                checked={crachaDevolvido}
                onChange={(e) => setDevolvido(e.target.checked)}
              />
              Cracha {item.cracha} devolvido
            </label>
            {!crachaDevolvido && (
              <label className="flex items-center gap-2 text-corpo text-ceara-texto2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--ceara-azul)]"
                  checked={abrirOcorrencia}
                  onChange={(e) => setAbrirOcorrencia(e.target.checked)}
                />
                Liberar a saida abrindo ocorrencia do cracha nao devolvido
              </label>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button carregando={registrar.isPending} onClick={() => registrar.mutate()}>
            {ehCaminhaoProprio ? 'Registrar retorno' : 'Registrar saida'}
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}

// ---------------------------------------------------------------- historico

/** Primeiro e ultimo dia do mes corrente, que e o recorte que se pede na maioria das vezes. */
function mesCorrente(): { de: string; ate: string } {
  const hoje = new Date();
  const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return {
    de: primeiro.toISOString().slice(0, 10),
    ate: hoje.toISOString().slice(0, 10),
  };
}

/**
 * Relatorio de movimento de veiculos por periodo (secao 14.5).
 *
 * Placa, rota e motorista sao as colunas que a operacao pede — as mesmas do
 * registro na guarita, para o relatorio ser conferivel contra o movimento.
 * Sai em XLSX com a marca e com a memoria de calculo (secao 10.3), e a mesma
 * tela imprime em PDF pelo navegador.
 */
function AbaRelatorio({ aoErrar }: { aoErrar: (e: string | null) => void }) {
  const inicial = mesCorrente();
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate);
  const [frota, setFrota] = useState('');
  const [baixando, setBaixando] = useState(false);

  const periodoInvalido = Boolean(de && ate && ate < de);

  // O dia final entra inteiro: quem filtra "ate 31/08" espera o dia 31 completo.
  const consulta = `de=${de}T00:00:00&ate=${ate}T23:59:59${frota ? `&frota=${frota}` : ''}`;

  const relatorio = useQuery({
    queryKey: ['portaria', 'relatorio', de, ate, frota],
    queryFn: () => get<RelatorioDeMovimentos>(`/portaria/relatorio/movimentos?${consulta}`),
    enabled: Boolean(de && ate) && !periodoInvalido,
  });

  async function exportar() {
    setBaixando(true);
    aoErrar(null);
    try {
      await baixarArquivo(`/portaria/relatorio/movimentos/exportar?${consulta}`, 'portaria-movimentos.xlsx');
    } catch (e) {
      aoErrar(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel gerar o arquivo.');
    } finally {
      setBaixando(false);
    }
  }

  const dados = relatorio.data;
  const linhas = dados?.linhas ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardTitulo>Periodo</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo rotulo="De" htmlFor="rel-de">
              <input
                id="rel-de"
                type="date"
                className={classeControle()}
                value={de}
                onChange={(e) => setDe(e.target.value)}
              />
            </Campo>
            <Campo
              rotulo="Ate"
              htmlFor="rel-ate"
              erro={periodoInvalido ? 'A data final e anterior a inicial.' : undefined}
            >
              <input
                id="rel-ate"
                type="date"
                className={classeControle()}
                value={ate}
                onChange={(e) => setAte(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Movimento" htmlFor="rel-frota">
              <select
                id="rel-frota"
                className={classeControle()}
                value={frota}
                onChange={(e) => setFrota(e.target.value)}
              >
                <option value="">Frota e terceiros</option>
                <option value="FROTA">So caminhao da casa</option>
                <option value="TERCEIRO">So veiculo de terceiro</option>
              </select>
            </Campo>
            <div className="flex items-end gap-2 print:hidden">
              <Button variante="secundario" onClick={() => void exportar()} disabled={baixando || linhas.length === 0}>
                {baixando ? 'Gerando...' : 'Exportar XLSX'}
              </Button>
              <Button variante="secundario" onClick={() => window.print()} disabled={linhas.length === 0}>
                Imprimir / PDF
              </Button>
            </div>
          </div>

          <p className="text-legenda italic text-ceara-texto2">
            O periodo recorta pelo registro na guarita. Caminhao que saiu no ultimo dia do periodo e voltou depois entra
            aqui pela saida, com o retorno exibido.
          </p>
        </CardCorpo>
      </Card>

      {relatorio.isLoading && <p className="text-corpo text-ceara-texto2">Apurando o periodo...</p>}
      {relatorio.error && (
        <p role="alert" className="text-corpo text-ceara-vermelho">
          {relatorio.error instanceof ApiError ? relatorio.error.erro.mensagem : 'Falha ao apurar o periodo.'}
        </p>
      )}

      {dados && (
        <>
          <section className="grid gap-4 sm:grid-cols-4">
            <Kpi
              rotulo="Movimentos"
              valor={String(dados.totais.movimentos)}
              rodape={`${dados.totais.veiculosDistintos} veiculo(s)`}
            />
            <Kpi
              rotulo="Permanencia media"
              valor={duracaoBr(dados.totais.permanenciaMediaMinutos)}
              rodape="so movimentos encerrados"
            />
            <Kpi
              rotulo="Em aberto"
              valor={String(dados.totais.emAberto)}
              destaque={dados.totais.emAberto > 0 ? 'regra' : 'nenhum'}
              rodape="sem o evento de fechamento"
            />
            <Kpi
              rotulo="Km rodados"
              valor={dados.totais.kmTotal ?? 'sem base'}
              rodape={`${dados.totais.rotasDistintas} rota(s)`}
            />
          </section>

          {dados.truncado && (
            <p
              role="alert"
              className="rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto"
            >
              O periodo passou de {dados.tetoDeLinhas} movimentos e foi cortado nesse teto. Divida o periodo para que os
              totais valham pelo recorte inteiro.
            </p>
          )}

          <Card>
            <CardTitulo>Movimento de veiculos</CardTitulo>
            <CardCorpo>
              {linhas.length > 0 ? (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Placa</Th>
                      <Th>Rota</Th>
                      <Th>Motorista</Th>
                      <Th>Movimento</Th>
                      <Th>Inicio</Th>
                      <Th>Fim</Th>
                      <Th>Permanencia</Th>
                      <Th>Km</Th>
                      <Th>Situacao</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {linhas.map((l) => (
                      <Tr key={l.id}>
                        <Td>
                          <span className="font-medium text-ceara-texto">{l.placa ?? '—'}</span>
                          {l.frotaNumero && (
                            <span className="ml-1 text-legenda text-ceara-texto2">#{l.frotaNumero}</span>
                          )}
                        </Td>
                        <Td>{l.rota ?? '—'}</Td>
                        <Td>{l.motorista ?? '—'}</Td>
                        <Td>{ROTULO_TIPO_ACESSO[l.tipo]}</Td>
                        <Td>{dataHoraBr(l.inicioEm)}</Td>
                        <Td>{dataHoraBr(l.fimEm)}</Td>
                        <Td>{duracaoBr(l.permanenciaMinutos)}</Td>
                        <Td>{l.kmViagem ?? '—'}</Td>
                        <Td>
                          {l.emAberto ? (
                            <Badge tom="ouro">Em aberto</Badge>
                          ) : (
                            <Badge tom="neutro">{ROTULO_STATUS[l.status]}</Badge>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              ) : (
                <EstadoVazio titulo="Nada no periodo" descricao="Nenhum movimento de veiculo com esse recorte." />
              )}
            </CardCorpo>
          </Card>

          <Card>
            <CardTitulo>Memoria de calculo</CardTitulo>
            <CardCorpo>
              <dl className="flex flex-col gap-3">
                {Object.entries(dados.memoriaDeCalculo).map(([indicador, formula]) => (
                  <div key={indicador}>
                    <dt className="text-corpo font-medium text-ceara-texto">{indicador}</dt>
                    <dd className="text-legenda text-ceara-texto2">{formula}</dd>
                  </div>
                ))}
              </dl>
            </CardCorpo>
          </Card>
        </>
      )}
    </div>
  );
}

function AbaHistorico() {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');

  const acessos = useQuery({
    queryKey: ['portaria', 'acessos', busca, status],
    queryFn: () =>
      get<{ itens: AcessoNaLista[] }>(
        `/portaria/acessos?limite=50${busca ? `&busca=${encodeURIComponent(busca)}` : ''}${status ? `&status=${status}` : ''}`,
      ),
  });

  const indicadores = useQuery({
    queryKey: ['portaria', 'indicadores'],
    queryFn: () => get<IndicadoresPortaria>('/portaria/indicadores?dias=30'),
  });

  const itens = acessos.data?.itens ?? [];

  return (
    <div className="flex flex-col gap-5">
      {indicadores.data && (
        <section className="grid gap-4 sm:grid-cols-4">
          <Kpi rotulo="Movimentos em 30 dias" valor={String(indicadores.data.total)} />
          <Kpi rotulo="Permanencia media" valor={duracaoBr(indicadores.data.permanenciaMediaMinutos)} />
          <Kpi rotulo="Ainda abertos" valor={String(indicadores.data.aindaAbertos)} />
          <Kpi
            rotulo="Entradas recusadas"
            valor={String(indicadores.data.recusados)}
            destaque={indicadores.data.recusados > 0 ? 'regra' : 'nenhum'}
          />
        </section>
      )}

      <Card>
        <CardTitulo>Historico do portao</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Buscar" htmlFor="busca-hist" ajuda="Nome, documento, placa ou transportadora.">
              <input
                id="busca-hist"
                className={classeControle()}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Situacao" htmlFor="status-hist">
              <select
                id="status-hist"
                className={classeControle()}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todas</option>
                {Object.entries(ROTULO_STATUS).map(([chave, rotulo]) => (
                  <option key={chave} value={chave}>
                    {rotulo}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <p className="text-legenda italic text-ceara-texto2">
            Inicio e fim sao os eventos do portao: para quem vem de fora, a entrada e a saida; para o caminhao da casa,
            que comeca dentro, a saida para a rota e o retorno.
          </p>

          {itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Quem</Th>
                  <Th>Tipo</Th>
                  <Th>Placa</Th>
                  <Th>Rota</Th>
                  <Th>Guarita</Th>
                  <Th>Inicio</Th>
                  <Th>Fim</Th>
                  <Th>Permanencia</Th>
                  <Th>Km</Th>
                  <Th>Situacao</Th>
                </Tr>
              </Thead>
              <Tbody>
                {itens.map((a) => (
                  <Tr key={a.id}>
                    <Td>{a.pessoaExterna?.nome ?? a.motorista?.nome ?? a.transportadora ?? '—'}</Td>
                    <Td>{ROTULO_TIPO_ACESSO[a.tipo]}</Td>
                    <Td className="font-mono">{a.veiculo?.placa ?? a.placaExterna ?? '—'}</Td>
                    <Td>{a.rota?.nome ?? '—'}</Td>
                    <Td>{a.pontoAcesso.codigo}</Td>
                    {/* no caminhao da casa o movimento comeca pela saida: exibir na ordem
                        cronologica evita ler "entrou antes de sair" como erro de registro */}
                    <Td>{dataHoraBr(a.tipo === 'VEICULO_PROPRIO' ? a.saidaEm : a.entradaEm)}</Td>
                    <Td>{dataHoraBr(a.tipo === 'VEICULO_PROPRIO' ? a.entradaEm : a.saidaEm)}</Td>
                    <Td>{duracaoBr(a.permanenciaMinutos)}</Td>
                    <Td>{a.kmViagem ?? '—'}</Td>
                    <Td>
                      <Badge tom={a.status === 'RECUSADO' ? 'vermelho' : a.status === 'ENCERRADO' ? 'neutro' : 'azul'}>
                        {ROTULO_STATUS[a.status]}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio titulo="Sem movimento" descricao="Nenhum acesso encontrado com estes filtros." />
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}

interface IndicadoresPortaria {
  total: number;
  aindaAbertos: number;
  recusados: number;
  permanenciaMediaMinutos: number | null;
  porTipoPessoa: Array<{ tipo: string; total: number }>;
}

// ---------------------------------------------------------------- ocorrencias

function AbaOcorrencias({ pontos, aoErrar }: { pontos: PontoAcesso[]; aoErrar: (e: string | null) => void }) {
  const cliente = useQueryClient();
  const [gravidade, setGravidade] = useState<Gravidade>('BAIXA');
  const [descricao, setDescricao] = useState('');
  const [pontoAcessoId, setPonto] = useState('');

  const lista = useQuery({
    queryKey: ['portaria', 'ocorrencias'],
    queryFn: () => get<{ itens: OcorrenciaPortaria[] }>('/portaria/ocorrencias?limite=50'),
  });

  const abrir = useMutation({
    mutationFn: () =>
      post('/portaria/ocorrencias', {
        gravidade,
        descricao,
        pontoAcessoId: pontoAcessoId || null,
      }),
    onSuccess: async () => {
      aoErrar(null);
      setDescricao('');
      await cliente.invalidateQueries({
        queryKey: ['portaria', 'ocorrencias'],
      });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao abrir a ocorrencia.'),
  });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardTitulo>
          <span className="flex items-center gap-2">
            <ShieldAlert size={16} aria-hidden />
            Registrar ocorrencia
          </span>
        </CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Gravidade" htmlFor="gravidade" ajuda="Grave notifica na hora quem responde por seguranca.">
              <select
                id="gravidade"
                className={classeControle()}
                value={gravidade}
                onChange={(e) => setGravidade(e.target.value as Gravidade)}
              >
                <option value="BAIXA">Baixa</option>
                <option value="MEDIA">Media</option>
                <option value="ALTA">Alta</option>
              </select>
            </Campo>
            <Campo rotulo="Guarita" htmlFor="ponto-oc">
              <select
                id="ponto-oc"
                className={classeControle()}
                value={pontoAcessoId}
                onChange={(e) => setPonto(e.target.value)}
              >
                <option value="">Nao informar</option>
                {pontos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.codigo} — {p.nome}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <Campo rotulo="O que aconteceu" htmlFor="descricao-oc" obrigatorio>
            <textarea
              id="descricao-oc"
              rows={3}
              className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Campo>

          <div className="flex justify-end">
            <Button disabled={descricao.trim().length < 5} carregando={abrir.isPending} onClick={() => abrir.mutate()}>
              Registrar ocorrencia
            </Button>
          </div>
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>Ocorrencias registradas</CardTitulo>
        <CardCorpo>
          {(lista.data?.itens ?? []).length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Quando</Th>
                  <Th>Gravidade</Th>
                  <Th>Guarita</Th>
                  <Th>Descricao</Th>
                </Tr>
              </Thead>
              <Tbody>
                {(lista.data?.itens ?? []).map((o) => (
                  <Tr key={o.id}>
                    <Td>{dataHoraBr(o.ocorridoEm)}</Td>
                    <Td>
                      <Badge tom={TOM_GRAVIDADE[o.gravidade]}>{o.gravidade.toLowerCase()}</Badge>
                    </Td>
                    <Td>{o.pontoAcesso?.codigo ?? '—'}</Td>
                    <Td>{o.descricao}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio titulo="Sem ocorrencias" descricao="Nenhuma ocorrencia registrada nesta unidade." />
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  rodape,
  Icone,
  destaque = 'nenhum',
}: {
  rotulo: string;
  valor: string;
  rodape?: string;
  Icone?: typeof Users;
  destaque?: 'nenhum' | 'ok' | 'regra' | 'risco';
}) {
  return (
    <Card destaque={destaque}>
      <CardCorpo className="flex items-start gap-3 pt-4">
        {Icone && <Icone size={20} className="mt-1 text-ceara-azul" aria-hidden />}
        <div>
          <p className="text-legenda text-ceara-texto2">{rotulo}</p>
          <p className="text-h2 text-ceara-azul">{valor}</p>
          {rodape && <p className="mt-1 text-legenda text-ceara-texto2">{rodape}</p>}
        </div>
      </CardCorpo>
    </Card>
  );
}
