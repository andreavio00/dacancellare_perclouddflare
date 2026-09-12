/*
 * PozzaLive / Meteo Fassa - previsioni su richiesta v1.0
 *
 * Il Worker e' indipendente dall'aggregatore delle localita fisse.
 * Non viene chiamato all'apertura della pagina: /search parte solo dopo
 * l'azione dell'utente e /forecast solo dopo la scelta di un risultato.
 *
 * Endpoint:
 *   GET  /
 *   GET  /health
 *   GET  /search?q={testo}&limit={1..10}
 *   GET  /forecast?id={id_opaco}
 *   OPTIONS *
 */

const SERVICE_NAME = "meteo-fassa-previsioni-richiesta";
const SCHEMA_VERSION = "1.0";
const FORECAST_SCHEMA_VERSION = "1.2";
const SCOPE = "dolomites_euregio";

const SEARCH_CACHE_TTL = 24 * 60 * 60;
const FORECAST_CACHE_TTL = 30 * 60;
const CATALOG_CACHE_TTL = 24 * 60 * 60;
const HEALTH_CACHE_TTL = 60;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;
const FORECAST_DAYS = 3;
const MODEL = "icon_d2";

const TARGET_PERIOD_STARTS = new Set(["08:00", "11:00", "14:00", "17:00"]);

const METEOREPORT_CATALOGS = [
  {
    key: "trentino",
    url: "https://meteo.report/open_data/forecasts/trentino.json",
    admin1: "Trentino-Alto Adige/Südtirol",
    admin2: "Trento"
  },
  {
    key: "sud_tyrol",
    url: "https://meteo.report/open_data/forecasts/sud_tyrol.json",
    admin1: "Trentino-Alto Adige/Südtirol",
    admin2: "Bolzano"
  }
];

const KNOWN_PLACES = [
  {
    ref: "baita_alle_cascate",
    name: "Baita alle Cascate",
    aliases: ["Cascate Val San Nicolò", "Baita Cascate"],
    context: "Val San Nicolò · San Giovanni di Fassa · Trento",
    kind: "point_of_interest",
    latitude: 46.41616,
    longitude: 11.78222,
    elevation_m: 1850
  },
  {
    ref: "passo_san_nicolo",
    name: "Passo San Nicolò",
    aliases: ["Pas de Sèn Nicolò"],
    context: "San Giovanni di Fassa · Trento",
    kind: "pass",
    latitude: 46.42173,
    longitude: 11.79331,
    elevation_m: 2340
  },
  {
    ref: "rifugio_contrin",
    name: "Rifugio Contrin",
    aliases: ["Contrin"],
    context: "Val Contrin · Canazei · Trento",
    kind: "point_of_interest",
    latitude: 46.42972,
    longitude: 11.81616,
    elevation_m: 2016
  },
  {
    ref: "penia",
    name: "Penia",
    aliases: ["Penia di Canazei"],
    context: "Canazei · Trento",
    kind: "town",
    latitude: 46.45804,
    longitude: 11.79882,
    elevation_m: 1550
  },
  {
    ref: "passo_fedaia",
    name: "Passo Fedaia",
    aliases: ["Fedaia"],
    context: "Marmolada · Trento/Belluno",
    kind: "pass",
    latitude: 46.4535,
    longitude: 11.889,
    elevation_m: 2057
  },
  {
    ref: "rifugio_vajolet",
    name: "Rifugio Vajolet",
    aliases: ["Vajolet"],
    context: "Catinaccio · San Giovanni di Fassa · Trento",
    kind: "point_of_interest",
    latitude: 46.45799,
    longitude: 11.63275,
    elevation_m: 2243
  },
  {
    ref: "passo_feudo",
    name: "Passo Feudo",
    aliases: ["Feudo"],
    context: "Latemar · Predazzo · Trento",
    kind: "pass",
    latitude: 46.34471,
    longitude: 11.55894,
    elevation_m: 2175
  },
  {
    ref: "rifugio_sasso_piatto",
    name: "Rifugio Sasso Piatto",
    aliases: ["Sasso Piatto", "Plattkofelhütte"],
    context: "Sassolungo · Alpe di Siusi · Bolzano",
    kind: "point_of_interest",
    latitude: 46.5044,
    longitude: 11.70087,
    elevation_m: 2300
  },
  {
    ref: "val_duron_baita_lino_brach",
    name: "Val Duron - Baita Lino Brach",
    aliases: ["Baita Lino Brach", "Val Duron"],
    context: "Val Duron · Campitello di Fassa · Trento",
    kind: "point_of_interest",
    latitude: 46.49271,
    longitude: 11.695762,
    elevation_m: 1856
  }
].map(place => ({
  ...place,
  origin: "local",
  geocoder: "pozzalive",
  timezone: "Europe/Rome",
  country_code: "IT",
  admin1: "Trentino-Alto Adige/Südtirol",
  admin2: place.context.includes("Bolzano") ? "Bolzano" : "Trento",
  preferred_forecast_provider: "open-meteo",
  forecast_location: null
}));

const WEATHER = {
  clear: { code: "clear", label_it: "Sereno", icon: "☀️", severity: 10 },
  mostly_clear: { code: "mostly_clear", label_it: "Poco nuvoloso", icon: "🌤️", severity: 20 },
  partly_cloudy: { code: "partly_cloudy", label_it: "Parzialmente nuvoloso", icon: "⛅", severity: 30 },
  cloudy: { code: "cloudy", label_it: "Nuvoloso", icon: "☁️", severity: 40 },
  overcast: { code: "overcast", label_it: "Molto nuvoloso", icon: "☁️", severity: 50 },
  fog: { code: "fog", label_it: "Nebbia o foschia", icon: "🌫️", severity: 50 },
  drizzle: { code: "drizzle", label_it: "Pioviggine", icon: "🌦️", severity: 60 },
  light_rain: { code: "light_rain", label_it: "Pioggia debole", icon: "🌦️", severity: 65 },
  rain: { code: "rain", label_it: "Pioggia", icon: "🌧️", severity: 75 },
  heavy_rain: { code: "heavy_rain", label_it: "Pioggia forte", icon: "🌧️", severity: 90 },
  light_showers: { code: "light_showers", label_it: "Rovesci deboli", icon: "🌦️", severity: 65 },
  showers: { code: "showers", label_it: "Rovesci", icon: "🌦️", severity: 80 },
  heavy_showers: { code: "heavy_showers", label_it: "Rovesci forti", icon: "🌧️", severity: 90 },
  light_snow: { code: "light_snow", label_it: "Neve debole", icon: "🌨️", severity: 65 },
  snow: { code: "snow", label_it: "Neve", icon: "🌨️", severity: 80 },
  heavy_snow: { code: "heavy_snow", label_it: "Neve forte", icon: "🌨️", severity: 90 },
  unstable: { code: "unstable", label_it: "Instabile", icon: "🌦️", severity: 80 },
  thunderstorm: { code: "thunderstorm", label_it: "Temporali", icon: "⛈️", severity: 110 },
  unknown: { code: "unknown", label_it: "Non definito", icon: "❔", severity: 0 }
};

