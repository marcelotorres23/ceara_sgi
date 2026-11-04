import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp, PackagePlus } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';

interface TanqueOpcao {
  id: string;
  codigo: string;
  nome: string;
  produto: string;
  capacidade: string;
  saldo: string;
}

interface ItemDaNota {
  codigo: string | null;
  descricao: string;
  unidade: string | null;
  litros: string;
  valorUnitario: string;
  valorTotal: string;
  ehCombustivel: boolean;
}

interface LeituraDaNota {
  nota: {
    chave: string | null;
    numero: string | null;
    serie: string | null;
    emitidaEm: string | null;
    fornecedor: { cnpj: string | null; razaoSocial: string | null; nomeFantasia: string | null };
    itens: ItemDaNota[];
    litrosDeCombustivel: string;
    valorDeCombustivel: string;
    custoUnitarioMedio: string | null;
    valorTotalDaNota: string | null;
    avisos: string[];
  };
  fornecedor: { id: string; razaoSocial: string; nomeFantasia: string | null; status: string } | null;
  fornecedorNaoCadastrado: boolean;
  jaLancada: { em: string; tanque: string | null } | null;
}

const num = (v: string | null, casas = 2): string =>
  v === null ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(v));

const reais = (v: string | null): string => (v === null ? '—' : `R$ ${num(v)}`);
const dataBr = (iso: string | null): string => (iso === null ? '—' : new Date(iso).toLocaleDateString('pt-BR'));

/**
 * Entrada de combustivel no tanque (secao 7.9).
 *
 * Dois caminhos para o mesmo lancamento: digitar, ou **soltar o XML da NF-e** e conferir o
 * que veio. O XML preenche litros, custo do litro, numero da nota e fornecedor — os quatro
 * campos onde um digito trocado desalinha o custo medio de todo o estoque.
 *
 * O arquivo **propoe**, e nunca grava sozinho: volume faturado e volume recebido divergem
 * por temperatura e por sobra de mangueira, e quem sabe o que desceu do caminhao-tanque e
 * quem estava no patio com a regua na mao.
 */
