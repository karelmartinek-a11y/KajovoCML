import { formatDate } from "./ui-helpers.js";

const DEFAULT_REPOSITORY_COMPONENT_CATALOG_VERSION = "1.1";
const DEFAULT_REPOSITORY_COMPONENT_CATALOG_PATH = `docs/onboarding-catalogs/repository-component-${DEFAULT_REPOSITORY_COMPONENT_CATALOG_VERSION}.json`;

export type OnboardingHandoff = {
  label: string;
  descriptor: {
    summary: string;
    businessPurpose: string;
    serviceOwner: string;
    technicalOwner: string;
    criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };
  token: string;
  initialExpiresAt: string;
  programmerApiUrl: string;
  intakeUrls?: {
    recommendedIntakeUrl: string;
    nativeComponentIntakeUrl: string;
    componentCatalogUrl: string;
    repositoryComponentCatalogVersion: string;
    repositoryComponentCatalogPath: string;
    repositoryComponentCatalogFileName: string;
    secretApiDiscoveryUrl?: string;
  };
  catalogVersion: string;
  secretGrants?: Array<{
    secretStableName: string | null;
    allSecrets: boolean;
    transferredComponentPublicId?: string | null;
  }>;
};

export function onboardingHandoffText(handoff: OnboardingHandoff): string {
  const expiresAt = formatDate(handoff.initialExpiresAt);
  const intakeUrl = handoff.intakeUrls?.recommendedIntakeUrl ?? handoff.programmerApiUrl;
  const repositoryCatalogPath = handoff.intakeUrls?.repositoryComponentCatalogPath ?? DEFAULT_REPOSITORY_COMPONENT_CATALOG_PATH;
  const repositoryCatalogVersion = handoff.intakeUrls?.repositoryComponentCatalogVersion ?? DEFAULT_REPOSITORY_COMPONENT_CATALOG_VERSION;
  const secretGrantSummary = handoff.secretGrants?.length
    ? handoff.secretGrants.map((grant) => grant.allSecrets ? "ALL_SECRETS" : grant.secretStableName).join(", ")
    : "žádné";
  return [
    "Automatická integrace prvku do KajovoCML",
    "",
    `Označení integračního toku: ${handoff.label}`,
    `Shrnutí prvku: ${handoff.descriptor.summary}`,
    `Účel: ${handoff.descriptor.businessPurpose}`,
    `Vlastník služby: ${handoff.descriptor.serviceOwner}`,
    `Technický vlastník: ${handoff.descriptor.technicalOwner}`,
    `Kritičnost: ${handoff.descriptor.criticality}`,
    `Integrační token: ${handoff.token}`,
    `První registrační požadavek proveďte nejpozději do: ${expiresAt}`,
    `Doporučené programátorské API: ${intakeUrl}`,
    `Kanonický component intake: ${handoff.intakeUrls?.nativeComponentIntakeUrl ?? intakeUrl}`,
    `Kanonický component katalog: ${handoff.intakeUrls?.componentCatalogUrl ?? `/api/onboarding-catalogs/component/${handoff.catalogVersion}`}`,
    `Secret API discovery: ${handoff.intakeUrls?.secretApiDiscoveryUrl ?? "není dostupné"}`,
    `Zdrojový monorepo katalog: ${repositoryCatalogPath}`,
    `Přidělené secret grants: ${secretGrantSummary}`,
    "Komponenta může být udržována externě nebo přímo v KajovoCML.",
    "Pokud je udržována v KajovoCML, zdrojový kód patří výhradně do components/<repository-key>/; klíč adresáře není KCML identita.",
    "Požadovaná struktura zdrojového balíku: component.kcml.json, manifest.kcml.json, README.md, package.json, pnpm-lock.yaml, tsconfig.json, src/, evidence/.",
    "Rozsah tokenu: registrace jednoho libovolného prvku a čtení jen výslovně grantovaných KCML Secrets; token se spotřebuje až po úspěšném předání výsledného přístupového tokenu.",
    "Integrační token autorizuje registraci v KajovoCML a onboardingové čtení grantovaných secrets, nikoli zápis do GitHubu, merge, build, deploy ani administrátorská práva.",
    "",
    `Postupujte přesně podle component katalogu KajovoCML ${handoff.catalogVersion} a zdrojového katalogu repository-component-${repositoryCatalogVersion}.`,
    `Repository-component-${repositoryCatalogVersion} je aktuální testovací source katalog pro stavové i request-response repository komponenty v KajovoCML.`,
    "Životní cyklus je přesně tento: zdrojový kontrakt v manifest.kcml.json -> build OCI image -> produkční deploy receipt -> finalizovaný manifest uploadovaný přes /v2/component-onboardings.",
    "Codex připraví ve zdrojovém adresáři jen source-phase kontrakt. Image digest, image reference, runtime digest a produkční runtime location vznikají až po buildu a deployi a nesmí být nahrazeny placeholderem.",
    "Stav jobu načítejte přes GET /v2/component-onboardings/{id}. Při blokaci odešlete úplný opravený finální manifest na /revisions s aktuálním ETag v hlavičce If-Match; readiness spusťte přes /readiness.",
    "Za úspěšné dokončení lze považovat pouze stav, kdy registrace, revisions, readiness, secret handoff a access-token handoff doběhnou bez blokátorů a komponenta přejde automaticky do ACTIVE bez ručního zásahu administrátora."
  ].join("\n");
}