const METEOREPORT_SKY = {
  A: ["clear", "Cielo sereno"],
  B: ["mostly_clear", "Soleggiato"],
  C: ["partly_cloudy", "Parzialmente nuvoloso"],
  D: ["cloudy", "Nuvoloso"],
  E: ["overcast", "Molto nuvoloso"],
  F: ["showers", "Rovesci"],
  G: ["heavy_showers", "Rovesci forti"],
  H: ["rain", "Pioggia moderata"],
  I: ["heavy_rain", "Pioggia forte"],
  J: ["light_rain", "Pioggia debole"],
  K: ["light_showers", "Rovesci deboli"],
  L: ["light_snow", "Neve debole e sole"],
  M: ["snow", "Neve e sole"],
  N: ["light_snow", "Neve debole"],
  O: ["snow", "Neve moderata"],
  P: ["heavy_snow", "Neve forte"],
  Q: ["light_snow", "Neve bagnata e sole"],
  R: ["snow", "Neve bagnata"],
  S: ["fog", "Foschia"],
  T: ["fog", "Foschia in quota"],
  U: ["unstable", "Instabile"],
  V: ["thunderstorm", "Temporali"],
  W: ["snow", "Instabile con neve bagnata"],
  X: ["thunderstorm", "Temporali di neve bagnata"],
  Y: ["thunderstorm", "Instabile con temporali nevosi"],
  Z: ["thunderstorm", "Temporali nevosi"]
};

const WMO_PRIORITY = {
  0: 10, 1: 20, 2: 30, 3: 40,
  45: 50, 48: 55,
  51: 60, 53: 62, 55: 64, 56: 66, 57: 68,
  61: 70, 63: 72, 65: 74, 66: 76, 67: 78,
  71: 80, 73: 82, 75: 84, 77: 86,
  80: 90, 81: 92, 82: 94, 85: 96, 86: 98,
  95: 110, 96: 115, 99: 120
};

const ATTRIBUTIONS = {
  meteoreport: {
    name: "Meteo.report / GeoSphere Austria",
    url: "https://meteo.report/"
  },
  openstreetmap: {
    name: "© OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright"
  },
  openMeteoGeocoding: {
    name: "Open-Meteo Geocoding / GeoNames",
    url: "https://open-meteo.com/en/docs/geocoding-api"
  },
  openMeteoForecast: {
    name: "Open-Meteo / DWD ICON-D2",
    url: "https://open-meteo.com/en/docs/dwd-api"
  }
};

class AppError extends Error {
  constructor(status, code, message, retryable = false, upstreamStatus = null) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.upstreamStatus = upstreamStatus;
  }
}

function validNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validValues(values) {
  return values.map(validNumber).filter(value => value !== null);
}

function average(values) {
  const valid = validValues(values);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function sumComplete(values) {
  const valid = validValues(values);
  return valid.length === values.length
    ? valid.reduce((sum, value) => sum + value, 0)
    : null;
}

function minimum(values) {
  const valid = validValues(values);
  return valid.length ? Math.min(...valid) : null;
}

function maximum(values) {
  const valid = validValues(values);
  return valid.length ? Math.max(...valid) : null;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseLocalIso(iso) {
  const match = String(iso ?? "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
  );
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
}

function addMinutesLocal(iso, minutes) {
  const parsed = parseLocalIso(iso);
  if (!parsed) return null;
  const date = new Date(Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute
  ));
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

function localDateTimeParts(timeZone, instant = new Date()) {
  const requestedZone = safeText(timeZone, 50) || "Europe/Rome";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: requestedZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
      isoMinute: `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`,
      secondsOfDay: Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second)
    };
  } catch {
    if (requestedZone !== "Europe/Rome") return localDateTimeParts("Europe/Rome", instant);
    return {
      isoMinute: instant.toISOString().slice(0, 16),
      secondsOfDay: instant.getUTCHours() * 3600 + instant.getUTCMinutes() * 60 + instant.getUTCSeconds()
    };
  }
}

function weightedWindDirection(directions, speeds) {
  let x = 0;
  let y = 0;
  let totalWeight = 0;

  for (let index = 0; index < directions.length; index += 1) {
    const direction = validNumber(directions[index]);
    const speed = validNumber(speeds[index]);
    if (direction === null || speed === null) continue;
    const radians = direction * Math.PI / 180;
    x += Math.sin(radians) * speed;
    y += Math.cos(radians) * speed;
    totalWeight += speed;
  }

  if (!totalWeight) return null;
  let degrees = Math.atan2(x, y) * 180 / Math.PI;
  if (degrees < 0) degrees += 360;
  return round(degrees, 0);
}

function makeWeather(type, sourceCode = null, label = null) {
  const base = WEATHER[type] || WEATHER.unknown;
  return {
    ...base,
    label_it: label || base.label_it,
    source_code: sourceCode
  };
}

function representativeWmo(codes) {
  const valid = validValues(codes);
  if (!valid.length) return null;
  return valid.reduce((best, current) =>
    (WMO_PRIORITY[current] ?? -1) > (WMO_PRIORITY[best] ?? -1) ? current : best
  );
}

function weatherFromWmo(code) {
  if (code === null) return makeWeather("unknown", null);
  if (code === 0) return makeWeather("clear", code);
  if (code === 1) return makeWeather("mostly_clear", code);
  if (code === 2) return makeWeather("partly_cloudy", code);
  if (code === 3) return makeWeather("cloudy", code);
  if ([45, 48].includes(code)) return makeWeather("fog", code);
  if ([51, 53, 55, 56, 57].includes(code)) return makeWeather("drizzle", code);
  if ([61, 63, 65, 66, 67].includes(code)) return makeWeather("rain", code);
  if ([71, 73, 75, 77, 85, 86].includes(code)) return makeWeather("snow", code);
  if ([80, 81, 82].includes(code)) return makeWeather("showers", code);
  if ([95, 96, 99].includes(code)) return makeWeather("thunderstorm", code);
  return makeWeather("unknown", code);
}

function weatherFromMeteoReport(record) {
  const sourceCode = String(record?.sky_condition ?? "").toUpperCase();
  const mapped = METEOREPORT_SKY[sourceCode];
  if (mapped) return makeWeather(mapped[0], sourceCode, mapped[1]);
  if ((validNumber(record?.fresh_snow) ?? 0) > 0) return makeWeather("snow", sourceCode || null);
  if ((validNumber(record?.rain_fall) ?? 0) > 0) return makeWeather("rain", sourceCode || null);
  return makeWeather("unknown", sourceCode || null);
}

function corsHeaders(cacheTtl = 0, extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheTtl > 0
      ? `public, max-age=${cacheTtl}`
      : "no-store",
    ...extra
  };
}

function jsonResponse(data, status = 200, cacheTtl = 0, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: corsHeaders(status >= 200 && status < 300 ? cacheTtl : 0, extraHeaders)
  });
}

function errorResponse(error) {
  const appError = error instanceof AppError
    ? error
    : new AppError(500, "INTERNAL_ERROR", "Errore interno del servizio.", true);

  return jsonResponse({
    ok: false,
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    error: {
      code: appError.code,
      message: appError.message,
      retryable: appError.retryable
    }
  }, appError.status);
}

