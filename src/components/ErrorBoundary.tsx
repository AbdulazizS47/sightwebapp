import { Component, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('Unhandled error caught by ErrorBoundary:', { error, info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p>Please refresh the page. If the problem persists, contact support.</p>
        </div>
      );
    }
    return this.props.children;
  }
}