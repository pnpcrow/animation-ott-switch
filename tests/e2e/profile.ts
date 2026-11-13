import { realpath, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";

/** Only remove the isolated profile made for this test run. */
export async function removeTestProfile(profile: string) {
  const target = await realpath(profile);
  const parent = await realpath(tmpdir());
  if (
    dirname(target) !== parent ||
    !basename(target).startsWith("ott-switch-")
  ) {
    throw new Error(
      "Refusing to remove a directory outside the test profile scope",
    );
  }
  await rm(target, { recursive: true, force: true });
}
