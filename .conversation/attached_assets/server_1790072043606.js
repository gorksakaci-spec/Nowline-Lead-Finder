require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const GOOGLE_MAPS_ACTOR = "compass~crawler-google-places";

// ---------------------------------------------------------------------------
// OTONOM SEKTOR EVRENI
// Kullanicidan sektor istenmiyor. Sistem, "musteriyle yogun mesajlasan,
// WhatsApp/Instagram/Telegram uzerinden satis yapan" tipteki isletme
// turlerini kendi icinde tarar. Bu liste NOWLINE'in genel profiline gore
// genis tutuldu; tek bir sektore kilitli degil.
// ---------------------------------------------------------------------------
const SECTOR_UNIVERSE = [
  "beauty salon", "hair salon", "nail salon", "spa",
  "dental clinic", "aesthetic clinic", "medical clinic", "physiotherapy clinic",
  "real estate agency", "property management company",
  "car dealership", "car rental company",
  "travel agency", "event planning company", "wedding hall",
  "photography studio", "fitness center", "gym", "yoga studio",
  "pet shop", "veterinary clinic",
  "furniture store", "interior design studio",
  "boutique clothing store", "jewelry store",
  "restaurant", "cafe", "catering company",
  "tutoring center", "language school", "driving school",
  "marketing agency", "IT services company",
];

const AUTOMATION_SIGNALS = [
  "whatsapp business api", "live chat", "livechat", "chatbot",
  "ai assistant", "intercom", "zendesk", "tawk.to", "crisp chat",
];

const HUB_CITIES = ["dubai", "abu dhabi"];

// ---------------------------------------------------------------------------
// Puanlama: sektore gore degil, "bu isletmenin mesajlasma otomasyonuna
// ihtiyaci var mi" sinyaline gore calisir.
// ---------------------------------------------------------------------------
function scoreLead(place, websiteInfo) {
  let score = 45; // baz puan (zaten hedef evrenden geldigi icin)
  const notes = [];

  if (!place.website) {
    score += 15;
    notes.push("Website yok -> WhatsApp/Instagram gibi kanallara daha bagimli");
  } else if (websiteInfo) {
    if (websiteInfo.hasAutomationSignal) {
      score -= 25;
      notes.push("Sitede zaten bir chatbot/canli destek izi var");
    } else {
      score += 10;
      notes.push("Websitesi var ama otomasyon izi yok");
    }
    if (websiteInfo.email) {
      score += 10;
      notes.push("Email bulundu -> kolay ulasim");
    }
  }

  const city = (place.city || place.address || "").toLowerCase();
  if (HUB_CITIES.some((c) => city.includes(c))) {
    score += 10;
    notes.push("Buyuk is merkezi (Dubai/Abu Dhabi)");
  }

  const reviews = place.reviewsCount || 0;
  if (reviews >= 15 && reviews <= 600) {
    score += 10;
    notes.push("Aktif ama kurumsal dev olmayan isletme (ideal buyukluk)");
  } else if (reviews > 600) {
    score -= 5;
    notes.push("Cok buyuk/kurumsal isletme olabilir");
  }

  if (place.phone) {
    score += 5;
    notes.push("Telefon numarasi mevcut");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, notes };
}

async function extractEmailFromWebsite(url) {
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const res = await axios.get(target, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NowlineLeadBot/1.0)" },
      maxRedirects: 3,
    });
    const html = res.data;
    const $ = cheerio.load(html);
    const text = $.root().text();

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const found = (text.match(emailRegex) || []).filter(
      (e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e)
    );

    const lowerHtml = html.toLowerCase();
    const hasAutomationSignal = AUTOMATION_SIGNALS.some((s) => lowerHtml.includes(s));

    return { email: found.length ? found[0] : null, hasAutomationSignal };
  } catch (err) {
    return { email: null, hasAutomationSignal: false };
  }
}

async function runApifySearch(searchStrings, location, maxPerQuery) {
  const apifyRes = await axios.post(
    `https://api.apify.com/v2/acts/${GOOGLE_MAPS_ACTOR}/run-sync-get-dataset-items`,
    {
      searchStringsArray: searchStrings,
      maxCrawledPlacesPerSearch: maxPerQuery,
      language: "en",
      locationQuery: location,
      skipClosedPlaces: true,
    },
    { params: { token: APIFY_TOKEN }, timeout: 1000 * 60 * 8 }
  );
  return apifyRes.data || [];
}

// ---------------------------------------------------------------------------
// POST /api/discover
// body: { location: "Dubai, United Arab Emirates", sectorCount: 12, maxPerSector: 8, topN: 50 }
// Kullanicidan sektor ISTEMEZ. SECTOR_UNIVERSE icinden otomatik secim yapar,
// hepsini tarar, tek bir havuzda puanlayip en iyileri dondurur.
// ---------------------------------------------------------------------------
app.post("/api/discover", async (req, res) => {
  try {
    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: "APIFY_API_TOKEN tanimli degil. Replit Secrets kismina ekle." });
    }

    const {
      location = "United Arab Emirates",
      sectorCount = 12,
      maxPerSector = 8,
      topN = 50,
    } = req.body || {};

    // Evrenden rastgele/karisik bir alt kume sec (Apify maliyetini kontrol altinda tutmak icin)
    const shuffled = [...SECTOR_UNIVERSE].sort(() => Math.random() - 0.5);
    const chosenSectors = shuffled.slice(0, Math.min(sectorCount, SECTOR_UNIVERSE.length));
    const searchStrings = chosenSectors.map((s) => `${s} in ${location}`);

    const places = await runApifySearch(searchStrings, location, maxPerSector);

    const enriched = [];
    const BATCH = 5;
    for (let i = 0; i < places.length; i += BATCH) {
      const batch = places.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (p) => {
          const websiteInfo = p.website ? await extractEmailFromWebsite(p.website) : null;
          const { score, notes } = scoreLead(p, websiteInfo);
          return {
            name: p.title || "Bilinmiyor",
            website: p.website || null,
            email: websiteInfo?.email || null,
            phone: p.phone || null,
            category: p.categoryName || null,
            address: p.address || null,
            rating: p.totalScore || null,
            reviewsCount: p.reviewsCount || null,
            score,
            notes,
          };
        })
      );
      enriched.push(...results);
    }

    // Ayni isletme farkli sektor aramalarindan iki kere gelmis olabilir -> tekillestir
    const seen = new Set();
    const deduped = enriched.filter((l) => {
      const key = `${l.name}|${l.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => b.score - a.score);
    const top = deduped.slice(0, topN);

    res.json({
      scannedSectors: chosenSectors,
      totalFound: deduped.length,
      returned: top.length,
      leads: top,
    });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ error: "Arama sirasinda hata olustu.", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nowline Lead Finder http://localhost:${PORT} adresinde calisiyor`));
