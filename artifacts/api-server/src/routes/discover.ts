import { Router, type IRouter } from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { DiscoverLeadsBody, DiscoverLeadsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const GOOGLE_MAPS_ACTOR = "compass~crawler-google-places";
const SECTOR_UNIVERSE = [
  "beauty salon",
  "hair salon",
  "nail salon",
  "spa",
  "dental clinic",
  "aesthetic clinic",
  "medical clinic",
  "physiotherapy clinic",
  "real estate agency",
  "property management company",
  "car dealership",
  "car rental company",
  "travel agency",
  "event planning company",
  "wedding hall",
  "photography studio",
  "fitness center",
  "gym",
  "yoga studio",
  "pet shop",
  "veterinary clinic",
  "furniture store",
  "interior design studio",
  "boutique clothing store",
  "jewelry store",
  "restaurant",
  "cafe",
  "catering company",
  "tutoring center",
  "language school",
  "driving school",
  "marketing agency",
  "IT services company",
] as const;

const AUTOMATION_SIGNALS = [
  "whatsapp business api",
  "live chat",
  "livechat",
  "chatbot",
  "ai assistant",
  "intercom",
  "zendesk",
  "tawk.to",
  "crisp chat",
] as const;

const HUB_CITIES = ["dubai", "abu dhabi"] as const;

type Place = {
  title?: string;
  website?: string;
  phone?: string;
  categoryName?: string;
  address?: string;
  city?: string;
  totalScore?: number;
  reviewsCount?: number;
};

type WebsiteInfo = {
  email: string | null;
  hasAutomationSignal: boolean;
};

function scoreLead(place: Place, websiteInfo: WebsiteInfo | null) {
  let score = 45;
  const notes: string[] = [];

  if (!place.website) {
    score += 15;
    notes.push("Website yok — WhatsApp/Instagram gibi kanallara daha bağımlı");
  } else if (websiteInfo) {
    if (websiteInfo.hasAutomationSignal) {
      score -= 25;
      notes.push("Sitede zaten chatbot/canlı destek izi var");
    } else {
      score += 10;
      notes.push("Website var ama otomasyon izi yok");
    }
    if (websiteInfo.email) {
      score += 10;
      notes.push("Email bulundu — kolay ulaşım");
    }
  }

  const city = (place.city ?? place.address ?? "").toLowerCase();
  if (HUB_CITIES.some((hub) => city.includes(hub))) {
    score += 10;
    notes.push("Büyük iş merkezi (Dubai/Abu Dhabi)");
  }

  const reviews = place.reviewsCount ?? 0;
  if (reviews >= 15 && reviews <= 600) {
    score += 10;
    notes.push("Aktif ama kurumsal dev olmayan işletme");
  } else if (reviews > 600) {
    score -= 5;
    notes.push("Çok büyük/kurumsal işletme olabilir");
  }

  if (place.phone) {
    score += 5;
    notes.push("Telefon numarası mevcut");
  }

  return { score: Math.max(0, Math.min(100, score)), notes };
}

function getSafeWebsiteUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.")
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

async function extractWebsiteInfo(rawUrl: string): Promise<WebsiteInfo> {
  const target = getSafeWebsiteUrl(rawUrl);
  if (!target) return { email: null, hasAutomationSignal: false };

  try {
    const response = await axios.get<string>(target, {
      timeout: 8_000,
      maxContentLength: 1_000_000,
      maxBodyLength: 1_000_000,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NowlineLeadBot/1.0)",
      },
      maxRedirects: 3,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const html = response.data;
    const $ = cheerio.load(html);
    const text = $.root().text();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const email =
      (text.match(emailRegex) ?? []).find(
        (value) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(value),
      ) ?? null;
    const lowerHtml = html.toLowerCase();
    const hasAutomationSignal = AUTOMATION_SIGNALS.some((signal) =>
      lowerHtml.includes(signal),
    );
    return { email, hasAutomationSignal };
  } catch {
    return { email: null, hasAutomationSignal: false };
  }
}

async function runApifySearch(
  searchStrings: string[],
  location: string,
  maxPerQuery: number,
) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("APIFY_API_TOKEN is not configured");
  }

  const response = await axios.post<Place[]>(
    `https://api.apify.com/v2/acts/${GOOGLE_MAPS_ACTOR}/run-sync-get-dataset-items`,
    {
      searchStringsArray: searchStrings,
      maxCrawledPlacesPerSearch: maxPerQuery,
      language: "en",
      locationQuery: location,
      skipClosedPlaces: true,
    },
    {
      params: { token },
      timeout: 1000 * 60 * 8,
      maxContentLength: 10_000_000,
    },
  );
  return Array.isArray(response.data) ? response.data : [];
}

router.post("/discover", async (req, res) => {
  const parsed = DiscoverLeadsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Arama parametreleri geçersiz.",
      detail: parsed.error.issues[0]?.message ?? null,
    });
  }

  try {
    const { location, sectorCount, maxPerSector, topN } = parsed.data;
    const chosenSectors = [...SECTOR_UNIVERSE]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(sectorCount, SECTOR_UNIVERSE.length));
    const places = await runApifySearch(
      chosenSectors.map((sector) => `${sector} in ${location}`),
      location,
      maxPerSector,
    );

    const enriched: Array<{
      name: string;
      website: string | null;
      email: string | null;
      phone: string | null;
      category: string | null;
      address: string | null;
      rating: number | null;
      reviewsCount: number | null;
      score: number;
      notes: string[];
    }> = [];

    for (let index = 0; index < places.length; index += 5) {
      const batch = places.slice(index, index + 5);
      const results = await Promise.all(
        batch.map(async (place) => {
          const websiteInfo = place.website
            ? await extractWebsiteInfo(place.website)
            : null;
          const { score, notes } = scoreLead(place, websiteInfo);
          return {
            name: place.title || "Bilinmiyor",
            website: place.website || null,
            email: websiteInfo?.email || null,
            phone: place.phone || null,
            category: place.categoryName || null,
            address: place.address || null,
            rating: place.totalScore ?? null,
            reviewsCount: place.reviewsCount ?? null,
            score,
            notes,
          };
        }),
      );
      enriched.push(...results);
    }

    const seen = new Set<string>();
    const deduped = enriched.filter((lead) => {
      const key = `${lead.name}|${lead.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => b.score - a.score);

    const output = DiscoverLeadsResponse.parse({
      scannedSectors: chosenSectors,
      totalFound: deduped.length,
      returned: Math.min(topN, deduped.length),
      leads: deduped.slice(0, topN),
    });
    return res.json(output);
  } catch (error) {
    req.log.error({ err: error }, "Lead discovery failed");
    const detail =
      error instanceof Error && error.message === "APIFY_API_TOKEN is not configured"
        ? "APIFY_API_TOKEN tanımlı değil."
        : "Apify araması veya website zenginleştirmesi başarısız oldu.";
    return res.status(500).json({ error: "Arama sırasında hata oluştu.", detail });
  }
});

export default router;