import { formatDate } from "./ui-helpers.js";

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
  };
  catalogVersion: string;
};

export function onboardingHandoffText(handoff: OnboardingHandoff): string {
  const expiresAt = formatDate(handoff.initialExpiresAt);
  const intakeUrl = handoff.intakeUrls?.recommendedIntakeUrl ?? handoff.programmerApiUrl;
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
    "Zdrojový monorepo katalog: docs/onboarding-catalogs/repository-component-1.1.json",
    "Komponenta může být udržována externě nebo přímo v KajovoCML.",
    "Pokud je udržována v KajovoCML, zdrojový kód patří výhradně do components/<repository-key>/; klíč adresáře není KCML identita.",
    "Požadovaná struktura zdrojového balíku: component.kcml.json, manifest.kcml.json, README.md, package.json, pnpm-lock.yaml, tsconfig.json, src/, evidence/.",
    "Rozsah tokenu: registrace jednoho libovolného prvku; token se spotřebuje až po úspěšném předání přístupového tokenu.",
    "Integrační token autorizuje registraci v KajovoCML, nikoli zápis do GitHubu, merge, build, deploy ani administrátorskou aktivaci.",
    "",
    `Postupujte přesně podle component katalogu KajovoCML ${handoff.catalogVersion} a zdrojového katalogu repository-component-1.1.`,
    "Životní cyklus je přesně tento: zdrojový kontrakt v manifest.kcml.json -> build OCI image -> produkční deploy receipt -> finalizovaný manifest uploadovaný přes /v2/component-onboardings.",
    "Codex připraví ve zdrojovém adresáři jen source-phase kontrakt. Image digest, image reference, runtime digest a produkční runtime location vznikají až po buildu a deployi a nesmí být nahrazeny placeholderem.",
    "Stav jobu načítejte přes GET /v2/component-onboardings/{id}. Při blokaci odešlete úplný opravený finální manifest na /revisions s aktuálním ETag v hlavičce If-Match; readiness spusťte přes /readiness.",
    "Za úspěšné dokončení lze považovat pouze stav, kdy registrace, revisions, readiness a access-token handoff doběhnou bez blokátorů a navazující administrátorská aktivace může bezpečně pokračovat."
  ].join("\n");
}
