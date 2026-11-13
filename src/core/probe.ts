import type { PageTitle, ProviderId } from "./types";
import type { SearchCandidate } from "../providers/search";

export interface ProbeRequest {
  channel: "ott-switch-probe";
  token: string;
  kind: "search" | "detail";
  provider: ProviderId;
}
export interface ProbeReply {
  token: string;
  url: string;
  ready: boolean;
  loading?: boolean;
  candidates?: SearchCandidate[];
  complete?: boolean;
  blocked?: boolean;
  reason?: string;
  detail?: PageTitle | null;
}
