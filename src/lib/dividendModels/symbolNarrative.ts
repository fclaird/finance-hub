import { logError } from "@/lib/log";
import { fetchSchwabInstrumentFundamental } from "@/lib/schwab/instrumentFundamental";

const WD_UA = "FinanceHubSymbolNarrative/1.0 (local; opensource data)";

/** English Wikidata description for best entity match, or null. */
async function wikidataEnglishDescription(search: string): Promise<{ text: string; label: string; id: string } | null> {
  const q = (search ?? "").trim();
  if (q.length < 2) return null;
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.searchParams.set("action", "wbsearchentities");
  searchUrl.searchParams.set("search", q);
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("limit", "3");

  try {
    const resp = await fetch(searchUrl.toString(), { headers: { "User-Agent": WD_UA } });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      search?: Array<{ id: string; label?: string; description?: string }>;
    };
    const hit = json.search?.[0];
    if (!hit?.id) return null;

    let text = (hit.description ?? "").trim();
    if (!text) {
      const entUrl = new URL("https://www.wikidata.org/w/api.php");
      entUrl.searchParams.set("action", "wbgetentities");
      entUrl.searchParams.set("ids", hit.id);
      entUrl.searchParams.set("props", "descriptions");
      entUrl.searchParams.set("languages", "en");
      entUrl.searchParams.set("format", "json");
      const entResp = await fetch(entUrl.toString(), { headers: { "User-Agent": WD_UA } });
      if (entResp.ok) {
        const ent = (await entResp.json()) as {
          entities?: Record<string, { descriptions?: { en?: { value?: string } } }>;
        };
        text = (ent.entities?.[hit.id]?.descriptions?.en?.value ?? "").trim();
      }
    }
    if (!text) return null;
    const label = (hit.label ?? "").trim() || hit.id;
    return { text, label, id: hit.id };
  } catch (e) {
    logError("wikidata_description_fetch", e);
    return null;
  }
}

/**
 * Build a short plain-English summary: what the company does and how it earns money.
 * Combines Wikidata (entity description), Wikipedia lead/extract, and Schwab sector/industry.
 */
function buildBusinessSummary(opts: {
  sym: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  wikiIntro: string | null;
  wikidata: { text: string; label: string; id: string } | null;
}): string {
  const { sym, companyName, sector, industry, wikiIntro, wikidata } = opts;
  const parts: string[] = [];

  if (wikidata?.text) {
    const d = wikidata.text.replace(/\s+/g, " ").trim();
    if (d.length > 20) parts.push(d.endsWith(".") ? d : `${d}.`);
  }

  if (wikiIntro && wikiIntro.length > 40) {
    const sentences = wikiIntro
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 30);
    let wikiChunk = "";
    for (const s of sentences.slice(0, 3)) {
      const low = s.toLowerCase();
      const dup =
        wikidata?.text &&
        (low.includes(wikidata.text.slice(0, 40).toLowerCase()) || wikidata.text.toLowerCase().includes(low.slice(0, 40)));
      if (dup) continue;
      wikiChunk = wikiChunk ? `${wikiChunk} ${s}` : s;
      if (wikiChunk.length > 420) break;
    }
    if (wikiChunk.trim()) {
      const w = wikiChunk.trim();
      parts.push(w.endsWith(".") ? w : `${w}.`);
    }
  }

  if (sector || industry) {
    const label = companyName ?? sym;
    parts.push(
      `Market data classifies ${label} (${sym}) in the ${sector ?? "reported"} sector${industry ? `, ${industry}` : ""} — check the issuer’s latest 10-K for revenue mix and risks.`,
    );
  }

  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length > 1400) return joined.slice(0, 1397).trimEnd() + "…";
  if (!joined) {
    return `${companyName ?? sym} (${sym}): no Wikidata or Wikipedia summary matched. When fundamentals exist, Schwab lists sector ${sector ?? "n/a"} and industry ${industry ?? "n/a"} — read the issuer’s latest 10-K for how the business operates and earns revenue.`;
  }
  return joined;
}

function stripWikiNoise(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\{\{[^}]*\}\}/g, "")
    .trim();
}

/** Wikipedia extracts intro (plain text) for a page title, or null. */
async function wikipediaIntroForTitle(title: string): Promise<string | null> {
  const u = new URL("https://en.wikipedia.org/w/api.php");
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("prop", "extracts");
  u.searchParams.set("exintro", "true");
  u.searchParams.set("explaintext", "true");
  u.searchParams.set("titles", title);

  try {
    const resp = await fetch(u.toString(), { headers: { "User-Agent": "FinanceHubDividendModels/1.0 (contact: local)" } });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      query?: { pages?: Record<string, { extract?: string; missing?: boolean }> };
    };
    const pages = json.query?.pages;
    if (!pages) return null;
    const first = Object.values(pages)[0];
    if (!first || first.missing || !first.extract) return null;
    return stripWikiNoise(first.extract);
  } catch (e) {
    logError("wikipedia_intro_fetch", e);
    return null;
  }
}

/** Longer plain-text extract (not intro-only) for richer “what they do” copy. */
async function wikipediaArticleExtract(title: string): Promise<string | null> {
  const u = new URL("https://en.wikipedia.org/w/api.php");
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("prop", "extracts");
  u.searchParams.set("explaintext", "true");
  u.searchParams.set("exintro", "false");
  u.searchParams.set("exchars", "9000");
  u.searchParams.set("titles", title);

  try {
    const resp = await fetch(u.toString(), { headers: { "User-Agent": "FinanceHubDividendModels/1.0 (contact: local)" } });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      query?: { pages?: Record<string, { extract?: string; missing?: boolean }> };
    };
    const pages = json.query?.pages;
    if (!pages) return null;
    const first = Object.values(pages)[0];
    if (!first || first.missing || !first.extract) return null;
    return stripWikiNoise(first.extract);
  } catch (e) {
    logError("wikipedia_article_fetch", e);
    return null;
  }
}

