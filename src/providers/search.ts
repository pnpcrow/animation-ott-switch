import { parseHTML } from 'linkedom';
import type { Availability, PageTitle, ProviderId } from '../core/types';
import { canonicalizeProviderUrl, cleanTitle, detectProvider, normalizeTitle, providers, safeProviderUrl, titleVariants } from './identity';
import { extractPage } from './extract';

export interface SearchCandidate { title: string; url: string; year?: number; expired?: boolean; playable?: boolean; upcoming?: boolean }
interface SearchResult { candidates: SearchCandidate[]; complete: boolean; reason?: string }
const MAX_BODY_BYTES = 4_000_000;
const REQUEST_TIMEOUT_MS = 8000;

function result(provider: ProviderId, status: Availability['status'], reason: string, extra: Partial<Availability> = {}): Availability {
  return { provider, status, checkedAt: Date.now(), reason, ...extra };
}

/** No fuzzy auto-switching: punctuation/script normalization only; season/part/year never discarded. */
export function matchCandidates(provider: ProviderId, page: PageTitle, candidates: SearchCandidate[], complete = false): Availability {
  const wanted = new Set([page.title, ...page.aliases].flatMap(titleVariants).map(normalizeTitle).filter(Boolean));
  const unique = [...new Map(candidates.filter(c => safeProviderUrl(provider, c.url)).map(c => [canonicalizeProviderUrl(c.url)!, c])).values()];
  const exact = unique.filter(c => titleVariants(c.title).some(v => wanted.has(normalizeTitle(v))) && (!page.year || !c.year || c.year === page.year));
  const active = exact.filter(c => !c.expired && c.playable !== false && !c.upcoming);
  if (active.length === 1) {
    const match = active[0];
    return result(provider, 'available', provider === 'apple' || provider === 'prime'
      ? '동일 제목의 작품 페이지를 확인했습니다. 구독 포함·대여/구매·한국 제공 여부는 서비스에서 확인하세요.'
      : '동일 제목의 작품 페이지를 확인했습니다. 재생 권한과 제공 지역은 서비스에서 확인하세요.', { url: canonicalizeProviderUrl(match.url)!, title: match.title });
  }
  if (active.length > 1) return result(provider, 'ambiguous', '같은 제목의 여러 버전이 있습니다. 자막·더빙·시즌을 확인한 뒤 연결하세요.', { candidates: active.slice(0, 8).map(({ title, url }) => ({ title, url: canonicalizeProviderUrl(url)! })) });
  if (exact.some(c => c.upcoming && !c.expired)) return result(provider, 'unknown', '작품은 등록되어 있지만 아직 공개된 에피소드가 없습니다. 서비스에서 공개 일정을 확인하세요.');
  if (exact.length && complete) return result(provider, 'unavailable', '검색된 동일 작품의 서비스 종료 또는 재생 불가 상태가 확인되었습니다.');
  if (complete) return result(provider, 'unavailable', '이 검색어와 별칭으로 동일 제목을 찾지 못했습니다. 다른 언어의 제목도 확인해 보세요.');
  return result(provider, 'unknown', '검색 결과만으로 동일 작품을 확인할 수 없습니다. 공식 검색에서 직접 확인해 주세요.');
}

async function readResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new Error('응답이 너무 큽니다.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let size = 0, body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('응답이 너무 큽니다.'); }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function request(url: string, provider: ProviderId): Promise<{ body: string; url: string }> {
  const response = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: 'text/html,application/json' } });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '로그인 또는 사이트의 접근 확인이 필요합니다.' : `서비스 응답 오류 (${response.status})`);
  const finalUrl = response.url || url;
  const host = new URL(finalUrl).hostname;
  if (!(provider === 'laftel' && host === 'api.laftel.net') && detectProvider(finalUrl) !== provider) throw new Error('다른 서비스로 이동하여 확인할 수 없습니다.');
  if (/\/(?:login|signin|sign_in|auth-redirect|unsupported-browser)(?:\/|\?|$)/i.test(new URL(finalUrl).pathname)) throw new Error('로그인 또는 지원 브라우저에서 직접 확인해 주세요.');
  return { body: await readResponse(response), url: finalUrl };
}

function attrTitle(anchor: Element): string {
  return cleanTitle(anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.querySelector('.search-card-title, [data-testid="title"], [data-uia="title-card-title"], h2, h3')?.textContent || anchor.querySelector('img[alt]')?.getAttribute('alt') || anchor.textContent || '');
}

