import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  erro: Error | null;
}

/**
 * Sem isso, um erro nao tratado em qualquer lugar da arvore de componentes
 * derruba o app inteiro e o React so mostra uma tela em branco (sem
 * explicacao nenhuma pro usuario). Aqui pelo menos aparece o que quebrou e
 * um jeito de voltar, em vez de branco puro.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error("Erro nao tratado no Gerador de Croqui:", erro, info.componentStack);
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="upload-view">
          <header className="upload-header">
            <p className="eyebrow">Ops</p>
            <h1>Algo quebrou aqui</h1>
            <p className="subtitulo">
              {this.state.erro.message || "Erro desconhecido."} — os dados salvos não foram perdidos.
            </p>
          </header>
          <button type="button" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