function responseWithHeader(response, name, value) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function cachedResponse(cacheKey, ttl, context, producer) {
  const cache = globalThis.caches?.default;
  const request = new Request(`https://cache.pozzalive.internal/${cacheKey}`);

  if (cache) {
    const cached = await cache.match(request);
    if (cached) return responseWithHeader(cached, "X-PozzaLive-Cache", "HIT");
  }

  const response = await producer();

  if (cache && response.ok) {
    const operation = cache.put(request, response.clone());
    if (typeof context?.waitUntil === "function") context.waitUntil(operation);
    else await operation;
  }

  return responseWithHeader(response, "X-PozzaLive-Cache", "MISS");
}

async function fetchJson(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    label = "Fonte esterna",
    headers = {},
    cf
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers
      },
      signal: controller.signal,
      ...(cf ? { cf } : {})
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      if (response.ok) {
        throw new AppError(502, "UPSTREAM_ERROR", `${label}: risposta JSON non valida.`, true);
      }
    }

    if (!response.ok) {
      const reason = typeof body?.reason === "string"
        ? body.reason
        : typeof body?.error === "string"
          ? body.error
          : `HTTP ${response.status}`;
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `${label}: ${reason}`,
        response.status >= 500 || response.status === 429,
        response.status
      );
    }

    return body;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.name === "AbortError") {
      throw new AppError(504, "UPSTREAM_TIMEOUT", `${label}: tempo massimo superato.`, true);
    }
    throw new AppError(502, "UPSTREAM_ERROR", `${label}: servizio non disponibile.`, true);
  } finally {
    clearTimeout(timer);
  }
}

function encodeUtf8Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeUtf8Base64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function candidatePayload(candidate) {
  return {
    v: 1,
    o: candidate.origin,
    r: candidate.ref,
    n: candidate.name,
    c: candidate.context,
    k: candidate.kind,
    la: candidate.latitude,
    lo: candidate.longitude,
    e: candidate.elevation_m,
    tz: candidate.timezone,
    cc: candidate.country_code,
    a1: candidate.admin1,
    a2: candidate.admin2,
    g: candidate.geocoder,
    p: candidate.preferred_forecast_provider
  };
}

function encodeCandidateId(candidate) {
  return `loc1.${encodeUtf8Base64Url(JSON.stringify(candidatePayload(candidate)))}`;
}

function safeText(value, maxLength = 180) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function decodeCandidateId(id) {
  if (typeof id !== "string" || id.length < 8 || id.length > 2400 || !id.startsWith("loc1.")) {
    throw new AppError(400, "INVALID_LOCATION_ID", "Identificativo della località non valido.");
  }

  let payload;
  try {
    payload = JSON.parse(decodeUtf8Base64Url(id.slice(5)));
  } catch {
    throw new AppError(400, "INVALID_LOCATION_ID", "Identificativo della località non valido.");
  }

  const candidate = {
    origin: safeText(payload?.o, 20),
    ref: safeText(payload?.r, 100),
    name: safeText(payload?.n, 140),
    context: safeText(payload?.c, 240),
    kind: safeText(payload?.k, 30),
    latitude: validNumber(payload?.la),
    longitude: validNumber(payload?.lo),
    elevation_m: validNumber(payload?.e),
    timezone: safeText(payload?.tz, 50),
    country_code: safeText(payload?.cc, 2)?.toUpperCase() ?? null,
    admin1: safeText(payload?.a1, 100),
    admin2: safeText(payload?.a2, 100),
    geocoder: safeText(payload?.g, 30),
    preferred_forecast_provider: safeText(payload?.p, 30),
    opaque_id: id
  };

  const allowedOrigins = new Set(["mr", "local", "osm", "open_meteo"]);
  const allowedKinds = new Set(["town", "pass", "point_of_interest", "mountain", "other"]);

  if (
    payload?.v !== 1 ||
    !allowedOrigins.has(candidate.origin) ||
    !candidate.ref ||
    !candidate.name ||
    !candidate.context ||
    !allowedKinds.has(candidate.kind) ||
    candidate.latitude === null ||
    candidate.longitude === null ||
    !candidate.timezone ||
    !candidate.country_code ||
    !candidate.geocoder ||
    !["meteo.report", "open-meteo"].includes(candidate.preferred_forecast_provider)
  ) {
    throw new AppError(400, "INVALID_LOCATION_ID", "Identificativo della località non valido.");
  }

  if (!isCandidateInScope(candidate)) {
    throw new AppError(422, "OUTSIDE_MODEL_COVERAGE", "La località è fuori dall'area Dolomiti + Euregio.");
  }

  return candidate;
}

function pointInBox(latitude, longitude, box) {
  return latitude >= box.south && latitude <= box.north &&
    longitude >= box.west && longitude <= box.east;
}

function inFallbackScope(latitude, longitude, countryCode) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  const boxes = countryCode === "AT"
    ? [
        { south: 46.72, north: 47.72, west: 10.0, east: 12.75 },
        { south: 46.62, north: 47.15, west: 12.0, east: 13.05 }
      ]
    : [
        { south: 45.65, north: 46.6, west: 10.35, east: 11.98 },
        { south: 46.2, north: 47.12, west: 10.35, east: 12.55 },
        { south: 45.78, north: 46.72, west: 11.62, east: 12.82 }
      ];

  return boxes.some(box => pointInBox(latitude, longitude, box));
}

function isCandidateInScope(candidate) {
  const countryCode = String(candidate.country_code ?? "").toUpperCase();
  const admin1 = normalizeText(candidate.admin1);
  const admin2 = normalizeText(candidate.admin2);
  const admin = `${admin1} ${admin2}`.trim();

  if (countryCode === "AT" && /(^| )tirol( |$)/.test(admin)) return true;

  if (countryCode === "AT") {
    if (admin1 || admin2) return false;
    return inFallbackScope(candidate.latitude, candidate.longitude, countryCode);
  }

  if (countryCode === "IT") {
    if (/trentino|alto adige|sudtirol|suedtirol/.test(admin)) return true;
    if (/trento|bolzano|bozen/.test(admin2)) return true;
    if (/belluno/.test(admin)) return true;

    // Un risultato con una provincia esplicita diversa da quelle ammesse
    // non deve rientrare solo perché cade in uno dei rettangoli di sicurezza.
    if (admin2) return false;

    // Con il solo livello regionale Veneto, le coordinate servono a
    // distinguere la fascia dolomitica dal resto della regione.
    if (admin1) {
      if (!/veneto/.test(admin1)) return false;
      return inFallbackScope(candidate.latitude, candidate.longitude, countryCode);
    }

    return inFallbackScope(candidate.latitude, candidate.longitude, countryCode);
  }

  return false;
}

function parseElevation(value) {
  if (value === null || value === undefined || value === "") return null;
  let text = String(value).trim().replace(/\s*m(?:etri)?$/i, "");
  if (/^-?\d{1,2}[.,]\d{3}$/.test(text)) text = text.replace(/[.,]/, "");
  else text = text.replace(",", ".");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? validNumber(match[0]) : null;
}

