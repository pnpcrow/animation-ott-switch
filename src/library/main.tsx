import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Bookmark as BookmarkIcon,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Film,
  FolderPlus,
  Heart,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../core/client";
import { MAX_BACKUP_BYTES, parseBackup } from "../core/backup";
import {
  cleanSearchPage,
  providers,
  providerTitleId,
  safeProviderUrl,
} from "../providers/identity";
import type {
  Availability,
  BackupEnvelope,
  Bookmark,
  BookmarkPatch,
  Category,
  LibrarySnapshot,
  PageTitle,
  ProviderId,
} from "../core/types";
import "./styles.css";

type View = "all" | "favorites" | "uncategorized" | `category:${string}`;
type Modal =
  | { type: "settings" }
  | { type: "help" }
  | { type: "category"; category?: Category }
  | { type: "edit"; bookmark: Bookmark }
  | { type: "add" }
  | { type: "delete"; bookmark: Bookmark }
  | { type: "delete-category"; category: Category }
  | { type: "export" }
  | { type: "import"; backup: BackupEnvelope; name: string }
  | null;
const categoryColors = [
  "#b7e27c",
  "#b7a2f4",
  "#e8b16b",
  "#78c9d3",
  "#ed8f9e",
  "#a1adbf",
];
const dateLabel = (time: number) =>
  new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(
    time,
  );
const providerLetters: Record<ProviderId, string> = {
  laftel: "L",
  aniplus: "A+",
  crunchyroll: "C",
  netflix: "N",
  prime: "P",
  apple: "tv+",
  wavve: "W",
  tving: "T",
  coupang: "cp",
  watcha: "W",
};
const FormNoticeContext = React.createContext<string | null>(null);

function Artwork({
  src,
  title,
  className = "",
}: {
  src: string;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return /^https:\/\//i.test(src) && !failed ? (
    <img
      className={className}
      src={src}
      alt={title}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className={"artwork-fallback " + className}
      aria-label="대표 이미지 없음"
    >
      <Film strokeWidth={1.2} />
    </div>
  );
}

