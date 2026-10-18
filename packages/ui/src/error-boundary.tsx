"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  /** Rendered instead of the children after a render error; `reset` clears the error and retries. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  /** When any entry changes (shallow, by Object.is) a failed boundary retries on its own. */
  resetKeys?: readonly unknown[];
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((item, index) => !Object.is(item, b[index]));
}

/**
 * Hand-written on purpose (no react-error-boundary dependency). Exists so one broken
 * plugin or panel shows a local fallback instead of unmounting the whole host tree.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    // Anything can be thrown; normalise so fallbacks can rely on `.message`.
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && keysChanged(previous.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
