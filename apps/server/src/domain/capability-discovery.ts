import type pg from "pg";
import { createHash } from "node:crypto";

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> } | pg.Pool;

export type CapabilityCandidate = Readonly<{
  componentId: string; code: string; displayName: string; purpose: string; revisionId: string | null;
  revision: string | null; manifestDigest: string | null; capabilities: string[]; tools: Array<{ contractId: string; name: string; title: string; description: string; inputSchema: unknown; outputSchema: unknown; requiredScope: string; contractDigest: string }>;
  contractMatch: "CANDIDATE"; runtimeEligibility: "ELIGIBLE" | "INELIGIBLE"; eligibilityReasons: string[];
  enabled: boolean; lifecycleState: string; activationState: string; operationalState: string; ready: boolean; principalStatus: string; validationState: string | null;
}>;

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function canonical(value: unknown): string {
  const encoded = JSON.stringify(value, (_key: string, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item);
  return encoded ?? "null";
}
function contractDigest(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }

/** Read-only discovery over the canonical component/revision/tool contracts; no parallel registry. */
export async function lookupCmlCapabilities(db: Queryable, input: { requirement: string; keywords?: string[]; componentId?: string }): Promise<CapabilityCandidate[]> {
  const terms = [input.requirement, ...(input.keywords ?? [])].map((item) => item.trim()).filter(Boolean).slice(0, 20);
  const pattern = `%${terms.join(" ").replace(/[%_]/g, "\\$&")}%`;
  const result = await db.query(`
    select c.id,c.code,c.display_name,c.description,c.enabled,c.lifecycle_state,c.activation_state,c.operational_state,
           principal.status principal_status,r.id revision_id,r.revision,r.manifest_digest,r.capabilities,r.validation_state,
           coalesce(readiness.ready,false) ready,
           coalesce(jsonb_agg(jsonb_build_object('id',tool.id,'name',tool.name,'title',tool.title,'description',tool.description,'inputSchema',tool.input_schema,'outputSchema',tool.output_schema,'requiredScope',tool.scope_name)
             order by tool.name) filter (where tool.id is not null),'[]'::jsonb) tools
      from component c
      join principal on principal.id=c.principal_id
      left join component_revision r on r.id=c.active_revision_id
      left join component_current_readiness readiness on readiness.component_id=c.id
      left join component_tool_contract tool on tool.component_id=c.id and tool.revision_id=c.active_revision_id
     where c.lifecycle_state <> 'DEREGISTERED'
       and ($2::uuid is null or c.id=$2::uuid)
       and ($1::text = '%%' or concat_ws(' ',c.code,c.display_name,c.description,coalesce(array_to_string(r.capabilities,' '),'')) ilike $1 escape '\\'
            or exists (select 1 from component_tool_contract matching_tool where matching_tool.component_id=c.id and matching_tool.revision_id=c.active_revision_id
                      and concat_ws(' ',matching_tool.name,matching_tool.title,matching_tool.description) ilike $1 escape '\\'))
     group by c.id,c.code,c.display_name,c.description,c.enabled,c.lifecycle_state,c.activation_state,c.operational_state,principal.status,r.id,r.revision,r.manifest_digest,r.capabilities,r.validation_state,readiness.ready
     order by c.enabled desc, readiness.ready desc, c.updated_at desc
     limit 25`, [terms.length ? pattern : "%%", input.componentId ?? null]);
  return result.rows.map((row) => {
    const enabled = Boolean(row.enabled); const ready = Boolean(row.ready); const validationState = row.validation_state ? text(row.validation_state) : null;
    const lifecycleState = text(row.lifecycle_state); const activationState = text(row.activation_state); const operationalState = text(row.operational_state); const principalStatus = text(row.principal_status);
    const eligibilityReasons = [
      !row.revision_id && "no_active_revision", !enabled && "disabled", lifecycleState !== "ACTIVE" && `lifecycle_${lifecycleState || "unknown"}`,
      activationState !== "ACTIVE" && `activation_${activationState || "unknown"}`, operationalState !== "HEALTHY" && `operational_${operationalState || "unknown"}`,
      !ready && "readiness_not_pass", principalStatus !== "ACTIVE" && `principal_${principalStatus || "unknown"}`, validationState !== "APPROVED" && "active_revision_not_approved"
    ].filter((value): value is string => Boolean(value));
    return {
      componentId: text(row.id), code: text(row.code), displayName: text(row.display_name), purpose: text(row.description), revisionId: row.revision_id ? text(row.revision_id) : null,
      revision: row.revision ? text(row.revision) : null, manifestDigest: row.manifest_digest ? text(row.manifest_digest) : null,
      capabilities: strings(row.capabilities), tools: Array.isArray(row.tools) ? (row.tools as Array<Record<string, unknown>>).map((tool) => {
        const inputSchema = tool.inputSchema ?? {}; const outputSchema = tool.outputSchema ?? {}; const requiredScope = text(tool.requiredScope);
        return { contractId: text(tool.id), name: text(tool.name), title: text(tool.title), description: text(tool.description), inputSchema, outputSchema, requiredScope, contractDigest: contractDigest({ componentId: row.id, revisionId: row.revision_id, contractId: tool.id, name: tool.name, inputSchema, outputSchema, requiredScope }) };
      }) : [],
      contractMatch: "CANDIDATE", runtimeEligibility: eligibilityReasons.length ? "INELIGIBLE" : "ELIGIBLE", eligibilityReasons,
      enabled, lifecycleState, activationState, operationalState, ready, principalStatus, validationState
    };
  });
}

export async function readCmlCapabilityContract(db: Queryable, componentId: string): Promise<CapabilityCandidate | null> {
  const candidate = (await lookupCmlCapabilities(db, { requirement: "", componentId }))[0] ?? null;
  if (!candidate) return null;
  const contracts = await db.query(`select id,name,title,description,input_schema,output_schema,scope_name
    from component_tool_contract where component_id=$1 and revision_id=$2 order by name`, [componentId, candidate.revisionId]);
  return { ...candidate, tools: contracts.rows.map((row) => {
    const inputSchema = row.input_schema ?? {}; const outputSchema = row.output_schema ?? {}; const requiredScope = text(row.scope_name);
    return { contractId: text(row.id), name: text(row.name), title: text(row.title), description: text(row.description), inputSchema, outputSchema, requiredScope, contractDigest: contractDigest({ componentId, revisionId: candidate.revisionId, contractId: row.id, name: row.name, inputSchema, outputSchema, requiredScope }) };
  }) };
}
