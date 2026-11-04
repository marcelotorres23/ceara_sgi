import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Card, CardCorpo } from '../../design-system/components/Card';
import { ModalConfirmacao } from '../../design-system/components/ModalConfirmacao';
import { cn } from '../../design-system/cn';
import { useSessao } from '../auth/useSessao';
import { CardLote } from './CardLote';
import { ColunaKanban } from './ColunaKanban';
import { moeda, numero, type CardKanban, type Criticidade, type PainelKanban as Painel, type StatusLote, type Swimlane } from './tipos';

/**
 * Destinos que nao se alcancam arrastando, espelhados de `state-machine.ts`.
 *
 * Aprovar, reprovar, emitir pedido, receber e lancar NF tem cada um a sua tela, porque cada
 * um tem uma checagem que o arrasto nao faz — a faixa de alcada, a segregacao que impede
 * quem cotou de aprovar, a data prometida, o three-way match. O servidor recusa de todo
 * jeito; tirar a coluna do alvo evita oferecer um caminho que termina em erro.
 */
const DESTINOS_COM_ATO_PROPRIO: StatusLote[] = [
  'APROVADO', 'REPROVADO', 'PEDIDO_EMITIDO', 'RECEBIDO', 'RECEBIDO_PARCIAL', 'NF_LANCADA', 'ENCERRADO',
];

/** Permissao que cada destino cobra, igual a do backend. */
const PERMISSAO_POR_DESTINO: Partial<Record<StatusLote, string>> = {
  TRIAGEM: 'solicitacao:triar',
  DEVOLVIDO_AO_SOLICITANTE: 'solicitacao:triar',
  EM_COTACAO: 'cotacao:gerenciar',
  MAPA_PRONTO: 'mapa:gerar',
  AGUARDANDO_APROVACAO: 'mapa:gerar',
  EM_RENEGOCIACAO: 'lote:aprovar',
  CANCELADO: 'solicitacao:cancelar',
  AGUARDANDO_ENTREGA: 'pedido:emitir',
  BLOQUEADO_DIVERGENCIA: 'recebimento:registrar',
};

/**
 * Transicoes validas espelhadas do backend apenas para dar retorno imediato ao arrastar.
 * A decisao continua sendo do servidor: o drop chama a API e a maquina de estados manda.
 */
const TRANSICOES: Partial<Record<StatusLote, StatusLote[]>> = {
  TRIAGEM: ['EM_COTACAO', 'DEVOLVIDO_AO_SOLICITANTE', 'CANCELADO'],
  EM_COTACAO: ['MAPA_PRONTO', 'DEVOLVIDO_AO_SOLICITANTE', 'CANCELADO'],
  MAPA_PRONTO: ['AGUARDANDO_APROVACAO', 'EM_COTACAO', 'CANCELADO'],
  AGUARDANDO_APROVACAO: ['APROVADO', 'REPROVADO', 'EM_RENEGOCIACAO', 'CANCELADO'],
  APROVADO: ['PEDIDO_EMITIDO', 'CANCELADO'],
  PEDIDO_EMITIDO: ['AGUARDANDO_ENTREGA', 'CANCELADO'],
  AGUARDANDO_ENTREGA: ['RECEBIDO_PARCIAL', 'RECEBIDO', 'BLOQUEADO_DIVERGENCIA'],
  RECEBIDO_PARCIAL: ['RECEBIDO', 'BLOQUEADO_DIVERGENCIA'],
  RECEBIDO: ['NF_LANCADA', 'BLOQUEADO_DIVERGENCIA'],
  NF_LANCADA: ['ENCERRADO', 'BLOQUEADO_DIVERGENCIA'],
  EM_RENEGOCIACAO: ['MAPA_PRONTO', 'EM_COTACAO', 'CANCELADO'],
};

const ORDEM_FLUXO: StatusLote[] = [
  'RASCUNHO', 'TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'APROVADO',
  'PEDIDO_EMITIDO', 'AGUARDANDO_ENTREGA', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'NF_LANCADA', 'ENCERRADO',
];

const EXIGEM_MOTIVO: StatusLote[] = [
  'DEVOLVIDO_AO_SOLICITANTE', 'EM_RENEGOCIACAO', 'REPROVADO', 'CANCELADO', 'BLOQUEADO_DIVERGENCIA',
];

/** Motivo obrigatorio no destino ou em qualquer retrocesso do fluxo (secao 6.3). */
function exigeMotivo(de: StatusLote, para: StatusLote): boolean {
  if (EXIGEM_MOTIVO.includes(para)) return true;
  const i = ORDEM_FLUXO.indexOf(de);
  const j = ORDEM_FLUXO.indexOf(para);
  return i >= 0 && j >= 0 && j < i;
}

