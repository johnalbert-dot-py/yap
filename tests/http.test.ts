import { afterEach, describe, expect, it } from "vitest";
import { HttpTransportError } from "../src/error.js";
import { createFetchClient } from "../src/http/client.js";

const originalFetch = globalThis.fetch;

type FetchCall = { url: string; init?: RequestInit };

const cookieFromCall = (call: FetchCall | undefined): string | null =>
  new Headers(call?.init?.headers).get("cookie");

const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>): FetchCall[] => {
  const calls: FetchCall[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return impl(url, init);
  }) as typeof fetch;
  return calls;
};

describe("createFetchClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws HttpTransportError on 5xx and keeps response headers on 2xx", async () => {
    stubFetch(async (url) => {
      if (url.includes("fail")) {
        return new Response("nope", { status: 503, headers: { "set-cookie": "a=1" } });
      }
      return new Response("ok", { status: 200, headers: { "set-cookie": "a=1" } });
    });
    const http = createFetchClient();
    const ok = await http.request({ method: "GET", url: "https://example.test/ok" });
    expect(ok.status).toBe(200);
    expect(ok.bodyText).toBe("ok");
    expect(ok.headers?.["set-cookie"]).toBe("a=1");

    await expect(
      http.request({ method: "GET", url: "https://example.test/fail" }),
    ).rejects.toBeInstanceOf(HttpTransportError);
    await expect(
      http.request({ method: "GET", url: "https://example.test/fail" }),
    ).rejects.toMatchObject({
      status: 503,
      url: "https://example.test/fail",
    });
  });

  it("sends Set-Cookie from an earlier response on the next request", async () => {
    const calls = stubFetch(async (url) => {
      if (url.endsWith("/cart.js")) {
        return new Response('{"item_count":1}', { status: 200 });
      }
      return new Response("ok", {
        status: 200,
        headers: { "set-cookie": "cart=1; Path=/" },
      });
    });
    const http = createFetchClient();
    await http.request({ method: "POST", url: "https://shop.example.test/cart/add.js" });
    await http.request({ method: "GET", url: "https://shop.example.test/cart.js" });
    expect(cookieFromCall(calls[1])).toBe("cart=1");
  });

  it("puts jar cookies before a request Cookie header", async () => {
    const calls = stubFetch(async () => {
      return new Response("ok", {
        status: 200,
        headers: { "set-cookie": "sid=abc; Path=/" },
      });
    });
    const http = createFetchClient();
    await http.request({ method: "GET", url: "https://shop.example.test/" });
    await http.request({
      method: "GET",
      url: "https://shop.example.test/account",
      headers: { Cookie: "manual=1" },
    });
    expect(cookieFromCall(calls[1])).toBe("sid=abc; manual=1");
  });

  it("stores Set-Cookie on a redirect and sends it to the Location URL", async () => {
    const calls = stubFetch(async (url) => {
      if (url.endsWith("/login")) {
        return new Response("", {
          status: 302,
          headers: {
            location: "/account",
            "set-cookie": "sid=abc; Path=/",
          },
        });
      }
      return new Response("in", { status: 200 });
    });
    const http = createFetchClient();
    const res = await http.request({ method: "POST", url: "https://shop.example.test/login" });
    expect(res.status).toBe(200);
    expect(res.bodyText).toBe("in");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://shop.example.test/account");
    expect(cookieFromCall(calls[1])).toBe("sid=abc");
    expect(calls[1]?.init?.method).toBe("GET");
  });

  it("does not share cookies across client instances", async () => {
    const calls = stubFetch(async () => {
      return new Response("ok", { status: 200, headers: { "set-cookie": "sid=abc; Path=/" } });
    });
    const first = createFetchClient();
    await first.request({ method: "GET", url: "https://shop.example.test/" });
    const second = createFetchClient();
    await second.request({ method: "GET", url: "https://shop.example.test/" });
    expect(cookieFromCall(calls[0])).toBeNull();
    expect(cookieFromCall(calls[1])).toBeNull();
  });

  it("passes an abort signal to fetch", async () => {
    const calls = stubFetch(async () => new Response("ok", { status: 200 }));
    const http = createFetchClient();
    await http.request({ method: "GET", url: "https://example.test/" });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps Authorization on a same-origin redirect", async () => {
    const calls = stubFetch(async (url) => {
      if (url.endsWith("/start")) {
        return new Response("", {
          status: 302,
          headers: { location: "/next" },
        });
      }
      return new Response("ok", { status: 200 });
    });
    const http = createFetchClient();
    await http.request({
      method: "GET",
      url: "https://shop.example.test/start",
      headers: { Authorization: "Bearer secret" },
    });
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe("Bearer secret");
  });

  it("drops Authorization and Cookie on a cross-origin redirect", async () => {
    const calls = stubFetch(async (url) => {
      if (url.includes("shop.example.test")) {
        return new Response("", {
          status: 302,
          headers: { location: "https://other.example.test/next" },
        });
      }
      return new Response("ok", { status: 200 });
    });
    const http = createFetchClient();
    await http.request({
      method: "GET",
      url: "https://shop.example.test/start",
      headers: { Authorization: "Bearer secret", Cookie: "session=1" },
    });
    expect(calls[1]?.url).toBe("https://other.example.test/next");
    const headers = new Headers(calls[1]?.init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
  });

  it("aborts when timeoutMs elapses", async () => {
    stubFetch(async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 200);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason ?? new Error("aborted"));
        });
      });
      return new Response("late", { status: 200 });
    });
    const http = createFetchClient();
    await expect(
      http.request({ method: "GET", url: "https://example.test/", timeoutMs: 20 }),
    ).rejects.toMatchObject({ status: 408 });
  });
});
