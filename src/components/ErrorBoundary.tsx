import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<{ children?: React.ReactNode }, State> {
  // Declare state as a class field so TypeScript resolves it correctly
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-100">
          <div className="rounded-full bg-red-500/10 p-4 text-red-500">
            <AlertTriangle className="h-10 w-10" />
          </div>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-zinc-500">{this.state.error?.message ?? 'An unexpected error occurred.'}</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
