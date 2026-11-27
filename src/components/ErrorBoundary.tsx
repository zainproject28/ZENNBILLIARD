import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected application error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#090a0d] text-zinc-100 flex items-center justify-center p-6">
          <div className="liquid-metal-border glass-panel max-w-md w-full rounded-2xl p-6 text-center space-y-4 shadow-2xl">
            <h1 className="font-display text-2xl font-extrabold text-zinc-100">ZENN BILLIARD</h1>
            <p className="text-sm text-zinc-400 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl neu-btn-gold font-semibold text-sm transition-colors"
            >
              Reload Table
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
