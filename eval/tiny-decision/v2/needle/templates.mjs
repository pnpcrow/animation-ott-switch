// Tool schemas are fixed before fresh validation; labels and provenance are not accepted.
export const templates = [
  "field-enum",
  "contrast-enum",
  "candidate-tools",
  "relation-enum",
];
const goals = {
  title:
    "Select the current work's clean name; exclude an episode name and site branding.",
  image:
    "Select the current work's poster or backdrop; exclude logos, icons and episode art.",
  description:
    "Select the current work's plot; exclude episode plots, promotions and placeholders.",
};
const examples = {
  title:
    "Example: visible dialog h1 River beats hidden main h1 Old. A site slogan alone means absent.",
  image:
    "Example: work poster alt River at 600x900 beats Brand icon at 32x32. A logo alone means absent.",
  description:
    "Example: a paragraph in the work detail beats a nearby episode summary. Subscribe now is not a plot.",
};
const clip = (value, limit) =>
  [
    ...String(value ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  ]
    .slice(0, limit)
    .join("");
const tag = (p) =>
  typeof p === "string" ? p : (p?.tag || "") + (p?.role ? `(${p.role})` : "");

function brief(candidate, field, style) {
  const value = clip(candidate.value, field === "title" ? 60 : 50);
  const structure = [candidate.tag, candidate.source, candidate.role]
    .filter(Boolean)
    .join("/");
  const state =
    candidate.tag === "meta" || candidate.tag === "title"
      ? "metadata"
      : candidate.hidden === true
        ? "hidden"
        : candidate.hidden === false
          ? "visible"
          : "";
  const parents = (candidate.parents || [])
    .slice(0, 2)
    .map(tag)
    .filter(Boolean)
    .join(">");
  const related = clip(candidate.nearHeading, 28);
  const alt = clip(candidate.alt, 34);
  const size =
    candidate.width > 0 && candidate.height > 0
      ? `${candidate.width}x${candidate.height}`
      : "";
  const extras = [
    candidate.navigation ? "navigation" : "",
    candidate.dialog ? clip(candidate.dialog, 28) : "",
    candidate.inert ? "inert" : "",
    alt ? `alt=${alt}` : "",
    size,
    related ? `near=${related}` : "",
  ].filter(Boolean);
  if (style === "sentence")
    return `${structure} ${state}${parents ? ` under ${parents}` : ""}: ${value}${extras.length ? `; ${extras.join(", ")}` : ""}`;
  return [structure, state, parents, value, ...extras]
    .filter(Boolean)
    .join("|");
}

export function requestFor(
  { field, page, candidates },
  template,
  { maxChars = 2200 } = {},
) {
  if (!templates.includes(template))
    throw new Error("Unknown Needle v2 template");
  if (!goals[field] || !Array.isArray(candidates) || !candidates.length)
    throw new Error("Missing field/candidates");
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw new Error("Duplicate candidate IDs");
  const binding = candidates.map((candidate, index) => ({
    key:
      candidate.id === "__none__"
        ? "absent"
        : `node_${String(index + 1).padStart(2, "0")}`,
    id: candidate.id,
  }));
  if (!binding.some((x) => x.key === "absent"))
    throw new Error("Explicit absent option required");
  const rows = candidates.map((candidate, index) => ({
    key: binding[index].key,
    facts:
      candidate.id === "__none__"
        ? "No current work detail or no suitable field element"
        : brief(
            candidate,
            field,
            template === "relation-enum" ? "sentence" : "compact",
          ),
  }));
  const url = (() => {
    try {
      if (String(page?.url || "").startsWith("/")) return clip(page.url, 65);
      const u = new URL(page?.url);
      return clip(decodeURI(u.pathname), 65);
    } catch {
      return "";
    }
  })();
  const heading = clip(
    Array.isArray(page?.headings)
      ? page.headings
          .map((x) => (typeof x === "string" ? x : x.text || x.value || ""))
          .filter(Boolean)
          .slice(0, 2)
          .join(" / ")
      : page?.headings,
    60,
  );
  const title = clip(page?.title, 70);
  const dialogs =
    typeof page?.dialogs === "number"
      ? String(page.dialogs)
      : Array.isArray(page?.dialogs)
        ? clip(JSON.stringify(page.dialogs), 70)
        : clip(page?.dialogs, 50);
  const context = [
    `path=${url}`,
    `pageTitle=${title}`,
    heading ? `headings=${heading}` : "",
    dialogs ? `dialogs=${dialogs}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const rule =
    "Use observed evidence. A visible work dialog overrides the background page. Choose absent when no work detail or field exists.";
  let tools, input;
  if (template === "candidate-tools") {
    tools = rows.map((row) => ({
      name:
        row.key === "absent"
          ? `no_${field}_available`
          : `choose_${field}_${row.key}`,
      description: row.facts,
      parameters: { type: "object", properties: {} },
    }));
    input = `${goals[field]} ${rule}\n${context}`;
  } else {
    tools = [
      {
        name: `choose_${field}_element`,
        description: goals[field],
        parameters: {
          type: "object",
          properties: {
            node: { type: "string", enum: binding.map((x) => x.key) },
          },
          required: ["node"],
        },
      },
    ];
    input = `${rule}${template === "contrast-enum" ? ` ${examples[field]}` : ""}\n${context}\n${rows.map((row) => `${row.key}: ${row.facts}`).join("\n")}`;
  }
  const serialized = JSON.stringify(tools) + input;
  const measured = {
    chars: [...serialized].length,
    utf8Bytes: new TextEncoder().encode(serialized).byteLength,
    toolChars: [...JSON.stringify(tools)].length,
    inputChars: [...input].length,
    desiredChars: 1800,
    maxChars,
  };
  if (measured.chars > maxChars)
    throw Object.assign(
      new Error(
        `Needle request budget ${measured.chars}>${maxChars}; no candidate dropped`,
      ),
      { measured },
    );
  return { tools, input, binding, field, template, measured };
}

export function readChoice(response, request, { suppressed = false } = {}) {
  if (
    !suppressed &&
    (response?.success === false || response?.validation?.ungrounded?.length)
  )
    return {
      chosenId: null,
      accepted: false,
      reason: "Engine failure or ungrounded argument",
    };
  const calls =
    response?.[suppressed ? "suppressed_calls" : "function_calls"] || [];
  if (calls.length !== 1)
    return { chosenId: null, accepted: false, reason: "No unique tool call" };
  const call = calls[0];
  let key;
  if (request.template === "candidate-tools") {
    if (call.name === `no_${request.field}_available`) key = "absent";
    else if (call.name?.startsWith(`choose_${request.field}_`))
      key = call.name.slice(`choose_${request.field}_`.length);
  } else if (call.name === `choose_${request.field}_element`)
    key = call.arguments?.node;
  const chosenId = request.binding.find((item) => item.key === key)?.id;
  return chosenId
    ? { chosenId, accepted: !suppressed }
    : {
        chosenId: null,
        accepted: false,
        reason: "Unobserved choice or wrong task tool",
      };
}
