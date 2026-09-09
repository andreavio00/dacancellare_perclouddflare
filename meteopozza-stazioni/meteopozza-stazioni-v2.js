import baseWorker from "./meteopozza-stazioni.js";

const POZZA_URL = "https://www.fassaweb.net/it-it/meteoestrade/datirilevatiapozzadifassa.aspx";
const SOURCE_TIMEOUT_MS = 4500;
const EDGE_CACHE_SECONDS = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&deg;|&#176;/gi, "°")
    .replace(/&agrave;/gi, "à")
    .replace(/&egrave;/gi, "è")
    .replace(/&igrave;/gi, "ì")
    .replace(/&ograve;/gi, "ò")
    .replace(/&ugrave;/gi, "ù")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value) {
  const m = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function normalize12h(hour, suffix) {
  let h = Number(hour);
  const s = String(suffix || "").toUpperCase();
  // Il titolo FassaWEB può mostrare, per esempio, "20:00 PM": se l'ora è
  // già in formato 24h ignoriamo il suffisso. Per min/max (1:58 PM, 7:19 AM)
  // applichiamo invece la normale conversione 12h -> 24h.
  if (h <= 12 && s) {
    if (s === "PM" && h < 12) h += 12;
    if (s === "AM" && h === 12) h = 0;
  }
  return h;
}

function italyOffset(year, month, day) {
  try {
    const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Rome",
      timeZoneName: "longOffset",
      hour: "2-digit"
    }).formatToParts(probe).find(p => p.type === "timeZoneName")?.value || "GMT+01:00";
    const m = part.match(/GMT([+-]\d{2}:\d{2})/);
    return m ? m[1] : "+01:00";
  } catch {
    return "+01:00";
  }
}

function localIso(year, month, day, hour, minute) {
  const pad = n => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${italyOffset(year, month, day)}`;
}

function clock24(hour, minute, suffix) {
  const pad = n => String(n).padStart(2, "0");
  return `${pad(normalize12h(hour, suffix))}:${pad(minute)}`;
}

function parsePozza(html) {
  const text = cleanText(html);

  const stamp = text.match(/Dati rilevati il\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+alle\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);

  // FassaWEB usa una tabella con una prima riga di intestazioni
  // "Attuale Minima Massima" e una seconda riga con i tre valori.
  // Dopo cleanText() l'ordine diventa quindi:
  // Temperature Attuale Minima Massima 22.2 °C 11.8 °C alle ... 27.8 °C alle ...
  const temp = text.match(
    /Temperature\s+Attuale\s+Minima\s+Massima\s+(-?\d+(?:[.,]\d+)?)\s*°C\s+(-?\d+(?:[.,]\d+)?)\s*°C\s+alle\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\s+(-?\d+(?:[.,]\d+)?)\s*°C\s+alle\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i
  );

  // Anche pressione e umidità sono due colonne della stessa tabella:
  // le due intestazioni compaiono prima, poi i rispettivi valori.
  const pressureHumidity = text.match(
    /Pressione assoluta\s+Umidità relativa\s+(-?\d+(?:[.,]\d+)?)\s*hPa\s+Variazione nelle 3 ore precedenti:\s*(-?\d+(?:[.,]\d+)?)\s*hPa\s+(\d+(?:[.,]\d+)?)\s*%/i
  );

  if (!temp && !pressureHumidity) throw new Error("Campi principali Pozza non trovati");

  let aggiornamento = null;
  if (stamp) {
    const [, dd, mm, yyyy, hh, min, suffix] = stamp;
    aggiornamento = localIso(Number(yyyy), Number(mm), Number(dd), normalize12h(hh, suffix), Number(min));
  }

  return {
    stazione: "Pozza di Fassa",
    fonte: "FassaWEB",
    tipo: "amatoriale",
    avvertenza: "Stazione amatoriale · dati non ufficiali",
    temperatura: temp ? {
      attuale: numberValue(temp[1]),
      min: numberValue(temp[2]),
      ora_min: clock24(temp[3], temp[4], temp[5]),
      max: numberValue(temp[6]),
      ora_max: clock24(temp[7], temp[8], temp[9])
    } : null,
    umidita: { attuale: pressureHumidity ? numberValue(pressureHumidity[3]) : null },
    pressione: pressureHumidity ? {
      attuale: numberValue(pressureHumidity[1]),
      variazione_3h: numberValue(pressureHumidity[2])
    } : null,
    aggiornamento
  };
}

async function fetchPozza() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(POZZA_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MeteoPozzaWorker/2.0)",
        "Accept": "text/html,application/xhtml+xml"
      },
      signal: controller.signal
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true, status: response.status, html, errore: null };
  } catch (error) {
    return {
      ok: false,
      status: null,
      html: null,
      errore: controller.signal.aborted ? `Timeout dopo ${SOURCE_TIMEOUT_MS}ms` : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readPozzaKv(env) {
  if (!env?.METEO_CACHE) return null;
  try {
    const raw = await env.METEO_CACHE.get("stazione:pozza");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function writePozzaKv(env, data) {
  if (!env?.METEO_CACHE) return;
  try {
    await env.METEO_CACHE.put("stazione:pozza", JSON.stringify(data), { expirationTtl: 21600 });
  } catch {}
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "GET") {
      return new Response("Metodo non consentito", { status: 405, headers: corsHeaders });
    }

    const raw = url.searchParams.get("raw");
    if (raw === "pozza") {
      const r = await fetchPozza();
      return new Response(r.ok ? r.html : `Errore: ${r.errore}`, {
        status: r.ok ? r.status : 502,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    if (raw) {
      return baseWorker.fetch(request, env, ctx);
    }

    // Cache breve dell'intero JSON. La chiave ignora il parametro ?_=Date.now()
    // usato dal frontend, così aperture ravvicinate non riscaricano tutte le fonti.
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(`${url.origin}${url.pathname}?edge=v2`, { method: "GET" });
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const [baseResponse, pozzaFetch] = await Promise.all([
      baseWorker.fetch(request, env, ctx),
      fetchPozza()
    ]);

    let base = { ok: true, timestamp: new Date().toISOString(), vigo: null, monzon: null, moena: null };
    try {
      if (baseResponse.ok) base = await baseResponse.json();
    } catch {}

    let pozza = null;
    if (pozzaFetch.ok) {
      try {
        pozza = { ...parsePozza(pozzaFetch.html), http: pozzaFetch.status, stato: "ok" };
        if (ctx?.waitUntil) ctx.waitUntil(writePozzaKv(env, pozza));
        else await writePozzaKv(env, pozza);
      } catch (error) {
        pozza = await readPozzaKv(env);
        if (pozza) pozza = { ...pozza, http: null, stato: "stale", erroreRete: `Parsing fallito: ${error}` };
      }
    } else {
      pozza = await readPozzaKv(env);
      if (pozza) pozza = { ...pozza, http: null, stato: "stale", erroreRete: pozzaFetch.errore };
    }

    const risultato = {
      ...base,
      ok: true,
      timestamp: new Date().toISOString(),
      pozza
    };

    const response = new Response(JSON.stringify(risultato, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}, stale-while-revalidate=120`
      }
    });

    if (cache && ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
