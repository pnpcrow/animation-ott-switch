import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const { publicKeyIdentity, validateIdentity, verifyProjectIdentity } =
  await import(new URL("../scripts/verify-identity.mjs", import.meta.url).href);

const REGISTERED_ID = "cmaijknliglhgokkmijggladebokgafl";
const REGISTERED_KEY_SHA256 =
  "2c089adb86b76eaac8966b0341ea605b415387225fca0f39a3e2247a4ed56a55";
const source = (path: string) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
function fixture() {
  return {
    identity: source("config/extension-identity.json"),
    packageJson: source("package.json"),
    manifest: source("public/manifest.json"),
  };
}

describe("registered extension identity", () => {
  it("pins the v0.1.5 store item and public key independently of the editable lock", () => {
    const current = fixture();
    expect(current.identity).toEqual({
      schemaVersion: 1,
      baselineRelease: "v0.1.5",
      extensionId: REGISTERED_ID,
      publicKeySha256: REGISTERED_KEY_SHA256,
      packageName: "animation-ott-switch",
      manifestName: "OTT Switch · 작품 보관함",
    });
    expect(validateIdentity(current)).toMatchObject({
      extensionId: REGISTERED_ID,
      publicKeySha256: REGISTERED_KEY_SHA256,
    });
  });

  it("derives the actual store ID from its public SPKI and accepts harmless key line wrapping", () => {
    const key = fixture().manifest.key;
    const wrapped = key.match(/.{1,64}/g).join("\n");
    expect(publicKeyIdentity(wrapped)).toEqual({
      extensionId: REGISTERED_ID,
      publicKeySha256: REGISTERED_KEY_SHA256,
      publicKeyBase64: key,
    });
  });

  it("allows matching numeric version updates without changing the identity", () => {
    const current = fixture();
    current.packageJson.version = current.manifest.version = "0.2.0";
    expect(validateIdentity(current)).toMatchObject({
      version: "0.2.0",
      extensionId: REGISTERED_ID,
      baselineRelease: "v0.1.5",
    });
  });

  it.each([
    undefined,
    null,
    "",
    "not base64!",
    "-----BEGIN PRIVATE KEY-----",
    "AQ==",
    "AB==",
  ])("rejects a missing or invalid public key: %s", (key) => {
    const current = fixture();
    current.manifest.key = key;
    expect(() => validateIdentity(current)).toThrow(/identity check failed/);
  });

  it("rejects DER trailing data even when the public-key parser can read the prefix", () => {
    const current = fixture();
    current.manifest.key = Buffer.concat([
      Buffer.from(current.manifest.key, "base64"),
      Buffer.from([0]),
    ]).toString("base64");
    expect(() => validateIdentity(current)).toThrow(
      /trailing or noncanonical DER/,
    );
  });

  it("rejects another parseable public key instead of silently generating a different ID", () => {
    const current = fixture();
    const changed = Buffer.from(current.manifest.key, "base64");
    // Change only a modulus byte; this remains a parseable public SPKI fixture.
    changed[100] ^= 1;
    current.manifest.key = changed.toString("base64");
    expect(publicKeyIdentity(current.manifest.key).extensionId).not.toBe(
      REGISTERED_ID,
    );
    expect(() => validateIdentity(current)).toThrow(/different extension ID/);
  });

  it("rejects a different locked ID or key fingerprint", () => {
    const changedId = fixture();
    changedId.identity.extensionId = "a".repeat(32);
    expect(() => validateIdentity(changedId)).toThrow(/different extension ID/);
    const changedHash = fixture();
    changedHash.identity.publicKeySha256 = "0".repeat(64);
    expect(() => validateIdentity(changedHash)).toThrow(
      /registered key fingerprint/,
    );
  });

  it("rejects renamed package and manifest identities", () => {
    const changedPackage = fixture();
    changedPackage.packageJson.name = "different-extension";
    expect(() => validateIdentity(changedPackage)).toThrow(/package name/);
    const changedName = fixture();
    changedName.manifest.name += " copy";
    expect(() => validateIdentity(changedName)).toThrow(/manifest name/);
  });

  it("rejects source version mismatch and a non-MV3 manifest", () => {
    const changedVersion = fixture();
    changedVersion.manifest.version = "0.1.5";
    expect(() => validateIdentity(changedVersion)).toThrow(
      /versions must match/,
    );
    const changedFormat = fixture();
    changedFormat.manifest.manifest_version = 2;
    expect(() => validateIdentity(changedFormat)).toThrow(/MV3/);
  });

  it.each(["0.1.6-test", "01.2", "0.65536", "0.0.0", "1.2.3.4.5"])(
    "rejects a non-Chrome version even when both source versions agree: %s",
    (version) => {
      const current = fixture();
      current.packageJson.version = current.manifest.version = version;
      expect(() => validateIdentity(current)).toThrow(/Chrome numeric version/);
    },
  );

  it("accepts source and built manifests with the same registered identity", () => {
    const current = fixture();
    expect(
      validateIdentity({
        ...current,
        distManifest: structuredClone(current.manifest),
      }),
    ).toMatchObject({ extensionId: REGISTERED_ID });
  });

  it.each(["key", "name", "version", "manifest_version"])(
    "rejects a stale or edited built manifest field: %s",
    (field) => {
      const current = fixture();
      const distManifest = structuredClone(current.manifest);
      if (field === "key") delete distManifest.key;
      else if (field === "name") distManifest.name = "old name";
      else if (field === "version") distManifest.version = "0.1.5";
      else distManifest.manifest_version = 2;
      expect(() => validateIdentity({ ...current, distManifest })).toThrow(
        /identity check failed/,
      );
    },
  );

  it("checks actual built files without rewriting a stale manifest", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "ott-switch-identity-test-"),
    );
    try {
      const current = fixture();
      await Promise.all([
        mkdir(join(temporary, "config")),
        mkdir(join(temporary, "public")),
        mkdir(join(temporary, "dist")),
      ]);
      const builtPath = join(temporary, "dist", "manifest.json");
      await Promise.all([
        writeFile(
          join(temporary, "config", "extension-identity.json"),
          JSON.stringify(current.identity),
        ),
        writeFile(
          join(temporary, "package.json"),
          JSON.stringify(current.packageJson),
        ),
        writeFile(
          join(temporary, "public", "manifest.json"),
          JSON.stringify(current.manifest),
        ),
        writeFile(
          builtPath,
          JSON.stringify({ ...current.manifest, version: "0.1.5" }),
        ),
      ]);
      await expect(
        verifyProjectIdentity({ root: temporary }),
      ).resolves.toMatchObject({ extensionId: REGISTERED_ID });
      const before = await readFile(builtPath, "utf8");
      await expect(
        verifyProjectIdentity({ root: temporary, includeDist: true }),
      ).rejects.toThrow(/dist version is stale/);
      expect(await readFile(builtPath, "utf8")).toBe(before);
    } finally {
      const target = await realpath(temporary);
      if (
        dirname(target) !== (await realpath(tmpdir())) ||
        !basename(target).startsWith("ott-switch-identity-test-")
      )
        throw new Error("Refusing to remove an unexpected test directory");
      await rm(target, { recursive: true, force: true });
    }
  });

  it.each(["build", "package"])(
    "checks the actual working directory before the %s script writes output",
    async (script) => {
      const temporary = await mkdtemp(
        join(tmpdir(), "ott-switch-identity-cwd-"),
      );
      try {
        const current = fixture();
        await Promise.all([
          mkdir(join(temporary, "config")),
          mkdir(join(temporary, "public")),
        ]);
        await Promise.all([
          writeFile(
            join(temporary, "config", "extension-identity.json"),
            JSON.stringify(current.identity),
          ),
          writeFile(
            join(temporary, "package.json"),
            JSON.stringify(current.packageJson),
          ),
          writeFile(
            join(temporary, "public", "manifest.json"),
            JSON.stringify(
              script === "build"
                ? { ...current.manifest, name: "Wrong source identity" }
                : current.manifest,
            ),
          ),
        ]);
        if (script === "package") {
          await mkdir(join(temporary, "dist"));
          await writeFile(
            join(temporary, "dist", "manifest.json"),
            JSON.stringify({
              ...current.manifest,
              name: "Wrong packaged identity",
            }),
          );
        }
        const child = spawnSync(
          process.execPath,
          [fileURLToPath(new URL(`../scripts/${script}.mjs`, import.meta.url))],
          {
            cwd: temporary,
            encoding: "utf8",
            timeout: 10_000,
            windowsHide: true,
          },
        );
        expect(child.error).toBeUndefined();
        expect(child.status).not.toBe(0);
        expect(child.stderr).toContain(
          script === "build"
            ? "manifest name differs from the registered identity"
            : "dist manifest name differs from source",
        );
        const { access } = await import("node:fs/promises");
        await expect(
          access(join(temporary, script === "build" ? "dist" : "release")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        const target = await realpath(temporary);
        if (
          dirname(target) !== (await realpath(tmpdir())) ||
          !basename(target).startsWith("ott-switch-identity-cwd-")
        )
          throw new Error(
            "Refusing to remove an unexpected script test directory",
          );
        await rm(target, { recursive: true, force: true });
      }
    },
  );
});
