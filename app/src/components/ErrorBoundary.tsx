import { Component, type ErrorInfo, type ReactNode } from "react";
import { GlassPanel } from "./ui";

interface Props {
  /** Changing the key (e.g. the route) resets the boundary. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps a failure in one view from blanking the whole dashboard. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("View failed to render:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <GlassPanel title="This view could not be displayed">
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          {this.state.error.message}. The other views still work. Reload the page to try again.
        </p>
      </GlassPanel>
    );
  }
}
