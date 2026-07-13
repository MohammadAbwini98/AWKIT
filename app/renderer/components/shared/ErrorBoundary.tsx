import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label for the area being guarded (shown in the fallback + logs). */
  area?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: string;
}

/**
 * Renderer crash guard. Without this, any exception thrown during a React render
 * unmounts the whole tree and the Electron window goes blank (the reported
 * "white screen"). This catches the error, keeps the app shell usable, shows a
 * readable fallback with the message + stack, and lets the user retry (re-mount)
 * or reload the window instead of being stuck on an empty page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the devtools console (and any main-process log forwarding) so the
    // crash is diagnosable rather than silent.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.area ? ` · ${this.props.area}` : ""}]`, error, info.componentStack);
    this.setState({ info: info.componentStack ?? "" });
  }

  private handleRetry = (): void => {
    this.setState({ error: null, info: "" });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h2>Something went wrong on this screen</h2>
          <p>
            The {this.props.area ?? "view"} hit an unexpected error. Your data is safe — nothing was saved. You can try
            again, or reload the window.
          </p>
          <pre className="error-boundary-detail">{error.message}{info ? `\n${info}` : ""}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="toolbar-button primary" onClick={this.handleRetry}>
              Try again
            </button>
            <button type="button" className="toolbar-button" onClick={this.handleReload}>
              Reload window
            </button>
          </div>
        </div>
      </div>
    );
  }
}
