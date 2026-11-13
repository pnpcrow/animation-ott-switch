import { useEffect, useRef, useState } from "react";
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
  Search,
  X,
} from "lucide-react";
import { api } from "../core/client";
import type {
  Availability,
  LibrarySnapshot,
  PageTitle,
  ProviderLink,
} from "../core/types";
import {
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
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
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
    return () => {
      alive = false;
      generation.current++;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    setCategories(saved?.categoryIds || []);
  }, [saved?.id, saved?.updatedAt, pageKey]);
  useEffect(() => {
    setResults([]);
    setManualProviders([]);
    setNotice("");
    setError("");
    generation.current++;
  }, [pageKey]);
  async function search(force = false) {
    const id = ++generation.current;
    setLoading(true);
    setError("");
    setManualProviders([]);
    try {
      const next = await api.lookup(page, force);
      if (id === generation.current) setResults(next);
    } catch (e) {
      if (id === generation.current) setError((e as Error).message);
    } finally {
      if (id === generation.current) setLoading(false);
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
                disabled={saving || !snapshot}
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
                <button
                  aria-label="OTT 다시 확인"
                  title="다시 확인"
                  disabled={loading}
                  onClick={() => {
                    void search(true);
                  }}
                >
                  <RefreshCw size={14} className={loading ? "spin" : ""} />
                </button>
              </div>
              <p className="switch-muted">
                한국 기준 · 구독 중인 OTT가 먼저 표시돼요.
              </p>
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
                  const subscribed =
                    snapshot?.settings.subscribedProviders.includes(
                      provider.id,
                    );
                  const state =
                    loading && !result
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
                        ) : (
                          <button className="switch-go disabled" disabled>
                            {current ? "현재" : "스위치"}
                          </button>
                        )}
                        {!current && !available && (
                          <a
                            href={provider.searchUrl(page.title)}
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
                                <a
                                  href={candidate.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {candidate.title} <ArrowUpRight size={11} />
                                </a>
                                <button
                                  disabled={loading}
                                  onClick={() => {
                                    setManualProviders([
                                      ...manualProviders,
                                      provider.id,
                                    ]);
                                    setResults(
                                      results.map((r) =>
                                        r.provider === provider.id
                                          ? {
                                              ...r,
                                              status: "available",
                                              url: candidate.url,
                                              title: candidate.title,
                                              checkedAt: Date.now(),
                                              reason:
                                                "직접 선택한 작품입니다. 저장하면 연결을 보관합니다.",
                                            }
                                          : r,
                                      ),
                                    );
                                    setNotice(
                                      "버전을 선택했어요. 위의 저장 버튼으로 연결을 보관하세요.",
                                    );
                                  }}
                                >
                                  이 버전 선택
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
                로그인·지역 제한이 있으면 직접 검색해 확인해 주세요. 작품
                페이지가 있어도 구독 포함 여부는 서비스마다 달라요.
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
