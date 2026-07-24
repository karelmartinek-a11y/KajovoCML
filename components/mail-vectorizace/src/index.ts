import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Duplex } from "node:stream";
import { convert } from "html-to-text";
import { simpleParser } from "mailparser";
import { z } from "zod";

type RuntimeMode = "PREPARE" | "ACTIVE" | "DRAINING" | "STOPPED";

type RuntimeContext = {
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
      text(): Promise<string>;
    }>;
    connectTls(input: {
      host: string;
      port: number;
      servername: string;
      protocol?: "TCP_TLS";
    }): Promise<Duplex>;
  };
  secrets: {
    get(name: string): Promise<unknown>;
  };
  storage: {
    dataPath: string;
  };
  runtime: {
    currentMode(): RuntimeMode;
    reportReady(input: {
      ready: boolean;
      status: string;
      dependencySummary?: Record<string, unknown>;
    }): Promise<void>;
    reportState(input: Record<string, unknown>): Promise<void>;
    reportHeartbeat(input: Record<string, unknown>): Promise<void>;
  };
};

type StoredMailMetadata = {
  messageId: string;
  subject: string;
  receivedAt: string;
  normalizedText: string;
};

type DependencySummary = {
  dataPath: string;
  mailSecretStatus: "available" | "pending";
  vectorSecretStatus: "available" | "pending";
  mode: RuntimeMode;
  pendingReason?: string;
  imapTlsValidated?: boolean;
};

const inputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional()
});

const imapHost = "imap.hotelchodovas.cz";
let database: DatabaseSync | null = null;

function databasePath(context: RuntimeContext): string {
  return join(context.storage.dataPath, "mail-vectorizace.sqlite");
}

function openDatabase(context: RuntimeContext): DatabaseSync {
  if (database) return database;
  mkdirSync(context.storage.dataPath, { recursive: true });
  database = new DatabaseSync(databasePath(context));
  database.exec(`
    create table if not exists mail_metadata (
      message_id text primary key,
      subject text not null,
      received_at text not null,
      normalized_text text not null
    );
    create table if not exists sync_checkpoint (
      mailbox text primary key,
      last_uid integer not null default 0,
      updated_at text not null
    );
  `);
  return database;
}

async function validateDependencies(context: RuntimeContext): Promise<Record<string, unknown>> {
  const summary: DependencySummary = {
    dataPath: context.storage.dataPath,
    mailSecretStatus: "pending",
    vectorSecretStatus: "pending",
    mode: context.runtime.currentMode()
  };
  try {
    const mailPassword = await context.secrets.get("MAIL_RECEPCE_PASS");
    const vectorApiKey = await context.secrets.get("API_KEY_VECTOR");
    summary.mailSecretStatus = mailPassword ? "available" : "pending";
    summary.vectorSecretStatus = vectorApiKey ? "available" : "pending";
  } catch (error) {
    const code = error instanceof Error ? error.message : "secret_unavailable";
    if (["secret_unavailable", "secret_broker_not_configured", "secret_timeout"].includes(code)) {
      summary.pendingReason = code;
      return summary;
    }
    throw error;
  }
  if (summary.mailSecretStatus === "available" && summary.vectorSecretStatus === "available" && context.runtime.currentMode() === "ACTIVE") {
    const socket = await context.egress.connectTls({
      host: imapHost,
      port: 993,
      servername: imapHost,
      protocol: "TCP_TLS"
    });
    socket.destroy();
    summary.imapTlsValidated = true;
  }
  return summary;
}

function readStoredMailMetadata(context: RuntimeContext, limit: number): StoredMailMetadata[] {
  const db = openDatabase(context);
  const rows = db.prepare(`
    select message_id as messageId, subject, received_at as receivedAt, normalized_text as normalizedText
    from mail_metadata
    order by received_at desc
    limit ?
  `).all(limit) as StoredMailMetadata[];
  return rows;
}

export async function normalizeMail(rawMessage: string): Promise<StoredMailMetadata> {
  const parsed = await simpleParser(rawMessage);
  const normalizedText = convert(parsed.html ? String(parsed.html) : parsed.text ?? "", {
    wordwrap: false,
    selectors: [{ selector: "a", options: { ignoreHref: true } }]
  }).trim();
  return {
    messageId: parsed.messageId ?? "missing-message-id",
    subject: parsed.subject ?? "",
    receivedAt: (parsed.date ?? new Date(0)).toISOString(),
    normalizedText
  };
}

export async function start(context: RuntimeContext): Promise<void> {
  openDatabase(context);
  const dependencySummary = await validateDependencies(context);
  const waitingForSecrets = dependencySummary.mailSecretStatus !== "available" || dependencySummary.vectorSecretStatus !== "available";
  await context.runtime.reportState({
    phase: context.runtime.currentMode().toLowerCase(),
    databasePath: databasePath(context),
    imapHost,
    mailbox: "recepce@hotelchodovas.cz",
    waitingForSecrets
  });
  await context.runtime.reportHeartbeat({
    phase: "started",
    mailbox: "recepce@hotelchodovas.cz"
  });
  await context.runtime.reportReady({
    ready: true,
    status: waitingForSecrets
      ? "WAITING_FOR_RUNTIME_SECRETS"
      : context.runtime.currentMode() === "PREPARE" ? "PREPARED" : "READY",
    dependencySummary
  });
}

export async function stop(context: RuntimeContext): Promise<void> {
  await context.runtime.reportState({
    phase: "stopped",
    mailbox: "recepce@hotelchodovas.cz"
  });
  database?.close();
  database = null;
}

export async function invoke(input: unknown, context: RuntimeContext): Promise<{ items: StoredMailMetadata[] }> {
  const parsed = inputSchema.parse(input ?? {});
  const limit = parsed.limit ?? 25;
  context.logger.info({ limit }, "mail_vectorizace.list_stored_mail_metadata");
  return { items: readStoredMailMetadata(context, limit) };
}
