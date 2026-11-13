import { createHash, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function requireValue(condition, message) {
  if (!condition)
    throw new Error(`Extension identity check failed: ${message}`);
}

/** Decode the public SPKI only. This tool never creates or handles private keys. */
export function publicKeyIdentity(value) {
  requireValue(
    typeof value === "string" && value.length > 0 && value.length <= 16384,
    "manifest.key must contain the registered public key",
  );
  const base64 = value.replace(/\s/g, "");
  requireValue(
    base64.length > 0 &&
      base64.length % 4 === 0 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        base64,
      ),
    "manifest.key must be canonical base64 SPKI",
  );
  const der = Buffer.from(base64, "base64");
  requireValue(
    der.toString("base64") === base64,
    "manifest.key contains noncanonical base64",
  );
  let key;
  try {
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new Error(
      "Extension identity check failed: manifest.key is not a valid DER SPKI public key",
    );
  }
  // Node's decoder can accept trailing data. Require the exact canonical DER.
  requireValue(
    Buffer.from(key.export({ format: "der", type: "spki" })).equals(der),
    "manifest.key contains trailing or noncanonical DER data",
  );
  const publicKeySha256 = createHash("sha256").update(der).digest("hex");
  const extensionId = publicKeySha256
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) =>
      String.fromCharCode(97 + Number.parseInt(digit, 16)),
    );
  return { extensionId, publicKeySha256, publicKeyBase64: base64 };
}

/** Validate source identity and, when supplied, the actual manifest being zipped. */
export function validateIdentity({
  identity,
  packageJson,
  manifest,
  distManifest,
}) {
  requireValue(
    identity && identity.schemaVersion === 1,
    "unsupported identity lock schema",
  );
  requireValue(
    typeof identity.baselineRelease === "string" &&
      /^v\d+\.\d+\.\d+$/.test(identity.baselineRelease),
    "identity lock must name its baseline release",
  );
  requireValue(
    typeof identity.extensionId === "string" &&
      /^[a-p]{32}$/.test(identity.extensionId),
    "identity lock has an invalid extension ID",
  );
  requireValue(
    typeof identity.publicKeySha256 === "string" &&
      /^[0-9a-f]{64}$/.test(identity.publicKeySha256),
    "identity lock has an invalid public key SHA-256",
  );
  requireValue(
    typeof identity.packageName === "string" && identity.packageName.length > 0,
    "identity lock has no package name",
  );
  requireValue(
    typeof identity.manifestName === "string" &&
      identity.manifestName.length > 0,
    "identity lock has no manifest name",
  );
  requireValue(
    packageJson?.name === identity.packageName,
    "package name differs from the registered identity",
  );
  requireValue(
    manifest?.name === identity.manifestName,
    "manifest name differs from the registered identity",
  );
  requireValue(manifest.manifest_version === 3, "manifest must remain MV3");
  requireValue(
    typeof manifest.version === "string" &&
      manifest.version === packageJson.version,
    "package and manifest versions must match",
  );
  const versionParts = manifest.version.split(".");
  requireValue(
    versionParts.length >= 1 &&
      versionParts.length <= 4 &&
      versionParts.every(
        (part) => /^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 65535,
      ) &&
      versionParts.some((part) => Number(part) > 0),
    "manifest version is not a valid Chrome numeric version",
  );
  const actual = publicKeyIdentity(manifest.key);
  requireValue(
    actual.extensionId === identity.extensionId,
    "public key derives a different extension ID",
  );
  requireValue(
    actual.publicKeySha256 === identity.publicKeySha256,
    "public key differs from the registered key fingerprint",
  );
  if (distManifest !== undefined) {
    requireValue(
      distManifest?.manifest_version === manifest.manifest_version,
      "dist manifest version differs from source",
    );
    requireValue(
      distManifest?.name === manifest.name,
      "dist manifest name differs from source",
    );
    requireValue(
      distManifest?.version === manifest.version,
      "dist version is stale; build before packaging",
    );
    const packaged = publicKeyIdentity(distManifest?.key);
    requireValue(
      packaged.publicKeyBase64 === actual.publicKeyBase64,
      "dist public key differs from source",
    );
    requireValue(
      packaged.extensionId === identity.extensionId &&
        packaged.publicKeySha256 === identity.publicKeySha256,
      "dist identity differs from the registered identity",
    );
  }
  return {
    extensionId: actual.extensionId,
    publicKeySha256: actual.publicKeySha256,
    baselineRelease: identity.baselineRelease,
    version: manifest.version,
  };
}

export async function verifyProjectIdentity({
  root = projectRoot,
  includeDist = false,
} = {}) {
  const json = async (path) =>
    JSON.parse(await readFile(resolve(root, path), "utf8"));
  const [identity, packageJson, manifest, distManifest] = await Promise.all([
    json("config/extension-identity.json"),
    json("package.json"),
    json("public/manifest.json"),
    includeDist ? json("dist/manifest.json") : undefined,
  ]);
  return validateIdentity({ identity, packageJson, manifest, distManifest });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  requireValue(
    args.every((arg) => arg === "--dist") && args.length <= 1,
    "usage: node scripts/verify-identity.mjs [--dist]",
  );
  const result = await verifyProjectIdentity({
    includeDist: args.includes("--dist"),
  });
  console.log(
    `Extension identity verified: ${result.extensionId} (version ${result.version}${args.includes("--dist") ? ", source + dist" : ", source"})`,
  );
}
