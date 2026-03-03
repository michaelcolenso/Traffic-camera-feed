import React, { type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex min-h-screen flex-col items-center justify-center px-4 text-slate-100">
            <div className="glass-panel-strong max-w-lg rounded-3xl px-8 py-9 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-300/40 bg-rose-500/15 text-rose-300">
                <svg
                  className="h-8 w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h2 className="font-display text-lg tracking-[0.08em] text-slate-100">System error</h2>
              <p className="mt-1 text-sm text-slate-400">
                {this.state.error?.message || 'An unexpected runtime error occurred'}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-5 rounded-xl border border-cyan-300/50 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/20"
              >
                Reload interface
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
