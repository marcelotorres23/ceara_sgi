import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { EstadoVazio } from '../../design-system/components/Table';
import { Badge } from '../../design-system/components/Badge';
import { useSessao } from '../auth/useSessao';

/**
 * Shell do painel. Os KPIs ao vivo entram em F2 (Kanban) e F9 (BI) -
 * aqui ficam apenas os cartoes de estrutura, sem numero inventado.
 */
export function PainelInicial() {
  const usuario = useSessao((s) => s.usuario);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-h1 text-ceara-azul">Painel</h1>
        <p className="text-legenda italic text-ceara-texto2">
          Perfis ativos: {usuario?.perfis.join(', ') || 'nenhum'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { titulo: 'Lotes em aberto', modulo: 'Compras', fase: 'F2' },
          { titulo: 'Itens vencidos no patio', modulo: 'Frota', fase: 'F14' },
          { titulo: 'Itens abaixo do minimo', modulo: 'Almoxarifado', fase: 'F4' },
          { titulo: 'Pontuacao do setor', modulo: 'Pessoas', fase: 'F8' },
        ].map((k) => (
          <Card key={k.titulo}>
            <CardCorpo className="pt-4">
              <p className="text-h3 text-ceara-texto">{k.titulo}</p>
              <p className="mt-2 font-mono text-[28px] leading-none text-ceara-texto2">—</p>
              <div className="mt-3 flex items-center gap-2">
                <Badge tom="azul">{k.modulo}</Badge>
                <Badge tom="neutro">{k.fase}</Badge>
              </div>
            </CardCorpo>
          </Card>
        ))}
      </div>

      <Card destaque="regra">
        <CardTitulo>Regras de ouro</CardTitulo>
        <CardCorpo>
          <ol className="list-decimal space-y-1 pl-5 text-corpo">
            <li>Pedido que nao esta no sistema nao existe.</li>
            <li>Nada se exclui — cancela-se com motivo, notificacao e trilha preservada.</li>
            <li>Escolha divergente do menor preco exige justificativa registrada.</li>
            <li>Nenhum titulo vai para contas a pagar sem aceite de recebimento vinculado ao pedido.</li>
            <li>Quem solicita nao cota; quem cota nao aprova; quem aprova nao recebe.</li>
          </ol>
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>Atividades</CardTitulo>
        <CardCorpo>
          <EstadoVazio
            titulo="Nenhuma atividade atribuida a voce"
            descricao="O painel operacional entra em producao na fase F2."
          />
        </CardCorpo>
      </Card>
    </div>
  );
}
