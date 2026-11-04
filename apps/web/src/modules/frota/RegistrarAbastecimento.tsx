import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Fuel } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';

interface VeiculoOpcao {
  id: string;
  placa: string;
  frotaNumero: string;
  hodometroAtual: string;
}

interface MotoristaOpcao {
  id: string;
  nome: string;
  veiculoPadrao?: { id: string; placa: string } | null;
}

interface Apuracao {
  valorTotal: string;
  kmPercorridos: string | null;
  consumoKml: string | null;
  custoPorKm: string | null;
  desvioPercentual: string | null;
  anomalia: boolean;
  tipos: string[];
  mensagens: string[];
}

const COMBUSTIVEIS = ['DIESEL S10', 'DIESEL S500', 'ARLA 32', 'GASOLINA', 'ETANOL'];

const decimalBr = (v: string | null, casas = 2): string =>
  v === null ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(v));

/**
 * Inclusao de abastecimento (secao 7.2).
 *
 * O formulario e curto de proposito: o que a operacao digita no balcao e placa, motorista,
 * litros, preco e hodometro — o resto o sistema apura sozinho. O km percorrido, o consumo,
 * o custo por km e as anomalias voltam **na hora do registro**, na tela, porque anomalia
 * descoberta no relatorio do fim do mes ja perdeu a chance de ser corrigida.
 */