interface Pendente {
  card: CardKanban;
  para: StatusLote;
  rotuloDestino: string;
}

export function PainelKanban() {
  const cliente = useQueryClient();
  const [criticidade, setCriticidade] = useState<Criticidade | ''>('');
  const [apenasMeus, setApenasMeus] = useState(false);
  const [apenasAtrasados, setApenasAtrasados] = useState(false);
  const [swimlane, setSwimlane] = useState<Swimlane | ''>('');
  const navegar = useNavigate();
  const permissoes = useSessao((s) => s.usuario?.permissoes ?? []);
  const [arrastando, setArrastando] = useState<CardKanban | null>(null);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const parametros = new URLSearchParams();
  if (criticidade) parametros.set('criticidade', criticidade);
  if (apenasMeus) parametros.set('apenasMeus', 'true');
  if (apenasAtrasados) parametros.set('apenasAtrasados', 'true');
  if (swimlane) parametros.set('swimlane', swimlane);
  const consulta = parametros.toString();

  const { data, isLoading } = useQuery({
    queryKey: ['painel', consulta],
    queryFn: () => get<Painel>(`/compras/painel${consulta ? `?${consulta}` : ''}`),
    refetchInterval: 60_000,
  });

  const mover = useMutation({
    mutationFn: (entrada: { loteId: string; para: StatusLote; motivo?: string }) =>
      post('/compras/painel/mover', entrada),
    onSuccess: () => {
      setErro(null);
      void cliente.invalidateQueries({ queryKey: ['painel'] });
    },
    onError: (e) => setErro(e instanceof ApiError ? e.erro.mensagem : 'Nao foi possivel mover o lote.'),
  });

  // Teclado alem do ponteiro: mover lote nao pode depender de mouse.
  // Tab ate o card, Espaco para pegar, setas para escolher a coluna, Espaco para soltar.
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  /**
   * Colunas que aceitam este card: a transicao precisa existir, o destino nao pode ter ato
   * proprio, e o perfil precisa da permissao daquele destino.
   */
  const destinosValidos = useMemo(
    () =>
      arrastando
        ? (TRANSICOES[arrastando.status] ?? []).filter(
            (para) =>
              !DESTINOS_COM_ATO_PROPRIO.includes(para) &&
              permissoes.includes(PERMISSAO_POR_DESTINO[para] ?? ''),
          )
        : [],
    [arrastando, permissoes],
  );

  function aoIniciar(evento: DragStartEvent) {
    setArrastando((evento.active.data.current as { card: CardKanban } | undefined)?.card ?? null);
  }

  function aoSoltar(evento: DragEndEvent) {
    const card = (evento.active.data.current as { card: CardKanban } | undefined)?.card;
    setArrastando(null);
    if (!card || !evento.over) return;

    const para = evento.over.id as StatusLote;
    if (para === card.status) return;

    if (!(TRANSICOES[card.status] ?? []).includes(para)) {
      setErro(`Nao e possivel mover de ${card.status} para ${para}.`);
      return;
    }

    if (DESTINOS_COM_ATO_PROPRIO.includes(para)) {
      setErro('Esta etapa nao se alcanca arrastando: ela tem tela propria, com as conferencias que o arrasto nao faz. Abra o lote.');
      return;
    }

    if (!permissoes.includes(PERMISSAO_POR_DESTINO[para] ?? '')) {
      setErro('Seu perfil nao permite mover o lote para esta etapa.');
      return;
    }

    const rotuloDestino = data?.colunas.find((c) => c.status === para)?.rotulo ?? para;

    // transicao que exige dado abre modal e so conclui apos o preenchimento
    if (exigeMotivo(card.status, para)) {
      setPendente({ card, para, rotuloDestino });
      return;
    }

    mover.mutate({ loteId: card.id, para });
  }

  const kpis = data?.kpis;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Painel do comprador</h1>
          <p className="text-legenda italic text-ceara-texto2">
            Arraste o card para mudar a etapa. Movimento que exige justificativa abre confirmacao.
          </p>
        </div>
      </div>

      {/* KPIs ao vivo (secao 6.3) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi rotulo="Lotes em aberto" valor={kpis ? numero(kpis.lotesEmAberto) : '—'} />
        <Kpi rotulo="Valor em negociacao" valor={kpis ? moeda(kpis.valorEmNegociacao) : '—'} />
        <Kpi
          rotulo="Dentro do SLA"
          valor={kpis ? `${kpis.percentualDentroDoSla}%` : '—'}
          tom={kpis && kpis.percentualDentroDoSla < 90 ? 'ruim' : 'bom'}
        />
        <Kpi
          rotulo="Aging > 10 dias"
          valor={kpis ? numero(kpis.agingAcimaDe10Dias) : '—'}
          tom={kpis && kpis.agingAcimaDe10Dias > 0 ? 'ruim' : 'bom'}
        />
        <Kpi rotulo="Savings do mes" valor={kpis ? moeda(kpis.savingsDoMes) : '—'} />
        <Kpi
          rotulo="Pedidos sem NF-e"
          valor={kpis ? numero(kpis.pedidosSemNotaFiscal) : '—'}
          tom={kpis && kpis.pedidosSemNotaFiscal > 0 ? 'ruim' : 'bom'}
        />
      </div>

      {/* Filtros - todos aplicados no servidor */}
      <Card>
        <CardCorpo className="flex flex-wrap items-center gap-3 py-3">
          <label className="flex items-center gap-2 text-legenda text-ceara-texto2">
            Criticidade
            <select
              value={criticidade}
              onChange={(e) => setCriticidade(e.target.value as Criticidade | '')}
              className="h-8 rounded-lg border border-ceara-borda bg-white px-2 text-corpo"
            >
              <option value="">Todas</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
              <option value="P4">P4</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-legenda text-ceara-texto2">
            Swimlane
            <select
              value={swimlane}
              onChange={(e) => setSwimlane(e.target.value as Swimlane | '')}
              className="h-8 rounded-lg border border-ceara-borda bg-white px-2 text-corpo"
            >
              <option value="">Sem agrupamento</option>
              <option value="CRITICIDADE">Criticidade</option>
              <option value="COMPRADOR">Comprador</option>
              <option value="CENTRO_CUSTO">Centro de custo</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-corpo">
            <input type="checkbox" checked={apenasMeus} onChange={(e) => setApenasMeus(e.target.checked)} />
            So os meus
          </label>

          <label className="flex items-center gap-2 text-corpo">
            <input type="checkbox" checked={apenasAtrasados} onChange={(e) => setApenasAtrasados(e.target.checked)} />
            So atrasados
          </label>

          {data?.raias && data.raias.length > 0 && (
            <span className="ml-auto flex flex-wrap gap-2">
              {data.raias.map((r) => (
                <span key={r.chave} className="rounded-full bg-ceara-nevoa px-2.5 py-0.5 text-legenda text-ceara-texto2">
                  {r.rotulo}: {r.totalLotes}
                </span>
              ))}
            </span>
          )}
        </CardCorpo>
      </Card>

      {erro && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-corpo text-ceara-vermelho">
          <AlertTriangle size={16} aria-hidden />
          {erro}
        </p>
      )}

      {isLoading && <p className="text-corpo text-ceara-texto2">Carregando painel...</p>}

      {data && (
        <DndContext sensors={sensores} onDragStart={aoIniciar} onDragEnd={aoSoltar}>
          <div className="flex flex-1 gap-3 overflow-x-auto pb-4">
            {data.colunas.map((coluna) => (
              <ColunaKanban
                key={coluna.status}
                coluna={coluna}
                // duplo clique abre o lote: e la que a cotacao, o mapa e o pedido acontecem
                onAbrirCard={(card) => navegar(`/compras/lotes/${card.id}`)}
                arrastando={Boolean(arrastando)}
                destinoValido={destinosValidos.includes(coluna.status)}
              />
            ))}
          </div>

          <DragOverlay>{arrastando && <div className="w-72"><CardLote card={arrastando} onAbrir={() => undefined} /></div>}</DragOverlay>
        </DndContext>
      )}

      <ModalConfirmacao
        aberto={pendente !== null}
        titulo={`Mover ${pendente?.card.numero ?? ''} para ${pendente?.rotuloDestino ?? ''}`}
        descricao="Este movimento fica registrado na trilha com o motivo informado."
        rotuloConfirmar="Mover"
        exigirMotivo
        destrutivo={pendente?.para === 'CANCELADO' || pendente?.para === 'REPROVADO'}
        onCancelar={() => setPendente(null)}
        onConfirmar={(motivo) => {
          if (pendente) mover.mutate({ loteId: pendente.card.id, para: pendente.para, motivo });
          setPendente(null);
        }}
      />
    </div>
  );
}

function Kpi({ rotulo, valor, tom = 'neutro' }: { rotulo: string; valor: string; tom?: 'bom' | 'ruim' | 'neutro' }) {
  return (
    <Card>
      <CardCorpo className="py-3">
        <p className="text-[11px] uppercase tracking-wide text-ceara-texto2">{rotulo}</p>
        <p
          className={cn(
            'mt-1 font-mono text-[20px] leading-none',
            tom === 'bom' && 'text-ceara-verde',
            tom === 'ruim' && 'text-ceara-vermelho',
            tom === 'neutro' && 'text-ceara-texto',
          )}
        >
          {valor}
        </p>
      </CardCorpo>
    </Card>
  );
}
