import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Droplet, Ruler } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda } from '../compras/tipos';
import { useSessao } from '../auth/useSessao';
import { FiltroUnidade } from './FiltroUnidade';
import { RegistrarAbastecimento } from './RegistrarAbastecimento';
import { RelatorioAbastecimento } from './RelatorioAbastecimento';
import { AgendaAbastecimento } from './AgendaAbastecimento';
import { EntradaDeCombustivel } from './EntradaDeCombustivel';
import { decimal } from './tipos';

interface Tanque {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'FIXO' | 'MOVEL';
  unidade: string;
  produto: string;
  veiculo: string | null;
  saldoLitros: string;
  capacidadeLitros: string;
  ocupacao: number | null;
  custoMedio: string;
  valorEmEstoque: string;
  bicos: number;
  ultimaAfericaoEm: string | null;
  alertaReposicao: boolean;
}

interface PainelTanques {
  itens: Tanque[];
  resumo: {
    tanques: number;
    litros: string;
    valorEmEstoque: string;
    emReposicao: number;
    semAfericaoRecente: number;
  };
  memoriaDeCalculo: Record<string, string>;
}

interface Movimentacao {
  id: string;
  tipo: string;
  litros: string;
  custoUnitario: string;
  saldoApos: string;
  notaFiscal: string | null;
  motivo: string | null;
  data: string;
  fornecedor: { razaoSocial: string } | null;
  tanqueDestino: { codigo: string } | null;
}

interface Afericao {
  id: string;
  data: string;
  saldoSistema: string;
  saldoMedido: string;
  diferenca: string;
  percentual: string;
  dentroDaTolerancia: boolean;
  motivo: string | null;
}

interface Extrato {
  tanque: { codigo: string; nome: string; produto: string; saldoLitros: string; custoMedio: string };
  movimentacoes: Movimentacao[];
  afericoes: Afericao[];
}

const ROTULO_MOVIMENTACAO: Record<string, string> = {
  ENTRADA_COMPRA: 'Compra',
  ENTRADA_TRANSFERENCIA: 'Recebido em transferencia',
  ENTRADA_ACERTO: 'Acerto de sobra',
  SAIDA_ABASTECIMENTO: 'Abastecimento',
  SAIDA_TRANSFERENCIA: 'Transferido',
  SAIDA_ACERTO: 'Acerto de perda',
};