export function EntradaDeCombustivel({ unidadeId }: { unidadeId?: string }) {
  const cliente = useQueryClient();
  const arquivo = useRef<HTMLInputElement>(null);

  const [tanqueId, setTanqueId] = useState('');
  const [litros, setLitros] = useState('');
  const [custoUnitario, setCusto] = useState('');
  const [notaFiscal, setNotaFiscal] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState('');
  const [leitura, setLeitura] = useState<LeituraDaNota | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);

  const tanques = useQuery({
    queryKey: ['tanques', 'painel', unidadeId],
    queryFn: () => get<{ itens: TanqueOpcao[] }>(`/transporte/tanques${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  });

  const fornecedores = useQuery({
    queryKey: ['compras', 'fornecedores'],
    queryFn: () => get<{ itens: Array<{ id: string; razaoSocial: string }> }>('/compras/fornecedores?limite=100'),
    staleTime: 300_000,
  });

  const tanque = tanques.data?.itens.find((t) => t.id === tanqueId) ?? null;

  /** Le o XML no servidor e traz os campos preenchidos, sem gravar nada. */
  async function lerXml(f: File) {
    setLendo(true);
    setErro(null);
    setSucesso(null);
    try {
      const buffer = await f.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const r = await post<LeituraDaNota>('/transporte/tanques/entradas/ler-xml', { conteudoBase64: base64 });

      setLeitura(r);
      // o formulario recebe o que a nota trouxe; tudo continua editavel antes de confirmar
      setLitros(r.nota.litrosDeCombustivel);
      setCusto(r.nota.custoUnitarioMedio ?? '');
      setNotaFiscal(r.nota.numero ?? '');
      setFornecedorId(r.fornecedor?.id ?? '');
      if (r.nota.emitidaEm) setData(r.nota.emitidaEm.slice(0, 10));
    } catch (e) {
      setLeitura(null);
      setErro(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel ler o XML da nota.');
    } finally {
      setLendo(false);
    }
  }

  const lancar = useMutation({
    mutationFn: () =>
      post(`/transporte/tanques/${tanqueId}/entradas`, {
        litros: litros.trim(),
        custoUnitario: custoUnitario.trim(),
        notaFiscal: notaFiscal.trim(),
        fornecedorId: fornecedorId || null,
        data: new Date(`${data}T12:00:00`).toISOString(),
        motivo: motivo.trim() || null,
      }),
    onSuccess: async () => {
      setErro(null);
      setSucesso(`Entrada de ${num(litros, 1)} L lancada no ${tanque?.codigo ?? 'tanque'}.`);
      setLeitura(null);
      setLitros('');
      setCusto('');
      setNotaFiscal('');
      setMotivo('');
      if (arquivo.current) arquivo.current.value = '';
      await cliente.invalidateQueries({ queryKey: ['tanques'] });
    },
    onError: (falha) => {
      setSucesso(null);
      setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao lancar a entrada.');
    },
  });

  const total = litros.trim() !== '' && custoUnitario.trim() !== '' ? Number(litros) * Number(custoUnitario) : null;

  /** Cabe no tanque? A conta e do servidor, mas avisar antes evita a viagem perdida. */
  const excedeCapacidade =
    tanque !== null && litros.trim() !== '' && Number(tanque.saldo) + Number(litros) > Number(tanque.capacidade);

  const pronto =
    tanqueId !== '' &&
    /^\d+(\.\d{1,3})?$/.test(litros.trim()) &&
    /^\d+(\.\d{1,4})?$/.test(custoUnitario.trim()) &&
    notaFiscal.trim().length >= 1;

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {sucesso && (
        <p className="flex items-center gap-2 rounded-card border-l-4 border-ceara-verde bg-[rgba(30,122,68,0.08)] px-4 py-3 text-corpo text-ceara-verde">
          <CheckCircle2 size={16} aria-hidden />
          {sucesso}
        </p>
      )}

      <Card destaque="regra">
        <CardTitulo>Entrada de combustivel</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-card bg-ceara-nevoa p-3">
            <input
              ref={arquivo}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void lerXml(f);
              }}
            />
            <Button variante="secundario" carregando={lendo} onClick={() => arquivo.current?.click()}>
              <FileUp size={16} aria-hidden /> Ler XML da nota
            </Button>
            <span className="text-legenda text-ceara-texto2">
              O arquivo preenche litros, custo do litro, numero da nota e fornecedor. Nada e gravado antes de voce
              conferir e confirmar.
            </span>
          </div>

          {leitura && <ResumoDaNota leitura={leitura} />}

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Tanque" htmlFor="e-tanque" obrigatorio>
              <select id="e-tanque" className={classeControle()} value={tanqueId} onChange={(e) => setTanqueId(e.target.value)}>
                <option value="">Selecione</option>
                {(tanques.data?.itens ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.codigo} · {t.nome} ({t.produto})
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              rotulo="Litros"
              htmlFor="e-litros"
              obrigatorio
              ajuda={tanque ? `Saldo atual: ${num(tanque.saldo, 1)} L de ${num(tanque.capacidade, 0)} L` : 'Volume que desceu para o tanque.'}
            >
              <input
                id="e-litros"
                inputMode="decimal"
                aria-invalid={excedeCapacidade}
                className={cn(classeControle(), excedeCapacidade && 'border-ceara-vermelho')}
                value={litros}
                onChange={(e) => setLitros(e.target.value)}
              />
            </Campo>

            <Campo rotulo="Custo do litro" htmlFor="e-custo" obrigatorio>
              <input id="e-custo" inputMode="decimal" className={classeControle()} value={custoUnitario} onChange={(e) => setCusto(e.target.value)} />
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Nota fiscal" htmlFor="e-nota" obrigatorio>
              <input id="e-nota" className={classeControle()} value={notaFiscal} onChange={(e) => setNotaFiscal(e.target.value)} />
            </Campo>

            <Campo rotulo="Fornecedor" htmlFor="e-fornecedor">
              <select id="e-fornecedor" className={classeControle()} value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">Nao informado</option>
                {(fornecedores.data?.itens ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.razaoSocial}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Data da entrada" htmlFor="e-data" obrigatorio>
              <input id="e-data" type="date" className={classeControle()} value={data} onChange={(e) => setData(e.target.value)} />
            </Campo>
          </div>

          <Campo rotulo="Observacao" htmlFor="e-motivo" ajuda="Diferenca entre o faturado e o recebido, por exemplo.">
            <input id="e-motivo" className={classeControle()} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>

          {excedeCapacidade && tanque && (
            <p className="flex items-start gap-2 text-corpo text-ceara-vermelho">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              {num(litros, 1)} L nao cabem: o {tanque.codigo} tem {num(tanque.saldo, 1)} L e capacidade de{' '}
              {num(tanque.capacidade, 0)} L. Confira o volume ou divida a carga entre tanques.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-corpo text-ceara-texto2">
              Valor da entrada:{' '}
              <span className="font-mono font-medium text-ceara-texto">{total === null ? '—' : reais(String(total))}</span>
            </span>
            <Button disabled={!pronto} carregando={lancar.isPending} onClick={() => lancar.mutate()}>
              <PackagePlus size={16} aria-hidden /> Lancar entrada
            </Button>
          </div>
        </CardCorpo>
      </Card>
    </div>
  );
}

/**
 * O que a nota trouxe, antes de confirmar.
 *
 * Mostra os itens separados entre o que vai para o tanque e o que nao vai — frete e
 * lubrificante em balde vem na mesma nota e nao podem entrar no volume.
 */
function ResumoDaNota({ leitura }: { leitura: LeituraDaNota }) {
  const { nota } = leitura;

  return (
    <Card destaque={leitura.jaLancada ? 'risco' : 'ok'}>
      <CardCorpo className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-h3 text-ceara-texto">
            NF-e {nota.numero ?? 'sem numero'}
            {nota.serie && <span className="text-ceara-texto2"> · serie {nota.serie}</span>}
          </p>
          <p className="text-legenda text-ceara-texto2">emitida em {dataBr(nota.emitidaEm)}</p>
        </div>

        <p className="text-corpo">
          {nota.fornecedor.razaoSocial ?? 'Fornecedor nao identificado'}
          {nota.fornecedor.cnpj && <span className="text-ceara-texto2"> · CNPJ {nota.fornecedor.cnpj}</span>}
          {leitura.fornecedor ? (
            <Badge tom="verde" className="ml-2">
              no cadastro
            </Badge>
          ) : leitura.fornecedorNaoCadastrado ? (
            <Badge tom="ouro" className="ml-2">
              nao cadastrado
            </Badge>
          ) : null}
        </p>

        {leitura.jaLancada && (
          <p className="flex items-start gap-2 text-corpo text-ceara-vermelho">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            Esta nota ja foi lancada em {dataBr(leitura.jaLancada.em)}
            {leitura.jaLancada.tanque && ` no ${leitura.jaLancada.tanque}`}. Lancar de novo duplicaria o estoque.
          </p>
        )}

        {nota.avisos.map((a) => (
          <p key={a} className="flex items-start gap-2 text-corpo text-[#8a6300]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {a}
          </p>
        ))}

        {nota.itens.length === 0 ? (
          <EstadoVazio titulo="Nota sem itens" descricao="O arquivo nao trouxe nenhum produto." />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Item</Th>
                <Th className="text-right">Quantidade</Th>
                <Th className="text-right">Unitario</Th>
                <Th className="text-right">Total</Th>
                <Th>Vai para o tanque?</Th>
              </Tr>
            </Thead>
            <Tbody>
              {nota.itens.map((i, indice) => (
                <Tr key={`${i.codigo ?? indice}`} className={cn(!i.ehCombustivel && 'opacity-60')}>
                  <Td>{i.descricao}</Td>
                  <Td className="text-right font-mono">
                    {num(i.litros, 3)} {i.unidade ?? ''}
                  </Td>
                  <Td className="text-right font-mono">{num(i.valorUnitario, 4)}</Td>
                  <Td className="text-right font-mono">{reais(i.valorTotal)}</Td>
                  <Td>
                    {i.ehCombustivel ? <Badge tom="verde">combustivel</Badge> : <Badge tom="neutro">fora do volume</Badge>}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Numero rotulo="Litros da nota" valor={`${num(nota.litrosDeCombustivel, 1)} L`} />
          <Numero rotulo="Valor do combustivel" valor={reais(nota.valorDeCombustivel)} />
          <Numero rotulo="Custo do litro" valor={nota.custoUnitarioMedio === null ? '—' : num(nota.custoUnitarioMedio, 4)} />
          <Numero rotulo="Total da nota" valor={reais(nota.valorTotalDaNota)} />
        </div>
      </CardCorpo>
    </Card>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-legenda text-ceara-texto2">{rotulo}</p>
      <p className="font-mono text-h3 text-ceara-texto">{valor}</p>
    </div>
  );
}