/** Service-worker compatible HTML parsing. Never inserts fetched markup into a live DOM. */
export function parseSearchHtml(provider: ProviderId, html: string, baseUrl: string): SearchResult {
  const { document } = parseHTML(html);
  const title = document.querySelector('title')?.textContent ?? '';
  if (/just a moment|access denied|로그인|sign in/i.test(title)) return { candidates: [], complete: false, reason: '로그인 또는 사이트의 접근 확인이 필요합니다.' };
  const candidates: SearchCandidate[] = [];
  // Apple search-card anchors exclude editorial/recommended titles elsewhere on the page.
  const anchors = provider === 'apple' ? document.querySelectorAll('a[data-testid="search-card-lockup"], a.search-card') : document.querySelectorAll('a[href]');
  for (const anchor of anchors) {
    if (candidates.length >= 200) break;
    let url: string;
    try { url = new URL(anchor.getAttribute('href') ?? '', baseUrl).href; } catch { continue; }
    if (!safeProviderUrl(provider, url)) continue;
    const candidateTitle = attrTitle(anchor);
    if (candidateTitle && candidateTitle.length <= 400) candidates.push({ title: candidateTitle, url: canonicalizeProviderUrl(url)! });
  }
  // Only explicit service-rendered no-result evidence counts as a complete empty search.
  // Generic empty SPA shells and recommendations never mean the title is absent.
  const noResults = provider === 'apple' && !!document.querySelector('.search-page__error-message') && /검색 결과가 없습니다|no results/i.test(document.querySelector('.search-page__error-message')?.textContent ?? '');
  return { candidates, complete: noResults, ...(candidates.length || noResults ? {} : { reason: '이 사이트는 검색 결과를 브라우저에서 불러옵니다. 공식 검색에서 확인해 주세요.' }) };
}

async function searchLaftel(title: string): Promise<SearchResult> {
  const { body } = await request(`https://api.laftel.net/api/search/v3/keyword/?keyword=${encodeURIComponent(title)}`, 'laftel');
  const data: unknown = JSON.parse(body);
  if (!data || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>).results) || typeof (data as Record<string, unknown>).count !== 'number') throw new Error('검색 응답 형식이 바뀌었습니다.');
  const payload = data as { count: number; results: unknown[] };
  const candidates: SearchCandidate[] = [];
  for (const raw of payload.results.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (!/^\d+$/.test(String(item.id)) || typeof item.name !== 'string') continue;
    candidates.push({ title: item.name.slice(0, 400), url: `https://laftel.net/item/${item.id}`, expired: item.is_expired === true, upcoming: item.is_viewing === true && item.is_episode_existed === false, ...(typeof item.is_viewing === 'boolean' ? { playable: item.is_viewing } : {}) });
  }
  return { candidates, complete: Number.isSafeInteger(payload.count) && payload.count >= 0 && payload.count <= candidates.length };
}

export async function searchProvider(provider: ProviderId, page: PageTitle): Promise<Availability> {
  const definition = providers.find(item => item.id === provider);
  if (!definition || !page.title?.trim()) return result(provider, 'unknown', '검색할 제목이 없습니다.');
  const queries = [...new Set([page.title, ...page.aliases].flatMap(titleVariants).map(cleanTitle).filter(Boolean))].slice(0, 3);
  let complete = true; let reason = ''; const candidates: SearchCandidate[] = [];
  try {
    // Bound each lookup to three public searches; no authentication tokens or private player APIs.
    for (const query of queries) {
      const search = provider === 'laftel' ? await searchLaftel(query) : await request(definition.searchUrl(query), provider).then(({ body, url }) => parseSearchHtml(provider, body, url));
      candidates.push(...search.candidates); complete &&= search.complete;
      if (search.reason) reason = search.reason;
      const matched = matchCandidates(provider, page, candidates, false);
      if (matched.status === 'available' || matched.status === 'ambiguous') {
        if (provider === 'laftel' || matched.status === 'ambiguous') return matched;
        // Reopen the candidate's official detail metadata to avoid trusting search labels alone.
        const verified = await request(matched.url!, provider);
        const { document } = parseHTML(verified.body);
        const detail = extractPage(document as unknown as Document, verified.url);
        if (!detail) return result(provider, 'unknown', '검색 후보의 상세 페이지를 확인할 수 없습니다. 공식 검색에서 확인해 주세요.');
        const check = matchCandidates(provider, page, [{ title: detail.title, url: detail.url, year: detail.year }], false);
        return check.status === 'available' ? check : result(provider, 'unknown', '상세 페이지의 제목·연도가 일치하지 않습니다. 직접 확인해 주세요.');
      }
    }
    const match = matchCandidates(provider, page, candidates, complete);
    return match.status === 'unknown' && reason ? { ...match, reason } : match;
  } catch (error) {
    return result(provider, 'unknown', error instanceof Error && error.name === 'TimeoutError' ? '검색 응답 시간이 초과되었습니다. 다시 시도해 주세요.' : error instanceof Error ? error.message : '서비스에 연결할 수 없습니다.');
  }
}
