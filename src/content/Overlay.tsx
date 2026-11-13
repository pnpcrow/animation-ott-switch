import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  ChevronLeft,
  FolderOpen,
  Library,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { api } from "../core/client";
import type {
  Availability,
  LibrarySnapshot,
  PageTitle,
  ProviderId,
  ProviderLink,
} from "../core/types";
import {
  cleanSearchPage,
  providers,
  safeProviderUrl,
  providerTitleId,
} from "../providers/identity";

export function Overlay({ page }: { page: PageTitle }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>();
  const [categories, setCategories] = useState<string[]>([]);
  const [results, setResults] = useState<Availability[]>([]);
  const [manualProviders, setManualProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<ProviderId[]>([]);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const preferredResults = useRef(new Set<ProviderId>());
  const pageKey = page.url + page.title;
  const saved = snapshot?.bookmarks.find(
    (b) =>
      !b.deletedAt &&
      Object.values(b.links).some(
        (l) =>
          l?.provider === page.provider &&
          providerTitleId(l.url) === providerTitleId(page.url),
      ),
  );
  const imageUrl = saved?.imageUrl ?? page.imageUrl;
  const description = saved?.description ?? page.description;
  const title = saved?.title ?? page.title;
  const refreshedSource = results.find(
    (result) =>
      result.provider === page.provider &&
      result.status === "available" &&
      result.url &&
      providerTitleId(result.url) === providerTitleId(page.url),
  );
  const searchTitle = cleanSearchPage(
    page,
    refreshedSource?.title ? [refreshedSource.title] : [],
  ).title;
  const invalidateSearchResults = useCallback(() => {
    generation.current++;
    preferredResults.current.clear();
    setResults([]);
    setManualProviders([]);
    setOpening([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .snapshot()
        .then((value) => {
          if (alive) setSnapshot(value);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void load();
    const unsubscribe = api.subscribe(() => {
      void load();
    });
    const unsubscribeReset = api.subscribeSearchResultsCleared(() => {
      invalidateSearchResults();
      setNotice("검색 결과를 초기화했어요. 다음 검색부터 새로 확인합니다.");
      setError("");
      void load();
    });
    return () => {
      alive = false;
      generation.current++;
      unsubscribe();
      unsubscribeReset();
    };
  }, [invalidateSearchResults]);
  useEffect(() => {
    setCategories(saved?.categoryIds || []);
  }, [saved?.id, saved?.updatedAt, pageKey]);
  useEffect(() => {
    invalidateSearchResults();
    setNotice("");
    setError("");
  }, [pageKey, invalidateSearchResults]);
  async function clearSearchResults() {
    setClearing(true);
    setError("");
    try {
      const cleared = await api.clearSearchResults();
      invalidateSearchResults();
      setSnapshot(await api.snapshot());
      setNotice(
        `검색 결과와 ${cleared.bookmarks}개 작품의 자동 연결 ${cleared.links}개를 초기화했어요. 다음 검색부터 새로 확인합니다.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClearing(false);
    }
  }
  async function search(force = false) {
    const id = ++generation.current;
    setLoading(true);
    setError("");
    setManualProviders([]);
    preferredResults.current.clear();
    try {
      const next = await api.lookup(page, force, (result) => {
        if (
          id !== generation.current ||
          preferredResults.current.has(result.provider)
        )
          return;
        setResults((current) => [
          ...current.filter((r) => r.provider !== result.provider),
          result,
        ]);
      });
      if (id === generation.current)
        setResults((current) =>
          next.map((result) =>
            preferredResults.current.has(result.provider)
              ? (current.find((r) => r.provider === result.provider) ?? result)
              : result,
          ),
        );
    } catch (e) {
      if (id === generation.current) setError((e as Error).message);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }
  async function openResult(provider: ProviderId, candidateUrl?: string) {
    const id = generation.current;
    preferredResults.current.add(provider);
    setOpening((current) => [...current, provider]);
    setError("");
    try {
      const result = await api.openResolved(page, provider, candidateUrl);
      if (id !== generation.current) return;
      setResults((current) => [
        ...current.filter((r) => r.provider !== provider),
        result,
      ]);
      if (result.status === "available") {
        if (candidateUrl)
          setManualProviders((current) => [...new Set([...current, provider])]);
        setNotice(
          result.opened === false
            ? result.reason ||
                "작품을 확인했어요. 스위치를 눌러 이동할 수 있어요."
            : "제목이 일치하는 작품 페이지로 이동했어요. 저장하면 이 연결을 보관할 수 있어요.",
        );
      } else {
        setNotice(result.reason || "동일한 작품을 확인하지 못했어요.");
      }
    } catch (e) {
      if (id === generation.current) setError((e as Error).message);
    } finally {
      if (id === generation.current)
        setOpening((current) => current.filter((p) => p !== provider));
    }
  }
  useEffect(() => {
    if (open) void search();
  }, [open, pageKey]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open]);
  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const links = { ...saved?.links };
      let skipped = false;
      for (const result of results) {
        if (
          result.status === "available" &&
          result.url &&
          safeProviderUrl(result.provider, result.url)
        ) {
          if (
            links[result.provider] &&
            !manualProviders.includes(result.provider)
          )
            continue;
          const conflict = snapshot?.bookmarks.some(
            (b) =>
              !b.deletedAt &&
              b.id !== saved?.id &&
              b.links[result.provider] &&
              providerTitleId(b.links[result.provider]!.url) ===
                providerTitleId(result.url!),
          );
          if (conflict) {
            skipped = true;
            continue;
          }
          links[result.provider] = {
            provider: result.provider,
            url: result.url,
            title: result.title || page.title,
            verifiedAt: result.checkedAt,
            source: manualProviders.includes(result.provider)
              ? "manual"
              : result.provider === page.provider
                ? "page"
                : "search",
          } satisfies ProviderLink;
        }
      }
      if (saved)
        await api.updateBookmark(saved.id, { categoryIds: categories, links });
      else await api.saveBookmark({ page, categoryIds: categories, links });
      setSnapshot(await api.snapshot());
      setNotice(
        (saved ? "변경 내용을 저장했어요." : "보관함에 담았어요.") +
          (skipped ? " 다른 북마크에 연결된 OTT는 제외했어요." : ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const ordered = [...providers].sort(
    (a, b) =>
      Number(snapshot?.settings.subscribedProviders.includes(b.id)) -
      Number(snapshot?.settings.subscribedProviders.includes(a.id)),
  );
  return (
    <div className="switch-root">
      <button
        ref={trigger}
        className={`switch-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label={open ? "OTT Switch 닫기" : "OTT Switch 열기"}
        aria-expanded={open}
        title="OTT Switch"
      >
        <ArrowLeftRight size={19} />
        <span>OTT</span>
      </button>
      {open && (
        <aside className="switch-panel" aria-label="OTT Switch 작품 패널">
          <header className="switch-header">
            <span className="switch-brand">
              <ArrowLeftRight size={18} /> OTT <b>Switch</b>
            </span>
            <div>
              <button
                title="내 보관함"
                aria-label="내 보관함"
                onClick={() => {
                  void api.openLibrary().catch((e) => setError(e.message));
                }}
              >
                <Library size={18} />
              </button>
              <button title="닫기" aria-label="패널 닫기" onClick={close}>
                <ChevronLeft size={19} />
              </button>
            </div>
          </header>
          <div className="switch-scroll">
            <div className="switch-hero">
              {imageUrl ? (
                <img
                  key={imageUrl}
                  src={imageUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              <div className="switch-hero-fallback">
                <ArrowLeftRight size={40} />
              </div>
              <div className="switch-hero-shade" />
              <span className="switch-origin">
                {providers.find((p) => p.id === page.provider)?.name}에서 발견
              </span>
            </div>
            <section className="switch-summary">
              <span className="switch-eyebrow">YOUR NEXT WATCH</span>
              <h1>{title}</h1>
              {saved && (
                <div className="switch-saved">
                  <Check size={13} /> 보관함에 저장됨
                </div>
              )}
              <p>
                {description ||
                  "등록된 소개가 없어요. 보관함에서 직접 소개를 작성할 수 있어요."}
              </p>
            </section>
            <section className="switch-bookmark">
              <div className="switch-section-heading">
                <h2>
                  <FolderOpen size={15} /> 내 카테고리
                </h2>
                <button
                  onClick={() => {
                    void api.openLibrary().catch((e) => setError(e.message));
                  }}
                >
                  관리 <ArrowUpRight size={12} />
                </button>
              </div>
              <div className="switch-categories">
                {snapshot?.categories
                  .filter((c) => !c.deletedAt)
                  .map((category) => (
                    <label key={category.id}>
                      <input
                        type="checkbox"
                        checked={categories.includes(category.id)}
                        onChange={(e) =>
                          setCategories(
                            e.target.checked
                              ? [...categories, category.id]
                              : categories.filter((id) => id !== category.id),
                          )
                        }
                      />
                      <span>{category.name}</span>
                    </label>
                  ))}
              </div>
              {!snapshot?.categories.some((c) => !c.deletedAt) && (
                <p className="switch-muted">
                  카테고리 없이 저장하거나 보관함에서 새로 만들 수 있어요.
                </p>
              )}
              <button
                className="switch-save"
                disabled={saving || clearing || !snapshot}
                onClick={() => {
                  void save();
                }}
              >
                {saving ? (
                  <LoaderCircle className="spin" size={16} />
                ) : saved ? (
                  <Check size={16} />
                ) : (
                  <BookmarkPlus size={16} />
                )}{" "}
                {saving
                  ? "저장하는 중…"
                  : saved
                    ? "변경 내용 저장"
                    : "내 보관함에 담기"}
              </button>
              {notice && (
                <p className="switch-notice" role="status">
                  {notice}
                </p>
              )}
              {error && (
                <p className="switch-error" role="alert">
                  {error}
                </p>
              )}
            </section>
            <section className="switch-services">
              <div className="switch-section-heading">
                <h2>어디서 볼 수 있을까요?</h2>
                <div className="switch-section-actions">
                  <button
                    aria-label="검색 결과 초기화"
                    title="검색 결과와 자동 저장한 OTT 연결 초기화"
                    disabled={clearing || saving}
                    onClick={() => void clearSearchResults()}
                  >
                    <RotateCcw size={14} className={clearing ? "spin" : ""} />
                  </button>
                  <button
                    aria-label="OTT 다시 확인"
                    title="다시 확인"
                    disabled={clearing || loading || opening.length > 0}
                    onClick={() => {
                      void search(true);
                    }}
                  >
                    <RefreshCw size={14} className={loading ? "spin" : ""} />
                  </button>
                </div>
              </div>
              <p className="switch-muted">
                한국 기준 · 제목이 일치하는 작품 페이지로 바로 이동해요.
              </p>
              {(loading || opening.length > 0) && (
                <p className="switch-muted" role="status">
                  작품 확인용 검색 탭이 잠시 열리고, 확인이 끝나면 자동으로
                  닫혀요.
                </p>
              )}
              <div className="switch-service-list">
                {ordered.map((provider) => {
                  const result = results.find(
                    (r) => r.provider === provider.id,
                  );
                  const available =
                    result?.status === "available" &&
                    result.url &&
                    safeProviderUrl(provider.id, result.url);
                  const current = provider.id === page.provider;
                  const isOpening = opening.includes(provider.id);
                  const isChecking = isOpening || (loading && !result);
                  const subscribed =
                    snapshot?.settings.subscribedProviders.includes(
                      provider.id,
                    );
                  const state = isChecking
                    ? "확인 중"
                    : result?.status === "unavailable"
                      ? "검색 결과 없음"
                      : result?.status === "ambiguous"
                        ? "동일 작품 확인 필요"
                        : available
                          ? current
                            ? "현재 페이지"
                            : "작품 페이지 확인"
                          : "확인 필요";
                  return (
                    <div
                      className={`switch-service ${subscribed ? "subscribed" : ""}`}
                      key={provider.id}
                    >
                      <span
                        className="switch-service-dot"
                        style={{ background: provider.color }}
                      />
                      <div className="switch-service-label">
                        <strong>
                          {provider.name}
                          {subscribed && <small>구독</small>}
                        </strong>
                        <span title={result?.reason}>{state}</span>
                      </div>
                      <div className="switch-service-actions">
                        {available && !current ? (
                          <a
                            className="switch-go"
                            href={result!.url}
                            target={
                              snapshot?.settings.openInNewTab
                                ? "_blank"
                                : "_self"
                            }
                            rel="noopener noreferrer"
                            title={result?.reason}
                          >
                            스위치 <ArrowUpRight size={12} />
                          </a>
                        ) : current ? (
                          <button className="switch-go disabled" disabled>
                            현재
                          </button>
                        ) : (
                          <button
                            className="switch-go"
                            disabled={
                              clearing ||
                              isChecking ||
                              result?.status === "unavailable"
                            }
                            onClick={() => void openResult(provider.id)}
                            aria-label={`${provider.name}에서 제목 확인 후 이동`}
                          >
                            {isChecking ? (
                              <LoaderCircle className="spin" size={12} />
                            ) : (
                              <ArrowUpRight size={12} />
                            )}
                            {isChecking
                              ? "확인 중"
                              : result?.status === "unavailable"
                                ? "검색 결과 없음"
                                : "찾아서 이동"}
                          </button>
                        )}
                        {!current && !available && (
                          <a
                            href={provider.searchUrl(searchTitle)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${provider.name}에서 직접 검색`}
                            aria-label={`${provider.name} 직접 검색`}
                          >
                            <Search size={15} />
                          </a>
                        )}
                      </div>
                      {result?.reason && !available && (
                        <span className="switch-service-reason">
                          {result.reason}
                        </span>
                      )}
                      {result?.status === "ambiguous" && (
                        <details className="switch-candidates">
                          <summary>
                            작품 후보 {result.candidates?.length || 0}개 확인
                          </summary>
                          {result.candidates
                            ?.filter((c) => safeProviderUrl(provider.id, c.url))
                            .map((candidate) => (
                              <div key={candidate.url}>
                                <span>{candidate.title}</span>
                                <button
                                  disabled={clearing || isOpening}
                                  onClick={() =>
                                    void openResult(provider.id, candidate.url)
                                  }
                                >
                                  {isOpening ? "확인 중…" : "이 작품으로 이동"}
                                </button>
                              </div>
                            ))}
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="switch-footnote">
                검색 결과와 상세 제목을 확인한 뒤 이동해요. 로그인·접근 확인이
                필요하면 직접 검색을 이용해 주세요. 구독 포함 여부는 서비스마다
                달라요.
              </p>
            </section>
          </div>
          <footer className="switch-footer">
            <span className="switch-local-dot" /> 이 브라우저에 저장돼요{" "}
            <button
              onClick={() => {
                void api.openLibrary().catch((e) => setError(e.message));
              }}
            >
              보관함 열기 <ArrowUpRight size={12} />
            </button>
          </footer>
        </aside>
      )}
    </div>
  );
}
