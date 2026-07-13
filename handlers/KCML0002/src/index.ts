const CATALOG_URL = "https://ha-inventory.hcasc.cz/v1/catalog";

const DEFAULT_CONTEXT = {
  correlationId: "",
  logger: {
    info: (fields = {}, message = "") => { void fields; void message; },
    error: (fields = {}, message = "") => { void fields; void message; }
  },
  egress: {
    fetch: async (url = "", init = {}) => {
      void url;
      void init;
      return { ok: false, status: 500, json: async () => ({}) };
    }
  }
};

export const invoke = async (input = {}, context = DEFAULT_CONTEXT) => {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 0) {
    throw new Error("invalid_input");
  }
  context.logger.info({ operation: "list_home_assistant_devices" }, "catalog.requested");
  const response = await context.egress.fetch(CATALOG_URL, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-correlation-id": context.correlationId
    }
  });
  if (!response.ok) {
    context.logger.error({ operation: "list_home_assistant_devices", status: response.status }, "catalog.upstream_failed");
    throw new Error("home_assistant_catalog_upstream_failed");
  }
  const output = await response.json();
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("home_assistant_catalog_invalid_response");
  }
  if (Reflect.get(output, "schema") !== "ha_device_catalog.v3" || !Array.isArray(Reflect.get(output, "devices"))) {
    throw new Error("home_assistant_catalog_contract_mismatch");
  }
  return output;
};
