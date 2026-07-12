import { z } from "zod";

const base64Secret = z.string().min(32).transform((value, ctx) => {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length < 32) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "secret must decode to at least 32 bytes" });
    return z.NEVER;
  }
  return decoded;
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_DOMAIN: z.string().default("hcasc.cz"),
  DATABASE_URL: z.string().min(1),
  ACCESS_TOKEN_HMAC_KEY_BASE64: base64Secret,
  ACCESS_TOKEN_HMAC_KEY_ID: z.string().min(1).default("v1"),
  SESSION_SECRET_BASE64: base64Secret,
  CSRF_SECRET_BASE64: base64Secret,
  MFA_ENCRYPTION_KEY_BASE64: base64Secret,
  ADMIN_TOTP_SECRET: z.string().min(16).optional(),
  ADMIN_HOST: z.string().default("admin.hcasc.cz"),
  AUTH_HOST: z.string().default("auth.hcasc.cz"),
  LOG_LEVEL: z.string().default("info")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