function haversineKm(first, second) {
  const radius = 6371;
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLatitude = radians(second.latitude - first.latitude);
  const deltaLongitude = radians(second.longitude - first.longitude);
  const latitude1 = radians(first.latitude);
  const latitude2 = radians(second.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function matchScore(query, values) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return -1;
  const queryWords = normalizedQuery.split(" ");
  let best = -1;

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    let score = -1;
    if (normalized === normalizedQuery) score = 100;
    else if (normalized.startsWith(`${normalizedQuery} `)) score = 88;
    else if (normalized.includes(normalizedQuery)) score = 76;
    else if (queryWords.every(word => normalized.includes(word))) score = 65;
    else if (normalizedQuery.includes(normalized)) score = 50;
    best = Math.max(best, score);
  }

  return best;
}

function sourcePriority(candidate) {
  if (candidate.origin === "open_meteo" && candidate.kind === "town") return 25;
  return {
    mr: 40,
    local: 30,
    osm: 20,
    open_meteo: 10
  }[candidate.origin] ?? 0;
}

function deduplicateCandidates(candidates) {
  const sorted = [...candidates].sort((first, second) =>
    (second._score + sourcePriority(second)) - (first._score + sourcePriority(first)) ||
    first.name.localeCompare(second.name, "it")
  );
  const result = [];

  for (const candidate of sorted) {
    const duplicateIndex = result.findIndex(existing => {
      const distance = haversineKm(existing, candidate);
      const sameName = normalizeText(existing.name) === normalizeText(candidate.name);
      const existingAdmin = normalizeText(existing.admin2);
      const candidateAdmin = normalizeText(candidate.admin2);
      const sameAdministrativeArea = existingAdmin && candidateAdmin &&
        (existingAdmin === candidateAdmin || existingAdmin.includes(candidateAdmin) || candidateAdmin.includes(existingAdmin));
      return distance < 0.15 ||
        (distance < 1.5 && sameName) ||
        (distance < 5 && sameName && sameAdministrativeArea &&
          existing.kind === "town" && candidate.kind === "town");
    });

    if (duplicateIndex === -1) {
      result.push(candidate);
      continue;
    }

    const existing = result[duplicateIndex];
    if (existing.elevation_m === null && candidate.elevation_m !== null) {
      result[duplicateIndex] = { ...existing, elevation_m: candidate.elevation_m };
    }
  }

  return result;
}

function kindFromName(name, fallback = "town") {
  const normalized = normalizeText(name);
  if (/\b(passo|joch|pass|sella|forcella|scharte)\b/.test(normalized)) return "pass";
  return fallback;
}

function kindFromOsm(item) {
  const category = normalizeText(item?.category ?? item?.class);
  const type = normalizeText(item?.type);
  const addressType = normalizeText(item?.addresstype);
  const address = item?.address || {};
  if (category === "mountain pass" || type === "mountain pass" || type === "saddle") return "pass";
  if (category === "natural" && ["peak", "volcano", "ridge"].includes(type)) return "mountain";
  if (category === "tourism" || ["alpine hut", "wilderness hut", "chalet"].includes(type)) {
    return "point_of_interest";
  }
  if (category === "place" && ["city", "town", "village", "hamlet", "municipality", "locality"].includes(type)) {
    return "town";
  }
  if (["city", "town", "village", "hamlet", "municipality"].includes(addressType)) return "town";
  if (category === "boundary" && type === "administrative" &&
    (address.city || address.town || address.village || address.municipality)) return "town";
  return kindFromName(item?.name, "other");
}

function kindFromGeoNames(item) {
  const code = String(item?.feature_code ?? "").toUpperCase();
  if (/PASS|SADL/.test(code)) return "pass";
  if (/^MT|PK|RDGE/.test(code)) return "mountain";
  if (/^PPL|ADM/.test(code)) return "town";
  return kindFromName(item?.name, "other");
}

function extractForecastId(url) {
  const match = String(url ?? "").match(
    /^https:\/\/meteo\.report\/var\/data\/forecasts\/([0-9a-f-]{36})\.json$/i
  );
  return match ? match[1].toLowerCase() : null;
}

async function loadMeteoReportCatalogs(env) {
  const timeoutMs = validNumber(env?.UPSTREAM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const settled = await Promise.allSettled(METEOREPORT_CATALOGS.map(async source => {
    const data = await fetchJson(source.url, {
      timeoutMs,
      label: `Catalogo Meteo.report ${source.key}`,
      headers: {
        "User-Agent": "PozzaLive/1.0 (+https://andreavio00.github.io/meteo-fassa/)"
      },
      cf: {
        cacheTtl: CATALOG_CACHE_TTL,
        cacheEverything: true
      }
    });

    if (!Array.isArray(data)) {
      throw new AppError(502, "UPSTREAM_ERROR", `Catalogo Meteo.report ${source.key}: formato inatteso.`, true);
    }

    return data
      .filter(item => ["2", "8"].includes(String(item?.id_venue_type)))
      .map(item => ({ ...item, _catalog: source }));
  }));

  const venues = [];
  const warnings = [];
  let availableCatalogs = 0;

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      venues.push(...result.value);
      availableCatalogs += 1;
    } else {
      warnings.push({
        source: `meteo.report:${METEOREPORT_CATALOGS[index].key}`,
        code: result.reason?.code || "UPSTREAM_ERROR"
      });
    }
  });

  return { venues, warnings, availableCatalogs };
}

function meteoReportName(venue) {
  return safeText(venue?.name_ita, 140) ||
    safeText(venue?.name_lld, 140) ||
    safeText(venue?.name_deu, 140) ||
    safeText(venue?.name_eng, 140) ||
    "Località Meteo.report";
}

function meteoReportCandidate(venue, byId, query) {
  const forecastId = extractForecastId(venue?.url);
  const target = forecastId ? byId.get(forecastId) : null;
  if (!forecastId || !target) return null;

  const names = [venue.name_ita, venue.name_lld, venue.name_deu, venue.name_eng].filter(Boolean);
  const score = matchScore(query, names);
  if (score < 0) return null;

  const name = meteoReportName(venue);
  const targetName = meteoReportName(target);
  const catalog = venue._catalog;
  const kind = String(venue.id_venue_type) === "8"
    ? "point_of_interest"
    : kindFromName(name, "town");

  return {
    origin: "mr",
    ref: String(venue.id).toLowerCase(),
    name,
    context: `${catalog.admin2} · Italia`,
    kind,
    latitude: validNumber(venue.lat),
    longitude: validNumber(venue.lon),
    elevation_m: validNumber(venue.elevation),
    timezone: "Europe/Rome",
    country_code: "IT",
    admin1: catalog.admin1,
    admin2: catalog.admin2,
    geocoder: "meteo.report",
    preferred_forecast_provider: "meteo.report",
    forecast_location: {
      id: `mr:${forecastId}`,
      name: targetName,
      latitude: validNumber(target.lat),
      longitude: validNumber(target.lon),
      elevation_m: validNumber(target.elevation),
      distance_km: round(haversineKm(
        { latitude: validNumber(venue.lat), longitude: validNumber(venue.lon) },
        { latitude: validNumber(target.lat), longitude: validNumber(target.lon) }
      ), 1)
    },
    _score: score
  };
}

