import { describe, expect, it } from "vitest";
import { CookieJar, mergeCookieHeader, parseSetCookie } from "../src/http/cookies.js";

describe("parseSetCookie", () => {
  it("defaults to the request host and directory path", () => {
    const cookie = parseSetCookie("sid=abc", new URL("https://shop.example.test/cart/add"));
    expect(cookie).toMatchObject({
      name: "sid",
      value: "abc",
      domain: "shop.example.test",
      hostOnly: true,
      path: "/cart",
      secure: false,
    });
  });

  it("rejects a Domain that does not match the request host", () => {
    expect(
      parseSetCookie("sid=abc; Domain=evil.test", new URL("https://shop.example.test/")),
    ).toBeUndefined();
  });

  it("rejects a public-suffix-like Domain with no dot", () => {
    expect(
      parseSetCookie("sid=abc; Domain=com", new URL("https://shop.example.test/")),
    ).toBeUndefined();
  });
});

describe("CookieJar", () => {
  it("sends stored cookies to a matching later URL", () => {
    const jar = new CookieJar();
    const headers = new Headers();
    headers.append("set-cookie", "cart=1; Path=/");
    headers.append("set-cookie", "sid=abc; Path=/");
    jar.storeFromResponse("https://shop.example.test/cart/add.js", headers);
    expect(jar.cookieHeaderFor("https://shop.example.test/cart.js")).toBe("cart=1; sid=abc");
  });

  it("does not send a Secure cookie to http", () => {
    const jar = new CookieJar();
    const headers = new Headers({ "set-cookie": "sid=abc; Secure; Path=/" });
    jar.storeFromResponse("https://shop.example.test/", headers);
    expect(jar.cookieHeaderFor("http://shop.example.test/")).toBeUndefined();
    expect(jar.cookieHeaderFor("https://shop.example.test/")).toBe("sid=abc");
  });

  it("does not send an expired cookie", () => {
    const jar = new CookieJar();
    const headers = new Headers({ "set-cookie": "sid=abc; Max-Age=0; Path=/" });
    jar.storeFromResponse("https://shop.example.test/", headers);
    expect(jar.cookieHeaderFor("https://shop.example.test/")).toBeUndefined();
  });

  it("keeps a host-only cookie off a sibling host", () => {
    const jar = new CookieJar();
    jar.storeFromResponse(
      "https://shop.example.test/",
      new Headers({ "set-cookie": "sid=abc; Path=/" }),
    );
    expect(jar.cookieHeaderFor("https://other.example.test/")).toBeUndefined();
  });

  it("sends a Domain cookie to a subdomain", () => {
    const jar = new CookieJar();
    jar.storeFromResponse(
      "https://example.test/",
      new Headers({ "set-cookie": "sid=abc; Domain=example.test; Path=/" }),
    );
    expect(jar.cookieHeaderFor("https://shop.example.test/")).toBe("sid=abc");
  });
});

describe("mergeCookieHeader", () => {
  it("puts jar cookies before a request Cookie header", () => {
    expect(mergeCookieHeader({ Cookie: "extra=1" }, "sid=abc")).toEqual({
      Cookie: "sid=abc; extra=1",
    });
  });
});