const percentualBr = (valor: number | null): string =>
  valor === null
    ? '—'
    : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(valor * 100)}%`;

/**
 * Abastecimento interno (secao 7.9): o estoque do tanque proprio.
 *
 * A tela existe para responder uma pergunta que a planilha nunca respondeu com
 * confianca: quantos litros ha no tanque agora, e quanto disso ja foi para os
 * veiculos. Entrada por nota, transferencia para o comboio, abastecimento e
 * afericao — cada litro tem origem e destino.
 */
type Aba = 'registrar' | 'agenda' | 'entrada' | 'relatorio' | 'tanques';

/**
 * `exige` marca a aba que so aparece para quem opera o tanque.
 *
 * O motorista registra o proprio abastecimento e nao movimenta o tanque do patio (ADR 0025).
 * O servidor ja recusa com 403; esconder a aba evita oferecer a ele um caminho sem saida.
 */
const ABAS: Array<{ chave: Aba; rotulo: string; exige?: string }> = [
  { chave: 'registrar', rotulo: 'Registrar' },
  { chave: 'agenda', rotulo: 'Agenda', exige: 'abastecimento:confirmar' },
  { chave: 'entrada', rotulo: 'Entrada de combustivel', exige: 'tanque:operar' },
  { chave: 'relatorio', rotulo: 'Relatorio' },
  { chave: 'tanques', rotulo: 'Tanques', exige: 'tanque:operar' },
];

export function Abastecimento() {
  const cliente = useQueryClient();
  const permissoes = useSessao((s) => s.usuario?.permissoes ?? []);
  const abas = ABAS.filter((a) => !a.exige || permissoes.includes(a.exige));

  const [aba, setAba] = useState<Aba>('registrar');
  const [unidadeId, setUnidadeId] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const painel = useQuery({
    queryKey: ['tanques', 'painel', unidadeId],
    queryFn: () => get<PainelTanques>(`/transporte/tanques${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  });

  const extrato = useQuery({
    queryKey: ['tanques', 'extrato', selecionado],
    queryFn: () => get<Extrato>(`/transporte/tanques/${selecionado}/extrato`),
    enabled: Boolean(selecionado),
  });

  const tanque = painel.data?.itens.find((t) => t.id === selecionado) ?? null;

  const aoMovimentar = async () => {
    setErro(null);
    await cliente.invalidateQueries({ queryKey: ['tanques'] });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Abastecimento</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Registro do abastecimento do veiculo, relatorio por periodo e o controle do tanque proprio. Cada litro
            que entra e sai tem registro, e o abastecimento no tanque da casa baixa o estoque na mesma transacao.
          </p>
        </div>
        <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
      </header>

      <nav aria-label="Areas do abastecimento" className="flex flex-wrap gap-1 border-b border-ceara-borda">
        {abas.map((a) => (
          <button
            key={a.chave}
            type="button"
            onClick={() => setAba(a.chave)}
            aria-current={aba === a.chave}
            className={cn(
              'border-b-2 px-3 py-2 text-corpo transition-colors',
              aba === a.chave
                ? 'border-ceara-ouro font-medium text-ceara-azul'
                : 'border-transparent text-ceara-texto2 hover:text-ceara-texto',
            )}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {aba === 'registrar' && <RegistrarAbastecimento unidadeId={unidadeId} />}
      {aba === 'agenda' && <AgendaAbastecimento unidadeId={unidadeId} />}
      {aba === 'entrada' && <EntradaDeCombustivel unidadeId={unidadeId} />}
      {aba === 'relatorio' && <RelatorioAbastecimento unidadeId={unidadeId} />}

      {aba === 'tanques' && (
      <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Tanques ativos" valor={String(painel.data?.resumo.tanques ?? 0)} Icone={Droplet} />
        <Kpi rotulo="Litros em estoque" valor={`${decimal(painel.data?.resumo.litros ?? '0', 0)} L`} />
        <Kpi rotulo="Valor imobilizado" valor={moeda(painel.data?.resumo.valorEmEstoque ?? '0')} />
        <Kpi
          rotulo="Precisam de atencao"
          valor={String((painel.data?.resumo.emReposicao ?? 0) + (painel.data?.resumo.semAfericaoRecente ?? 0))}
          rodape={`${painel.data?.resumo.emReposicao ?? 0} em reposicao · ${painel.data?.resumo.semAfericaoRecente ?? 0} sem afericao`}
          destaque={(painel.data?.resumo.emReposicao ?? 0) > 0 ? 'regra' : 'nenhum'}
          Icone={AlertTriangle}
        />
      </section>

      <Card>
        <CardTitulo>Tanques</CardTitulo>
        <CardCorpo>
          {painel.data && painel.data.itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Codigo</Th>
                  <Th>Tanque</Th>
                  <Th>Produto</Th>
                  <Th>Saldo</Th>
                  <Th>Ocupacao</Th>
                  <Th>Custo medio</Th>
                  <Th>Valor</Th>
                  <Th>Ultima afericao</Th>
                </Tr>
              </Thead>
              <Tbody>
                {painel.data.itens.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <button
                        type="button"
                        className="font-mono text-ceara-azul hover:underline"
                        onClick={() => setSelecionado(selecionado === t.id ? null : t.id)}
                      >
                        {t.codigo}
                      </button>
                    </Td>
                    <Td>
                      {t.nome}
                      {t.tipo === 'MOVEL' && (
                        <Badge tom="ouro" className="ml-2">
                          comboio {t.veiculo ?? ''}
                        </Badge>
                      )}
                    </Td>
                    <Td>{t.produto}</Td>
                    <Td className="font-medium">{decimal(t.saldoLitros, 1)} L</Td>
                    <Td className={t.alertaReposicao ? 'text-ceara-vermelho' : undefined}>
                      {percentualBr(t.ocupacao)}
                      {t.alertaReposicao && <span className="ml-1 text-legenda">repor</span>}
                    </Td>
                    <Td>{moeda(t.custoMedio)}</Td>
                    <Td>{moeda(t.valorEmEstoque)}</Td>
                    <Td>
                      {t.ultimaAfericaoEm ? (
                        new Date(t.ultimaAfericaoEm).toLocaleDateString('pt-BR')
                      ) : (
                        <span className="text-ceara-texto2">nunca aferido</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio
              titulo="Nenhum tanque cadastrado"
              descricao="Cadastre o tanque do patio e os bicos para controlar o combustivel proprio."
            />
          )}
        </CardCorpo>
      </Card>

      {tanque && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="flex flex-col gap-5">
            <EntradaPorCompra tanque={tanque} aoConcluir={aoMovimentar} aoErrar={setErro} />
            <Transferencia
              tanque={tanque}
              tanques={painel.data?.itens ?? []}
              aoConcluir={aoMovimentar}
              aoErrar={setErro}
            />
            <Aferir tanque={tanque} aoConcluir={aoMovimentar} aoErrar={setErro} />
          </div>

          <Card>
            <CardTitulo>Extrato do {tanque.codigo}</CardTitulo>
            <CardCorpo>
              {extrato.data && extrato.data.movimentacoes.length > 0 ? (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Data</Th>
                      <Th>Movimento</Th>
                      <Th>Litros</Th>
                      <Th>Saldo apos</Th>
                      <Th>Documento</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {extrato.data.movimentacoes.map((m) => (
                      <Tr key={m.id}>
                        <Td className="whitespace-nowrap">{new Date(m.data).toLocaleDateString('pt-BR')}</Td>
                        <Td>
                          <Badge tom={m.tipo.startsWith('ENTRADA') ? 'verde' : 'azul'}>
                            {ROTULO_MOVIMENTACAO[m.tipo] ?? m.tipo}
                          </Badge>
                        </Td>
                        <Td className={m.tipo.startsWith('ENTRADA') ? 'text-ceara-verde' : 'text-ceara-texto'}>
                          {m.tipo.startsWith('ENTRADA') ? '+' : '−'}
                          {decimal(m.litros, 1)}
                        </Td>
                        <Td>{decimal(m.saldoApos, 1)}</Td>
                        <Td className="max-w-[14rem] truncate text-legenda text-ceara-texto2">
                          {m.notaFiscal ?? m.tanqueDestino?.codigo ?? m.motivo ?? '—'}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              ) : (
                <p className="text-corpo text-ceara-texto2">Sem movimentacao neste tanque.</p>
              )}

              {extrato.data && extrato.data.afericoes.length > 0 && (
                <div className="mt-4">
                  <p className="text-h3 text-ceara-texto">Afericoes</p>
                  <ul className="mt-2 flex flex-col gap-1 text-legenda">
                    {extrato.data.afericoes.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-ceara-texto2">{new Date(a.data).toLocaleDateString('pt-BR')}</span>
                        <span>
                          sistema {decimal(a.saldoSistema, 1)} L · medido {decimal(a.saldoMedido, 1)} L
                        </span>
                        <Badge tom={a.dentroDaTolerancia ? 'verde' : 'vermelho'}>
                          {decimal(a.diferenca, 1)} L
                        </Badge>
                        {a.motivo && <span className="italic text-ceara-texto2">{a.motivo}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardCorpo>
          </Card>
        </div>
      )}

      {painel.data && (
        <Card>
          <CardTitulo>Memoria de calculo</CardTitulo>
          <CardCorpo>
            <dl className="flex flex-col gap-1 text-legenda text-ceara-texto2">
              {Object.entries(painel.data.memoriaDeCalculo).map(([chave, texto]) => (
                <p key={chave}>
                  <span className="font-medium text-ceara-texto">{chave}:</span> {texto}
                </p>
              ))}
            </dl>
          </CardCorpo>
        </Card>
      )}
      </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- formularios

function EntradaPorCompra({
  tanque,
  aoConcluir,
  aoErrar,
}: {
  tanque: Tanque;
  aoConcluir: () => void;
  aoErrar: (e: string | null) => void;
}) {
  const [litros, setLitros] = useState('');
  const [custoUnitario, setCustoUnitario] = useState('');
  const [notaFiscal, setNotaFiscal] = useState('');

  const registrar = useMutation({
    mutationFn: () =>
      post(`/transporte/tanques/${tanque.id}/entradas`, {
        litros: litros.replace(',', '.'),
        custoUnitario: custoUnitario.replace(',', '.'),
        notaFiscal,
      }),
    onSuccess: () => {
      setLitros('');
      setCustoUnitario('');
      setNotaFiscal('');
      aoConcluir();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a entrada.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    registrar.mutate();
  }

  return (
    <Card>
      <CardTitulo>Entrada por compra</CardTitulo>
      <CardCorpo>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <p className="text-legenda italic text-ceara-texto2">
            O diesel que chegou no caminhao-tanque. A nota e obrigatoria: entrada sem documento nao tem como ser
            conferida depois.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Litros" htmlFor="entrada-litros" obrigatorio>
              <input
                id="entrada-litros"
                required
                inputMode="decimal"
                className={classeControle()}
                value={litros}
                onChange={(e) => setLitros(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Custo do litro" htmlFor="entrada-custo" obrigatorio ajuda="Entra no custo medio.">
              <input
                id="entrada-custo"
                required
                inputMode="decimal"
                className={classeControle()}
                value={custoUnitario}
                onChange={(e) => setCustoUnitario(e.target.value)}
              />
            </Campo>
          </div>

          <Campo rotulo="Nota fiscal" htmlFor="entrada-nf" obrigatorio>
            <input
              id="entrada-nf"
              required
              className={classeControle()}
              value={notaFiscal}
              onChange={(e) => setNotaFiscal(e.target.value)}
            />
          </Campo>

          <Button type="submit" tamanho="sm" carregando={registrar.isPending}>
            Registrar entrada
          </Button>
        </form>
      </CardCorpo>
    </Card>
  );
}

function Transferencia({
  tanque,
  tanques,
  aoConcluir,
  aoErrar,
}: {
  tanque: Tanque;
  tanques: Tanque[];
  aoConcluir: () => void;
  aoErrar: (e: string | null) => void;
}) {
  const [destinoId, setDestinoId] = useState('');
  const [litros, setLitros] = useState('');

  const transferir = useMutation({
    mutationFn: () =>
      post(`/transporte/tanques/${tanque.id}/transferencias`, {
        destinoId,
        litros: litros.replace(',', '.'),
      }),
    onSuccess: () => {
      setLitros('');
      aoConcluir();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha na transferencia.'),
  });

  // so faz sentido transferir para tanque do mesmo produto; o servidor confirma
  const destinos = tanques.filter((t) => t.id !== tanque.id && t.produto === tanque.produto);

  return (
    <Card>
      <CardTitulo>Transferir para outro tanque</CardTitulo>
      <CardCorpo>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            transferir.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-legenda italic text-ceara-texto2">
            Abastecer o comboio que leva combustivel a frente de servico. O custo acompanha o combustivel.
          </p>

          <Campo rotulo="Tanque de destino" htmlFor="destino" obrigatorio>
            <select
              id="destino"
              required
              className={classeControle()}
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
            >
              <option value="">Selecione</option>
              {destinos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.codigo} · {t.nome}
                  {t.tipo === 'MOVEL' ? ' (comboio)' : ''}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Litros" htmlFor="transf-litros" obrigatorio>
            <input
              id="transf-litros"
              required
              inputMode="decimal"
              className={classeControle()}
              value={litros}
              onChange={(e) => setLitros(e.target.value)}
            />
          </Campo>

          <Button
            type="submit"
            tamanho="sm"
            variante="secundario"
            iconeEsquerda={<ArrowRightLeft size={14} aria-hidden />}
            disabled={destinos.length === 0}
            carregando={transferir.isPending}
          >
            Transferir
          </Button>
        </form>
      </CardCorpo>
    </Card>
  );
}

function Aferir({
  tanque,
  aoConcluir,
  aoErrar,
}: {
  tanque: Tanque;
  aoConcluir: () => void;
  aoErrar: (e: string | null) => void;
}) {
  const [saldoMedido, setSaldoMedido] = useState('');
  const [motivo, setMotivo] = useState('');
  const [acertarSaldo, setAcertarSaldo] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const aferir = useMutation({
    mutationFn: () =>
      post<{ apuracao: { mensagem: string; dentroDaTolerancia: boolean } }>(
        `/transporte/tanques/${tanque.id}/afericoes`,
        { saldoMedido: saldoMedido.replace(',', '.'), motivo: motivo.trim() || null, acertarSaldo },
      ),
    onSuccess: (r) => {
      setResultado(r.apuracao.mensagem);
      setSaldoMedido('');
      setMotivo('');
      aoConcluir();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao aferir.'),
  });

  const diferenca = saldoMedido ? Number(saldoMedido.replace(',', '.')) - Number(tanque.saldoLitros) : null;

  return (
    <Card>
      <CardTitulo>Aferir o tanque</CardTitulo>
      <CardCorpo>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            aferir.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-legenda italic text-ceara-texto2">
            A regua contra o sistema. Perda pequena e evaporacao; acima da tolerancia, alguem precisa explicar — e
            o sistema exige a explicacao.
          </p>

          <Campo
            rotulo="Saldo medido (L)"
            htmlFor="medido"
            obrigatorio
            ajuda={`Sistema aponta ${decimal(tanque.saldoLitros, 1)} L.`}
          >
            <input
              id="medido"
              required
              inputMode="decimal"
              className={classeControle()}
              value={saldoMedido}
              onChange={(e) => setSaldoMedido(e.target.value)}
            />
          </Campo>

          {diferenca !== null && diferenca !== 0 && !Number.isNaN(diferenca) && (
            <p className={`text-legenda ${diferenca < 0 ? 'text-ceara-vermelho' : 'text-[#8a6300]'}`}>
              {diferenca < 0 ? 'Falta' : 'Sobra'} de {decimal(Math.abs(diferenca), 1)} L em relacao ao sistema.
            </p>
          )}

          <Campo rotulo="O que foi apurado" htmlFor="motivo-afericao" ajuda="Obrigatorio quando a diferenca passa da tolerancia.">
            <textarea
              id="motivo-afericao"
              rows={2}
              className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Campo>

          <label className="flex items-center gap-2 text-legenda text-ceara-texto2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--ceara-azul)]"
              checked={acertarSaldo}
              onChange={(e) => setAcertarSaldo(e.target.checked)}
            />
            Lancar o acerto que iguala o sistema a medicao
          </label>

          {resultado && <p className="text-legenda text-ceara-azul">{resultado}</p>}

          <Button
            type="submit"
            tamanho="sm"
            variante="secundario"
            iconeEsquerda={<Ruler size={14} aria-hidden />}
            carregando={aferir.isPending}
          >
            Registrar afericao
          </Button>
        </form>
      </CardCorpo>
    </Card>
  );
}

function Kpi({
  rotulo,
  valor,
  rodape,
  destaque = 'nenhum',
  Icone,
}: {
  rotulo: string;
  valor: string;
  rodape?: string;
  destaque?: 'nenhum' | 'regra' | 'ok';
  Icone?: typeof Droplet;
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
