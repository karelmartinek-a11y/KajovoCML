function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeBaseDomain(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_PATTERN.test(normalized)) throw new Error("config_invalid_hostname");
  return normalized;
}

export function controlPlaneHostnames(baseDomain: string): { adminHost: string; authHost: string; registerHost: string } {
  const normalized = normalizeBaseDomain(baseDomain);
  return {
    adminHost: `admin.${normalized}`,
    authHost: `auth.${normalized}`,
    registerHost: `register.${normalized}`
  };
}

export function kcmlCodeFromNumber(number: number): string {
  return `KCML${String(number).padStart(4, "0")}`;
}

export function kcmlHostnameForCode(code: string, baseDomain: string): string {
  if (!/^KCML[0-9]{4,}$/i.test(code)) throw new Error("invalid_kcml_code");
  return `${code.toLowerCase()}.${normalizeBaseDomain(baseDomain)}`;
}

export function isKcmlHostname(hostname: string, baseDomain: string): boolean {
  return new RegExp(`^kcml[0-9]{4,}\\.${escapeRegex(normalizeBaseDomain(baseDomain))}$`, "i").test(hostname);
}

export function resourceForHostname(hostname: string): string {
  return `https://${hostname}/mcp`;
}
