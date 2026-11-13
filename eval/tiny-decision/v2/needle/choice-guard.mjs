import { readChoice } from "./templates.mjs";

export function unknownToolNames(response, tools, { suppressed = false } = {}) {
  const allowed = new Set(tools.map((tool) => tool.name));
  const calls =
    response?.[suppressed ? "suppressed_calls" : "function_calls"] || [];
  return calls.map((call) => call.name).filter((name) => !allowed.has(name));
}

// A parser-only guard outside the frozen prompt compiler. It never promotes a
// suppressed call or changes native confidence, payloads or decoding settings.
export function guardedChoice(response, request, options = {}) {
  if (unknownToolNames(response, request.tools, options).length)
    return {
      chosenId: null,
      accepted: false,
      reason: "Tool name absent from the actual request schema",
    };
  return readChoice(response, request, options);
}
