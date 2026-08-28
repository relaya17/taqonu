#!/usr/bin/env tsx
/**
 * SBOM (Software Bill of Materials) Generator
 *
 * Generates a CycloneDX 1.5 SBOM for the Atlas monorepo.
 * Scans all package.json files and produces:
 *   - sbom.json (CycloneDX JSON)
 *   - sbom.xml (CycloneDX XML)
 *
 * Usage: pnpm sbom:generate
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

interface PackageJson {
  name: string;
  version?: string;
  description?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface SbomComponent {
  type: "library" | "application" | "framework";
  "bom-ref": string;
  name: string;
  version: string;
  description?: string;
  licenses?: Array<{ license: { id?: string; name?: string } }>;
  purl?: string;
  hashes?: Array<{ alg: string; content: string }>;
  scope?: "required" | "optional" | "excluded";
}

interface SbomDependency {
  ref: string;
  dependsOn: string[];
}

interface CycloneDxBom {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: Array<{ vendor: string; name: string; version: string }>;
    component: {
      type: "application";
      name: string;
      version: string;
      description?: string;
    };
  };
  components: SbomComponent[];
  dependencies: SbomDependency[];
}

function findPackageJsonFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findPackageJsonFiles(full, files);
    } else if (entry === "package.json") {
      files.push(full);
    }
  }
  return files;
}

function parseVersion(spec: string): string {
  const clean = spec.replace(/^[~^>=<]+/, "").split(" ")[0];
  if (clean.startsWith("workspace:")) return "workspace";
  return clean || "0.0.0";
}

function makePurl(name: string, version: string): string {
  if (!name) return `pkg:npm/unknown@${version}`;
  const cleanName = name.startsWith("@")
    ? name.replace("@", "%40").replace("/", "%2F")
    : name;
  return `pkg:npm/${cleanName}@${version}`;
}

function makeBomRef(name: string, version: string): string {
  if (!name) return `pkg:npm/unknown@${version}`;
  return `pkg:npm/${name.replace("@", "").replace("/", "-")}@${version}`;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function generateUuid(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function collectDependencies(
  deps: Record<string, string> | undefined,
  scope: "required" | "optional",
  components: Map<string, SbomComponent>,
): string[] {
  if (!deps) return [];
  const refs: string[] = [];
  for (const [name, spec] of Object.entries(deps)) {
    const version = parseVersion(spec);
    const bomRef = makeBomRef(name, version);
    refs.push(bomRef);
    if (!components.has(bomRef)) {
      components.set(bomRef, {
        type: "library",
        "bom-ref": bomRef,
        name,
        version,
        purl: makePurl(name, version),
        scope,
      });
    }
  }
  return refs;
}

function toXml(bom: CycloneDxBom): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5"
     serialNumber="${escape(bom.serialNumber)}"
     version="${bom.version}">
  <metadata>
    <timestamp>${escape(bom.metadata.timestamp)}</timestamp>
    <tools>
`;
  for (const tool of bom.metadata.tools) {
    xml += `      <tool>
        <vendor>${escape(tool.vendor)}</vendor>
        <name>${escape(tool.name)}</name>
        <version>${escape(tool.version)}</version>
      </tool>
`;
  }
  xml += `    </tools>
    <component type="${bom.metadata.component.type}">
      <name>${escape(bom.metadata.component.name)}</name>
      <version>${escape(bom.metadata.component.version)}</version>
${bom.metadata.component.description ? `      <description>${escape(bom.metadata.component.description)}</description>\n` : ""}    </component>
  </metadata>
  <components>
`;
  for (const comp of bom.components) {
    xml += `    <component type="${comp.type}" bom-ref="${escape(comp["bom-ref"])}">
      <name>${escape(comp.name)}</name>
      <version>${escape(comp.version)}</version>
${comp.description ? `      <description>${escape(comp.description)}</description>\n` : ""}${comp.purl ? `      <purl>${escape(comp.purl)}</purl>\n` : ""}${comp.scope ? `      <scope>${comp.scope}</scope>\n` : ""}`;
    if (comp.licenses?.length) {
      xml += `      <licenses>
`;
      for (const lic of comp.licenses) {
        xml += `        <license>
${lic.license.id ? `          <id>${escape(lic.license.id)}</id>\n` : ""}${lic.license.name ? `          <name>${escape(lic.license.name)}</name>\n` : ""}        </license>
`;
      }
      xml += `      </licenses>
`;
    }
    xml += `    </component>
`;
  }
  xml += `  </components>
  <dependencies>
`;
  for (const dep of bom.dependencies) {
    xml += `    <dependency ref="${escape(dep.ref)}">
`;
    for (const d of dep.dependsOn) {
      xml += `      <dependency ref="${escape(d)}" />
`;
    }
    xml += `    </dependency>
`;
  }
  xml += `  </dependencies>
</bom>
`;
  return xml;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname ?? process.cwd(), "..");
  const rootPkg = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ) as PackageJson;

  const components = new Map<string, SbomComponent>();
  const dependencies: SbomDependency[] = [];
  const packageJsonFiles = findPackageJsonFiles(repoRoot);

  console.log(`Found ${packageJsonFiles.length} package.json files`);

  for (const pkgPath of packageJsonFiles) {
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as PackageJson;
    if (!pkg.name) {
      console.log(`  Skipping ${pkgPath} (no name)`);
      continue;
    }
    const pkgVersion = pkg.version ?? "0.0.0";
    const bomRef = makeBomRef(pkg.name, pkgVersion);

    const isWorkspace = pkgPath !== join(repoRoot, "package.json");
    const compType = isWorkspace ? "library" : "application";

    components.set(bomRef, {
      type: compType,
      "bom-ref": bomRef,
      name: pkg.name,
      version: pkgVersion,
      description: pkg.description,
      purl: makePurl(pkg.name, pkgVersion),
      licenses: pkg.license ? [{ license: { id: pkg.license } }] : undefined,
      hashes: [{ alg: "SHA-256", content: hashContent(raw) }],
    });

    const depRefs: string[] = [];
    depRefs.push(...collectDependencies(pkg.dependencies, "required", components));
    depRefs.push(...collectDependencies(pkg.devDependencies, "optional", components));
    depRefs.push(...collectDependencies(pkg.peerDependencies, "optional", components));

    dependencies.push({
      ref: bomRef,
      dependsOn: depRefs,
    });
  }

  const bom: CycloneDxBom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${generateUuid()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: "Atlas",
          name: "sbom-generator",
          version: "1.0.0",
        },
      ],
      component: {
        type: "application",
        name: rootPkg.name,
        version: rootPkg.version ?? "0.0.0",
        description: rootPkg.description,
      },
    },
    components: Array.from(components.values()),
    dependencies,
  };

  const outDir = join(repoRoot, ".atlas", "sbom");
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, "sbom.json");
  const xmlPath = join(outDir, "sbom.xml");

  writeFileSync(jsonPath, JSON.stringify(bom, null, 2), "utf8");
  writeFileSync(xmlPath, toXml(bom), "utf8");

  console.log(`\nSBOM generated successfully!`);
  console.log(`  Components: ${bom.components.length}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  XML:  ${xmlPath}`);
}

main().catch((err) => {
  console.error("SBOM generation failed:", err);
  process.exit(1);
});
