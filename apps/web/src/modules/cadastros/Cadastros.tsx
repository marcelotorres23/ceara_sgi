import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { cn } from '../../design-system/cn';
import { useSessao } from '../auth/useSessao';
import { PaginaCadastro } from './PaginaCadastro';
import { Colaboradores } from './Colaboradores';
import { CADASTROS, type ChaveCadastro } from './definicoes';

const ORDEM: ChaveCadastro[] = ['veiculos', 'motoristas', 'rotas', 'itens', 'fornecedores', 'almoxarifados'];

/**
 * Colaboradores nao cabe no formato generico dos demais cadastros, e por isso tem tela
 * propria: o formulario declarativo monta campos de texto, e foto e outro fluxo.
 */
const ABAS_PROPRIAS = [
  { chave: 'colaboradores', titulo: 'Colaboradores', permissao: 'colaborador:consultar', Tela: Colaboradores },
] as const;

/**
 * Hub de cadastros. As abas seguem a permissao de LEITURA de cada recurso:
 * quem nao pode ver um cadastro nao ve a aba - e o servidor recusa de novo.
 */
export function Cadastros() {
  const permissoes = useSessao((s) => s.usuario?.permissoes ?? []);
  const visiveis = ORDEM.filter((c) => permissoes.includes(CADASTROS[c].permissaoLer));
  const proprias = ABAS_PROPRIAS.filter((a) => permissoes.includes(a.permissao));
  const primeira: string | null = visiveis[0] ?? proprias[0]?.chave ?? null;

  if (!primeira) {
    return (
      <div>
        <h1 className="text-h1 text-ceara-azul">Cadastros</h1>
        <p className="mt-2 text-corpo text-ceara-texto2">Seu perfil nao tem acesso a nenhum cadastro.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Cadastros" className="flex flex-wrap gap-1 border-b border-ceara-borda">
        {visiveis.map((chave) => (
          <NavLink
            key={chave}
            to={chave}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-corpo transition-colors',
                isActive
                  ? 'border-ceara-ouro font-medium text-ceara-azul'
                  : 'border-transparent text-ceara-texto2 hover:text-ceara-texto',
              )
            }
          >
            {CADASTROS[chave].titulo}
          </NavLink>
        ))}

        {proprias.map((a) => (
          <NavLink
            key={a.chave}
            to={a.chave}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-corpo transition-colors',
                isActive
                  ? 'border-ceara-ouro font-medium text-ceara-azul'
                  : 'border-transparent text-ceara-texto2 hover:text-ceara-texto',
              )
            }
          >
            {a.titulo}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<Navigate to={primeira} replace />} />
        {visiveis.map((chave) => (
          <Route key={chave} path={chave} element={<PaginaCadastro definicao={CADASTROS[chave]} />} />
        ))}
        {proprias.map((a) => (
          <Route key={a.chave} path={a.chave} element={<a.Tela />} />
        ))}
        <Route path="*" element={<Navigate to={primeira} replace />} />
      </Routes>
    </div>
  );
}