export function RegistrarAbastecimento({ unidadeId }: { unidadeId?: string }) {
  const cliente = useQueryClient();
  const [veiculoId, setVeiculoId] = useState('');
  const [motoristaId, setMotoristaId] = useState('');
  const [dataHora, setDataHora] = useState(() => new Date().toISOString().slice(0, 16));
  const [posto, setPosto] = useState('');
  const [postoInterno, setPostoInterno] = useState(false);
  const [tipoCombustivel, setCombustivel] = useState(COMBUSTIVEIS[0]!);
  const [litros, setLitros] = useState('');
  const [valorUnitario, setValorUnitario] = useState('');
  const [hodometro, setHodometro] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [apuracao, setApuracao] = useState<Apuracao | null>(null);

  const consulta = unidadeId ? `&unidadeId=${unidadeId}` : '';

  const veiculos = useQuery({
    queryKey: ['frota', 'veiculos', unidadeId],
    queryFn: () => get<{ itens: VeiculoOpcao[] }>(`/transporte/veiculos?limite=100${consulta}`),
  });

  const motoristas = useQuery({
    queryKey: ['frota', 'motoristas', unidadeId],
    queryFn: () => get<{ itens: MotoristaOpcao[] }>(`/transporte/motoristas?limite=100${consulta}`),
  });

  const veiculo = veiculos.data?.itens.find((v) => v.id === veiculoId) ?? null;

  const registrar = useMutation({
    mutationFn: () =>
      post<{ apuracao: Apuracao }>('/transporte/abastecimentos', {
        veiculoId,
        motoristaId,
        dataHora: new Date(dataHora).toISOString(),
        posto: posto.trim(),
        postoInterno,
        tipoCombustivel,
        litros: litros.trim(),
        valorUnitario: valorUnitario.trim(),
        hodometro: hodometro.trim(),
        formaPagamento: formaPagamento.trim() || null,
        justificativa: justificativa.trim() || null,
      }),
    onSuccess: async (r) => {
      setErro(null);
      setApuracao(r.apuracao);
      limpar();
      await cliente.invalidateQueries({ queryKey: ['abastecimento'] });
      await cliente.invalidateQueries({ queryKey: ['frota'] });
    },
    onError: (falha) => {
      setApuracao(null);
      setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar o abastecimento.');
    },
  });

  function limpar() {
    setLitros('');
    setValorUnitario('');
    setHodometro('');
    setJustificativa('');
  }

  /*
   * O hodometro do cadastro entra como sugestao ao escolher o veiculo: quem abastece digita
   * a leitura do painel, que quase sempre e um pouco maior — corrigir e mais rapido que
   * digitar seis digitos do zero.
   */
  function escolherVeiculo(id: string) {
    setVeiculoId(id);
    const v = veiculos.data?.itens.find((x) => x.id === id);
    if (v && hodometro.trim() === '') setHodometro(String(Math.round(Number(v.hodometroAtual))));

    // motorista padrao do veiculo, quando houver: menos um campo para procurar na lista
    const dono = motoristas.data?.itens.find((m) => m.veiculoPadrao?.id === id);
    if (dono && motoristaId === '') setMotoristaId(dono.id);
  }

  const total = litros.trim() !== '' && valorUnitario.trim() !== '' ? Number(litros) * Number(valorUnitario) : null;

  const pronto =
    veiculoId !== '' &&
    motoristaId !== '' &&
    posto.trim().length >= 2 &&
    /^\d+(\.\d{1,3})?$/.test(litros.trim()) &&
    /^\d+(\.\d{1,4})?$/.test(valorUnitario.trim()) &&
    /^\d+(\.\d)?$/.test(hodometro.trim());

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {apuracao && <ResultadoDoRegistro apuracao={apuracao} aoFechar={() => setApuracao(null)} />}

      <Card destaque="regra">
        <CardTitulo>Novo abastecimento</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Veiculo" htmlFor="ab-veiculo" obrigatorio>
              <select id="ab-veiculo" className={classeControle()} value={veiculoId} onChange={(e) => escolherVeiculo(e.target.value)}>
                <option value="">Selecione</option>
                {(veiculos.data?.itens ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa} · frota {v.frotaNumero}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Motorista" htmlFor="ab-motorista" obrigatorio>
              <select id="ab-motorista" className={classeControle()} value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
                <option value="">Selecione</option>
                {(motoristas.data?.itens ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Data e hora" htmlFor="ab-data" obrigatorio>
              <input id="ab-data" type="datetime-local" className={classeControle()} value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Posto" htmlFor="ab-posto" obrigatorio ajuda="Nome do posto, ou do tanque quando for interno.">
              <input id="ab-posto" className={classeControle()} value={posto} onChange={(e) => setPosto(e.target.value)} />
            </Campo>

            <Campo rotulo="Onde abasteceu" htmlFor="ab-interno">
              <select
                id="ab-interno"
                className={classeControle()}
                value={postoInterno ? 'interno' : 'externo'}
                onChange={(e) => setPostoInterno(e.target.value === 'interno')}
              >
                <option value="externo">Posto de rua</option>
                <option value="interno">Tanque proprio</option>
              </select>
            </Campo>

            <Campo rotulo="Combustivel" htmlFor="ab-combustivel" obrigatorio>
              <select id="ab-combustivel" className={classeControle()} value={tipoCombustivel} onChange={(e) => setCombustivel(e.target.value)}>
                {COMBUSTIVEIS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Campo rotulo="Litros" htmlFor="ab-litros" obrigatorio ajuda="Use ponto: 154.320">
              <input id="ab-litros" inputMode="decimal" className={classeControle()} value={litros} onChange={(e) => setLitros(e.target.value)} />
            </Campo>

            <Campo rotulo="Valor por litro" htmlFor="ab-unitario" obrigatorio>
              <input id="ab-unitario" inputMode="decimal" className={classeControle()} value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} />
            </Campo>

            <Campo
              rotulo="Hodometro"
              htmlFor="ab-hodometro"
              obrigatorio
              ajuda={veiculo ? `Cadastro: ${decimalBr(veiculo.hodometroAtual, 0)} km` : 'Leitura do painel.'}
            >
              <input id="ab-hodometro" inputMode="decimal" className={classeControle()} value={hodometro} onChange={(e) => setHodometro(e.target.value)} />
            </Campo>

            <Campo rotulo="Forma de pagamento" htmlFor="ab-pagamento">
              <input id="ab-pagamento" className={classeControle()} value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} />
            </Campo>
          </div>

          <Campo
            rotulo="Justificativa"
            htmlFor="ab-justificativa"
            ajuda="Exigida quando o hodometro informado for menor que o do ultimo abastecimento."
          >
            <input id="ab-justificativa" className={classeControle()} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
          </Campo>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-corpo text-ceara-texto2">
              Total do abastecimento:{' '}
              <span className="font-mono font-medium text-ceara-texto">
                {total === null ? '—' : `R$ ${decimalBr(String(total))}`}
              </span>
            </span>
            <Button disabled={!pronto} carregando={registrar.isPending} onClick={() => registrar.mutate()}>
              <Fuel size={16} aria-hidden /> Registrar abastecimento
            </Button>
          </div>
        </CardCorpo>
      </Card>
    </div>
  );
}

/**
 * O que o sistema apurou no ato do registro.
 *
 * Consumo e custo por km aparecem aqui porque e o unico momento em que quem digitou ainda
 * lembra do abastecimento — se o numero saiu torto, e agora que ele percebe.
 */
function ResultadoDoRegistro({ apuracao, aoFechar }: { apuracao: Apuracao; aoFechar: () => void }) {
  return (
    <Card destaque={apuracao.anomalia ? 'risco' : 'ok'}>
      <CardCorpo className="flex flex-col gap-3 pt-4">
        <p className="flex items-center gap-2 text-h3">
          {apuracao.anomalia ? (
            <>
              <AlertTriangle size={18} className="text-ceara-vermelho" aria-hidden />
              <span className="text-ceara-vermelho">Registrado com anomalia</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={18} className="text-ceara-verde" aria-hidden />
              <span className="text-ceara-verde">Registrado</span>
            </>
          )}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Numero rotulo="Total" valor={`R$ ${decimalBr(apuracao.valorTotal)}`} />
          <Numero rotulo="Km percorridos" valor={apuracao.kmPercorridos === null ? 'sem base' : decimalBr(apuracao.kmPercorridos, 1)} />
          <Numero rotulo="Consumo" valor={apuracao.consumoKml === null ? 'sem base' : `${decimalBr(apuracao.consumoKml, 3)} km/L`} />
          <Numero rotulo="Custo por km" valor={apuracao.custoPorKm === null ? 'sem base' : `R$ ${decimalBr(apuracao.custoPorKm, 4)}`} />
        </div>

        {apuracao.mensagens.length > 0 && (
          <ul className="flex flex-col gap-1">
            {apuracao.mensagens.map((m) => (
              <li key={m} className="text-corpo text-ceara-vermelho">
                {m}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variante="texto" tamanho="sm" onClick={aoFechar}>
            Ok, entendi
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-legenda text-ceara-texto2">{rotulo}</p>
      <p className={cn('font-mono text-h3 text-ceara-texto')}>{valor}</p>
    </div>
  );
}
