interface Closable {
  close(): Promise<unknown>;
}

interface SignalSource {
  once(signal: "SIGTERM" | "SIGINT", handler: () => void): unknown;
  removeListener?(signal: "SIGTERM" | "SIGINT", handler: () => void): unknown;
}

export function registerShutdownHandlers(app: Closable, source: SignalSource = process) {
  let closing: Promise<unknown> | undefined;
  const close = () => { closing ??= app.close().catch(() => undefined); };
  source.once("SIGTERM", close);
  source.once("SIGINT", close);
  return () => {
    source.removeListener?.("SIGTERM", close);
    source.removeListener?.("SIGINT", close);
  };
}
