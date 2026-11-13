import type {
  BackupEnvelope,
  Bookmark,
  Category,
  LibrarySnapshot,
  ProviderId,
  ProviderLink,
  Revision,
  Settings,
} from "./types";
import { safeProviderUrl } from "../providers/identity";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "laftel",
  "aniplus",
  "crunchyroll",
  "netflix",
  "prime",
  "apple",
  "wavve",
  "tving",
  "coupang",
  "watcha",
];
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_BOOKMARKS = 20_000;
export const MAX_CATEGORIES = 1_000;

function fail(message: string): never {
  throw new Error(`가져올 수 없는 데이터: ${message}`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} 형식이 올바르지 않습니다.`);
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  label: string,
  max: number,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim())
  )
    fail(`${label} 값이 올바르지 않습니다.`);
  return value;
}
function time(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail(`${label} 시각이 올바르지 않습니다.`);
  // Extremely large timestamps can permanently dominate later edits.
  if (value > Date.now() + 365 * 24 * 60 * 60 * 1000)
    fail(`${label} 시각이 너무 먼 미래입니다.`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} 값이 올바르지 않습니다.`);
  return value;
}
function strings(
  value: unknown,
  label: string,
  maxCount: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxCount)
    fail(`${label} 목록이 올바르지 않습니다.`);
  return [...new Set(value.map((v) => text(v, label, maxLength)))];
}
function revision(value: Record<string, unknown>): Revision {
  const updatedAt = time(value.updatedAt, "수정");
  const deletedAt =
    value.deletedAt === undefined ? undefined : time(value.deletedAt, "삭제");
  if (deletedAt !== undefined && deletedAt > updatedAt)
    fail("삭제 시각은 수정 시각보다 늦을 수 없습니다.");
  return {
    updatedAt,
    deviceId: text(value.deviceId, "기기 ID", 128),
    ...(deletedAt !== undefined ? { deletedAt } : {}),
  };
}

export function validateImageUrl(value: unknown): string {
  const raw = text(value, "대표 이미지 URL", 4096, true);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password)
      fail("대표 이미지는 인증 정보 없는 HTTPS URL이어야 합니다.");
    return url.href;
  } catch {
    return fail("대표 이미지는 올바른 HTTPS URL이어야 합니다.");
  }
}

export function parseBookmark(raw: unknown): Bookmark {
  const value = object(raw, "작품");
  const rawLinks = object(value.links, "OTT 연결");
  const links: Partial<Record<ProviderId, ProviderLink>> = {};
  if (Object.keys(rawLinks).length > PROVIDER_IDS.length)
    fail("OTT 연결 개수가 너무 많습니다.");
  for (const [key, rawLink] of Object.entries(rawLinks)) {
    if (!PROVIDER_IDS.includes(key as ProviderId))
      fail("지원하지 않는 OTT 연결입니다.");
    const provider = key as ProviderId;
    const link = object(rawLink, "OTT 연결");
    const url = text(link.url, "OTT URL", 4096);
    if (link.provider !== provider || !safeProviderUrl(provider, url))
      fail("OTT의 공식 작품 URL만 저장할 수 있습니다.");
    if (!["page", "search", "manual"].includes(link.source as string))
      fail("OTT 연결 출처가 올바르지 않습니다.");
    links[provider] = {
      provider,
      url,
      title: text(link.title, "OTT 제목", 500),
      verifiedAt: time(link.verifiedAt, "연결 확인"),
      source: link.source as ProviderLink["source"],
    };
  }
  const year = value.year;
  if (
    year !== undefined &&
    (typeof year !== "number" ||
      !Number.isInteger(year) ||
      year < 1888 ||
      year > 2200)
  )
    fail("제작 연도가 올바르지 않습니다.");
  const result: Bookmark = {
    id: text(value.id, "작품 ID", 256),
    title: text(value.title, "제목", 500),
    aliases: strings(value.aliases, "다른 제목", 30, 500),
    description: text(value.description, "소개", 30_000, true),
    imageUrl: validateImageUrl(value.imageUrl),
    categoryIds: strings(value.categoryIds, "카테고리 ID", MAX_CATEGORIES, 256),
    links,
    favorite: bool(value.favorite, "즐겨찾기"),
    notes: text(value.notes, "메모", 30_000, true),
    createdAt: time(value.createdAt, "생성"),
    ...revision(value),
    ...(year !== undefined ? { year: year as number } : {}),
  };
  if (result.createdAt > result.updatedAt)
    fail("생성 시각은 수정 시각보다 늦을 수 없습니다.");
  return result;
}

export function parseCategory(raw: unknown): Category {
  const value = object(raw, "카테고리");
  const color = text(value.color, "카테고리 색상", 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(color))
    fail("카테고리 색상은 6자리 HEX 값이어야 합니다.");
  const result = {
    id: text(value.id, "카테고리 ID", 256),
    name: text(value.name, "카테고리 이름", 100),
    color,
    createdAt: time(value.createdAt, "생성"),
    ...revision(value),
  };
  if (result.createdAt > result.updatedAt)
    fail("생성 시각은 수정 시각보다 늦을 수 없습니다.");
  return result;
}

