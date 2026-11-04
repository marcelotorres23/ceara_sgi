import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * Sem isto, uma excecao em um unico card derruba o painel inteiro - inaceitavel
 * numa tela operacional. O erro fica contido na regiao e o resto segue utilizavel.
 */
interface Props {
  children: ReactNode;
  /** identifica a regiao na mensagem, ex.: "o painel" */
  regiao: string;
}

interface Estado {
  erro: Error | null;
}

export class LimiteDeErro extends Component<Props, Estado> {
  override state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`Falha em ${this.props.regiao}:`, erro, info.componentStack);
  }

  override render(): ReactNode {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div
        role="alert"
        className="rounded-card border border-ceara-borda border-l-4 border-l-ceara-vermelho bg-white p-5 shadow-card"
      >
        <h2 className="text-h2 text-ceara-vermelho">Nao foi possivel exibir {this.props.regiao}</h2>
        <p className="mt-2 text-corpo text-ceara-texto">
          Os dados nao foram alterados. Recarregue a tela; se persistir, informe o suporte com o horario da falha.
        </p>
        <p className="mt-2 font-mono text-legenda text-ceara-texto2">{erro.message}</p>
        <Button className="mt-4" onClick={() => this.setState({ erro: null })}>
          Tentar novamente
        </Button>
      </div>
    );
  }
}