function searchMeteoReportCatalog(catalogResult, query) {
  const byId = new Map(catalogResult.venues.map(venue => [String(venue.id).toLowerCase(), venue]));
  return catalogResult.venues
    .map(venue => meteoReportCandidate(venue, byId, query))
    .filter(candidate => candidate && candidate.latitude !== null && candidate.longitude !== null);
}

function searchKnownPlaces(query) {
  return KNOWN_PLACES
    .map(place => ({
      ...place,
      _score: matchScore(query, [place.name, ...(place.aliases || [])])
    }))
    .filter(place => place._score >= 0);
}

function osmName(item) {
  const address = item?.address || {};
  return safeText(item?.name, 140) ||
    safeText(address.tourism, 140) ||
    safeText(address.mountain_pass, 140) ||
    safeText(address.peak, 140) ||
    safeText(address.hamlet, 140) ||
    safeText(address.village, 140) ||
    safeText(address.town, 140) ||
    safeText(address.city, 140) ||
    "Località";
}

function uniqueContext(parts, name) {
  const normalizedName = normalizeText(name);
  const seen = new Set([normalizedName]);
  const result = [];

  for (const part of parts) {
    const text = safeText(part, 120);
    const normalized = normalizeText(text);
    if (!text || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(text);
  }

  return result.slice(0, 4).join(" · ") || "Dolomiti / Euregio";
}

function osmContext(item, name) {
  const address = item?.address || {};
  return uniqueContext([
    address.hamlet,
    address.village,
    address.town,
    address.city,
    address.municipality,
    address.county,
    address.state,
    address.country
  ], name);
}

function osmReference(item) {
  const prefix = { node: "N", way: "W", relation: "R" }[String(item?.osm_type).toLowerCase()];
  const id = safeText(item?.osm_id, 30);
  return prefix && id ? `${prefix}${id}` : `place:${safeText(item?.place_id, 30) || "unknown"}`;
}

function normalizeOsmCandidate(item, query) {
  const latitude = validNumber(item?.lat);
  const longitude = validNumber(item?.lon);
  const address = item?.address || {};
  const countryCode = safeText(address.country_code, 2)?.toUpperCase() ?? null;
  const name = osmName(item);
  const candidate = {
    origin: "osm",
    ref: osmReference(item),
    name,
    context: osmContext(item, name),
    kind: kindFromOsm(item),
    latitude,
    longitude,
    elevation_m: parseElevation(item?.extratags?.ele),
    timezone: countryCode === "AT" ? "Europe/Vienna" : "Europe/Rome",
    country_code: countryCode,
    admin1: safeText(address.state, 100),
    admin2: safeText(address.county, 100),
    geocoder: "openstreetmap",
    preferred_forecast_provider: "open-meteo",
    forecast_location: null,
    _score: Math.max(matchScore(query, [name, item?.display_name]), 20)
  };

  if (latitude === null || longitude === null || !isCandidateInScope(candidate)) return null;
  return candidate;
}

let lastNominatimRequestAt = 0;
let nominatimQueue = Promise.resolve();

async function scheduleNominatimRequest(env, operation) {
  const minimumInterval = Math.max(0, validNumber(env?.NOMINATIM_MIN_INTERVAL_MS) ?? 1100);
  const run = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, minimumInterval - (Date.now() - lastNominatimRequestAt));
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastNominatimRequestAt = Date.now();
    return operation();
  });
  nominatimQueue = run.catch(() => undefined);
  return run;
}

async function searchNominatim(query, limit, env) {
  const baseUrl = safeText(env?.NOMINATIM_BASE_URL, 300) || "https://nominatim.openstreetmap.org/search";
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("countrycodes", "it,at");
  url.searchParams.set("viewbox", "10.0,47.8,13.3,45.65");
  url.searchParams.set("limit", String(Math.min(40, Math.max(10, limit * 2))));
  url.searchParams.set("dedupe", "1");
  url.searchParams.set("accept-language", "it");

  const appOrigin = safeText(env?.APP_ORIGIN, 300) || "https://andreavio00.github.io/meteo-fassa/";
  const timeoutMs = validNumber(env?.UPSTREAM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;

  const data = await scheduleNominatimRequest(env, () => fetchJson(url.toString(), {
    timeoutMs,
    label: "Geocodifica OpenStreetMap",
    headers: {
      "User-Agent": `PozzaLive/1.0 (+${appOrigin})`,
      Referer: appOrigin,
      "Accept-Language": "it,en;q=0.8,de;q=0.6"
    },
    cf: {
      cacheTtl: SEARCH_CACHE_TTL,
      cacheEverything: true
    }
  }));

  if (!Array.isArray(data)) {
    throw new AppError(502, "UPSTREAM_ERROR", "Geocodifica OpenStreetMap: formato inatteso.", true);
  }

  return data.map(item => normalizeOsmCandidate(item, query)).filter(Boolean);
}

function normalizeOpenMeteoGeocodingCandidate(item, query) {
  const countryCode = safeText(item?.country_code, 2)?.toUpperCase() ?? null;
  const name = safeText(item?.name, 140) || "Località";
  const candidate = {
    origin: "open_meteo",
    ref: String(item?.id ?? `${item?.latitude},${item?.longitude}`),
    name,
    context: uniqueContext([item?.admin4, item?.admin3, item?.admin2, item?.admin1, item?.country], name),
    kind: kindFromGeoNames(item),
    latitude: validNumber(item?.latitude),
    longitude: validNumber(item?.longitude),
    elevation_m: validNumber(item?.elevation),
    timezone: safeText(item?.timezone, 50) || (countryCode === "AT" ? "Europe/Vienna" : "Europe/Rome"),
    country_code: countryCode,
    admin1: safeText(item?.admin1, 100),
    admin2: safeText(item?.admin2, 100),
    geocoder: "open-meteo",
    preferred_forecast_provider: "open-meteo",
    forecast_location: null,
    _score: Math.max(matchScore(query, [name]), 10)
  };

  if (candidate.latitude === null || candidate.longitude === null || !isCandidateInScope(candidate)) return null;
  return candidate;
}

async function searchOpenMeteoGeocoding(query, limit, env) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(Math.min(40, Math.max(10, limit * 2))));
  url.searchParams.set("language", "it");
  url.searchParams.set("format", "json");

  const data = await fetchJson(url.toString(), {
    timeoutMs: validNumber(env?.UPSTREAM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
    label: "Geocodifica Open-Meteo",
    cf: {
      cacheTtl: SEARCH_CACHE_TTL,
      cacheEverything: true
    }
  });

  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map(item => normalizeOpenMeteoGeocodingCandidate(item, query))
    .filter(Boolean);
}

