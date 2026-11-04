import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Wrench } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda } from '../compras/tipos';
import { decimal, type ApoioDaOs, type OrdemServicoDetalhada } from './tipos';

type Natureza = 'PECA' | 'MAO_DE_OBRA';

/**
 * Lancamento de itens da OS (secao 8.2).
 *
 * Peca do catalogo sai do estoque na hora, por requisicao vinculada ao veiculo e a OS —
 * e o custo e o custo medio do almoxarifado, nao um valor digitado. Servico e mao de obra
 * entram pelo valor combinado. E a diferenca entre as duas naturezas que faz o custo por
 * ativo significar alguma coisa.
 */
export function ItensDaOs({ osId, aoFechar }: { osId: string; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [natureza, setNatureza] = useState<Natureza>('PECA');
  const [itemId, setItemId] = useState('');
  const [almoxarifadoId, setAlmoxarifadoId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [custoUnitario, setCusto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const os = useQuery({
    queryKey: ['frota', 'os', osId],
    queryFn: () => get<OrdemServicoDetalhada>(`/transporte/manutencao/ordens/${osId}`),
  });

  const apoio = useQuery({
    queryKey: ['frota', 'apoio-os'],
    queryFn: () => get<ApoioDaOs>('/transporte/manutencao/apoio'),
    staleTime: 300_000,
  });

  const adicionar = useMutation({
    mutationFn: () =>
      post(`/transporte/manutencao/ordens/${osId}/itens`, {
        descricao: natureza === 'PECA' ? descricaoDaPeca() : descricao,
        itemId: natureza === 'PECA' ? itemId : null,
        almoxarifadoId: natureza === 'PECA' ? almoxarifadoId : null,
        quantidade,
        custoUnitario: natureza === 'MAO_DE_OBRA' ? custoUnitario : null,
        maoDeObra: natureza === 'MAO_DE_OBRA',
      }),
    onSuccess: async () => {
      setErro(null);
      setItemId('');
      setDescricao('');
      setQuantidade('1');
      setCusto('');
      await cliente.invalidateQueries({ queryKey: ['frota', 'os', osId] });
      await cliente.invalidateQueries({ queryKey: ['manutencao'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao lancar o item.'),
  });

  function descricaoDaPeca(): string {
    const item = apoio.data?.itens.find((i) => i.id === itemId);
    return item ? `${item.codigo} - ${item.descricao}` : descricao;
  }

  const d = os.data;
  const encerrada = d?.status === 'CONCLUIDA' || d?.status === 'CANCELADA';

  const pronto =
    natureza === 'PECA'
      ? itemId !== '' && almoxarifadoId !== '' && Number(quantidade) > 0
      : descricao.trim().length >= 2 && Number(quantidade) > 0 && Number(custoUnitario) >= 0;

  return (
    <Card>
      <CardTitulo
        acao={
          <Button variante="texto" tamanho="sm" onClick={aoFechar}>
            Fechar
          </Button>
        }
      >
        Itens de {d?.numero ?? 'OS'} {d && `· ${d.veiculo.placa}`}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        {erro && (
          <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
            {erro}
          </p>
        )}

        {d && (
          <p className="text-legenda text-ceara-texto2">
            {d.descricao} · pecas {moeda(d.custoPecas)} · mao de obra {moeda(d.custoMaoObra)} ·{' '}
            <strong className="text-ceara-texto">total {moeda(d.custoTotal)}</strong>
          </p>
        )}

        {encerrada ? (
          <p className="rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto">
            OS encerrada nao aceita novos itens. Se algo ficou de fora, abra outra OS.
          </p>
        ) : (
          <div className="flex flex-col gap-4 rounded-card border border-ceara-borda p-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['PECA', 'Peca do estoque', Package],
                  ['MAO_DE_OBRA', 'Mao de obra ou servico', Wrench],
                ] as Array<[Natureza, string, typeof Package]>
              ).map(([chave, rotulo, Icone]) => (
                <button
                  key={chave}
                  type="button"
                  onClick={() => setNatureza(chave)}
                  aria-current={natureza === chave}
                  className={
                    natureza === chave
                      ? 'flex items-center gap-2 rounded-lg border border-ceara-azul bg-[var(--ceara-azul-10)] px-3 py-2 text-corpo font-medium text-ceara-azul'
                      : 'flex items-center gap-2 rounded-lg border border-ceara-borda px-3 py-2 text-corpo text-ceara-texto hover:border-ceara-azul'
                  }
                >
                  <Icone size={14} aria-hidden />
                  {rotulo}
                </button>
              ))}
            </div>

            {natureza === 'PECA' ? (
              <>
                <p className="text-legenda italic text-ceara-texto2">
                  A peca sai do estoque agora, por requisicao vinculada a esta OS e a placa. O custo e o custo medio
                  do almoxarifado — nao se digita preco de peca propria.
                </p>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_8rem]">
                  <Campo rotulo="Peca" htmlFor="item-peca" obrigatorio>
                    <select id="item-peca" className={classeControle()} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                      <option value="">Selecione</option>
                      {(apoio.data?.itens ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.codigo} — {i.descricao}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo rotulo="Almoxarifado" htmlFor="item-almox" obrigatorio>
                    <select id="item-almox" className={classeControle()} value={almoxarifadoId} onChange={(e) => setAlmoxarifadoId(e.target.value)}>
                      <option value="">Selecione</option>
                      {(apoio.data?.almoxarifados ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.codigo} — {a.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo rotulo="Quantidade" htmlFor="item-qtde" obrigatorio>
                    <input id="item-qtde" inputMode="decimal" className={classeControle()} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
                  </Campo>
                </div>
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_8rem_10rem]">
                <Campo rotulo="Descricao do servico" htmlFor="item-desc" obrigatorio>
                  <input id="item-desc" className={classeControle()} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
                </Campo>
                <Campo rotulo="Quantidade" htmlFor="item-qtde-mo" obrigatorio ajuda="Horas ou unidades.">
                  <input id="item-qtde-mo" inputMode="decimal" className={classeControle()} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
                </Campo>
                <Campo rotulo="Custo unitario" htmlFor="item-custo" obrigatorio>
                  <input id="item-custo" inputMode="decimal" className={classeControle()} value={custoUnitario} onChange={(e) => setCusto(e.target.value)} />
                </Campo>
              </div>
            )}

            <div className="flex justify-end">
              <Button disabled={!pronto} carregando={adicionar.isPending} onClick={() => adicionar.mutate()}>
                Lancar item
              </Button>
            </div>
          </div>
        )}

        {(d?.itens.length ?? 0) > 0 ? (
          <Table>
            <Thead>
              <Tr>
                <Th>Item</Th>
                <Th>Natureza</Th>
                <Th>Quantidade</Th>
                <Th>Custo</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(d?.itens ?? []).map((i) => (
                <Tr key={i.id}>
                  <Td>{i.descricao}</Td>
                  <Td>
                    <Badge tom={i.maoDeObra ? 'ouro' : 'azul'}>{i.maoDeObra ? 'mao de obra' : 'peca'}</Badge>
                  </Td>
                  <Td>{decimal(i.quantidade, 2)}</Td>
                  <Td>{moeda(i.custo)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : (
          <EstadoVazio
            titulo="Nenhum item lancado"
            descricao="Lance as pecas e os servicos desta OS — sem item ela nao conclui, porque nao alimentaria o custo do veiculo."
          />
        )}
      </CardCorpo>
    </Card>
  );
}
