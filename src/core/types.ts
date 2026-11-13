export type ProviderId =
  | "laftel"
  | "aniplus"
  | "crunchyroll"
  | "netflix"
  | "prime"
  | "apple"
  | "wavve"
  | "tving"
  | "coupang"
  | "watcha";
export type AvailabilityStatus =
  "available" | "unavailable" | "unknown" | "ambiguous";
export interface PageTitle {
  title: string;
  description: string;
  imageUrl: string;
  provider: ProviderId;
  url: string;
  aliases: string[];
  year?: number;
}
export interface ProviderLink {
  provider: ProviderId;
  url: string;
  title: string;
  verifiedAt: number;
  source: "page" | "search" | "manual";
}
export interface Availability {
  provider: ProviderId;
  status: AvailabilityStatus;
  checkedAt: number;
  url?: string;
  title?: string;
  reason?: string;
  /** False when a verified switch was cancelled because the source tab moved. */
  opened?: boolean;
  candidates?: { title: string; url: string }[];
}
export interface Revision {
  updatedAt: number;
  deviceId: string;
  deletedAt?: number;
}
export interface Bookmark extends Revision {
  id: string;
  title: string;
  aliases: string[];
  description: string;
  imageUrl: string;
  year?: number;
  categoryIds: string[];
  links: Partial<Record<ProviderId, ProviderLink>>;
  favorite: boolean;
  notes: string;
  createdAt: number;
}
export interface Category extends Revision {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}
export interface Settings extends Revision {
  id: "settings";
  subscribedProviders: ProviderId[];
  region: string;
  openInNewTab: boolean;
}
export interface LibrarySnapshot {
  schemaVersion: 1;
  bookmarks: Bookmark[];
  categories: Category[];
  settings: Settings;
}
export interface BackupEnvelope {
  format: "ott-switch";
  schemaVersion: 1;
  exportedAt: number;
  scope: "full" | "group";
  data: LibrarySnapshot;
}
export type BookmarkPatch = Partial<
  Pick<
    Bookmark,
    | "title"
    | "aliases"
    | "description"
    | "imageUrl"
    | "categoryIds"
    | "links"
    | "favorite"
    | "notes"
  >
> & { year?: number | null };
export interface SaveBookmarkInput {
  page: PageTitle;
  categoryIds: string[];
  links?: Partial<Record<ProviderId, ProviderLink>>;
}
export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  color: string;
  searchUrl: (title: string) => string;
}