async function enrichMissingElevations(candidates, env) {
  const missing = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.elevation_m === null);

  if (!missing.length) return candidates;

  const url = new URL("https://api.open-meteo.com/v1/elevation");
  url.searchParams.set("latitude", missing.map(({ candidate }) => candidate.latitude).join(","));
  url.searchParams.set("longitude", missing.map(({ candidate }) => candidate.longitude).join(","));

  try {
    const data = await fetchJson(url.toString(), {
      timeoutMs: validNumber(env?.UPSTREAM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
      label: "Quota Open-Meteo",
      cf: {
        cacheTtl: CATALOG_CACHE_TTL,
        cacheEverything: true
      }
    });
    const elevations = Array.isArray(data?.elevation) ? data.elevation : [];
    const enriched = [...candidates];
    missing.forEach(({ candidate, index }, elevationIndex) => {
      enriched[index] = {
        ...candidate,
        elevation_m: validNumber(elevations[elevationIndex])
      };
    });
    return enriched;
  } catch {
    return candidates;
  }
}

function publicSearchResult(candidate) {
  return {
    id: encodeCandidateId(candidate),
    name: candidate.name,
    context: candidate.context,
    kind: candidate.kind,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    elevation_m: candidate.elevation_m,
    timezone: candidate.timezone,
    country_code: candidate.country_code,
    admin1: candidate.admin1,
    admin2: candidate.admin2,
    geocoder: candidate.geocoder,
    preferred_forecast_provider: candidate.preferred_forecast_provider,
    forecast_location: candidate.forecast_location
  };
}

function searchAttributions(candidates) {
  const attributions = [];
  if (candidates.some(candidate => candidate.origin === "mr")) attributions.push(ATTRIBUTIONS.meteoreport);
  if (candidates.some(candidate => candidate.origin === "osm")) attributions.push(ATTRIBUTIONS.openstreetmap);
  if (candidates.some(candidate => candidate.origin === "open_meteo")) {
    attributions.push(ATTRIBUTIONS.openMeteoGeocoding);
  }
  return attributions;
}

async function handleSearch(url, env) {
  const query = String(url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);

  if (query.length < 2 || query.length > 100) {
    throw new AppError(400, "INVALID_QUERY", "Inserisci una località da 2 a 100 caratteri.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppError(400, "INVALID_QUERY", `Il limite deve essere compreso tra 1 e ${MAX_LIMIT}.`);
  }

  const [catalogResult, osmResult, openMeteoResult] = await Promise.all([
    loadMeteoReportCatalogs(env),
    searchNominatim(query, limit, env)
      .then(results => ({ results, warning: null }))
      .catch(error => ({
        results: [],
        warning: { source: "openstreetmap", code: error?.code || "UPSTREAM_ERROR" }
      })),
    searchOpenMeteoGeocoding(query, limit, env)
      .then(results => ({ results, warning: null }))
      .catch(error => ({
        results: [],
        warning: { source: "open-meteo-geocoding", code: error?.code || "UPSTREAM_ERROR" }
      }))
  ]);

  const warnings = [...catalogResult.warnings];
  if (osmResult.warning) warnings.push(osmResult.warning);
  if (openMeteoResult.warning) warnings.push(openMeteoResult.warning);

  const candidates = deduplicateCandidates([
    ...searchMeteoReportCatalog(catalogResult, query),
    ...searchKnownPlaces(query),
    ...osmResult.results,
    ...openMeteoResult.results
  ]).slice(0, limit);

  const enriched = await enrichMissingElevations(candidates, env);

  if (!enriched.length) {
    throw new AppError(404, "LOCATION_NOT_FOUND", "Nessuna località trovata nell'area Dolomiti + Euregio.");
  }

  return {
    ok: true,
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    query: {
      text: query,
      normalized: normalizeText(query),
      limit,
      scope: SCOPE
    },
    results: enriched.map(publicSearchResult),
    attributions: searchAttributions(enriched),
    ...(warnings.length ? { warnings } : {})
  };
}

function firstThreeForecastDays(periods) {
  const dates = [...new Set(periods.map(period => period.date))]
    .sort()
    .slice(0, FORECAST_DAYS);
  const allowedDates = new Set(dates);
  return periods.filter(period => allowedDates.has(period.date));
}

function futureForecastPeriods(periods, timeZone) {
  const nowLocal = localDateTimeParts(timeZone).isoMinute;
  const futureOrCurrent = periods.filter(period => {
    const end = safeText(period?.end, 40)?.slice(0, 16);
    return Boolean(end) && end > nowLocal;
  });
  return firstThreeForecastDays(futureOrCurrent);
}

function forecastCacheTtl(id) {
  try {
    const candidate = decodeCandidateId(id);
    const { secondsOfDay } = localDateTimeParts(candidate.timezone);
    const nextBoundary = [11, 14, 17, 20]
      .map(hour => hour * 3600)
      .find(boundary => boundary > secondsOfDay);
    if (nextBoundary === undefined) return FORECAST_CACHE_TTL;
    return Math.max(1, Math.min(FORECAST_CACHE_TTL, nextBoundary - secondsOfDay));
  } catch {
    return FORECAST_CACHE_TTL;
  }
}

function normalizeOpenMeteoPeriods(data) {
  const hourly = data?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) {
    throw new AppError(502, "UPSTREAM_ERROR", "Open-Meteo: dati orari mancanti.", true);
  }

  const periods = [];

  for (let index = 0; index < hourly.time.length; index += 1) {
    const start = safeText(hourly.time[index], 30);
    if (!start || !TARGET_PERIOD_STARTS.has(start.slice(11, 16))) continue;

    const expectedSecond = addMinutesLocal(start, 60);
    const expectedThird = addMinutesLocal(start, 120);
    if (hourly.time[index + 1] !== expectedSecond || hourly.time[index + 2] !== expectedThird) continue;

    const sourceHours = [0, 1, 2].map(offset => ({
      temperature_2m: validNumber(hourly.temperature_2m?.[index + offset]),
      precipitation_probability: validNumber(hourly.precipitation_probability?.[index + offset]),
      precipitation: validNumber(hourly.precipitation?.[index + offset]),
      snowfall: validNumber(hourly.snowfall?.[index + offset]),
      weather_code: validNumber(hourly.weather_code?.[index + offset]),
      wind_speed_10m: validNumber(hourly.wind_speed_10m?.[index + offset]),
      wind_gusts_10m: validNumber(hourly.wind_gusts_10m?.[index + offset]),
      wind_direction_10m: validNumber(hourly.wind_direction_10m?.[index + offset]),
      freezing_level_height: validNumber(hourly.freezing_level_height?.[index + offset]),
      sunshine_duration: validNumber(hourly.sunshine_duration?.[index + offset])
    }));

    const everyHourHasCoreData = sourceHours.every(hour =>
      hour.temperature_2m !== null ||
      hour.precipitation !== null ||
      hour.weather_code !== null ||
      hour.wind_speed_10m !== null
    );
    if (!everyHourHasCoreData) continue;

    const temperatures = sourceHours.map(hour => hour.temperature_2m);
    const rain = sourceHours.map(hour => hour.precipitation);
    const rainProbability = sourceHours.map(hour => hour.precipitation_probability);
    const snowfall = sourceHours.map(hour => hour.snowfall);
    const weatherCodes = sourceHours.map(hour => hour.weather_code);
    const windSpeed = sourceHours.map(hour => hour.wind_speed_10m);
    const gusts = sourceHours.map(hour => hour.wind_gusts_10m);
    const windDirection = sourceHours.map(hour => hour.wind_direction_10m);
    const freezingLevel = sourceHours.map(hour => hour.freezing_level_height);
    const sunshineSeconds = sourceHours.map(hour => hour.sunshine_duration);
    const representativeCode = representativeWmo(weatherCodes);
    const end = addMinutesLocal(start, 180);
    const sunshineTotal = sumComplete(sunshineSeconds);

    periods.push({
      start,
      end,
      date: start.slice(0, 10),
      period: `${start.slice(11, 16)}-${end.slice(11, 16)}`,
      summary: {
        weather: weatherFromWmo(representativeCode),
        temperature_c: round(average(temperatures), 1),
        precipitation_mm: round(sumComplete(rain), 1),
        precipitation_probability_pct: maximum(rainProbability)
      },
      details: {
        temperature_min_c: round(minimum(temperatures), 1),
        temperature_max_c: round(maximum(temperatures), 1),
        wind_speed_avg_kmh: round(average(windSpeed), 1),
        wind_speed_max_kmh: round(maximum(windSpeed), 1),
        wind_gust_max_kmh: round(maximum(gusts), 1),
        wind_direction_deg: weightedWindDirection(windDirection, windSpeed),
        fresh_snow: round(sumComplete(snowfall), 1),
        snow_level_m: null,
        freezing_level_m: round(average(freezingLevel), 0),
        sunshine_duration: Number.isFinite(sunshineTotal)
          ? round(sunshineTotal / 3600, 1)
          : null
      },
      source: {
        provider: "open-meteo",
        model: MODEL,
        weather_code: representativeCode
      }
    });
  }

  return periods;
}

