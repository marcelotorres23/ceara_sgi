import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { get } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { dataHoraBr, type Integridade, type RegistroDeAuditoria } from './tipos';

/**
 * Trilha de auditoria (secao 5.4).
 *
 * Cada registro encadeia o hash do anterior: alterar uma linha no banco quebra a cadeia
 * a partir dela, e a verificacao aponta onde. E o que separa registro de anotacao.
 */
export function Auditoria() {
  const [expandido, setExpandido] = useState<string | null>(null);

  const trilha = useQuery({
    queryKey: ['governanca', 'auditoria'],
    queryFn: () => get<{ itens: RegistroDeAuditoria[] }>('/auditoria?limite=100'),
  });

  const integridade = useQuery({
    queryKey: ['governanca', 'integridade'],
    queryFn: () => get<Integridade>('/auditoria/integridade'),
  });

  const itens = trilha.data?.itens ?? [];

  return (
    <div className="flex flex-col gap-5">
      {integridade.data && (
        <Card destaque={integridade.data.integro ? 'ok' : 'risco'}>
          <CardCorpo className="flex items-start gap-3 pt-4">
            {integridade.data.integro ? (
              <ShieldCheck size={20} className="mt-0.5 text-ceara-verde" aria-hidden />
            ) : (
              <ShieldAlert size={20} className="mt-0.5 text-ceara-vermelho" aria-hidden />
            )}
            <div>
              <p className="text-corpo font-medium text-ceara-texto">
                {integridade.data.integro
                  ? 'Cadeia de hash intacta.'
                  : 'Cadeia de hash quebrada — algum registro foi alterado fora do sistema.'}
              </p>
              <p className="text-legenda text-ceara-texto2">
                {integridade.data.integro
                  ? 'Cada registro encadeia o anterior, e a verificacao percorreu todos sem divergencia.'
                  : `A quebra comeca no registro ${integridade.data.quebraNoId}. Deste ponto em diante a trilha nao serve como prova.`}
              </p>
            </div>
          </CardCorpo>
        </Card>
      )}

      <Card>
        <CardTitulo
          acao={
            <Button
              tamanho="sm"
              variante="secundario"
              carregando={integridade.isFetching}
              onClick={() => void integridade.refetch()}
            >
              Verificar de novo
            </Button>
          }
        >
          Trilha de auditoria
        </CardTitulo>
        <CardCorpo>
          {itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Quando</Th>
                  <Th>Quem</Th>
                  <Th>Entidade</Th>
                  <Th>Acao</Th>
                  <Th>IP</Th>
                  <Th>Detalhe</Th>
                </Tr>
              </Thead>
              <Tbody>
                {itens.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">{dataHoraBr(r.timestamp)}</Td>
                    <Td>{r.usuario?.nome ?? 'sistema'}</Td>
                    <Td className="font-mono text-legenda">{r.entidade}</Td>
                    <Td>
                      <Badge tom={r.acao.startsWith('DECIDIR') || r.acao.includes('INATIV') ? 'ouro' : 'azul'}>
                        {r.acao.toLowerCase().replaceAll('_', ' ')}
                      </Badge>
                    </Td>
                    <Td className="font-mono text-legenda">{r.ip ?? '—'}</Td>
                    <Td>
                      <button
                        type="button"
                        className="text-ceara-azul hover:underline"
                        onClick={() => setExpandido(expandido === r.id ? null : r.id)}
                        aria-expanded={expandido === r.id}
                      >
                        {expandido === r.id ? 'ocultar' : 'ver'}
                      </button>
                      {expandido === r.id && (
                        <pre className="mt-2 max-w-[28rem] overflow-x-auto rounded bg-ceara-nevoa p-2 text-[11px]">
                          {JSON.stringify({ anterior: r.valorAnterior, novo: r.valorNovo, hash: r.hash }, null, 2)}
                        </pre>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio titulo="Trilha vazia" descricao="Nenhum registro de auditoria ainda." />
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}