async function wikipediaSearchBestTitle(query: string): Promise<string | null> {
  const u = new URL("https://en.wikipedia.org/w/api.php");
  u.searchParams.set("action", "opensearch");
  u.searchParams.set("search", query);
  u.searchParams.set("limit", "3");
  u.searchParams.set("namespace", "0");
  u.searchParams.set("format", "json");

  try {
    const resp = await fetch(u.toString(), { headers: { "User-Agent": "FinanceHubDividendModels/1.0 (contact: local)" } });
    if (!resp.ok) return null;
    const json = (await resp.json()) as [string, string[], string[], string[]];
    const titles = Array.isArray(json?.[1]) ? json[1] : [];
    return typeof titles[0] === "string" ? titles[0] : null;
  } catch (e) {
    logError("wikipedia_opensearch", e);
    return null;
  }
}

function splitIntoParagraphs(text: string, maxParas = 5, minLen = 60): string[] {
  let chunks = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= minLen);
  if (chunks.length <= 1 && text.length > 400) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 40);
    chunks = [];
    let buf = "";
    for (const s of sentences) {
      const next = buf ? `${buf} ${s}` : s;
      if (next.length > 520 && buf) {
        chunks.push(buf.trim());
        buf = s;
        if (chunks.length >= maxParas) break;
      } else {
        buf = next;
      }
    }
    if (buf && chunks.length < maxParas) chunks.push(buf.trim());
  }
  const out = chunks.slice(0, maxParas);
  if (out.length === 0 && text.length > minLen) return [text.slice(0, 2800)];
  return out;
}

export type SymbolNarrativeResult = {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  /** 2–4 sentences from Wikidata + Wikipedia + Schwab classification (what they do / revenue context). */
  businessSummary: string;
  paragraphs: string[];
  sources: string[];
};

export async function buildSymbolNarrative(symbol: string): Promise<SymbolNarrativeResult> {
  const sym = (symbol ?? "").trim().toUpperCase();
  const f = await fetchSchwabInstrumentFundamental(sym);
  const companyName = f.companyName;
  const sector = f.sector;
  const industry = f.industry;
  const sources: string[] = ["Schwab instrument fundamentals"];

  const paras: string[] = [];

  const searchQ =
    companyName && companyName.length > 2 && companyName.length < 140 ? companyName : `${sym} company stock`;
  const wikiTitle = await wikipediaSearchBestTitle(searchQ);
  let wikiIntro: string | null = null;
  let wikiBody: string | null = null;
  if (wikiTitle) {
    wikiIntro = await wikipediaIntroForTitle(wikiTitle);
    wikiBody = await wikipediaArticleExtract(wikiTitle);
    if (wikiIntro || wikiBody) sources.push(`Wikipedia (“${wikiTitle}”, article extract)`);
  }

  const wdQuery =
    companyName && companyName.length > 2 && companyName.length < 140 ? companyName : `${sym} stock company`;
  const wikidata = await wikidataEnglishDescription(wdQuery);
  if (wikidata) sources.push(`Wikidata (${wikidata.label}, ${wikidata.id})`);

  const introParas = wikiIntro && wikiIntro.length > 80 ? splitIntoParagraphs(wikiIntro, 2, 40) : [];
  const bodyParas =
    wikiBody && wikiBody.length > 200
      ? splitIntoParagraphs(wikiBody.replace(wikiIntro ?? "", " ").trim(), 4, 80)
      : [];

  const merged: string[] = [];
  for (const p of introParas) merged.push(p);
  for (const p of bodyParas) {
    if (merged.length >= 5) break;
    if (!merged.some((x) => x.slice(0, 80) === p.slice(0, 80))) merged.push(p);
  }
  paras.push(...merged.slice(0, 5));

  if (paras.length === 0) {
    paras.push(
      `${companyName ?? sym} (${sym}) is how this issue appears in your connected market-data feed. Schwab classifies it in the ${sector ?? "unknown"} sector and ${industry ?? "a broad industry"} category when those fields are present.`,
    );
    paras.push(
      "For dividend models, cash flows and yields are only as good as the underlying distribution policy and the quotes used to estimate forward income. Review the issuer’s latest annual report, earnings materials, and exchange filings for how the business earns revenue, funds distributions, and manages leverage or commodity exposure.",
    );
    paras.push(
      "This blurb is informational, not investment advice. Data can be delayed or incomplete; verify critical dates (ex-dividend, pay dates) against your broker and issuer announcements.",
    );
  } else if (paras.length <= 2) {
    paras.push(
      `From the same public fundamentals snapshot, ${sym} is associated with ${sector ?? "its reported sector"} and ${industry ?? "its reported industry"} when available. Distribution-heavy vehicles often combine fee income, interest spreads, royalties, midstream fees, or portfolio income depending on structure.`,
    );
    paras.push(
      "Use SEC filings (10-K/10-Q), the issuer’s investor relations site, and major news sources for the most current description of operations and risks.",
    );
  } else if (paras.length === 3) {
    paras.push(
      "Cross-check any Wikipedia summary with primary filings and issuer disclosures; corporate actions and strategy can change meaningfully over time.",
    );
  }

  const businessSummary = buildBusinessSummary({
    sym,
    companyName,
    sector,
    industry,
    wikiIntro,
    wikidata,
  });

  return {
    symbol: sym,
    companyName,
    sector,
    industry,
    businessSummary,
    paragraphs: paras.slice(0, 5),
    sources,
  };
}
