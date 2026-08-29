export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  expiresAt?: number;
  secure: boolean;
};

const isExpired = (cookie: StoredCookie, now: number): boolean =>
  cookie.expiresAt !== undefined && cookie.expiresAt <= now;

const hostMatches = (cookie: StoredCookie, hostname: string): boolean => {
  const host = hostname.toLowerCase();
  const domain = cookie.domain.toLowerCase();
  if (cookie.hostOnly) {
    return host === domain;
  }
  return host === domain || host.endsWith(`.${domain}`);
};

const pathMatches = (cookie: StoredCookie, pathname: string): boolean => {
  if (cookie.path === "/") {
    return true;
  }
  if (pathname === cookie.path) {
    return true;
  }
  return pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`);
};

const cookieKey = (cookie: StoredCookie): string =>
  `${cookie.name}\n${cookie.domain}\n${cookie.path}`;

const parseCookieDate = (value: string): number | undefined => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const defaultPath = (pathname: string): string => {
  const slash = pathname.lastIndexOf("/");
  if (slash <= 0) {
    return "/";
  }
  return pathname.slice(0, slash);
};

const domainAllowed = (requestHost: string, cookieDomain: string): boolean => {
  const host = requestHost.toLowerCase();
  const domain = cookieDomain.replace(/^\./, "").toLowerCase();
  if (domain.length === 0) {
    return false;
  }
  if (!domain.includes(".") && domain !== "localhost") {
    return false;
  }
  if (domain === host) {
    return true;
  }
  return host.endsWith(`.${domain}`);
};

export const parseSetCookie = (setCookie: string, requestUrl: URL): StoredCookie | undefined => {
  const parts = setCookie.split(";").map((part) => part.trim());
  const pair = parts[0];
  if (!pair) {
    return undefined;
  }
  const separator = pair.indexOf("=");
  if (separator < 1) {
    return undefined;
  }
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (!name) {
    return undefined;
  }

  let domain = requestUrl.hostname;
  let hostOnly = true;
  let path = defaultPath(requestUrl.pathname);
  let expiresAt: number | undefined;
  let secure = false;
  let maxAgeSeen = false;

  for (const part of parts.slice(1)) {
    const attrSep = part.indexOf("=");
    const attrName = (attrSep === -1 ? part : part.slice(0, attrSep)).trim().toLowerCase();
    const attrValue = attrSep === -1 ? "" : part.slice(attrSep + 1).trim();
    if (attrName === "secure") {
      secure = true;
      continue;
    }
    if (attrName === "domain" && attrValue) {
      const nextDomain = attrValue.replace(/^\./, "");
      if (!domainAllowed(requestUrl.hostname, nextDomain)) {
        return undefined;
      }
      domain = nextDomain;
      hostOnly = false;
      continue;
    }
    if (attrName === "path" && attrValue.startsWith("/")) {
      path = attrValue;
      continue;
    }
    if (attrName === "max-age") {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) {
        expiresAt = Date.now() + seconds * 1000;
        maxAgeSeen = true;
      }
      continue;
    }
    if (attrName === "expires" && !maxAgeSeen) {
      expiresAt = parseCookieDate(attrValue);
    }
  }

  return { name, value, domain, hostOnly, path, expiresAt, secure };
};

export class CookieJar {
  private cookies = new Map<string, StoredCookie>();

  storeFromResponse(requestUrl: string, headers: Headers, now = Date.now()): void {
    const url = new URL(requestUrl);
    const lines = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of lines) {
      const parsed = parseSetCookie(line, url);
      if (!parsed) {
        continue;
      }
      if (isExpired(parsed, now)) {
        this.cookies.delete(cookieKey(parsed));
        continue;
      }
      this.cookies.set(cookieKey(parsed), parsed);
    }
  }

  cookieHeaderFor(requestUrl: string, now = Date.now()): string | undefined {
    const url = new URL(requestUrl);
    const parts: string[] = [];
    for (const [key, cookie] of this.cookies) {
      if (isExpired(cookie, now)) {
        this.cookies.delete(key);
        continue;
      }
      if (cookie.secure && url.protocol !== "https:") {
        continue;
      }
      if (!hostMatches(cookie, url.hostname) || !pathMatches(cookie, url.pathname)) {
        continue;
      }
      parts.push(`${cookie.name}=${cookie.value}`);
    }
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
}

export const mergeCookieHeader = (
  headers: Record<string, string>,
  jarHeader: string | undefined,
): Record<string, string> => {
  if (!jarHeader) {
    return headers;
  }
  const next = { ...headers };
  const existingKey = Object.keys(next).find((key) => key.toLowerCase() === "cookie");
  if (!existingKey) {
    next.Cookie = jarHeader;
    return next;
  }
  next[existingKey] = `${jarHeader}; ${next[existingKey]}`;
  return next;
};
