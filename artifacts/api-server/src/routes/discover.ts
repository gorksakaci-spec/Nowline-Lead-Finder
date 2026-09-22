import { Router, type IRouter } from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { DiscoverLeadsBody, DiscoverLeadsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const GOOGLE_MAPS_ACTOR = "compass~crawler-google-places";
const INSTAGRAM_SEARCH_ACTOR = "apify~instagram-search-scraper";
const INSTAGRAM_PROFILE_ACTOR = "apify~instagram-profile-scraper";
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

type Lead = {
  platform: "maps" | "instagram";
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  rating: number | null;
  reviewsCount: number | null;
  followersCount: number | null;
  isBusinessAccount?: boolean;
  bioEmail?: string | null;
  profileUrl: string | null;
};

type WebsiteInfo = {
  email: string | null;
  hasAutomationSignal: boolean;
};

function scoreLead(lead: Lead, websiteInfo: WebsiteInfo | null) {
  let score = 45;
  const notes: string[] = [];

  if (!lead.website) {
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

  const city = (lead.city ?? lead.address ?? "").toLowerCase();
  if (HUB_CITIES.some((hub) => city.includes(hub))) {
    score += 10;
    notes.push("Büyük iş merkezi (Dubai/Abu Dhabi)");
  }

  if (lead.platform === "instagram") {
    const followers = lead.followersCount ?? 0;
    if (followers >= 500 && followers <= 50_000) {
      score += 10;
      notes.push("Aktif ama mega olmayan Instagram profili");
    } else if (followers > 50_000) {
      score -= 5;
      notes.push("Çok büyük/kurumsal Instagram hesabı olabilir");
    }
    if (lead.isBusinessAccount) {
      score += 5;
      notes.push("Instagram Business hesabı");
    }
  } else {
    const reviews = lead.reviewsCount ?? 0;
    if (reviews >= 15 && reviews <= 600) {
      score += 10;
      notes.push("Aktif ama kurumsal dev olmayan işletme");
    } else if (reviews > 600) {
      score -= 5;
      notes.push("Çok büyük/kurumsal işletme olabilir");
    }
  }

  if (lead.phone) {
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

function extractEmailFromText(text: string | undefined) {
  if (!text) return null;
  return text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] ?? null;
}

function normalizeMapsPlace(place: Place): Lead {
  return {
    platform: "maps",
    name: place.title || "Bilinmiyor",
    website: place.website || null,
    email: null,
    phone: place.phone || null,
    category: place.categoryName || null,
    address: place.address || null,
    city: place.city || null,
    rating: place.totalScore ?? null,
    reviewsCount: place.reviewsCount ?? null,
    followersCount: null,
    profileUrl: null,
  };
}

function normalizeInstagramProfile(profile: Record<string, unknown>): Lead {
  const username = typeof profile.username === "string" ? profile.username : null;
  const externalUrl =
    typeof profile.externalUrl === "string"
      ? profile.externalUrl
      : typeof profile.website === "string"
        ? profile.website
        : null;
  return {
    platform: "instagram",
    name:
      (typeof profile.fullName === "string" && profile.fullName) ||
      username ||
      "Bilinmiyor",
    website: externalUrl,
    email: null,
    phone: null,
    category: "Instagram profili",
    address: null,
    city: null,
    rating: null,
    reviewsCount: null,
    followersCount:
      typeof profile.followersCount === "number" ? profile.followersCount : 0,
    isBusinessAccount: profile.isBusinessAccount === true,
    bioEmail: extractEmailFromText(
      typeof profile.biography === "string"
        ? profile.biography
        : typeof profile.bio === "string"
          ? profile.bio
          : undefined,
    ),
    profileUrl: username ? `https://instagram.com/${username}` : null,
  };
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
  return Array.isArray(response.data)
    ? response.data.map((place) => normalizeMapsPlace(place))
    : [];
}

async function runInstagramSearch(
  searchTerms: string[],
  location: string,
  maxPerTerm: number,
) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not configured");

  const searchResponse = await axios.post<unknown[]>(
    `https://api.apify.com/v2/acts/${INSTAGRAM_SEARCH_ACTOR}/run-sync-get-dataset-items`,
    {
      search: searchTerms.map((term) => `${term} ${location}`),
      searchType: "user",
      searchLimit: maxPerTerm,
    },
    { params: { token }, timeout: 1000 * 60 * 8, maxContentLength: 10_000_000 },
  );
  const usernames = [
    ...new Set(
      (Array.isArray(searchResponse.data) ? searchResponse.data : [])
        .map((profile) =>
          profile && typeof profile === "object" && "username" in profile
            ? profile.username
            : null,
        )
        .filter((username): username is string => typeof username === "string"),
    ),
  ];
  if (!usernames.length) return [];

  const profileResponse = await axios.post<unknown[]>(
    `https://api.apify.com/v2/acts/${INSTAGRAM_PROFILE_ACTOR}/run-sync-get-dataset-items`,
    { usernames },
    { params: { token }, timeout: 1000 * 60 * 8, maxContentLength: 10_000_000 },
  );
  return (Array.isArray(profileResponse.data) ? profileResponse.data : [])
    .filter((profile): profile is Record<string, unknown> => typeof profile === "object" && profile !== null)
    .map(normalizeInstagramProfile);
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
    const { location, sectorCount, maxPerSector, topN, source } = parsed.data;
    const chosenSectors = [...SECTOR_UNIVERSE]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(sectorCount, SECTOR_UNIVERSE.length));
    const searchStrings = chosenSectors.map((sector) => `${sector} in ${location}`);
    const leads: Lead[] = [];
    if (source === "maps" || source === "both") {
      leads.push(...(await runApifySearch(searchStrings, location, maxPerSector)));
    }
    if (source === "instagram" || source === "both") {
      leads.push(...(await runInstagramSearch(chosenSectors, location, maxPerSector)));
    }

    const enriched: Array<{
      platform: "maps" | "instagram";
      name: string;
      website: string | null;
      email: string | null;
      phone: string | null;
      category: string | null;
      address: string | null;
      rating: number | null;
      reviewsCount: number | null;
      followersCount: number | null;
      profileUrl: string | null;
      score: number;
      notes: string[];
    }> = [];

    for (let index = 0; index < leads.length; index += 5) {
      const batch = leads.slice(index, index + 5);
      const results = await Promise.all(
        batch.map(async (lead) => {
          const websiteInfo = lead.website
            ? await extractWebsiteInfo(lead.website)
            : null;
          const { score, notes } = scoreLead(lead, websiteInfo);
          return {
            platform: lead.platform,
            name: lead.name,
            website: lead.website,
            email: websiteInfo?.email || lead.bioEmail || null,
            phone: lead.phone,
            category: lead.category,
            address: lead.address,
            rating: lead.rating,
            reviewsCount: lead.reviewsCount,
            followersCount: lead.followersCount,
            profileUrl: lead.profileUrl,
            score,
            notes,
          };
        }),
      );
      enriched.push(...results);
    }

    const seen = new Set<string>();
    const deduped = enriched.filter((lead) => {
      const key = `${lead.platform}|${lead.name}|${lead.address || lead.profileUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => b.score - a.score);

    const output = DiscoverLeadsResponse.parse({
      source,
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