import { describe, expect, it } from "vitest";
import { onboardingHandoffText } from "./onboarding-handoff.js";

describe("onboarding handoff", () => {
  it("contains the current catalogs, external-or-repository storage rule and v2 revision flow", () => {
    const text = onboardingHandoffText({
      label: "Fakturační AI agent",
      descriptor: {
        summary: "Zpracování faktur",
        businessPurpose: "Automatizace fakturačního workflow",
        serviceOwner: "Finance Ops",
        technicalOwner: "Platform Engineering",
        criticality: "HIGH"
      },
      token: "kci_example",
      initialExpiresAt: "2026-07-23T14:00:00.000Z",
      programmerApiUrl: "https://register.hcasc.cz/v2/component-onboardings",
      intakeUrls: {
        recommendedIntakeUrl: "https://register.hcasc.cz/v2/component-onboardings",
        nativeComponentIntakeUrl: "https://register.hcasc.cz/v2/component-onboardings",
        componentCatalogUrl: "https://register.hcasc.cz/api/onboarding-catalogs/component/2026.07.22-compliance.1"
      },
      catalogVersion: "2026.07.22-compliance.1"
    });

    expect(text).toContain("Označení integračního toku: Fakturační AI agent");
    expect(text).toContain("Shrnutí prvku: Zpracování faktur");
    expect(text).toContain("Integrační token: kci_example");
    expect(text).toContain("repository-component-1.1.json");
    expect(text).toContain("Komponenta může být udržována externě");
    expect(text).toContain("components/<repository-key>/");
    expect(text).toContain("component.kcml.json, manifest.kcml.json");
    expect(text).toContain("nikoli zápis do GitHubu, merge, build, deploy");
    expect(text).toContain("/v2/component-onboardings");
    expect(text).toContain("build OCI image");
    expect(text).toContain("deploy receipt");
    expect(text).toContain("/revisions");
    expect(text).toContain("If-Match");
    expect(text).toContain("/readiness");
    expect(text).not.toContain("UPLOAD_REVISION");
  });

  it("uses fallback catalog and intake addresses when detailed URLs are absent", () => {
    const text = onboardingHandoffText({
      label: "Obecná integrace",
      descriptor: {
        summary: "Integrace prvku",
        businessPurpose: "Registrace aplikačního prvku",
        serviceOwner: "KCML",
        technicalOwner: "Platform Engineering",
        criticality: "HIGH"
      },
      token: "kci_generic",
      initialExpiresAt: "2026-07-24T14:00:00.000Z",
      programmerApiUrl: "https://register.hcasc.cz/v2/component-onboardings",
      catalogVersion: "2026.07.22-compliance.1"
    });

    expect(text).toContain("Doporučené programátorské API: https://register.hcasc.cz/v2/component-onboardings");
    expect(text).toContain("Kanonický component intake: https://register.hcasc.cz/v2/component-onboardings");
    expect(text).toContain("Kanonický component katalog: /api/onboarding-catalogs/component/2026.07.22-compliance.1");
  });
});