function normalizeMeteoReportPeriods(data) {
  const forecast = data?.["180"];
  const start = safeText(data?.start, 40);
  if (!forecast || typeof forecast !== "object" || !start) {
    throw new AppError(502, "UPSTREAM_ERROR", "Meteo.report: previsione a tre ore mancante.", true);
  }

  const periods = Object.entries(forecast).map(([key, record]) => {
    const offsetMinutes = Number(String(key).slice(3));
    if (!Number.isFinite(offsetMinutes) || !record || typeof record !== "object") return null;
    const periodStart = addMinutesLocal(start, offsetMinutes);
    const periodEnd = addMinutesLocal(periodStart, 180);
    if (!periodStart || !periodEnd || !TARGET_PERIOD_STARTS.has(periodStart.slice(11, 16))) return null;

    const hasCoreData = [
      record.temperature,
      record.rain_fall,
      record.sky_condition,
      record.wind_speed
    ].some(value => value !== null && value !== undefined && value !== "");
    if (!hasCoreData) return null;

    return {
      start: periodStart,
      end: periodEnd,
      date: periodStart.slice(0, 10),
      period: `${periodStart.slice(11, 16)}-${periodEnd.slice(11, 16)}`,
      summary: {
        weather: weatherFromMeteoReport(record),
        temperature_c: validNumber(record.temperature),
        precipitation_mm: validNumber(record.rain_fall),
        precipitation_probability_pct: validNumber(record.rain_probability)
      },
      details: {
        temperature_min_c: null,
        temperature_max_c: null,
        wind_speed_kmh: validNumber(record.wind_speed),
        wind_gust_kmh: validNumber(record.wind_gust),
        wind_direction_deg: validNumber(record.wind_direction),
        fresh_snow: validNumber(record.fresh_snow),
        snow_level_m: validNumber(record.snow_level),
        freezing_level_m: validNumber(record.freezing_level),
        sunshine_duration: validNumber(record.sunshine_duration),
        sky_condition: record.sky_condition ?? null
      },
      source: {
        provider: "meteo.report",
        source_key: key,
        sky_condition: record.sky_condition ?? null
      }
    };
  }).filter(Boolean).sort((first, second) => first.start.localeCompare(second.start));

  return periods;
}

function groupPeriodsByDay(periods) {
  const map = new Map();
  for (const period of periods) {
    if (!map.has(period.date)) map.set(period.date, []);
    map.get(period.date).push(period);
  }
  return [...map.entries()]
    .map(([date, periods_3h]) => ({ date, periods_3h }))
    .sort((first, second) => first.date.localeCompare(second.date));
}

function buildCoverage(periods) {
  const days = groupPeriodsByDay(periods);
  const lastDay = days.at(-1);
  return {
    from: periods[0]?.start ?? null,
    to: periods.at(-1)?.end ?? null,
    complete_periods: periods.length,
    partial_last_day: Boolean(lastDay && lastDay.periods_3h.length < TARGET_PERIOD_STARTS.size)
  };
}

function forecastAttributions(candidate, provider) {
  const attributions = [];
  if (candidate.origin === "osm") attributions.push(ATTRIBUTIONS.openstreetmap);
  if (candidate.origin === "open_meteo") attributions.push(ATTRIBUTIONS.openMeteoGeocoding);
  if (provider === "meteo.report") attributions.push(ATTRIBUTIONS.meteoreport);
  if (provider === "open-meteo") attributions.push(ATTRIBUTIONS.openMeteoForecast);
  return attributions;
}

async function resolveMeteoReportVenue(candidate, env) {
  const catalogResult = await loadMeteoReportCatalogs(env);
  const byId = new Map(catalogResult.venues.map(venue => [String(venue.id).toLowerCase(), venue]));
  const selected = byId.get(candidate.ref.toLowerCase());

  if (!selected) {
    const catalogsUnavailable = catalogResult.availableCatalogs === 0;
    throw new AppError(
      catalogsUnavailable ? 502 : 400,
      catalogsUnavailable ? "UPSTREAM_ERROR" : "INVALID_LOCATION_ID",
      catalogsUnavailable
        ? "Catalogo Meteo.report non disponibile."
        : "La località Meteo.report non è più disponibile nel catalogo Open Data.",
      catalogsUnavailable
    );
  }

  const forecastId = extractForecastId(selected.url);
  const target = forecastId ? byId.get(forecastId) : null;
  if (!forecastId || !target) {
    throw new AppError(502, "UPSTREAM_ERROR", "Collegamento Meteo.report non valido.", true);
  }

  return {
    selected,
    forecastId,
    target,
    url: `https://meteo.report/var/data/forecasts/${forecastId}.json`
  };
}

