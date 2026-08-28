import { ApplicationStyle, ModuleProfile, ModuleSurface } from "../types";

/** The fourth wizard choice is a deliberate escape hatch for unusual mixes. */
export type ModuleProfileChoice = ModuleProfile | "advanced";

export interface ModuleArchitectureChoice {
  moduleSurface: ModuleSurface;
  applicationStyle: ApplicationStyle;
}

export function moduleProfileFor(
  moduleSurface: ModuleSurface,
  applicationStyle: ApplicationStyle
): ModuleProfileChoice {
  if (moduleSurface === "minimal" && applicationStyle === "service") return "lean";
  if (moduleSurface === "crud" && applicationStyle === "service") return "crud";
  if (moduleSurface === "minimal" && applicationStyle === "cqrs") return "cqrs";
  return "advanced";
}

export function architectureForModuleProfile(profile: ModuleProfile): ModuleArchitectureChoice {
  if (profile === "crud") {
    return { moduleSurface: "crud", applicationStyle: "service" };
  }
  if (profile === "cqrs") {
    return { moduleSurface: "minimal", applicationStyle: "cqrs" };
  }
  return { moduleSurface: "minimal", applicationStyle: "service" };
}

export function describeModuleProfile(profile: ModuleProfileChoice): string {
  if (profile === "lean") return "Lean (minimal + service)";
  if (profile === "crud") return "CRUD (CRUD surface + service)";
  if (profile === "cqrs") return "CQRS (minimal surface + CQRS)";
  return "Advanced (choose surface + application boundary)";
}