function Dialog({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const formError = React.useContext(FormNoticeContext);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + (wide ? "modal-wide" : "")}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={close} aria-label="닫기">
          <X size={20} />
        </button>
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      {children}
    </dialog>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [sort, setSort] = useState("recent");
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<{
    id: string;
    results: Availability[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [openingProviders, setOpeningProviders] = useState<ProviderId[]>([]);
  const lookupGeneration = useRef(0);
  const preferredResults = useRef(new Set<ProviderId>());
  const selectedBookmarkId = useRef<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
    } catch (e) {
      setNotice({
        text: e instanceof Error ? e.message : "보관함을 불러오지 못했어요.",
        error: true,
      });
    }
  }, []);
  const invalidateSearchResults = useCallback(() => {
    lookupGeneration.current++;
    preferredResults.current.clear();
    setAvailability(null);
    setSearching(false);
    setOpeningProviders([]);
  }, []);
  useEffect(() => {
    void load();
    const unsubscribe = api.subscribe(() => {
      void load();
    });
    const unsubscribeReset = api.subscribeSearchResultsCleared(() => {
      invalidateSearchResults();
      setNotice({
        text: "검색 결과를 초기화했어요. 다음 검색부터 새로 확인합니다.",
      });
      void load();
    });
    return () => {
      unsubscribe();
      unsubscribeReset();
    };
  }, [load, invalidateSearchResults]);
  const clearSearchResults = async () => {
    setBusy(true);
    try {
      const cleared = await api.clearSearchResults();
      invalidateSearchResults();
      await load();
      setNotice({
        text: `검색 결과와 ${cleared.bookmarks}개 작품의 자동 연결 ${cleared.links}개를 초기화했어요. 다음 검색부터 새로 확인합니다.`,
      });
    } catch (e) {
      setNotice({
        text:
          e instanceof Error ? e.message : "검색 결과를 초기화하지 못했어요.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (modal) setNotice(null);
  }, [modal]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const bookmarks = useMemo(
    () => snapshot?.bookmarks.filter((b) => b.deletedAt === undefined) ?? [],
    [snapshot],
  );
  const categories = useMemo(
    () => snapshot?.categories.filter((c) => c.deletedAt === undefined) ?? [],
    [snapshot],
  );
  const activeCategoryIds = useMemo(
    () => new Set(categories.map((c) => c.id)),
    [categories],
  );
  const activeCategory = view.startsWith("category:")
    ? categories.find((c) => c.id === view.slice(9))
    : undefined;
  const viewTitle =
    view === "all"
      ? "모든 작품"
      : view === "favorites"
        ? "즐겨찾기"
        : view === "uncategorized"
          ? "미분류"
          : (activeCategory?.name ?? "카테고리");
  const filtered = useMemo(
    () =>
      bookmarks
        .filter((b) => {
          if (view === "favorites" && !b.favorite) return false;
          if (
            view === "uncategorized" &&
            b.categoryIds.some((id) => activeCategoryIds.has(id))
          )
            return false;
          if (
            view.startsWith("category:") &&
            !b.categoryIds.includes(view.slice(9))
          )
            return false;
          if (
            subscribedOnly &&
            !snapshot?.settings.subscribedProviders.some((p) => b.links[p])
          )
            return false;
          const normalized = query.trim().toLocaleLowerCase();
          return (
            !normalized ||
            [b.title, ...b.aliases, b.description, b.notes].some((text) =>
              text.toLocaleLowerCase().includes(normalized),
            )
          );
        })
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title, "ko")
            : sort === "added"
              ? b.createdAt - a.createdAt
              : b.updatedAt - a.updatedAt,
        ),
    [bookmarks, view, query, subscribedOnly, snapshot, sort, activeCategoryIds],
  );
  useEffect(() => {
    if (!filtered.some((b) => b.id === selectedId))
      setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);
  useEffect(() => {
    if (view.startsWith("category:") && snapshot && !activeCategory)
      setView("all");
  }, [view, snapshot, activeCategory]);
  const selected = filtered.find((b) => b.id === selectedId) ?? null;
  selectedBookmarkId.current = selected?.id ?? null;
  useEffect(() => {
    lookupGeneration.current++;
    preferredResults.current.clear();
    setSearching(false);
    setOpeningProviders([]);
    setAvailability(null);
    return () => {
      lookupGeneration.current++;
    };
  }, [selected?.id]);
  const chooseView = (next: View) => {
    setView(next);
    setMobileDetail(false);
  };
  const run = async (
    fn: () => Promise<unknown>,
    success: string,
    close = true,
  ) => {
    setBusy(true);
    try {
      await fn();
      await load();
      if (close) setModal(null);
      setNotice({ text: success });
    } catch (e) {
      setNotice({
        text:
          e instanceof Error
            ? e.message
            : "처리하지 못했어요. 다시 시도해 주세요.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const pageForBookmark = (bookmark: Bookmark): PageTitle | null => {
    const link = Object.values(bookmark.links).find(
      (link) => link && safeProviderUrl(link.provider, link.url),
    );
    if (!link) return null;
    const refreshedSource =
      availability?.id === bookmark.id
        ? availability.results.find(
            (result) =>
              result.provider === link.provider &&
              result.status === "available" &&
              result.url &&
              providerTitleId(result.url) === providerTitleId(link.url),
          )
        : undefined;
    return cleanSearchPage(
      {
        title: link.title || bookmark.title,
        aliases: [...new Set([...bookmark.aliases, bookmark.title])],
        description: bookmark.description,
        imageUrl: bookmark.imageUrl,
        year: bookmark.year,
        provider: link.provider,
        url: link.url,
      },
      refreshedSource?.title ? [refreshedSource.title] : [],
    );
  };
  const lookup = async (bookmark: Bookmark) => {
    const page = pageForBookmark(bookmark);
    if (!page) {
      setNotice({
        text: "작품 정보 편집에서 OTT 작품 주소를 먼저 추가해 주세요.",
        error: true,
      });
      return;
    }
    const generation = ++lookupGeneration.current;
    preferredResults.current.clear();
    setAvailability({ id: bookmark.id, results: [] });
    setSearching(true);
    try {
      const results = await api.lookup(page, true, (result) => {
        if (
          generation !== lookupGeneration.current ||
          selectedBookmarkId.current !== bookmark.id ||
          preferredResults.current.has(result.provider)
        )
          return;
        setAvailability((current) => ({
          id: bookmark.id,
          results: [
            ...(current?.id === bookmark.id
              ? current.results.filter((r) => r.provider !== result.provider)
              : []),
            result,
          ],
        }));
      });
      if (
        generation === lookupGeneration.current &&
        selectedBookmarkId.current === bookmark.id
      )
        setAvailability((current) => ({
          id: bookmark.id,
          results: results.map((result) =>
            preferredResults.current.has(result.provider) &&
            current?.id === bookmark.id
              ? (current.results.find((r) => r.provider === result.provider) ??
                result)
              : result,
          ),
        }));
    } catch (e) {
      if (generation === lookupGeneration.current)
        setNotice({
          text:
            e instanceof Error ? e.message : "OTT 검색을 완료하지 못했어요.",
          error: true,
        });
    } finally {
      if (generation === lookupGeneration.current) setSearching(false);
    }
  };
  const openResult = async (
    bookmark: Bookmark,
    provider: ProviderId,
    candidateUrl?: string,
  ) => {
    const page = pageForBookmark(bookmark);
    if (!page) {
      setNotice({
        text: "작품 정보 편집에서 OTT 작품 주소를 먼저 추가해 주세요.",
        error: true,
      });
      return;
    }
    const generation = lookupGeneration.current;
    preferredResults.current.add(provider);
    setOpeningProviders((current) => [...current, provider]);
    try {
      const result = await api.openResolved(page, provider, candidateUrl);
      if (
        generation !== lookupGeneration.current ||
        selectedBookmarkId.current !== bookmark.id
      )
        return;
      setAvailability((current) => ({
        id: bookmark.id,
        results: [
          ...(current?.id === bookmark.id
            ? current.results.filter((r) => r.provider !== provider)
            : []),
          result,
        ],
      }));
      setNotice({
        text:
          result.status === "available" && result.opened !== false
            ? "제목이 일치하는 작품 페이지로 이동했어요."
            : result.reason || "동일한 작품을 확인하지 못했어요.",
      });
    } catch (e) {
      if (generation === lookupGeneration.current)
        setNotice({
          text:
            e instanceof Error ? e.message : "작품 페이지를 확인하지 못했어요.",
          error: true,
        });
    } finally {
      if (generation === lookupGeneration.current)
        setOpeningProviders((current) => current.filter((p) => p !== provider));
    }
  };
  const selectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error("가져올 파일은 10MB 이하여야 해요.");
      const backup = parseBackup(JSON.parse(await file.text()));
      setModal({ type: "import", backup, name: file.name });
    } catch (e) {
      setNotice({
        text:
          e instanceof Error
            ? e.message
            : "올바른 OTT Switch 백업 파일이 아니에요.",
        error: true,
      });
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="보관함 탐색">
        <a className="brand" href="library.html" aria-label="OTT Switch 보관함">
          <span className="brand-mark">
            <ArrowLeftRight size={22} strokeWidth={2.5} />
          </span>
          <span>
            ott<span className="brand-light">switch</span>
            <small>YOUR STORIES, TOGETHER</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">나</span>
          <span>
            나의 보관함<small>이 브라우저에 저장됨</small>
          </span>
          <ShieldCheck size={16} />
        </div>
        <div className="section-eyebrow">LIBRARY</div>
        <nav className="main-nav">
          <button
            className={"nav-item " + (view === "all" ? "active" : "")}
            aria-label="모든 작품"
            onClick={() => chooseView("all")}
          >
            <Layers3 size={18} />
            <span>모든 작품</span>
            <span className="nav-count">{bookmarks.length}</span>
          </button>
          <button
            className={"nav-item " + (view === "favorites" ? "active" : "")}
            aria-label="즐겨찾기"
            onClick={() => chooseView("favorites")}
          >
            <Heart size={18} />
            <span>즐겨찾기</span>
            <span className="nav-count">
              {bookmarks.filter((b) => b.favorite).length}
            </span>
          </button>
          <button
            className={"nav-item " + (view === "uncategorized" ? "active" : "")}
            aria-label="미분류"
            onClick={() => chooseView("uncategorized")}
          >
            <BookmarkIcon size={18} />
            <span>미분류</span>
            <span className="nav-count">
              {
                bookmarks.filter(
                  (b) => !b.categoryIds.some((id) => activeCategoryIds.has(id)),
                ).length
              }
            </span>
          </button>
        </nav>
        <div className="section-eyebrow category-heading">
          <span>COLLECTIONS</span>
          <button
            className="icon-button small"
            onClick={() => setModal({ type: "category" })}
            aria-label="카테고리 추가"
          >
            <Plus size={17} />
          </button>
        </div>
        <nav className="category-nav" aria-label="카테고리">
          {categories.map((category) => (
            <div
              className={
                "category-row " +
                (activeCategory?.id === category.id ? "active" : "")
              }
              key={category.id}
            >
              <button
                className="nav-item"
                title={category.name}
                aria-label={category.name}
                onClick={() => chooseView(("category:" + category.id) as View)}
              >
                <span
                  className="category-dot"
                  style={{ background: category.color }}
                />
                <span>{category.name}</span>
                <span className="nav-count">
                  {
                    bookmarks.filter((b) => b.categoryIds.includes(category.id))
                      .length
                  }
                </span>
              </button>
              <button
                className="category-edit icon-button small"
                aria-label={category.name + " 카테고리 편집"}
                onClick={() => setModal({ type: "category", category })}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
        </nav>
        <button
          className="add-collection"
          onClick={() => setModal({ type: "category" })}
        >
          <FolderPlus size={16} />새 카테고리
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" />
            <div>
              당신만의 작품 기록<small>계정 없이, 로컬에 안전하게</small>
            </div>
          </div>
          <button
            className="nav-item utility"
            aria-label="내보내기"
            onClick={() => setModal({ type: "export" })}
          >
            <ArrowUpFromLine size={17} />
            <span>내보내기</span>
          </button>
          <button
            className="nav-item utility"
            aria-label="가져오기"
            onClick={() => importRef.current?.click()}
          >
            <ArrowDownToLine size={17} />
            <span>가져오기</span>
          </button>
          <div className="sidebar-footer">
            <button
              onClick={() => setModal({ type: "settings" })}
              aria-label="설정"
            >
              <Settings2 size={16} />
              <span>설정</span>
            </button>
            <button
              onClick={() => setModal({ type: "help" })}
              aria-label="사용 안내"
            >
              <CircleHelp size={18} />
            </button>
            <span>v0.1.3</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>내 라이브러리</span>
            <ChevronRight size={15} />
            <strong>{viewTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-badge">
              <span className="status-dot" />
              로컬 보관함
            </span>
            <button
              className="button primary compact"
              onClick={() => setModal({ type: "add" })}
            >
              <Plus size={16} />
              작품 추가
            </button>
          </div>
        </header>
        <div className={"content-grid " + (mobileDetail ? "show-detail" : "")}>
          <section className="title-column" aria-label="작품 목록">
            <div className="list-heading">
              <div>
                <span className="section-eyebrow">YOUR COLLECTION</span>
                <h1>
                  {viewTitle}
                  <span>{filtered.length}</span>
                </h1>
              </div>
              {activeCategory && (
                <button
                  className="icon-button"
                  onClick={() =>
                    setModal({ type: "category", category: activeCategory })
                  }
                  aria-label="현재 카테고리 편집"
                >
                  <MoreHorizontal size={20} />
                </button>
              )}
            </div>
            <div className="search-field">
              <Search size={17} />
              <input
                ref={searchRef}
                aria-label="보관함 검색"
                placeholder="제목, 소개, 메모 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>Ctrl K</kbd>
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="icon-button small"
                  aria-label="검색어 지우기"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="list-filters">
              <button
                className={"filter-chip " + (subscribedOnly ? "selected" : "")}
                onClick={() => setSubscribedOnly(!subscribedOnly)}
                aria-pressed={subscribedOnly}
              >
                <span className="tiny-dot" />내 구독 OTT
              </button>
              <label className="sort-select">
                <span className="sr-only">작품 정렬</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="recent">최근 수정순</option>
                  <option value="added">최근 추가순</option>
                  <option value="title">제목순</option>
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
            <div
              className="title-list"
              role="list"
              aria-label={viewTitle + " 작품"}
            >
              {!snapshot ? (
                <div className="list-empty">
                  <LoaderCircle className="spin" />
                  <p>보관함을 불러오는 중</p>
                  <button className="text-button" onClick={() => void load()}>
                    다시 불러오기
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="list-empty">
                  <Search size={27} strokeWidth={1.3} />
                  <h3>
                    {bookmarks.length
                      ? "작품이 없어요"
                      : "첫 작품을 기다리고 있어요"}
                  </h3>
                  <p>
                    {query
                      ? "다른 검색어를 입력해 보세요."
                      : subscribedOnly
                        ? "설정에서 구독 OTT를 선택하거나 필터를 꺼 보세요."
                        : bookmarks.length
                          ? "이 카테고리에 작품을 담아 보세요."
                          : "마음에 드는 작품을 나만의 보관함에 모아 보세요."}
                  </p>
                  {(query || subscribedOnly) && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setQuery("");
                        setSubscribedOnly(false);
                      }}
                    >
                      검색과 필터 초기화
                    </button>
                  )}
                </div>
              ) : (
                filtered.map((bookmark) => (
                  <button
                    role="listitem"
                    key={bookmark.id}
                    className={
                      "title-card " +
                      (selected?.id === bookmark.id ? "selected" : "")
                    }
                    onClick={() => {
                      setSelectedId(bookmark.id);
                      setMobileDetail(true);
                    }}
                    aria-current={
                      selected?.id === bookmark.id ? "true" : undefined
                    }
                  >
                    <Artwork
                      src={bookmark.imageUrl}
                      title=""
                      className="list-artwork"
                    />
                    <span className="title-card-body">
                      <span className="title-card-top">
                        <span className="title-card-name">
                          {bookmark.title}
                        </span>
                        {bookmark.favorite && (
                          <Heart
                            size={13}
                            fill="currentColor"
                            className="favorite-mark"
                          />
                        )}
                      </span>
                      <span className="title-card-meta">
                        {bookmark.year && bookmark.year + " · "}
                        {Object.values(bookmark.links)
                          .filter(Boolean)
                          .map(
                            (link) =>
                              providers.find((p) => p.id === link?.provider)
                                ?.name,
                          )
                          .join(" · ") || "연결된 OTT 없음"}
                      </span>
                      <span className="title-card-bottom">
                        <span className="mini-category">
                          {categories.find((c) =>
                            bookmark.categoryIds.includes(c.id),
                          )?.name ?? "미분류"}
                        </span>
                        <time
                          dateTime={new Date(bookmark.updatedAt).toISOString()}
                        >
                          {dateLabel(bookmark.updatedAt)}
                        </time>
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="list-footer">
              <BookmarkIcon size={13} />
              <span>{bookmarks.length}개의 이야기, 하나의 보관함</span>
            </div>
          </section>
          <section className="detail-column" aria-label="작품 상세 미리보기">
            {selected ? (
              <>
                <div className="detail-toolbar">
                  <button
                    className="back-button text-button"
                    onClick={() => setMobileDetail(false)}
                  >
                    ← 목록
                  </button>
                  <span className="detail-caption">
                    <BookmarkIcon size={14} />
                    나의 작품 기록
                  </span>
                  <div className="detail-actions">
                    <button
                      className={
                        "icon-button " +
                        (selected.favorite ? "is-favorite" : "")
                      }
                      aria-label={
                        selected.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"
                      }
                      aria-pressed={selected.favorite}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api.updateBookmark(selected.id, {
                              favorite: !selected.favorite,
                            }),
                          selected.favorite
                            ? "즐겨찾기에서 해제했어요."
                            : "즐겨찾기에 담았어요.",
                          false,
                        )
                      }
                    >
                      <Heart
                        size={18}
                        fill={selected.favorite ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() =>
                        setModal({ type: "edit", bookmark: selected })
                      }
                      aria-label="작품 정보 편집"
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="icon-button danger-hover"
                      onClick={() =>
                        setModal({ type: "delete", bookmark: selected })
                      }
                      aria-label="작품 삭제"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
                <div className="detail-scroll">
                  <div className="hero">
                    <Artwork
                      src={selected.imageUrl}
                      title={selected.title}
                      className="hero-artwork"
                    />
                    <div className="hero-shade" />
                    <div className="hero-content">
                      <div className="hero-eyebrow">
                        <span className="tiny-dot" />
                        IN MY COLLECTION
                      </div>
                      <h2>{selected.title}</h2>
                      <div className="hero-meta">
                        {selected.year && <span>{selected.year}</span>}
                        {categories
                          .filter((c) => selected.categoryIds.includes(c.id))
                          .map((c) => (
                            <span key={c.id} className="hero-category">
                              <span
                                className="category-dot"
                                style={{ background: c.color }}
                              />
                              {c.name}
                            </span>
                          ))}
                        {!selected.categoryIds.some((id) =>
                          activeCategoryIds.has(id),
                        ) && <span className="hero-category">미분류</span>}
                      </div>
                    </div>
                  </div>
                  <div className="detail-body">
                    <section className="synopsis">
                      <div className="block-heading">
                        <h3>작품 소개</h3>
                        <button
                          className="icon-button small"
                          onClick={() =>
                            setModal({ type: "edit", bookmark: selected })
                          }
                          aria-label="소개 편집"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                      <p className={selected.description ? "" : "muted"}>
                        {selected.description ||
                          "아직 저장된 소개가 없어요. 작품 정보를 편집해서 나만의 소개를 적어 보세요."}
                      </p>
                    </section>
                    <section className="where-to-watch">
                      <div className="block-heading">
                        <div>
                          <h3>
                            <ArrowLeftRight size={17} />
                            어디에서 볼까요?
                          </h3>
                          <p>연결된 작품 페이지로 바로 이동하세요.</p>
                        </div>
                        <button
                          className="text-button"
                          disabled={searching || openingProviders.length > 0}
                          onClick={() => void lookup(selected)}
                        >
                          {searching ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Search size={14} />
                          )}
                          {searching ? "확인 중" : "다른 OTT 찾기"}
                        </button>
                      </div>
                      {(searching || openingProviders.length > 0) && (
                        <p className="lookup-caption" role="status">
                          작품 확인용 검색 탭이 잠시 열리고, 확인이 끝나면
                          자동으로 닫혀요.
                        </p>
                      )}
                      <div className="provider-grid">
                        {providers.map((provider) => {
                          const found =
                            availability?.id === selected.id
                              ? availability.results.find(
                                  (r) => r.provider === provider.id,
                                )
                              : undefined;
                          const saved = selected.links[provider.id];
                          const isOpening = openingProviders.includes(
                            provider.id,
                          );
                          const isChecking = isOpening || (searching && !found);
                          const url =
                            found?.status === "available" && found.url
                              ? found.url
                              : saved?.url;
                          const available =
                            url &&
                            safeProviderUrl(provider.id, url) &&
                            (!found ||
                              found.status === "available" ||
                              saved?.source === "manual");
                          const isSubscribed =
                            snapshot?.settings.subscribedProviders.includes(
                              provider.id,
                            );
                          return (
                            <div
                              className={
                                "provider-card " +
                                (available ? "available" : "")
                              }
                              key={provider.id}
                            >
                              <div className="provider-card-title">
                                <span
                                  className={
                                    "provider-symbol provider-" + provider.id
                                  }
                                  style={{ color: provider.color }}
                                >
                                  {providerLetters[provider.id]}
                                </span>
                                <span>
                                  {provider.name}
                                  <small>
                                    {isSubscribed ? "구독 중" : "미구독"}
                                  </small>
                                </span>
                              </div>
                              {available ? (
                                <a
                                  className="switch-link"
                                  href={url}
                                  target={
                                    snapshot?.settings.openInNewTab
                                      ? "_blank"
                                      : "_self"
                                  }
                                  rel="noopener noreferrer"
                                >
                                  스위치
                                  <ExternalLink size={13} />
                                </a>
                              ) : (
                                <button
                                  className="switch-link"
                                  disabled={
                                    isChecking ||
                                    found?.status === "unavailable"
                                  }
                                  aria-label={`${provider.name}에서 제목 확인 후 이동`}
                                  onClick={() =>
                                    void openResult(selected, provider.id)
                                  }
                                >
                                  {isChecking ? (
                                    <LoaderCircle className="spin" size={13} />
                                  ) : (
                                    <ArrowLeftRight size={13} />
                                  )}
                                  {isChecking
                                    ? "확인 중"
                                    : found?.status === "unavailable"
                                      ? "검색 결과 없음"
                                      : "찾아서 이동"}
                                </button>
                              )}
                              <div className="provider-card-foot">
                                <span title={found?.reason}>
                                  {available
                                    ? saved?.source === "manual"
                                      ? "직접 연결한 작품"
                                      : found
                                        ? "작품 페이지 확인됨"
                                        : "저장된 작품 링크"
                                    : found?.reason ||
                                      "검색 결과의 제목을 확인해 작품으로 이동해요"}
                                </span>
                                <a
                                  href={provider.searchUrl(
                                    pageForBookmark(selected)?.title ||
                                      selected.title,
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={
                                    provider.name +
                                    "에서 " +
                                    selected.title +
                                    " 검색"
                                  }
                                >
                                  직접 검색
                                  <ChevronRight size={12} />
                                </a>
                              </div>
                              {found?.status === "ambiguous" && (
                                <details className="provider-candidates">
                                  <summary>
                                    같은 제목의 작품{" "}
                                    {found.candidates?.length || 0}개
                                  </summary>
                                  {found.candidates
                                    ?.filter((candidate) =>
                                      safeProviderUrl(
                                        provider.id,
                                        candidate.url,
                                      ),
                                    )
                                    .map((candidate) => (
                                      <div key={candidate.url}>
                                        <span>{candidate.title}</span>
                                        <button
                                          className="text-button"
                                          disabled={isOpening}
                                          onClick={() =>
                                            void openResult(
                                              selected,
                                              provider.id,
                                              candidate.url,
                                            )
                                          }
                                        >
                                          {isOpening
                                            ? "확인 중…"
                                            : "이 작품으로 이동"}
                                          <ExternalLink size={12} />
                                        </button>
                                      </div>
                                    ))}
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {availability?.id === selected.id && (
                        <p className="lookup-caption">
                          {dateLabel(
                            Math.max(
                              ...availability.results.map((a) => a.checkedAt),
                              0,
                            ) || Date.now(),
                          )}{" "}
                          조회 · 제공 지역과 구매·대여 여부는 각 OTT에서 확인해
                          주세요.
                        </p>
                      )}
                    </section>
                    {selected.aliases.length > 0 && (
                      <section className="aliases">
                        <h3>다른 제목</h3>
                        <div>
                          {selected.aliases.map((alias, index) => (
                            <span key={alias + index}>{alias}</span>
                          ))}
                        </div>
                      </section>
                    )}
                    <section className="personal-note">
                      <div className="block-heading">
                        <h3>
                          <Pencil size={14} />
                          나의 메모
                        </h3>
                        <button
                          className="text-button"
                          onClick={() =>
                            setModal({ type: "edit", bookmark: selected })
                          }
                        >
                          {selected.notes ? "편집" : "메모 추가"}
                        </button>
                      </div>
                      <p className={selected.notes ? "" : "muted"}>
                        {selected.notes ||
                          "기억하고 싶은 장면, 다음에 볼 에피소드… 자유롭게 남겨 보세요."}
                      </p>
                    </section>
                    <footer className="detail-footer">
                      <span>
                        <ShieldCheck size={14} />이 브라우저에 저장된 작품
                      </span>
                      <span>
                        {dateLabel(selected.createdAt)} 추가 ·{" "}
                        {dateLabel(selected.updatedAt)} 수정
                      </span>
                    </footer>
                  </div>
                </div>
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-orbit">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <span className="orbit-node node-one">
                    <Film size={23} />
                  </span>
                  <span className="orbit-node node-two">
                    <BookmarkIcon size={20} />
                  </span>
                  <span className="orbit-node node-three">
                    <Heart size={17} />
                  </span>
                  <div className="welcome-mark">
                    <ArrowLeftRight size={43} strokeWidth={1.4} />
                  </div>
                </div>
                <span className="welcome-eyebrow">
                  ONE LIBRARY. EVERY STORY.
                </span>
                <h2>
                  {bookmarks.length ? (
                    "다음 이야기를 골라 보세요."
                  ) : (
                    <>
                      보고 싶은 모든 이야기,
                      <br />
                      이곳에 모아 두세요.
                    </>
                  )}
                </h2>
                <p>
                  {bookmarks.length ? (
                    "카테고리나 검색 조건을 바꿔 작품을 찾아보세요."
                  ) : (
                    <>
                      OTT마다 흩어진 작품을 나만의 카테고리로 정리하고,
                      <br />
                      내가 구독하는 곳에서 바로 이어 보세요.
                    </>
                  )}
                </p>
                <button
                  className="button primary"
                  onClick={() => setModal({ type: "add" })}
                >
                  <Plus size={17} />
                  {bookmarks.length ? "새 작품 담기" : "첫 작품 담기"}
                </button>
                <div className="welcome-providers">
                  {providers.slice(0, 5).map((provider) => (
                    <a
                      href={provider.searchUrl("")}
                      target="_blank"
                      rel="noopener noreferrer"
                      key={provider.id}
                    >
                      {provider.name}
                      <ExternalLink size={11} />
                    </a>
                  ))}
                  <span>외 {providers.length - 5}개 OTT</span>
                </div>
                <div className="welcome-tip">
                  <span className="tip-icon">
                    <Sparkles size={17} />
                  </span>
                  <p>
                    <strong>작품 페이지에서도 바로 담을 수 있어요</strong>
                    <span>
                      지원하는 OTT의 작품 상세 페이지에서 왼쪽 스위치 탭을 열어
                      보세요.
                    </span>
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="백업 파일 선택"
        onChange={(e) => void selectFile(e)}
      />
      {notice && (
        <div
          className={"toast " + (notice.error ? "error" : "")}
          role={notice.error ? "alert" : "status"}
        >
          <span>
            {notice.error ? <CircleHelp size={18} /> : <Check size={18} />}
          </span>
          <p>{notice.text}</p>
          <button
            className="icon-button small"
            onClick={() => setNotice(null)}
            aria-label="알림 닫기"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal && snapshot && (
        <FormNoticeContext.Provider value={notice?.error ? notice.text : null}>
          <ModalContent
            modal={modal}
            setModal={setModal}
            snapshot={snapshot}
            categories={categories}
            bookmarks={bookmarks}
            busy={busy}
            run={run}
            clearSearchResults={clearSearchResults}
            notice={notice && !notice.error ? notice.text : undefined}
            view={view}
          />
        </FormNoticeContext.Provider>
      )}
    </div>
  );
}

type ModalProps = {
  modal: Exclude<Modal, null>;
  setModal: (value: Modal) => void;
  snapshot: LibrarySnapshot;
  categories: Category[];
  bookmarks: Bookmark[];
  busy: boolean;
  run: (
    fn: () => Promise<unknown>,
    success: string,
    close?: boolean,
  ) => Promise<void>;
  view: View;
  clearSearchResults: () => Promise<void>;
  notice?: string;
};
function ModalContent({
  modal,
  setModal,
  snapshot,
  categories,
  bookmarks,
  busy,
  run,
  view,
  clearSearchResults,
  notice,
}: ModalProps) {
  const close = () => {
    if (!busy) setModal(null);
  };
  const submitButtons = (label = "저장") => (
    <div className="modal-actions">
      <button
        type="button"
        className="button ghost"
        onClick={close}
        disabled={busy}
      >
        취소
      </button>
      <button className="button primary" type="submit" disabled={busy}>
        {busy && <LoaderCircle size={16} className="spin" />}
        {label}
      </button>
    </div>
  );
  if (modal.type === "category")
    return (
      <Dialog
        title={modal.category ? "카테고리 편집" : "새 카테고리"}
        subtitle="작품을 나만의 기준으로 정리해 보세요."
        close={close}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(
              () =>
                api.saveCategory(
                  String(data.get("name")).trim(),
                  String(data.get("color")),
                  modal.category?.id,
                ),
              modal.category
                ? "카테고리를 수정했어요."
                : "새 카테고리를 만들었어요.",
            );
          }}
        >
          <label className="field">
            카테고리 이름
            <input
              name="name"
              placeholder="예: 주말에 몰아볼 작품"
              defaultValue={modal.category?.name}
              required
              maxLength={80}
              autoFocus
            />
          </label>
          <fieldset className="color-field">
            <legend>표시 색상</legend>
            {categoryColors.map((color, index) => (
              <label
                className="color-choice"
                key={color}
                style={{ "--choice-color": color } as React.CSSProperties}
              >
                <input
                  type="radio"
                  name="color"
                  value={color}
                  defaultChecked={
                    modal.category
                      ? modal.category.color === color
                      : index === 0
                  }
                />
                <span />
                <span className="sr-only">색상 {index + 1}</span>
              </label>
            ))}
            {modal.category &&
              !categoryColors.includes(modal.category.color) && (
                <label
                  className="color-choice"
                  style={
                    {
                      "--choice-color": modal.category.color,
                    } as React.CSSProperties
                  }
                >
                  <input
                    type="radio"
                    name="color"
                    value={modal.category.color}
                    defaultChecked
                  />
                  <span />
                  <span className="sr-only">현재 색상</span>
                </label>
              )}
          </fieldset>
          {modal.category && (
            <button
              type="button"
              className="text-button danger"
              onClick={() =>
                setModal({ type: "delete-category", category: modal.category! })
              }
            >
              <Trash2 size={14} />이 카테고리 삭제
            </button>
          )}
          {submitButtons()}
        </form>
      </Dialog>
    );
  if (modal.type === "delete-category")
    return (
      <Dialog title="카테고리를 삭제할까요?" close={close}>
        <p className="modal-copy">
          ‘{modal.category.name}’ 카테고리를 삭제합니다. 담긴 작품은 보관함에
          그대로 남습니다.
        </p>
        <div className="modal-actions">
          <button className="button ghost" onClick={close} disabled={busy}>
            취소
          </button>
          <button
            className="button danger-button"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.deleteCategory(modal.category.id),
                "카테고리를 삭제했어요.",
              )
            }
          >
            카테고리 삭제
          </button>
        </div>
      </Dialog>
    );
  if (modal.type === "delete")
    return (
      <Dialog title="작품을 삭제할까요?" close={close}>
        <p className="modal-copy">
          ‘{modal.bookmark.title}’ 작품과 저장한 메모를 보관함에서 삭제합니다.
        </p>
        <div className="modal-actions">
          <button className="button ghost" onClick={close} disabled={busy}>
            취소
          </button>
          <button
            className="button danger-button"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.deleteBookmark(modal.bookmark.id),
                "작품을 삭제했어요.",
              )
            }
          >
            작품 삭제
          </button>
        </div>
      </Dialog>
    );
  if (modal.type === "edit")
    return (
      <BookmarkEditor
        bookmark={modal.bookmark}
        categories={categories}
        close={close}
        busy={busy}
        run={run}
      />
    );
  if (modal.type === "add")
    return (
      <AddBookmark
        categories={categories}
        close={close}
        busy={busy}
        run={run}
        view={view}
      />
    );
  if (modal.type === "settings")
    return (
      <Dialog
        title="내 보관함 설정"
        subtitle="구독하는 OTT를 선택하면 작품을 더 빠르게 찾을 수 있어요."
        close={close}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(
              () =>
                api.updateSettings({
                  subscribedProviders: data.getAll("provider") as ProviderId[],
                  openInNewTab: data.has("newTab"),
                }),
              "설정을 저장했어요.",
            );
          }}
        >
          <fieldset className="provider-options">
            <legend>구독 중인 OTT</legend>
            {providers.map((p) => (
              <label key={p.id} className="check-card">
                <input
                  type="checkbox"
                  name="provider"
                  value={p.id}
                  defaultChecked={snapshot.settings.subscribedProviders.includes(
                    p.id,
                  )}
                />
                <span
                  className="category-dot"
                  style={{ background: p.color }}
                />
                {p.name}
              </label>
            ))}
          </fieldset>
          <label className="check-row setting-row">
            <input
              type="checkbox"
              name="newTab"
              defaultChecked={snapshot.settings.openInNewTab}
            />
            <span>
              스위치할 때 새 탭에서 열기
              <small>현재 보고 있는 작품 페이지를 유지합니다.</small>
            </span>
          </label>
          <div className="setting-info">
            <span>검색 지역</span>
            <strong>대한민국 · KR</strong>
          </div>
          <div className="search-reset-settings">
            <p>
              임시 검색 결과와 자동으로 저장한 OTT 연결을 비웁니다. 작품,
              카테고리, 직접 연결한 주소는 유지됩니다.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void clearSearchResults()}
            >
              <RotateCcw size={15} />
              검색 결과 초기화
            </button>
            {notice && <p role="status">{notice}</p>}
          </div>
          <div className="future-feature">
            <ShieldCheck size={21} />
            <div>
              <strong>지금은 로컬에 저장해요</strong>
              <p>
                JSON 파일로 백업하고 다른 브라우저로 옮길 수 있습니다. Google
                Drive 자동 동기화는 추후 제공 예정입니다.
              </p>
            </div>
          </div>
          {submitButtons()}
        </form>
      </Dialog>
    );
  if (modal.type === "export")
    return (
      <Dialog
        title="보관함 내보내기"
        subtitle="전체 보관함을 백업하거나, 카테고리를 골라 공유하세요."
        close={close}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const ids = data.getAll("category") as string[];
            void run(async () => {
              if (data.get("scope") === "group" && ids.length === 0)
                throw new Error("공유할 카테고리를 하나 이상 선택해 주세요.");
              const backup = await api.exportBackup(
                data.get("scope") === "full" ? undefined : ids,
              );
              const blob = new Blob([JSON.stringify(backup, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download =
                "ott-switch-" +
                backup.scope +
                "-" +
                new Date().toISOString().slice(0, 10) +
                ".json";
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, "JSON 파일을 내보냈어요.");
          }}
        >
          <label className="check-card export-option">
            <input type="radio" name="scope" value="full" defaultChecked />
            <span>
              전체 보관함 백업
              <small>
                작품 {bookmarks.length}개, 카테고리, 설정, 삭제 기록 포함
              </small>
            </span>
          </label>
          <label className="check-card export-option">
            <input type="radio" name="scope" value="group" />
            <span>
              카테고리 그룹 공유
              <small>
                선택한 카테고리와 작품만 포함 · 메모와 즐겨찾기 제외
              </small>
            </span>
          </label>
          <div className="category-checkboxes export-categories">
            {categories.length ? (
              categories.map((c) => (
                <label key={c.id} className="check-row">
                  <input
                    name="category"
                    type="checkbox"
                    value={c.id}
                    defaultChecked={view === "category:" + c.id}
                  />
                  <span
                    className="category-dot"
                    style={{ background: c.color }}
                  />
                  {c.name}
                </label>
              ))
            ) : (
              <p className="muted">아직 카테고리가 없어요.</p>
            )}
          </div>
          {submitButtons("JSON 내보내기")}
        </form>
      </Dialog>
    );
  if (modal.type === "import")
    return (
      <Dialog title="백업을 가져올까요?" subtitle={modal.name} close={close}>
        <div className="import-summary">
          <div>
            <strong>
              {
                modal.backup.data.bookmarks.filter(
                  (b) => b.deletedAt === undefined,
                ).length
              }
            </strong>
            <span>작품</span>
          </div>
          <div>
            <strong>
              {
                modal.backup.data.categories.filter(
                  (c) => c.deletedAt === undefined,
                ).length
              }
            </strong>
            <span>카테고리</span>
          </div>
          <div>
            <strong>{modal.backup.scope === "full" ? "전체" : "그룹"}</strong>
            <span>백업 종류</span>
          </div>
        </div>
        <p className="modal-copy">
          같은 항목은 더 최근에 수정한 내용으로 병합합니다.{" "}
          {modal.backup.scope === "full"
            ? "전체 백업에는 설정과 삭제 기록도 포함되어 있어 기존 작품이 삭제될 수 있습니다."
            : "현재 설정과 개인 메모, 즐겨찾기는 유지됩니다."}
        </p>
        <p className="muted small-copy">
          파일 생성일:{" "}
          {new Date(modal.backup.exportedAt).toLocaleString("ko-KR")}
        </p>
        <div className="modal-actions">
          <button className="button ghost" onClick={close} disabled={busy}>
            취소
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.importBackup(modal.backup),
                "백업을 보관함에 병합했어요.",
              )
            }
          >
            병합하여 가져오기
          </button>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title="OTT Switch 시작하기"
      subtitle="마음에 든 작품을 발견하는 순간부터, 다시 보는 순간까지."
      close={close}
    >
      <div className="help-steps">
        <div>
          <span>01</span>
          <div>
            <h3>작품 페이지에서 열기</h3>
            <p>
              지원하는 10개 OTT의 작품 상세 페이지에서 왼쪽 스위치 탭을 여세요.
              검색·재생 화면에서는 표시되지 않습니다.
            </p>
          </div>
        </div>
        <div>
          <span>02</span>
          <div>
            <h3>보관하고, 나답게 정리하기</h3>
            <p>
              카테고리를 골라 작품을 담고 이 보관함에서 이미지, 소개, 메모를
              편집하세요. 이미지는 주소만 저장합니다.
            </p>
          </div>
        </div>
        <div>
          <span>03</span>
          <div>
            <h3>구독하는 OTT로 스위치</h3>
            <p>
              제목이 일치하는 작품을 확인하면 상세 페이지로 바로 이동합니다.
              같은 제목이 여러 개면 후보를 고르고, 로그인이 필요하면 해당
              OTT에서 로그인한 뒤 다시 확인해 주세요.
            </p>
          </div>
        </div>
      </div>
      <div className="future-feature">
        <ArrowUpFromLine size={20} />
        <div>
          <strong>정기적으로 JSON 백업을 권장해요</strong>
          <p>
            브라우저 확장 프로그램을 삭제하면 로컬 데이터도 지워집니다.
            내보내기로 작품 기록을 보관하세요.
          </p>
        </div>
      </div>
      <div className="modal-actions">
        <button className="button primary" onClick={close}>
          시작하기
        </button>
      </div>
    </Dialog>
  );
}

function BookmarkEditor({
  bookmark,
  categories,
  close,
  busy,
  run,
}: {
  bookmark: Bookmark;
  categories: Category[];
  close: () => void;
  busy: boolean;
  run: ModalProps["run"];
}) {
  const [imageUrl, setImageUrl] = useState(bookmark.imageUrl);
  return (
    <Dialog
      title="작품 정보 편집"
      subtitle="내가 고른 이미지와 소개는 OTT 원본보다 우선해서 표시됩니다."
      close={close}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void run(async () => {
            const links: Bookmark["links"] = {};
            for (const provider of providers) {
              const url = String(data.get("link-" + provider.id) ?? "").trim();
              if (!url) continue;
              if (!safeProviderUrl(provider.id, url))
                throw new Error(
                  provider.name +
                    "의 올바른 HTTPS 작품 상세 주소를 입력해 주세요.",
                );
              links[provider.id] =
                bookmark.links[provider.id]?.url === url
                  ? bookmark.links[provider.id]
                  : {
                      provider: provider.id,
                      url,
                      title: String(data.get("title")).trim(),
                      verifiedAt: Date.now(),
                      source: "manual",
                    };
            }
            const patch: BookmarkPatch = {
              title: String(data.get("title")).trim(),
              aliases: String(data.get("aliases"))
                .split("\n")
                .map((a) => a.trim())
                .filter(Boolean),
              imageUrl: String(data.get("imageUrl")).trim(),
              description: String(data.get("description")).trim(),
              notes: String(data.get("notes")).trim(),
              categoryIds: data.getAll("category") as string[],
              links,
              year: data.get("year") ? Number(data.get("year")) : null,
            };
            await api.updateBookmark(bookmark.id, patch);
          }, "작품 정보를 저장했어요.");
        }}
      >
        <div className="edit-image-row">
          <Artwork
            src={imageUrl}
            title="대표 이미지 미리보기"
            className="edit-preview"
          />
          <div>
            <label className="field">
              대표 이미지 주소
              <input
                name="imageUrl"
                type="url"
                placeholder="https://..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                maxLength={4096}
              />
            </label>
            <p className="field-help">
              HTTPS 이미지 URL만 저장합니다. 비워 두면 기본 이미지가 표시됩니다.
            </p>
          </div>
        </div>
        <div className="form-columns">
          <label className="field">
            작품 제목
            <input
              name="title"
              defaultValue={bookmark.title}
              required
              maxLength={300}
              autoFocus
            />
          </label>
          <label className="field year-field">
            공개 연도
            <input
              name="year"
              type="number"
              min="1888"
              max="2200"
              defaultValue={bookmark.year}
              placeholder="선택"
            />
          </label>
        </div>
        <label className="field">
          작품 소개
          <textarea
            name="description"
            rows={4}
            maxLength={20000}
            defaultValue={bookmark.description}
            placeholder="작품을 소개해 주세요."
          />
        </label>
        <fieldset className="category-field">
          <legend>카테고리</legend>
          <div className="category-checkboxes">
            {categories.map((c) => (
              <label key={c.id} className="check-row">
                <input
                  type="checkbox"
                  name="category"
                  value={c.id}
                  defaultChecked={bookmark.categoryIds.includes(c.id)}
                />
                <span
                  className="category-dot"
                  style={{ background: c.color }}
                />
                {c.name}
              </label>
            ))}
            {!categories.length && (
              <p className="muted">
                카테고리를 만들면 여기에서 선택할 수 있어요.
              </p>
            )}
          </div>
        </fieldset>
        <label className="field">
          나의 메모
          <textarea
            name="notes"
            rows={3}
            maxLength={10000}
            defaultValue={bookmark.notes}
            placeholder="나중에 다시 보고 싶은 이유를 적어 보세요."
          />
        </label>
        <details className="advanced-fields">
          <summary>
            OTT 연결 주소와 다른 제목
            <ChevronDown size={16} />
          </summary>
          <p className="field-help">
            같은 작품인지 직접 확인한 상세 페이지 주소를 입력하세요. 검색·재생
            주소는 연결할 수 없습니다.
          </p>
          {providers.map((p) => (
            <label key={p.id} className="field">
              {p.name}
              <input
                name={"link-" + p.id}
                type="url"
                placeholder={p.name + " 작품 상세 페이지 URL"}
                defaultValue={bookmark.links[p.id]?.url ?? ""}
                maxLength={4096}
              />
            </label>
          ))}
          <label className="field">
            다른 제목
            <textarea
              name="aliases"
              rows={2}
              maxLength={4000}
              defaultValue={bookmark.aliases.join("\n")}
              placeholder="원제, 영문 제목 등을 한 줄에 하나씩 입력"
            />
          </label>
        </details>
        <div className="modal-actions">
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={close}
          >
            취소
          </button>
          <button className="button primary" disabled={busy} type="submit">
            {busy && <LoaderCircle size={16} className="spin" />}변경사항 저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddBookmark({
  categories,
  close,
  busy,
  run,
  view,
}: {
  categories: Category[];
  close: () => void;
  busy: boolean;
  run: ModalProps["run"];
  view: View;
}) {
  return (
    <Dialog
      title="작품 직접 추가"
      subtitle="OTT 작품 상세 주소를 알고 있다면 여기에서도 담을 수 있어요."
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void run(async () => {
            const provider = String(data.get("provider")) as ProviderId;
            const url = String(data.get("url")).trim();
            if (!safeProviderUrl(provider, url))
              throw new Error(
                "선택한 OTT의 HTTPS 작품 상세 주소를 입력해 주세요. 검색·재생 주소는 사용할 수 없어요.",
              );
            await api.saveBookmark({
              page: {
                title: String(data.get("title")).trim(),
                provider,
                url,
                description: String(data.get("description")).trim(),
                imageUrl: String(data.get("imageUrl")).trim(),
                aliases: [],
              },
              categoryIds: data.getAll("category") as string[],
            });
          }, "새 작품을 보관함에 담았어요.");
        }}
      >
        <label className="field">
          작품 제목
          <input
            name="title"
            required
            maxLength={300}
            placeholder="보관할 작품의 제목"
            autoFocus
          />
        </label>
        <label className="field">
          OTT
          <select name="provider" aria-label="OTT">
            {providers.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          작품 상세 주소
          <input
            name="url"
            type="url"
            required
            placeholder="https://..."
            maxLength={4096}
          />
        </label>
        <label className="field">
          대표 이미지 주소 <span className="optional">선택</span>
          <input
            name="imageUrl"
            type="url"
            placeholder="https://..."
            maxLength={4096}
          />
        </label>
        <label className="field">
          작품 소개 <span className="optional">선택</span>
          <textarea
            name="description"
            rows={3}
            maxLength={20000}
            placeholder="작품을 소개해 주세요."
          />
        </label>
        <fieldset className="category-field">
          <legend>카테고리</legend>
          <div className="category-checkboxes">
            {categories.map((c) => (
              <label key={c.id} className="check-row">
                <input
                  type="checkbox"
                  name="category"
                  value={c.id}
                  defaultChecked={view === "category:" + c.id}
                />
                <span
                  className="category-dot"
                  style={{ background: c.color }}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="modal-actions">
          <button
            type="button"
            className="button ghost"
            onClick={close}
            disabled={busy}
          >
            취소
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy && <LoaderCircle size={16} className="spin" />}보관함에 담기
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
