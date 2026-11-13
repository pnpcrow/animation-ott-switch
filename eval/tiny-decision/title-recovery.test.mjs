import test from "node:test";
import assert from "node:assert/strict";
import {
  loadTitleNormalizer,
  measureTitleRecovery,
  recoverySummary,
} from "../../scripts/title-recovery-tiny-decisions.mjs";

const normalizer = await loadTitleNormalizer();
const make = (expectedId = "n1") => ({
  id: "case-title",
  field: "title",
  split: "holdout",
  expectedId,
  acceptedIds: [expectedId],
  options: [
    {
      id: "n1",
      text: 'value="어느 마녀가 죽을 때까지"; main>h1 @text visible',
    },
    {
      id: "n2",
      text: 'value="Watch 어느 마녀가 죽을 때까지 | Crunchyroll"; head>meta @og:title head-metadata',
    },
    {
      id: "n3",
      text: 'value="Crunchyroll: Watch Popular Anime, Play Games & Shop Online"; head>title @text head-metadata',
    },
    { id: "__none__", text: "None" },
  ],
});
const snapshot = {
  pageUrl: "https://www.crunchyroll.com/series/fictional",
  fields: {
    title: [
      {
        id: "n1",
        value: "어느 마녀가 죽을 때까지",
        nodes: [{ tag: "h1", hidden: false }],
      },
      {
        id: "n2",
        value: "Watch 어느 마녀가 죽을 때까지 | Crunchyroll",
        nodes: [{ tag: "meta", hidden: true }],
      },
      {
        id: "n3",
        value: "Crunchyroll: Watch Popular Anime, Play Games & Shop Online",
        nodes: [{ tag: "title", hidden: true }],
      },
    ],
  },
};
test("recoverable decoration does not become correct element selection or feed gold to references", () => {
  const calls = [];
  const wrapped = {
    ...normalizer,
    cleanPageTitle: (...args) => {
      calls.push(args);
      return normalizer.cleanPageTitle(...args);
    },
  };
  const row = measureTitleRecovery(
    { chosenId: "n2" },
    make(),
    snapshot,
    wrapped,
  );
  assert.equal(row.elementCorrect, false);
  assert.equal(row.rawTitleRecoverable, true);
  assert.equal(row.visibleTitleRecoverable, true);
  assert.ok(calls.every((args) => args[3].length === 0));
});
test("marketing and absent-detail outputs receive no recovery credit", () => {
  assert.equal(
    measureTitleRecovery({ chosenId: "n3" }, make(), snapshot, normalizer)
      .rawTitleRecoverable,
    false,
  );
  const absent = measureTitleRecovery(
    { chosenId: "n2" },
    make("__none__"),
    snapshot,
    normalizer,
  );
  assert.equal(absent.rawTitleRecoverable, null);
  assert.equal(absent.nonEmptyWorkLikeOutputOnAbsentDetail, true);
  assert.equal(recoverySummary([absent]).positive.n, 0);
  assert.equal(recoverySummary([absent]).noOpenWork.incorrectSelections, 1);
});
test("errors remain in positive denominator and cannot become normalized matches", () => {
  const row = measureTitleRecovery(
    { chosenId: "n2", error: "failed" },
    make(),
    snapshot,
    normalizer,
  );
  assert.equal(row.rawTitleRecoverable, false);
  assert.equal(recoverySummary([row]).positive.n, 1);
  assert.equal(recoverySummary([row]).positive.errorsOrInvalid, 1);
});
