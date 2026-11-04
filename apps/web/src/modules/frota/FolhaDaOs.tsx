import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { type OrdemServicoDetalhada } from './tipos';

const dataHoraBr = (iso: string | null) =>
  iso === null ? '—' : new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const decimalBr = (v: string | null | undefined, casas = 1) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(v));

/** Linhas em branco: o mecanico anota na bancada o que descobre com a maquina aberta. */
const LINHAS_EM_BRANCO = 8;

/**
 * Folha da OS para a bancada (secao 7.5).
 *
 * O mecanico nao vai ao computador a cada parafuso: ele leva o papel, anota o que fez e o
 * que faltou, e o fechamento transcreve isso para o sistema. Por isso a folha tem tantas
 * linhas em branco quanto dados preenchidos — e por isso ela e impressa pelo navegador,
 * sem depender de gerador de PDF.
 */
export function FolhaDaOs({ osId, aoFechar }: { osId: string; aoFechar: () => void }) {
  const os = useQuery({
    queryKey: ['frota', 'os', osId],
    queryFn: () => get<OrdemServicoDetalhada>(`/transporte/manutencao/ordens/${osId}`),
  });

  // Esc fecha: a folha ocupa a tela inteira e nao deve prender quem so queria espiar
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  if (os.isLoading) return <p className="text-corpo text-ceara-texto2">Carregando a ordem de servico...</p>;
  if (!os.data) return null;

  const d = os.data;
  const pecas = d.itens.filter((i) => !i.maoDeObra);
  const servicos = d.itens.filter((i) => i.maoDeObra);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 print:static print:bg-white print:p-0">
      <div className="mx-auto max-w-[210mm] rounded-card bg-white p-8 shadow-card print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        {/* barra de acao: some na impressao */}
        <div className="mb-6 flex justify-end gap-2 print:hidden">
          <Button variante="texto" onClick={aoFechar}>
            Fechar
          </Button>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>

        <article className="folha-os text-[11pt] leading-snug text-black">
          <header className="mb-4 flex items-start justify-between border-b-2 border-black pb-3">
            <div>
              <p className="text-[16pt] font-bold tracking-wide">CEARA ALIMENTOS</p>
              <p className="text-[9pt]">
                {d.unidade.nome} · {d.unidade.cidade ?? ''} {d.unidade.uf ?? ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[9pt] uppercase tracking-wide">Ordem de servico</p>
              <p className="font-mono text-[20pt] font-bold leading-none">{d.numero}</p>
              <p className="text-[9pt]">{d.tipo === 'PREVENTIVA' ? 'Preventiva' : 'Corretiva'}</p>
            </div>
          </header>

          <section className="mb-3 grid grid-cols-4 gap-x-4 gap-y-2 border border-black p-2 text-[10pt]">
            <Campo rotulo="Placa" valor={d.veiculo.placa} destaque />
            <Campo rotulo="Frota" valor={d.veiculo.frotaNumero ?? '—'} />
            <Campo rotulo="Veiculo" valor={[d.veiculo.marca, d.veiculo.modelo, d.veiculo.ano].filter(Boolean).join(' ') || '—'} />
            <Campo rotulo="Hodometro na abertura" valor={decimalBr(d.hodometro)} />
            <Campo rotulo="Aberta em" valor={dataHoraBr(d.abertaEm)} />
            <Campo rotulo="Iniciada em" valor={dataHoraBr(d.iniciadaEm)} />
            <Campo rotulo="Oficina" valor={d.oficina ?? (d.terceiro ? 'Terceiro' : 'Propria')} />
            <Campo rotulo="Origem" valor={ROTULO_ORIGEM[d.origem] ?? d.origem} />
          </section>

          <section className="mb-3">
            <Titulo>Servico solicitado</Titulo>
            <p className="min-h-[3rem] border border-black p-2 text-[10pt]">{d.descricao}</p>
            {d.plano && (
              <p className="mt-1 text-[9pt] italic">
                Plano preventivo: {d.plano.descricao} (a cada {decimalBr(d.plano.gatilhoValor, 0)}{' '}
                {d.plano.gatilhoTipo === 'KM' ? 'km' : d.plano.gatilhoTipo === 'HORAS' ? 'horas' : 'dias'})
              </p>
            )}
            {d.osOrigem && (
              <p className="mt-1 text-[9pt] italic">Retorno da pendencia da {d.osOrigem.numero}.</p>
            )}
          </section>

          <section className="mb-3">
            <Titulo>Pecas e servicos ja lancados no sistema</Titulo>
            <TabelaDeItens itens={pecas} rotuloVazio="Nenhuma peca requisitada ate a impressao." />
            {servicos.length > 0 && (
              <div className="mt-2">
                <p className="text-[9pt] font-semibold uppercase">Mao de obra</p>
                <TabelaDeItens itens={servicos} rotuloVazio="" />
              </div>
            )}
          </section>

          <section className="mb-3">
            <Titulo>Anotacoes do mecanico</Titulo>
            <p className="mb-1 text-[9pt] italic">
              Escreva aqui o que foi feito e o que faltou. Estas linhas sao transcritas no fechamento da OS.
            </p>
            <div className="border border-black">
              {Array.from({ length: LINHAS_EM_BRANCO }).map((_, i) => (
                <div key={i} className="h-7 border-b border-dotted border-black last:border-b-0" />
              ))}
            </div>
          </section>

          <section className="mb-4 grid grid-cols-2 gap-4 text-[10pt]">
            <div className="border border-black p-2">
              <p className="mb-2 font-semibold uppercase">Conclusao</p>
              <label className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 border border-black" aria-hidden /> Servico TOTAL — nada pendente
              </label>
              <label className="mt-1 flex items-center gap-2">
                <span className="inline-block h-4 w-4 border border-black" aria-hidden /> Servico PARCIAL — descrever a
                pendencia acima
              </label>
              <p className="mt-3">Hodometro no fechamento: ______________________</p>
            </div>
            <div className="border border-black p-2">
              <p className="mb-2 font-semibold uppercase">Tempo</p>
              <p>Inicio: ____/____/______ as ______:______</p>
              <p className="mt-1">Termino: ____/____/______ as ______:______</p>
              <p className="mt-3 text-[9pt] italic">
                O tempo parado do veiculo e apurado pelo sistema no fechamento.
              </p>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-8 pt-6 text-[10pt]">
            <Assinatura rotulo="Mecanico responsavel" />
            <Assinatura rotulo="Conferencia / liberacao do veiculo" />
          </section>

          {d.status === 'CONCLUIDA' && (
            <section className="mt-4 border-2 border-black p-2 text-[10pt]">
              <p className="font-semibold uppercase">
                OS ja concluida em {dataHoraBr(d.fechadaEm)} — {d.conclusaoTipo === 'PARCIAL' ? 'PARCIAL' : 'TOTAL'}
              </p>
              {d.mecanico && <p>Executado por: {d.mecanico}</p>}
              {d.anotacoesMecanico && <p className="mt-1 whitespace-pre-wrap">{d.anotacoesMecanico}</p>}
              {d.pendencia && (
                <p className="mt-1">
                  <strong>Pendencia:</strong> {d.pendencia}
                  {d.osRetorno && ` — segue na ${d.osRetorno.numero}`}
                </p>
              )}
              <p className="mt-1">
                Custo total: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(d.custoTotal))}
              </p>
            </section>
          )}

          <footer className="mt-6 border-t border-black pt-2 text-[8pt]">
            Impresso em {dataHoraBr(new Date().toISOString())} · {d.numero} · a via impressa nao substitui o registro no
            sistema: o que vale e o que for lancado no fechamento.
          </footer>
        </article>
      </div>
    </div>
  );
}

