import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg,#111)] text-[var(--text-primary,#e5e5e5)]">
        <div className="max-w-md w-full mx-4 text-center">
          <h1 className="text-[17px] font-semibold mb-2">
            Something went wrong
          </h1>
          <p className="text-[13px] text-[var(--text-secondary,#999)] mb-1">
            {this.state.error?.message}
          </p>
          <pre className="text-[11px] text-[var(--text-secondary,#999)] mb-6 max-h-24 overflow-auto whitespace-pre-wrap break-all">
            {this.state.error?.stack
              ?.split("\n")
              .slice(1, 4)
              .join("\n")}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            className="px-4 py-2 rounded-md text-[13px] bg-[var(--surface,#222)] border border-[var(--border,#333)] hover:bg-[var(--surface-hover,#2a2a2a)] transition-colors duration-quick"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
