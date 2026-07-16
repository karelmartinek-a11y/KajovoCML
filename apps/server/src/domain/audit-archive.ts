import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { redact } from "../security/secrets.js";

type ClaimedArchiveEvent = { event_id: number; payload: unknown };

export async function archivePendingAuditEvents(db: Db, archivePath: string, batchSize = 500): Promise<number> {
  const leaseId = randomUUID();
  const claimed = await tx(db, async (client) => client.query<ClaimedArchiveEvent>(
    `with candidate as (
       select event_id
         from audit_archive_outbox
        where (state='PENDING' or (state='PROCESSING' and lease_expires_at<=now()))
          and next_attempt_at<=now()
        order by event_id
        limit $1
        for update skip locked
     )
     update audit_archive_outbox outbox
        set state='PROCESSING',lease_id=$2,lease_expires_at=now()+interval '2 minutes',
            attempt_count=attempt_count+1,updated_at=now()
       from candidate
      where outbox.event_id=candidate.event_id
      returning outbox.event_id,outbox.payload`,
    [batchSize, leaseId]
  ));
  if (!claimed.rowCount) return 0;
  try {
    await mkdir(path.dirname(archivePath), { recursive: true, mode: 0o700 });
    const body = claimed.rows
      .map((row) => JSON.stringify({ outboxEventId: Number(row.event_id), payload: redact(row.payload) }))
      .join("\n") + "\n";
    await appendFile(archivePath, body, { encoding: "utf8", mode: 0o600 });
    await db.query(
      `update audit_archive_outbox
          set state='ARCHIVED',archived_at=now(),lease_id=null,lease_expires_at=null,last_error=null,updated_at=now()
        where lease_id=$1 and state='PROCESSING'`,
      [leaseId]
    );
    return claimed.rowCount;
  } catch (error) {
    await db.query(
      `update audit_archive_outbox
          set state='PENDING',next_attempt_at=now()+least(interval '1 hour',interval '5 seconds'*power(2,least(attempt_count,10))),
              lease_id=null,lease_expires_at=null,last_error=$2,updated_at=now()
        where lease_id=$1 and state='PROCESSING'`,
      [leaseId, error instanceof Error ? error.message.slice(0, 500) : "archive_write_failed"]
    );
    throw error;
  }
}
