import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { post, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { useSessao } from './useSessao';

/**
 * Troca obrigatoria da senha (secao 5.1).
 *
 * Aparece no lugar da aplicacao inteira enquanto `deveTrocarSenha` estiver marcado: senha
 * entregue por terceiro serve para entrar uma vez, nao para operar o sistema. Ao trocar,
 * todas as sessoes caem e a pessoa entra de novo — com a senha que so ela conhece.
 */
export function TrocarSenha({ obrigatoria = false, aoConcluir }: { obrigatoria?: boolean; aoConcluir?: () => void }) {
  const sair = useSessao((s) => s.sair);
  const usuario = useSessao((s) => s.usuario);
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function trocar() {
    setEnviando(true);
    try {
      await post('/auth/senha', { senhaAtual, senhaNova });
      setErro(null);
      setPronto(true);
      aoConcluir?.();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Nao foi possivel trocar a senha.');
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <div className="grid min-h-screen place-items-center bg-ceara-nevoa p-4">
        <Card className="w-full max-w-md">
          <CardCorpo className="flex flex-col gap-4 pt-6 text-center">
            <p className="text-h2 text-ceara-azul">Senha trocada</p>
            <p className="text-corpo text-ceara-texto2">
              Por seguranca, todas as sessoes foram encerradas. Entre novamente com a nova senha.
            </p>
            <Button onClick={() => void sair()}>Ir para o login</Button>
          </CardCorpo>
        </Card>
      </div>
    );
  }

  const confere = senhaNova.length > 0 && senhaNova === confirmacao;
  const podeEnviar = senhaAtual.length > 0 && confere;

  return (
    <div className="grid min-h-screen place-items-center bg-ceara-nevoa p-4">
      <Card className="w-full max-w-md" destaque={obrigatoria ? 'regra' : 'nenhum'}>
        <CardCorpo className="flex flex-col gap-4 pt-6">
          <div className="flex items-center gap-2">
            <KeyRound size={20} className="text-ceara-azul" aria-hidden />
            <h1 className="text-h2 text-ceara-azul">Trocar senha</h1>
          </div>

          {obrigatoria && (
            <p className="rounded-lg border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-3 py-2 text-corpo text-ceara-texto">
              Sua senha foi definida por outra pessoa. Escolha uma senha sua antes de continuar — enquanto isso, o
              sistema fica bloqueado.
            </p>
          )}

          {erro && (
            <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-corpo text-ceara-vermelho">
              {erro}
            </p>
          )}

          <Campo rotulo="Senha atual" htmlFor="senha-atual" obrigatorio>
            <input
              id="senha-atual"
              type="password"
              autoComplete="current-password"
              className={classeControle()}
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
            />
          </Campo>

          <Campo
            rotulo="Nova senha"
            htmlFor="senha-nova"
            obrigatorio
            ajuda="Ao menos 8 caracteres. Nao pode ser apenas o seu nome ou o seu e-mail."
          >
            <input
              id="senha-nova"
              type="password"
              autoComplete="new-password"
              className={classeControle()}
              value={senhaNova}
              onChange={(e) => setSenhaNova(e.target.value)}
            />
          </Campo>

          <Campo
            rotulo="Repita a nova senha"
            htmlFor="senha-confirmacao"
            obrigatorio
            erro={confirmacao.length > 0 && !confere ? 'As duas senhas nao conferem.' : null}
          >
            <input
              id="senha-confirmacao"
              type="password"
              autoComplete="new-password"
              className={classeControle(confirmacao.length > 0 && !confere)}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </Campo>

          <p className="text-legenda italic text-ceara-texto2">
            Entrando como {usuario?.email}. Trocar a senha encerra todas as sessoes abertas.
          </p>

          <div className="flex justify-between gap-2">
            <Button variante="texto" onClick={() => void sair()}>
              Sair
            </Button>
            <Button disabled={!podeEnviar} carregando={enviando} onClick={() => void trocar()}>
              Trocar senha
            </Button>
          </div>
        </CardCorpo>
      </Card>
    </div>
  );
}
