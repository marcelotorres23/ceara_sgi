import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../design-system/components/Button';
import { Input } from '../../design-system/components/Input';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { useSessao, type Unidade } from './useSessao';
import { ApiError } from '../../lib/api';

export function LoginPage() {
  const entrar = useSessao((s) => s.entrar);
  const navegar = useNavigate();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Segundo passo: quem alcanca mais de uma unidade precisa dizer qual vai operar (secao 5.6).
  const [unidades, setUnidades] = useState<Unidade[] | null>(null);
  const [unidadeId, setUnidadeId] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const pendentes = await entrar(login.trim(), senha, unidadeId || undefined);
      if (pendentes) {
        setUnidades(pendentes);
        setUnidadeId(pendentes[0]?.id ?? '');
        return;
      }
      navegar('/', { replace: true });
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha de comunicacao com o servidor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* 30% azul: estrutura. Capa cheia com a marca. */}
      <section className="hidden flex-col justify-between bg-ceara-fundo p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="inline-block h-8 w-1.5 rounded bg-ceara-ouro" aria-hidden />
          <span className="font-display text-h2 tracking-wide">CEARA ALIMENTOS</span>
        </div>
        <div>
          <p className="font-display text-[32px] leading-tight">SGI Ceara</p>
          <p className="mt-2 max-w-sm text-corpo text-white/80">
            Suprimentos, Transporte, Almoxarifado e Pessoas em um unico fluxo, com trilha completa.
          </p>
        </div>
        <p className="text-legenda italic text-white/70">Distribuindo Qualidade</p>
      </section>

      {/* 60% branco: respiro */}
      <section className="flex items-center justify-center bg-white p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
          <h1 className="text-h1 text-ceara-azul">Acesso ao sistema</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">Use o mesmo usuario e senha do WinThor.</p>

          <div className="mt-6 flex flex-col gap-4">
            <Input
              rotulo="Usuario"
              name="login"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Usuario do WinThor"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
            <Input
              rotulo="Senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />

            {unidades && (
              <Campo
                rotulo="Unidade em operacao"
                htmlFor="unidade"
                obrigatorio
                ajuda="Tudo que voce registrar nesta sessao fica vinculado a esta unidade."
              >
                <select
                  id="unidade"
                  name="unidade"
                  required
                  className={classeControle()}
                  value={unidadeId}
                  onChange={(e) => setUnidadeId(e.target.value)}
                >
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.codigo} · {u.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
          </div>

          {erro && (
            <p role="alert" className="mt-4 rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-corpo text-ceara-vermelho">
              {erro}
            </p>
          )}

          <Button type="submit" carregando={enviando} className="mt-6 w-full">
            {unidades ? 'Entrar na unidade' : 'Entrar'}
          </Button>

          <p className="mt-6 text-legenda italic text-ceara-texto2">
            Esqueceu a senha? A redefinicao e feita no WinThor. Conta sem WinThor entra com o e-mail.
          </p>
        </form>
      </section>
    </main>
  );
}
