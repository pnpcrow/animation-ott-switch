import type { PageTitle, ProviderId } from "./types";
import type { SearchCandidate } from "../providers/search";
import type { SearchAction } from "../providers/search-actions";

export interface ProbeRequest {
  channel: "ott-switch-probe";
  token: string;
  kind: "search" | "detail" | "activate-search";
  action?: SearchAction;
  provider: ProviderId;
}
export interface ProbeReply {
  token: string;
  url: string;
  ready: boolean;
  loading?: boolean;
  candidates?: SearchCandidate[];
  actions?: SearchAction[];
  activated?: boolean;
  complete?: boolean;
  blocked?: boolean;
  reason?: string;
  detail?: PageTitle | null;
}
