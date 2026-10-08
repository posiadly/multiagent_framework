import { search, SafeSearchType, type SearchResult } from 'duck-duck-scrape';

const DDG_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

function needleOptions() {
  return {
    headers: DDG_HEADERS,
    uri_modifier: (rawUrl: string) => {
      const url = new URL(rawUrl);
      url.searchParams.delete('ss_mkt');
      return url.toString();
    },
  };
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapDdgRedirect(href: string): string {
  try {
    const absolute = href.startsWith('//')
      ? `https:${href}`
      : href.startsWith('/')
        ? `https://duckduckgo.com${href}`
        : href;
    const url = new URL(absolute);
    const uddg = url.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    // ignore
  }
  return href;
}

function isBlockedPage(html: string): boolean {
  return /anomalyDetectionBlock|Unfortunately, bots use DuckDuckGo|anomaly-modal/i.test(
    html,
  );
}

/**
 * DuckDuckGo lite HTML (GET) — currently the most reliable unauthenticated path.
 */
async function searchLite(query: string, limit: number): Promise<WebSearchHit[]> {
  const response = await fetch(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    { headers: DDG_HEADERS },
  );

  if (!response.ok) {
    throw new Error(
      `DuckDuckGo lite search failed (${response.status}): ${response.statusText}`,
    );
  }

  const html = await response.text();
  if (isBlockedPage(html)) {
    throw new Error(
      'DuckDuckGo lite blocked the request (anomaly / bot protection).',
    );
  }

  const hits: WebSearchHit[] = [];
  // Lite puts href before class; quotes vary.
  const linkRe =
    /<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null && hits.length < limit) {
    const title = decodeHtml(match[2] ?? '');
    const url = unwrapDdgRedirect(match[1] ?? '');
    if (
      !title ||
      !url ||
      url.includes('duckduckgo.com/y.js') ||
      /sponsored|more info/i.test(title)
    ) {
      continue;
    }

    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 1200);
    const snippetMatch = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(
      after,
    );
    hits.push({
      title,
      url,
      snippet: decodeHtml(snippetMatch?.[1] ?? ''),
    });
  }

  if (hits.length === 0) {
    throw new Error('DuckDuckGo lite returned no parseable results.');
  }

  return hits;
}

/**
 * DuckDuckGo HTML results via GET (POST often triggers bot protection).
 */
async function searchHtmlGet(
  query: string,
  limit: number,
): Promise<WebSearchHit[]> {
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: DDG_HEADERS },
  );

  if (!response.ok) {
    throw new Error(
      `DuckDuckGo HTML search failed (${response.status}): ${response.statusText}`,
    );
  }

  const html = await response.text();
  if (isBlockedPage(html)) {
    throw new Error(
      'DuckDuckGo HTML blocked the request (anomaly / bot protection).',
    );
  }

  const hits: WebSearchHit[] = [];
  const resultBlock =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>)?/gi;

  let match: RegExpExecArray | null;
  while ((match = resultBlock.exec(html)) !== null && hits.length < limit) {
    const title = decodeHtml(match[2] ?? '');
    const url = unwrapDdgRedirect(match[1] ?? '');
    const snippet = decodeHtml(match[3] ?? '');
    if (!url || !title) {
      continue;
    }
    hits.push({ title, url, snippet });
  }

  if (hits.length === 0) {
    throw new Error('DuckDuckGo HTML returned no parseable results.');
  }

  return hits;
}

function mapLibraryResults(
  results: SearchResult[],
  limit: number,
): WebSearchHit[] {
  return results.slice(0, limit).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.description?.trim() || '',
  }));
}

function explainLibraryError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (
    error instanceof TypeError &&
    /null \(reading ['"]1['"]\)/.test(error.message)
  ) {
    return 'DuckDuckGo returned an unexpected page (library could not parse results).';
  }
  return error.message;
}

async function searchWithLibrary(
  query: string,
  limit: number,
): Promise<WebSearchHit[]> {
  const result = await search(
    query,
    {
      safeSearch: SafeSearchType.MODERATE,
      locale: 'en-us',
      region: 'wt-wt',
      marketRegion: 'en-US',
    },
    needleOptions(),
  );

  if (result.noResults || !result.results?.length) {
    return [];
  }
  return mapLibraryResults(result.results, limit);
}

function isBotBlockMessage(message: string): boolean {
  return /anomaly|bot protection|blocked/i.test(message);
}

/**
 * Search DuckDuckGo: lite GET first (most reliable).
 * HTML GET only if lite failed for a non-block reason (same IP usually
 * shares bot blocks). duck-duck-scrape is last resort.
 */
export async function searchWeb(
  query: string,
  limit: number,
): Promise<WebSearchHit[]> {
  const errors: string[] = [];

  try {
    return await searchLite(query, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`lite: ${message}`);

    // HTML hits the same bot filter; skip it after a block.
    if (!isBotBlockMessage(message)) {
      try {
        return await searchHtmlGet(query, limit);
      } catch (htmlError) {
        const htmlMessage =
          htmlError instanceof Error ? htmlError.message : String(htmlError);
        errors.push(`html: ${htmlMessage}`);
      }
    }
  }

  try {
    return await searchWithLibrary(query, limit);
  } catch (error) {
    errors.push(`duck-duck-scrape: ${explainLibraryError(error)}`);
  }

  throw new Error(`DuckDuckGo search failed. ${errors.join(' | ')}`);
}
