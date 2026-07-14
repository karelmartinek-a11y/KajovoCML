export type OnboardingHandoff = {
  note: string;
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
};

export function onboardingHandoffText(handoff: OnboardingHandoff): string {
  const expiresAt = new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Prague"
  }).format(new Date(handoff.initialExpiresAt));
  return [
    "Automatická integrace nového MCP serveru do KajovoMCPCML",
    "",
    `Poznámka k serveru: ${handoff.note}`,
    `Shrnutí serveru: ${handoff.descriptor.summary}`,
    `Účel: ${handoff.descriptor.businessPurpose}`,
    `Vlastník služby: ${handoff.descriptor.serviceOwner}`,
    `Technický vlastník: ${handoff.descriptor.technicalOwner}`,
    `Kritičnost: ${handoff.descriptor.criticality}`,
    `Integrační token: ${handoff.token}`,
    `První upload proveďte nejpozději do: ${expiresAt}`,
    `Programátorské API: ${handoff.programmerApiUrl}`,
    "",
    "Postupujte přesně podle přiloženého dokumentu Connect in Catalog v1.4.",
    "Po přijetí manifestu a zdrojového ZIPu systém sám přidělí KCML identitu a HTTPS adresu a spustí PR/CI, nasazení, autorizaci, logging, monitoring, testy a aktivaci.",
    "Stav jobu průběžně načítejte přes programátorské API. Pokud vrátí UPLOAD_REVISION, opravte uvedenou chybu a nahrajte novou revizi podle katalogu; opakujte až do COMPLETE / ACTIVE.",
    "Token nevkládejte do repozitáře, logu, ticketu ani screenshotu."
  ].join("\n");
}
