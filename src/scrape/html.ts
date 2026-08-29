import { load, type CheerioAPI } from "cheerio";

export interface HtmlNode {
  selectAll(selector: string): HtmlNode[];
  text(): string;
  attr(name: string): string | null;
}

export interface HtmlDocument {
  selectAll(selector: string): HtmlNode[];
}

type CheerioElem = Parameters<CheerioAPI>[0];

class CheerioHtmlNode implements HtmlNode {
  constructor(
    private readonly $: CheerioAPI,
    private readonly node: CheerioElem,
  ) {}

  selectAll(selector: string): HtmlNode[] {
    return this.$(this.node)
      .find(selector)
      .toArray()
      .map((el) => new CheerioHtmlNode(this.$, el));
  }

  text(): string {
    return this.$(this.node).text().trim();
  }

  attr(name: string): string | null {
    const value = this.$(this.node).attr(name);
    return value === undefined ? null : value;
  }
}

export const parseHtml = (html: string): HtmlDocument => {
  const $ = load(html);
  return {
    selectAll(selector: string) {
      return $(selector)
        .toArray()
        .map((el) => new CheerioHtmlNode($, el));
    },
  };
};
