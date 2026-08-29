import { HttpTransportError } from "../error.js";
import { CookieJar, mergeCookieHeader } from "./cookies.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, unknown>;
  timeoutMs?: number;
};

export type HttpResponse = {
  status: number;
  url: string;
  bodyText: string;
  headers?: Record<string, string>;
};

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

const withQuery = (url: string, params?: Record<string, unknown>): string => {
  if (!params || Object.keys(params).length === 0) {
    return url;
  }
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
};

const encodeBody = (
  body: unknown,
  headers: Record<string, string>,
): { body?: string; headers: Record<string, string> } => {
  if (body === undefined) {
    return { headers };
  }
  if (typeof body === "string") {
    return { body, headers };
  }
  const next = { ...headers };
  if (!Object.keys(next).some((key) => key.toLowerCase() === "content-type")) {
    next["Content-Type"] = "application/json";
  }
  return { body: JSON.stringify(body), headers: next };
};

const responseHeaders = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
};

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;

const SENSITIVE_REQUEST_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

const originOf = (url: string): string => new URL(url).origin;

const dropBodyHeaders = (headers: Record<string, string>): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "content-type" || lower === "content-length") {
      continue;
    }
    next[key] = value;
  }
  return next;
};

const dropSensitiveHeaders = (headers: Record<string, string>): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_REQUEST_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    next[key] = value;
  }
  return next;
};

const shouldSwitchToGet = (status: number, method: HttpMethod): boolean => {
  if (method === "GET") {
    return false;
  }
  return status === 301 || status === 302 || status === 303;
};

export const createFetchClient = (): HttpClient => {
  const jar = new CookieJar();
  return {
    async request(req) {
      let url = withQuery(req.url, req.params);
      let method = req.method;
      const encoded = encodeBody(req.body, req.headers ?? {});
      let headers = encoded.headers;
      let body = method === "GET" ? undefined : encoded.body;
      let redirects = 0;

      while (true) {
        const requestHeaders = mergeCookieHeader(headers, jar.cookieHeaderFor(url));
        let response: Response;
        try {
          response = await fetch(url, {
            method,
            headers: requestHeaders,
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
          });
        } catch (error) {
          const timedOut =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError");
          if (timedOut) {
            throw new HttpTransportError({
              message: `Request timed out for ${url}`,
              url,
              status: 408,
            });
          }
          throw error;
        }
        const responseUrl = response.url || url;
        jar.storeFromResponse(responseUrl, response.headers);

        const location = response.headers.get("location");
        if (location && REDIRECT_CODES.has(response.status)) {
          if (redirects >= MAX_REDIRECTS) {
            throw new HttpTransportError({
              message: `Too many redirects for ${url}`,
              url,
              status: response.status,
            });
          }
          redirects += 1;
          await response.arrayBuffer();
          const nextUrl = new URL(location, url).toString();
          if (originOf(nextUrl) !== originOf(url)) {
            headers = dropSensitiveHeaders(headers);
          }
          url = nextUrl;
          if (shouldSwitchToGet(response.status, method)) {
            method = "GET";
            body = undefined;
            headers = dropBodyHeaders(headers);
          }
          continue;
        }

        const bodyText = await response.text();
        if (response.status >= 500) {
          throw new HttpTransportError({
            message: `HTTP ${response.status} for ${url}`,
            url,
            status: response.status,
          });
        }
        return {
          status: response.status,
          url: responseUrl,
          bodyText,
          headers: responseHeaders(response.headers),
        };
      }
    },
  };
};
