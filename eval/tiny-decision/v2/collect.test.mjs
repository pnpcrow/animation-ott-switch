import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { collectDomSnapshot } from "../collect.mjs";
import { enrichDomSnapshot } from "./collect.mjs";
import { buildInputs } from "./collect-inputs.mjs";

const url = "https://example.test/work/one";
function collect(body) {
  const { document } = parseHTML(
    `<html><head><title>Work</title></head><body>${body}</body></html>`,
  );
  const base = collectDomSnapshot(document, url);
  return { document, base, rich: enrichDomSnapshot(document, url, base) };
}

test("image attributes and local relationships are observed without fabricating layout", () => {
  const { rich } = collect(
    '<main><section role="region"><h1>Work</h1><a href="/work/one?token=secret&view=detail"><img src="https://cdn.example.test/poster.jpg" alt="Work artwork" title="Poster" width="600" height="900"></a></section></main>',
  );
  const image = rich.fields.image[0].nodes[0];
  assert.equal(image.alt, "Work artwork");
  assert.equal(image.title, "Poster");
  assert.equal(image.width, 600);
  assert.equal(image.height, 900);
  assert.equal(image.naturalWidth, null);
  assert.equal(image.renderedWidth, null);
  assert.equal(image.href, "https://example.test/work/one?view=detail");
  assert.deepEqual(image.nearbyHeadings, ["Work"]);
  assert.ok(image.parentRoles.some((n) => n.role === "region"));
  assert.equal(image.enrichmentMatch, "exactPathAndValue");
});

test("body prefix excludes executable or non-rendered script/style containers", () => {
  const { rich } = collect(
    '<script>DO_NOT_SEND()</script><style>.bad{content:"CSS"}</style><noscript>NO_SCRIPT</noscript><template>TEMPLATE</template><main>Visible prose</main>',
  );
  assert.equal(rich.pageEvidence.bodyPrefix, "Visible prose");
});

test("dialog order is explicitly a DOM observation, never an active/z-index assertion", () => {
  const { rich } = collect(
    '<dialog open><h1>First</h1></dialog><div role="dialog" aria-modal="true"><h1>Last</h1></div><div role="dialog" hidden><h1>Hidden</h1></div>',
  );
  assert.equal(rich.pageEvidence.visibleDialogCount, 2);
  assert.equal(rich.pageEvidence.dialogs[0].open, true);
  assert.equal(rich.pageEvidence.dialogs[1].ariaModal, "true");
  assert.equal(rich.pageEvidence.dialogs[1].lastVisibleInDom, true);
  assert.equal(rich.pageEvidence.dialogs[2].lastVisibleInDom, false);
  const last = rich.fields.title.find((c) => c.value === "Last").nodes[0];
  assert.equal(last.inLastVisibleDialogInDom, true);
  assert.equal(last.inTopVisibleDialog, undefined);
});

test("truncated path collisions abstain from adding another element relationships", () => {
  const branch =
    '<section><div><span><img src="https://cdn.example.test/same.jpg" alt="Same"></span></div></section>';
  const { rich } = collect(`<main>${branch}</main><aside>${branch}</aside>`);
  const nodes = rich.fields.image[0].nodes;
  assert.ok(nodes.length > 1);
  for (const node of nodes) {
    assert.equal(node.enrichmentMatched, false);
    assert.equal(node.enrichmentMatch, "ambiguousPathAndValue");
    assert.equal(node.parentRoles, undefined);
  }
});

test("same-value nodes cannot substitute for a missing exact path", () => {
  const { document, base } = collect("<h1>Work</h1>");
  const title = base.fields.title.find((c) => c.value === "Work");
  title.nodes.forEach((n) => (n.path = "missing:path"));
  const rich = enrichDomSnapshot(document, url, base);
  for (const node of rich.fields.title.find((c) => c.value === "Work").nodes) {
    assert.equal(node.enrichmentMatched, false);
    assert.equal(node.enrichmentMatch, "sameValueWithoutExactPath");
    assert.equal(node.region, undefined);
  }
});

test("input construction is annotation-free and keeps the fixed first-eight cap", () => {
  const { rich } = collect(
    "<h1>Work</h1>" +
      Array.from({ length: 12 }, (_, i) => `<h2>Heading ${i}</h2>`).join(""),
  );
  const page = {
    ...rich,
    id: "fixture",
    work: "ignored-secret",
    expectedId: "t12",
  };
  const inputs = buildInputs([page]);
  const row = inputs.find((r) => r.field === "title");
  assert.equal(row.options.length, 9);
  assert.ok(!row.options.some((o) => o.id === "t12"));
  assert.ok(!JSON.stringify(inputs).includes("ignored-secret"));
  assert.equal(row.expectedId, undefined);
  assert.equal(row.provenance, undefined);
  assert.deepEqual(buildInputs([page]), inputs);
});