export function parseSettings(raw: unknown): Settings {
  const value = object(raw, "설정");
  if (value.id !== "settings") fail("설정 ID가 올바르지 않습니다.");
  const subscribedProviders = strings(
    value.subscribedProviders,
    "구독 OTT",
    PROVIDER_IDS.length,
    20,
  );
  if (subscribedProviders.some((p) => !PROVIDER_IDS.includes(p as ProviderId)))
    fail("지원하지 않는 구독 OTT입니다.");
  const region = text(value.region, "지역", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) fail("지역은 두 자리 국가 코드여야 합니다.");
  return {
    id: "settings",
    subscribedProviders: subscribedProviders as ProviderId[],
    region,
    openInNewTab: bool(value.openInNewTab, "새 탭 열기"),
    ...revision(value),
  };
}

function uniqueIds<T extends { id: string }>(records: T[], label: string): T[] {
  if (new Set(records.map((r) => r.id)).size !== records.length)
    fail(`${label} ID가 중복되었습니다.`);
  return records;
}

export function parseSnapshot(raw: unknown): LibrarySnapshot {
  const value = object(raw, "보관함");
  if (value.schemaVersion !== 1) fail("지원하지 않는 보관함 버전입니다.");
  if (!Array.isArray(value.bookmarks) || value.bookmarks.length > MAX_BOOKMARKS)
    fail("작품 목록이 너무 크거나 잘못되었습니다.");
  if (
    !Array.isArray(value.categories) ||
    value.categories.length > MAX_CATEGORIES
  )
    fail("카테고리 목록이 너무 크거나 잘못되었습니다.");
  return {
    schemaVersion: 1,
    bookmarks: uniqueIds(value.bookmarks.map(parseBookmark), "작품"),
    categories: uniqueIds(value.categories.map(parseCategory), "카테고리"),
    settings: parseSettings(value.settings),
  };
}

/** Validates and projects known fields. Untrusted fields/prototypes never enter the DB. */
export function parseBackup(raw: unknown): BackupEnvelope {
  if (typeof raw === "string") {
    if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES)
      fail("백업 파일은 10MB 이하여야 합니다.");
    try {
      raw = JSON.parse(raw);
    } catch {
      fail("JSON 파일을 읽을 수 없습니다.");
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return fail("직렬화할 수 없는 데이터입니다.");
  }
  if (
    !serialized ||
    new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES
  )
    fail("백업 파일은 10MB 이하여야 합니다.");
  const value = object(raw, "백업");
  if (value.format !== "ott-switch" || value.schemaVersion !== 1)
    fail("AniOTT Switch 버전 1 백업이 아닙니다.");
  if (value.scope !== "full" && value.scope !== "group")
    fail("백업 범위가 올바르지 않습니다.");
  const data = parseSnapshot(value.data);
  if (value.scope === "group") {
    if (
      data.bookmarks.some((b) => b.deletedAt !== undefined) ||
      data.categories.some((c) => c.deletedAt !== undefined)
    )
      fail("그룹 파일에는 삭제 기록을 포함할 수 없습니다.");
    const categoryIds = new Set(data.categories.map((c) => c.id));
    if (
      data.bookmarks.some(
        (b) =>
          !b.categoryIds.length ||
          b.categoryIds.some((id) => !categoryIds.has(id)),
      )
    )
      fail("그룹 파일의 작품은 포함된 카테고리에 속해야 합니다.");
  }
  return {
    format: "ott-switch",
    schemaVersion: 1,
    exportedAt: time(value.exportedAt, "내보내기"),
    scope: value.scope,
    data,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Total ordering means merging the same replicas converges regardless of direction. */
export function latest<T extends Revision>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if ((a.deletedAt !== undefined) !== (b.deletedAt !== undefined))
    return a.deletedAt !== undefined ? a : b;
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? a : b;
  return stable(a) >= stable(b) ? a : b;
}

function mergeRecords<T extends Revision & { id: string }>(
  a: T[],
  b: T[],
): T[] {
  const records = new Map(a.map((record) => [record.id, record]));
  for (const record of b) {
    const local = records.get(record.id);
    records.set(record.id, local ? latest(local, record) : record);
  }
  return [...records.values()].sort((x, y) => x.id.localeCompare(y.id, "en"));
}

export function mergeSnapshots(
  local: LibrarySnapshot,
  incoming: LibrarySnapshot,
): LibrarySnapshot {
  return {
    schemaVersion: 1,
    bookmarks: mergeRecords(local.bookmarks, incoming.bookmarks),
    categories: mergeRecords(local.categories, incoming.categories),
    settings: latest(local.settings, incoming.settings),
  };
}

export function neutralSettings(): Settings {
  return {
    id: "settings",
    subscribedProviders: [],
    region: "KR",
    openInNewTab: true,
    updatedAt: 0,
    deviceId: "group-export",
  };
}
