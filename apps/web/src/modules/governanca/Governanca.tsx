import { useState } from 'react';
import { usePermissao } from '../auth/useSessao';
import { Alcadas } from './Alcadas';
import { Auditoria } from './Auditoria';
import { Parametros } from './Parametros';
import { PerfisEPermissoes } from './PerfisEPermissoes';
import { Usuarios } from './Usuarios';

type Aba = 'usuarios' | 'perfis' | 'alcadas' | 'parametros' | 'auditoria';

/**
 * Governanca (secoes 5.1 a 5.5).
 *
 * E aqui que se muda quem pode o que, quanto cada faixa aprova e como o sistema se
 * comporta — sem deploy. Cada mudanca passa por validacao no servidor e entra na trilha
 * de auditoria com valor anterior e novo: a governanca tambem responde por si mesma.
 */
export function Governanca() {
  const [erro, setErro] = useState<string | null>(null);

  const abas: Array<{ chave: Aba; rotulo: string; permitido: boolean }> = [
    { chave: 'usuarios', rotulo: 'Usuarios', permitido: usePermissao('usuario:listar') },
    { chave: 'perfis', rotulo: 'Perfis e permissoes', permitido: usePermissao('perfil:listar') },
    { chave: 'alcadas', rotulo: 'Alcadas', permitido: usePermissao('alcada:listar') },
    { chave: 'parametros', rotulo: 'Parametros', permitido: usePermissao('parametro:listar') },
    { chave: 'auditoria', rotulo: 'Auditoria', permitido: usePermissao('auditoria:consultar') },
  ];

  const visiveis = abas.filter((a) => a.permitido);
  const [aba, setAba] = useState<Aba>(visiveis[0]?.chave ?? 'usuarios');

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-h1 text-ceara-azul">Governanca</h1>
        <p className="mt-1 text-legenda italic text-ceara-texto2">
          Usuarios, perfis, alcadas e parametros — o que muda o comportamento do sistema sem deploy. Toda alteracao
          entra na trilha de auditoria com valor anterior e novo.
        </p>
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {visiveis.length === 0 ? (
        <p className="text-corpo text-ceara-texto2">Seu perfil nao alcanca nenhuma area da governanca.</p>
      ) : (
        <>
          <nav className="flex flex-wrap gap-1 border-b border-ceara-borda" aria-label="Areas da governanca">
            {visiveis.map(({ chave, rotulo }) => (
              <button
                key={chave}
                type="button"
                onClick={() => {
                  setAba(chave);
                  setErro(null);
                }}
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

          {aba === 'usuarios' && <Usuarios aoErrar={setErro} />}
          {aba === 'perfis' && <PerfisEPermissoes aoErrar={setErro} />}
          {aba === 'alcadas' && <Alcadas aoErrar={setErro} />}
          {aba === 'parametros' && <Parametros aoErrar={setErro} />}
          {aba === 'auditoria' && <Auditoria />}
        </>
      )}
    </div>
  );
}
