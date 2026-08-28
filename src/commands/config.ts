import pc from "picocolors";
import {
  moduleArchitectureForProfile,
  moduleProfileDescription,
  promptAdvancedModuleArchitecture,
  promptModuleProfile,
} from "../prompts/generate-wizard";
import { confirm } from "../prompts/interactive";
import { readConfig, writeConfig } from "../utils/config";
import { moduleProfileFor } from "../utils/module-profile";

/**
 * Interactive project-level defaults. Existing modules are not rewritten: the
 * wizard only controls what a future `generate module` receives when the user
 * chooses `--defaults` or accepts the generated-module prompt defaults.
 */
export async function configureProject(projectDir: string = process.cwd()): Promise<void> {
  const config = readConfig(projectDir);
  console.log("\nConfigure future generated modules:\n");

  const profile = await promptModuleProfile(
    moduleProfileFor(config.architecture.defaultModuleSurface, config.architecture.defaultApplicationStyle)
  );
  const { moduleSurface: defaultModuleSurface, applicationStyle: defaultApplicationStyle } =
    profile === "advanced"
      ? await promptAdvancedModuleArchitecture(
          config.architecture.defaultModuleSurface,
          config.architecture.defaultApplicationStyle
        )
      : moduleArchitectureForProfile(profile);

  console.log("\nSummary:");
  console.log(`  Default module profile: ${moduleProfileDescription(defaultModuleSurface, defaultApplicationStyle)}`);
  console.log(`  Default module surface: ${defaultModuleSurface}`);
  console.log(`  Default application style: ${defaultApplicationStyle}`);
  console.log("  Existing modules: unchanged");

  const proceed = await confirm({ message: "Save these project defaults?", default: true });
  if (!proceed) throw new Error("configuration cancelled");

  writeConfig(projectDir, {
    ...config,
    architecture: {
      ...config.architecture,
      defaultModuleSurface,
      defaultApplicationStyle,
    },
  });
  console.log(pc.green("\nupdated go-scaffold.config.json"));
}

export function showProjectConfig(projectDir: string = process.cwd()): void {
  console.log(JSON.stringify(readConfig(projectDir), null, 2));
}

export function validateProjectConfig(projectDir: string = process.cwd()): void {
  const config = readConfig(projectDir);
  console.log(pc.green(`valid go-scaffold.config.json (schema ${config.schemaVersion})`));
}
