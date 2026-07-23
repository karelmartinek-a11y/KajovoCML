export type HandlerExecutionMode = "REQUEST_RESPONSE" | "LONG_RUNNING";
export type HandlerLifecycleMode = "PREPARE" | "ACTIVE" | "DRAINING" | "STOPPED";

export type RuntimeReadyReport = {
  ready: boolean;
  status: string;
  dependencySummary?: Record<string, unknown>;
};

export type RuntimeApi = {
  currentMode(): HandlerLifecycleMode;
  reportReady(input: RuntimeReadyReport): Promise<void>;
  reportState(input: Record<string, unknown>): Promise<void>;
  reportHeartbeat(input: Record<string, unknown>): Promise<void>;
};

export type HandlerContext = {
  logger: {
    info(fields: Record<string, unknown> | undefined, message: string): void;
    error(fields: Record<string, unknown> | undefined, message: string): void;
  };
  egress: {
    fetch(url: string | URL, init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Record<string, unknown> | null;
    }): Promise<{
      status: number;
      ok: boolean;
      headers: Record<string, string>;
      text(): Promise<string>;
      json(): Promise<unknown>;
      bytes(): Promise<Uint8Array>;
    }>;
    connectTls(input: {
      host: string;
      port: number;
      servername: string;
      protocol?: "TCP_TLS";
    }): Promise<NodeJS.ReadWriteStream>;
  };
  secrets: {
    get(name: string): Promise<unknown>;
  };
  storage: {
    dataPath: string;
  };
  runtime: RuntimeApi;
};

export type ComponentModule<TInput = unknown, TOutput = unknown> = {
  start?(context: HandlerContext): Promise<void>;
  stop?(context: HandlerContext): Promise<void>;
  invoke(input: TInput, context: HandlerContext): Promise<TOutput>;
};

export function defineComponent<TInput = unknown, TOutput = unknown>(
  module: ComponentModule<TInput, TOutput>
): ComponentModule<TInput, TOutput> {
  return module;
}