const ROTULO_ORIGEM: Record<string, string> = {
  PLANO: 'Plano preventivo',
  CHECKLIST: 'Checklist reprovado',
  MOTORISTA: 'Relato do motorista',
  ANOMALIA_ABASTECIMENTO: 'Anomalia de consumo',
  INSPECAO_PNEU: 'Inspecao de pneu',
  OS_PARCIAL: 'Pendencia de OS anterior',
  MANUAL: 'Abertura manual',
};

function Titulo({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-[9pt] font-bold uppercase tracking-wide">{children}</p>;
}

function Campo({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div>
      <p className="text-[8pt] uppercase">{rotulo}</p>
      <p className={destaque ? 'font-mono text-[13pt] font-bold' : 'font-medium'}>{valor}</p>
    </div>
  );
}

function Assinatura({ rotulo }: { rotulo: string }) {
  return (
    <div>
      <div className="border-t border-black pt-1 text-center text-[9pt]">{rotulo}</div>
    </div>
  );
}

function TabelaDeItens({
  itens,
  rotuloVazio,
}: {
  itens: Array<{ id: string; descricao: string; quantidade: string; custo: string; maoDeObra: boolean }>;
  rotuloVazio: string;
}) {
  if (itens.length === 0) {
    return rotuloVazio ? <p className="border border-black p-2 text-[9pt] italic">{rotuloVazio}</p> : null;
  }

  return (
    <table className="w-full border-collapse border border-black text-[10pt]">
      <thead>
        <tr>
          <th className="border border-black px-2 py-1 text-left">Descricao</th>
          <th className="w-24 border border-black px-2 py-1 text-right">Qtde</th>
          <th className="w-28 border border-black px-2 py-1 text-right">Custo</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((i) => (
          <tr key={i.id}>
            <td className="border border-black px-2 py-1">{i.descricao}</td>
            <td className="border border-black px-2 py-1 text-right">{decimalBr(i.quantidade, 2)}</td>
            <td className="border border-black px-2 py-1 text-right">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(i.custo))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
