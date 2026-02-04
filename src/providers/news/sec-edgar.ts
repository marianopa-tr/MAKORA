import { generateId } from "../../lib/utils";
import type { NewsItem, NewsProvider, RawEvent } from "../types";

const SEC_BASE_URL = "https://www.sec.gov";

interface SECCompanyFiling {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

const RELEVANT_FORMS = ["8-K", "4", "13F-HR", "10-K", "10-Q", "SC 13D", "SC 13G"];

export class SECEdgarProvider implements NewsProvider {
  private symbolToCik: Map<string, string> = new Map();

  async poll(): Promise<RawEvent[]> {
    const events: RawEvent[] = [];

    try {
      const response = await fetch(
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom",
        {
          headers: {
            "User-Agent": "Makora Trading Bot (contact@example.com)",
            Accept: "application/atom+xml",
          },
        }
      );

      if (!response.ok) {
        console.error(`SEC EDGAR fetch failed: ${response.status}`);
        return events;
      }

      const text = await response.text();
      const entries = this.parseAtomFeed(text);

      for (const entry of entries.slice(0, 20)) {
        events.push({
          source: "sec_edgar",
          source_id: entry.id,
          content: JSON.stringify(entry),
          timestamp: entry.updated,
          metadata: {
            form: entry.form,
            company: entry.company,
          },
        });
      }
    } catch (error) {
      console.error("SEC EDGAR poll error:", error);
    }

    return events;
  }

  async getLatest(symbol?: string, limit: number = 20): Promise<NewsItem[]> {
    const items: NewsItem[] = [];

    if (!symbol) {
      return items;
    }

    try {
      const cik = await this.getCik(symbol);
      if (!cik) {
        return items;
      }

      const response = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, {
        headers: {
          "User-Agent": "Makora Trading Bot (contact@example.com)",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return items;
      }

      const data = (await response.json()) as SECCompanyFiling;
      const recent = data.filings.recent;

      for (let i = 0; i < Math.min(limit, recent.form.length); i++) {
        const form = recent.form[i];
        if (!form || !RELEVANT_FORMS.includes(form)) continue;

        items.push({
          id: generateId(),
          source: "sec_edgar",
          headline: `${data.name} filed ${form}`,
          summary: `SEC filing: ${form} for ${data.name}`,
          url: `${SEC_BASE_URL}/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${form}`,
          symbols: data.tickers,
          created_at: recent.filingDate[i] ?? new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("SEC EDGAR getLatest error:", error);
    }

    return items;
  }

  async search(_query: string, _limit: number = 20): Promise<NewsItem[]> {
    return [];
  }

  private parseAtomFeed(xml: string): Array<{
    id: string;
    title: string;
    updated: string;
    form: string;
    company: string;
  }> {
    const entries: Array<{
      id: string;
      title: string;
      updated: string;
      form: string;
      company: string;
    }> = [];

    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entryXml = match[1];
      if (!entryXml) continue;

      const id = this.extractTag(entryXml, "id") || generateId();
      const title = this.extractTag(entryXml, "title") || "";
      const updated = this.extractTag(entryXml, "updated") || new Date().toISOString();

      const formMatch = title.match(/\((\d+-\w+|\w+)\)/);
      const form = formMatch ? (formMatch[1] ?? "") : "";

      const companyMatch = title.match(/^([^(]+)/);
      const company = companyMatch ? (companyMatch[1]?.trim() ?? "") : "";

      entries.push({ id, title, updated, form, company });
    }

    return entries;
  }

  private extractTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`);
    const match = xml.match(regex);
    return match ? (match[1] ?? null) : null;
  }

  private async getCik(symbol: string): Promise<string | null> {
    if (this.symbolToCik.has(symbol)) {
      return this.symbolToCik.get(symbol) ?? null;
    }

    try {
      const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: {
          "User-Agent": "Makora Trading Bot (contact@example.com)",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;

      for (const entry of Object.values(data)) {
        this.symbolToCik.set(entry.ticker.toUpperCase(), String(entry.cik_str));
      }

      return this.symbolToCik.get(symbol.toUpperCase()) ?? null;
    } catch {
      return null;
    }
  }
}

export function createSECEdgarProvider(): SECEdgarProvider {
  return new SECEdgarProvider();
}
