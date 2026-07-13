import type { McpServer } from "../domain/types.js";
import { ociHandler } from "./oci-client.js";

export type HandlerContext = {
  correlationId: string;
  server: McpServer;
  logger: { info: (obj: object, msg?: string) => void | Promise<void>; error: (obj: object, msg?: string) => void | Promise<void> };
};

export type KcmlHandler = {
  key: string;
  version: string;
  invoke(input: unknown, ctx: HandlerContext): Promise<unknown>;
};

export function getHandler(server: McpServer): KcmlHandler | null {
  if (server.runtimeSocket && server.imageDigest) return ociHandler();
  return null;
}