async function fetchMeteoReportForecast(candidate, env) {
  const resolved = await resolveMeteoReportVenue(candidate, env);
  const data = await fetchJson(resolved.url, {
    timeoutMs: validNumber(env?.UPSTREAM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
    label: "Previsione Meteo.report",
    headers: {
      "User-Agent": "PozzaLive/1.0 (+https://andreavio00.github.io/meteo-fassa/)"
    },
    cf: {
      cacheTtl: FORECAST_CACHE_TTL,
      cacheEverything: true
    }
  });

  const periods = normalizeMeteoReportPeriods(data);
  if (!periods.length) {
    throw new AppError(503, "FORECAST_UNAVAILABLE", "Meteo.report non ha prodotto fasce valide.", true);
  }

  const target = resolved.target;
  const selected = resolved.selected;

  return {
    provider: "meteo.report",
    model: null,
    timezone: "Europe/Rome",
    periods,
    model_point: null,
    forecast_location: {
      id: `mr:${resolved.forecastId}`,
      name: meteoReportName(target),
      latitude: validNumber(target.lat),
      longitude: validNumber(target.lon),
      elevation_m: validNumber(target.elevation),
      distance_km: round(haversineKm(
        { latitude: validNumber(selected.lat), longitude: validNumber(selected.lon) },
        { latitude: validNumber(target.lat), longitude: validNumber(target.lon) }
      ), 1)
    },
    source_start: data.start ?? null,
    source_end: data.end ?? null
  };
}

function buildOpenMeteoForecastUrl(candidate) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  const hourlyVariables = [
    "temperature_2m",
    "precipitation_probability",
    "precipitation",
    "snowfall",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "freezing_level_height",
    "sunshine_duration"
  ];

  url.searchParams.set("latitude", String(candidate.latitude));
  url.searchParams.set("longitude", String(candidate.longitude));
  if (candidate.elevation_m !== null) {
    url.searchParams.set("elevation", String(candidate.elevation_m));
  }
  url.searchParams.set("hourly", hourlyVariables.join(","));
  url.searchParams.set("models", MODEL);
  url.searchParams.set("timezone", candidate.timezone || "Europe/Rome");
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("cell_selection", "land");
  return url.toString();
}

async function fetchOpenMeteoForecast(candidate, env) {
  let data;
  try {
    data = await fetchJson(buildOpenMeteoForecastUrl(candidate), {
      timeoutMs: validNumber(env?.UPSTREAM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
      label: "Previsione Open-Meteo ICON-D2",
      cf: {
        cacheTtl: FORECAST_CACHE_TTL,
        cacheEverything: true
      }
    });
  } catch (error) {
    if (error instanceof AppError && error.upstreamStatus === 400) {
      throw new AppError(
        422,
        "OUTSIDE_MODEL_COVERAGE",
        "La località non è coperta dal modello ICON-D2.",
        false,
        400
      );
    }
    throw error;
  }

  const periods = normalizeOpenMeteoPeriods(data);
  if (!periods.length) {
    throw new AppError(
      503,
      "FORECAST_UNAVAILABLE",
      "ICON-D2 non ha prodotto fasce complete per la località scelta.",
      true
    );
  }

  return {
    provider: "open-meteo",
    model: MODEL,
    timezone: data.timezone || candidate.timezone || "Europe/Rome",
    periods,
    model_point: {
      latitude: validNumber(data.latitude),
      longitude: validNumber(data.longitude),
      elevation_m: validNumber(data.elevation)
    },
    forecast_location: null,
    source_start: data.hourly?.time?.[0] ?? null,
    source_end: data.hourly?.time?.at(-1) ?? null
  };
}

function fallbackReason(error) {
  if (error?.code === "UPSTREAM_TIMEOUT") return "METEOREPORT_TIMEOUT";
  if (error?.code === "INVALID_LOCATION_ID") return "METEOREPORT_LOCATION_UNAVAILABLE";
  return "METEOREPORT_UNAVAILABLE";
}

function buildForecastPayload(candidate, result, fallback, reason) {
  const periods = futureForecastPeriods(result.periods, result.timezone);
  if (!periods.length) {
    throw new AppError(
      503,
      "FORECAST_UNAVAILABLE",
      "La fonte non ha prodotto fasce attuali o future per la località scelta.",
      true
    );
  }
  const elevation = candidate.elevation_m ?? result.model_point?.elevation_m ?? null;
  const location = {
    id: candidate.opaque_id,
    name: candidate.name,
    context: candidate.context,
    kind: candidate.kind,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    elevation_m: elevation,
    timezone: result.timezone,
    country_code: candidate.country_code,
    admin1: candidate.admin1,
    admin2: candidate.admin2,
    provider: result.provider,
    model: result.model,
    zones: [],
    primary_zone: null,
    coordinates: {
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      elevation_m: elevation
    },
    model_point: result.model_point,
    forecast_location: result.forecast_location,
    periods_3h: periods
  };

  return {
    ok: true,
    schema_version: FORECAST_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    location,
    source: {
      preferred_provider: candidate.preferred_forecast_provider,
      provider: result.provider,
      model: result.model,
      fallback,
      fallback_reason: reason,
      source_start: result.source_start,
      source_end: result.source_end
    },
    coverage: buildCoverage(periods),
    attributions: forecastAttributions(candidate, result.provider)
  };
}

async function handleForecast(url, env) {
  const id = url.searchParams.get("id");
  const candidate = decodeCandidateId(id);

  if (candidate.preferred_forecast_provider === "meteo.report") {
    let meteoReportError;
    try {
      const result = await fetchMeteoReportForecast(candidate, env);
      return buildForecastPayload(candidate, result, false, null);
    } catch (error) {
      meteoReportError = error;
    }

    try {
      const result = await fetchOpenMeteoForecast(candidate, env);
      return buildForecastPayload(candidate, result, true, fallbackReason(meteoReportError));
    } catch {
      throw new AppError(
        503,
        "FORECAST_UNAVAILABLE",
        "Nessuna fonte ha prodotto una previsione valida per la località scelta.",
        true
      );
    }
  }

  return buildForecastPayload(
    candidate,
    await fetchOpenMeteoForecast(candidate, env),
    false,
    null
  );
}

function serviceDescription() {
  return {
    ok: true,
    schema_version: SCHEMA_VERSION,
    service: SERVICE_NAME,
    generated_at: new Date().toISOString(),
    scope: SCOPE,
    behavior: "on_demand_only",
    forecast_model: MODEL,
    endpoints: {
      search: "/search?q={località}&limit={1..10}",
      forecast: "/forecast?id={id_opaco}",
      health: "/health"
    }
  };
}

function normalizedPath(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

export default {
  async fetch(request, env = {}, context = {}) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "GET") {
      return errorResponse(new AppError(405, "METHOD_NOT_ALLOWED", "Metodo non consentito."));
    }

    const url = new URL(request.url);
    const path = normalizedPath(url.pathname);

    try {
      if (path === "/" || path === "/health") {
        return jsonResponse(serviceDescription(), 200, HEALTH_CACHE_TTL);
      }

      if (path === "/search") {
        const query = String(url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
        const limit = url.searchParams.get("limit") ?? String(DEFAULT_LIMIT);
        const cacheKey = `search/${encodeURIComponent(normalizeText(query))}?limit=${encodeURIComponent(limit)}`;
        return await cachedResponse(cacheKey, SEARCH_CACHE_TTL, context, async () => {
          const payload = await handleSearch(url, env);
          return jsonResponse(payload, 200, SEARCH_CACHE_TTL);
        });
      }

      if (path === "/forecast") {
        const id = url.searchParams.get("id") ?? "";
        const cacheKey = `forecast/${encodeURIComponent(id)}`;
        const cacheTtl = forecastCacheTtl(id);
        return await cachedResponse(cacheKey, cacheTtl, context, async () => {
          const payload = await handleForecast(url, env);
          return jsonResponse(payload, 200, cacheTtl);
        });
      }

      throw new AppError(404, "ENDPOINT_NOT_FOUND", "Endpoint non trovato.");
    } catch (error) {
      return errorResponse(error);
    }
  }
};
