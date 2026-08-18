import { chromium } from 'playwright';
import robotsParser from 'robots-parser';

const USER_AGENT = 'AuraOS/0.9 (Ziya Energy public business research)';

const BLOCKED_HOSTS =
  /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com)$/i;

const USEFUL =
  /\b(contact|about|location|locations|facility|facilities|factory|factories|operations|property|properties|company|office|offices|branch|branches|shopping centre|shopping center|retail centre|retail center|business park|office park)\b/i;

const NOISE =
  /\b(career|careers|jobs?|vacanc|graduate|graduates|trainee|trainees|intern|internship|news|blog|media|press|recipe|competition|investor|investors|shareholder|shareholders|governance|board|financial results|annual report|integrated report)\b/i;

const robotsCache = new Map();
let browserPromise = null;

function normalizeUrl(value) {
  try {
    const u = new URL(String(value || '').trim());

    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (BLOCKED_HOSTS.test(u.hostname)) return null;

    u.hash = '';

    if (u.pathname !== '/') {
      u.pathname = u.pathname.replace(/\/+$/, '') + '/';
    }

    return u.href;
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  const normalized = normalizeUrl(value);
  return normalized ? normalized.toLowerCase() : '';
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }

  return browserPromise;
}

async function robotsAllowed(url) {
  try {
    const u = new URL(url);
    const robotsUrl = `${u.origin}/robots.txt`;

    let cached = robotsCache.get(robotsUrl);

    if (!cached) {
      try {
        const response = await fetch(robotsUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(8000)
        });

        if (!response.ok) {
          robotsCache.set(robotsUrl, true);
          return true;
        }

        cached = robotsParser(
          robotsUrl,
          await response.text()
        );

        robotsCache.set(robotsUrl, cached);
      } catch {
        robotsCache.set(robotsUrl, true);
        return true;
      }
    }

    if (cached === true) return true;

    return cached.isAllowed(url, USER_AGENT) !== false;
  } catch {
    return false;
  }
}

function rankLink(item, origin) {
  try {
    const u = new URL(item.href, origin);

    if (u.origin !== origin) return null;
    if (!['http:', 'https:'].includes(u.protocol)) return null;

    const signal = `${u.pathname} ${item.text || ''}`;

    if (NOISE.test(signal)) return null;
    if (!USEFUL.test(signal)) return null;

    if (
      /\.(pdf|jpg|jpeg|png|gif|svg|zip|doc|docx|xls|xlsx)$/i
        .test(u.pathname)
    ) {
      return null;
    }

    let score = 10;

    if (/\bcontact\b/i.test(signal)) score = 100;
    else if (/\blocation|locations|branch|branches\b/i.test(signal)) score = 90;
    else if (/\bfacility|facilities|factory|factories\b/i.test(signal)) score = 80;
    else if (/\babout|company\b/i.test(signal)) score = 70;
    else if (/\boperations\b/i.test(signal)) score = 60;

    return {
      url: normalizeUrl(u.href),
      score
    };
  } catch {
    return null;
  }
}

function usefulLinks(links = [], origin) {
  const found = new Map();

  for (const item of links) {
    const ranked = rankLink(item, origin);

    if (!ranked?.url) continue;

    const key = canonicalUrl(ranked.url);

    if (!key) continue;

    const existing = found.get(key);

    if (!existing || ranked.score > existing.score) {
      found.set(key, ranked);
    }
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score)
    .map(x => x.url)
    .slice(0, 20);
}

async function readPage(context, url) {
  if (!(await robotsAllowed(url))) {
    return {
      url,
      robotsBlocked: true,
      status: null,
      title: '',
      text: '',
      links: []
    };
  }

  const page = await context.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    const status = response?.status() ?? null;

    if (status && status >= 400) {
      return {
        url: page.url(),
        status,
        title: '',
        text: '',
        links: []
      };
    }

    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const visibleText = document.body?.innerText || '';

      const contactLinks = [
        ...document.querySelectorAll(
          'a[href^="mailto:"],a[href^="tel:"]'
        )
      ].map(a => a.getAttribute('href') || '');

      const links = [
        ...document.querySelectorAll('a[href]')
      ].slice(0, 1000).map(a => ({
        href: a.href,
        text: (a.textContent || '').trim().slice(0, 160)
      }));

      return {
        title: document.title || '',
        text: `${visibleText}\n${contactLinks.join('\n')}`,
        links
      };
    });

    return {
      url: page.url(),
      status,
      title: result.title,
      text: String(result.text || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      links: result.links || []
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function crawlPublicWebsite(startUrl, options = {}) {
  const normalized = normalizeUrl(startUrl);

  if (!normalized) {
    return {
      ok: false,
      startUrl,
      error: 'Invalid or blocked URL.',
      pagesVisited: 0,
      pages: [],
      robotsBlocked: [],
      text: ''
    };
  }

  const maxPages = Math.max(
    1,
    Math.min(8, Number(options.maxPages || 5))
  );

  const delayMs = Math.max(
    250,
    Number(options.delayMs || 600)
  );

  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    ignoreHTTPSErrors: true
  });

  const queue = [normalized];

  const queued = new Set([
    canonicalUrl(normalized)
  ]);

  const visited = new Set();
  const finalUrls = new Set();

  const pages = [];
  const robotsBlocked = [];

  let origin = new URL(normalized).origin;

  try {
    while (queue.length && pages.length < maxPages) {
      const next = queue.shift();

      if (!next) continue;

      const requestedKey = canonicalUrl(next);

      if (visited.has(requestedKey)) continue;

      visited.add(requestedKey);

      const result = await readPage(context, next);

      if (result.robotsBlocked) {
        robotsBlocked.push(next);
        continue;
      }

      if (result.url) {
        try {
          origin = new URL(result.url).origin;
        } catch {}
      }

      const finalKey = canonicalUrl(result.url || next);

      if (
        result.text &&
        finalKey &&
        !finalUrls.has(finalKey)
      ) {
        finalUrls.add(finalKey);

        pages.push({
          url: normalizeUrl(result.url || next),
          title: result.title || '',
          status: result.status,
          text: result.text.slice(0, 100000)
        });
      }

      const links = usefulLinks(
        result.links,
        origin
      );

      for (const link of links) {
        const key = canonicalUrl(link);

        if (
          key &&
          !queued.has(key) &&
          !visited.has(key)
        ) {
          queued.add(key);
          queue.push(link);
        }
      }

      await new Promise(resolve =>
        setTimeout(resolve, delayMs)
      );
    }
  } finally {
    await context.close().catch(() => {});
  }

  const text = pages
    .map(page => `${page.title}\n${page.text}`)
    .join('\n\n')
    .slice(0, 300000);

  return {
    ok: pages.length > 0,
    startUrl: normalized,
    pagesVisited: pages.length,
    pages,
    robotsBlocked,
    text
  };
}

export async function closeWebsiteCrawler() {
  if (!browserPromise) return;

  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {}

  browserPromise = null;
}

