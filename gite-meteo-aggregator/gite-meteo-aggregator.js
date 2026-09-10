// ======================================================
// GITE METEO AGGREGATOR
// Versione 1.0
//
// Service Bindings richiesti:
// FASSA    -> gitemeteofassa
// TRENTINO -> gite-meteotrentino
// PREDAZZO -> gite-meteopredazzo-rodella
//
// /          tutte le stazioni
// ?stations  elenco sintetico
// ======================================================


// ======================================================
// HEADERS
// ======================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=120",
        ...corsHeaders()
      }
    }
  );
}


// ======================================================
// NUMERI
// ======================================================

function num(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  )
    return null;

  if (typeof value === "number")
    return value;

  const cleaned =
    String(value)
      .replace(" m", "")
      .replace(",", ".")
      .trim();

  const n = Number(cleaned);

  return Number.isFinite(n)
    ? n
    : null;
}


// ======================================================
// DIREZIONE VENTO
// ======================================================

function directionFromDegrees(value) {

  const deg = num(value);

  if (deg === null)
    return null;

  const dirs = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW"
  ];

  const normalized =
    ((deg % 360) + 360) % 360;

  return dirs[
    Math.round(normalized / 22.5) % 16
  ];
}


// ======================================================
// NORMALIZZAZIONE
// ======================================================

function normalize(station, family) {

  const s = station || {};


  // --------------------------
  // VENTO
  // --------------------------

  let wind =
    num(s.wind);

  let windGust =
    num(
      s.windGust ??
      s.gust
    );

  let windMax =
    num(s.windMax);


  /*
    MeteoTrentino restituisce vento in m/s.

    Fassa e Predazzo/Rodella
    vengono mantenuti in km/h.
  */

  if (family === "trentino") {

    if (wind !== null)
      wind =
        +(wind * 3.6)
          .toFixed(1);

    if (windGust !== null)
      windGust =
        +(windGust * 3.6)
          .toFixed(1);

    if (windMax !== null)
      windMax =
        +(windMax * 3.6)
          .toFixed(1);
  }


  const windDegrees =
    num(
      s.windDirectionDegrees
    );


  // --------------------------
  // TEMPERATURA
  // --------------------------

  const temperatureMin =
    num(
      s.temperatureMin ??
      s.temperatureLow
    );

  const temperatureMax =
    num(
      s.temperatureMax ??
      s.temperatureHigh
    );


  // --------------------------
  // RISPOSTA COMUNE
  // --------------------------

  return {

    // Identificazione

    id:
      s.id || null,

    key:
      `${family}:${s.id}`,

    name:
      s.name || s.id || null,

    altitude:
      num(s.altitude),

    latitude:
      num(s.latitude),

    longitude:
      num(s.longitude),

    family,

    source:
      s.source || family,

    status:
      s.status || "unknown",


    // --------------------------
    // AGGIORNAMENTO
    // --------------------------

    updated:
      s.updated || null,

    updatedText:
      s.updatedText || null,

    fetchedAt:
      s.fetchedAt || null,


    // --------------------------
    // TEMPERATURA
    // --------------------------

    temperature:
      num(s.temperature),

    temperatureAt:
      s.temperatureAt || null,

    temperatureMin,

    temperatureMinAt:
      s.temperatureMinAt || null,

    temperatureMax,

    temperatureMaxAt:
      s.temperatureMaxAt || null,

    temperatureLowTime:
      s.temperatureLowTime || null,

    temperatureHighTime:
      s.temperatureHighTime || null,


    // --------------------------
    // PERCEPITA
    // --------------------------

    feelsLike:
      num(
        s.feelsLike ??
        s.perceived
      ),

    heatIndex:
      num(s.heatIndex),

    windChill:
      num(s.windChill),

    dewPoint:
      num(s.dewPoint),


    // --------------------------
    // UMIDITÀ
    // --------------------------

    humidity:
      num(s.humidity),

    humidityAt:
      s.humidityAt || null,

    humidityLow:
      num(s.humidityLow),

    humidityHigh:
      num(s.humidityHigh),


    // --------------------------
    // PRESSIONE
    // --------------------------

    pressure:
      num(s.pressure),

    pressureAt:
      s.pressureAt || null,

    pressureLow:
      num(s.pressureLow),

    pressureHigh:
      num(s.pressureHigh),


    // --------------------------
    // VENTO
    // sempre km/h
    // --------------------------

    wind,

    windAt:
      s.windAt || null,

    windGust,

    windGustAt:
      s.windGustAt || null,

    windMax,

    windDirection:
      s.windDirection ||
      directionFromDegrees(
        windDegrees
      ),

    windDirectionDegrees:
      windDegrees,

    windDirectionAt:
      s.windDirectionAt || null,


    // --------------------------
    // PIOGGIA
    // --------------------------

    precipitation:
      num(s.precipitation),

    precipitationAt:
      s.precipitationAt || null,

    rainRate:
      num(s.rainRate),

    rainToday:
      num(s.rainToday),

    rainMonth:
      num(s.rainMonth),

    rainTotal:
      num(s.rainTotal),


    // --------------------------
    // ALTRI SENSORI
    // --------------------------

    solarRadiation:
      num(s.solarRadiation),

    solarRadiationAt:
      s.solarRadiationAt || null,

    snowHeight:
      num(s.snowHeight),

    snowHeightAt:
      s.snowHeightAt || null,

    uv:
      num(s.uv),


    // --------------------------
    // UNITÀ NORMALIZZATE
    // --------------------------

    units: {
      temperature: "°C",
      feelsLike: "°C",
      dewPoint: "°C",
      humidity: "%",
      pressure: "hPa",
      wind: "km/h",
      windGust: "km/h",
      windMax: "km/h",
      windDirectionDegrees: "°",
      precipitation: "mm",
      rain: "mm",
      rainRate: "mm/h",
      solarRadiation: "W/m²",
      snowHeight: "cm",
      uv: "index"
    },


    // --------------------------
    // DATI ORIGINALI
    // --------------------------

    original: s
  };
}


// ======================================================
// LETTURA SERVICE BINDING
// ======================================================

async function fetchService(
  id,
  binding
) {

  try {

    const response =
      await binding.fetch(
        new Request(
          "https://internal/"
        )
      );


    if (!response.ok)
      throw new Error(
        `HTTP ${response.status}`
      );


    const data =
      await response.json();


    const stations =
      Array.isArray(
        data?.stations
      )
        ? data.stations
        : [];


    return {

      id,

      status:
        "online",

      version:
        data.version || null,

      generatedAt:
        data.generatedAt || null,

      count:
        stations.length,

      stations
    };


  } catch (err) {

    return {

      id,

      status:
        "error",

      version:
        null,

      generatedAt:
        null,

      count:
        0,

      stations:
        [],

      error:
        String(
          err?.message ||
          err
        )
    };
  }
}


// ======================================================
// WORKER
// ======================================================

export default {

  async fetch(request, env) {


    // --------------------------
    // CORS
    // --------------------------

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders()
        }
      );
    }


    const url =
      new URL(request.url);


    // ==================================================
    // CARICA LE TRE FAMIGLIE IN PARALLELO
    // ==================================================

    const results =
      await Promise.all([

        fetchService(
          "fassa",
          env.FASSA
        ),

        fetchService(
          "trentino",
          env.TRENTINO
        ),

        fetchService(
          "predazzo",
          env.PREDAZZO
        )

      ]);


    // ==================================================
    // NORMALIZZA
    // ==================================================

    const stations = [];


    for (
      const result
      of results
    ) {

      for (
        const station
        of result.stations
      ) {

        stations.push(
          normalize(
            station,
            result.id
          )
        );
      }
    }


    // ==================================================
    // ?stations
    // VERSIONE LEGGERA
    // ==================================================

    if (
      url.searchParams
        .has("stations")
    ) {

      return json({

        version:
          "1.0",

        generatedAt:
          new Date()
            .toISOString(),

        count:
          stations.length,

        stations:
          stations.map(
            s => ({

              id:
                s.id,

              key:
                s.key,

              name:
                s.name,

              altitude:
                s.altitude,

              family:
                s.family,

              source:
                s.source,

              status:
                s.status

            })
          )
      });
    }


    // ==================================================
    // RISPOSTA COMPLETA
    // ==================================================

    return json({

      version:
        "1.0",

      generatedAt:
        new Date()
          .toISOString(),

      count:
        stations.length,


      // Stato dei tre Worker sorgente

      sources:
        results.map(
          r => ({

            id:
              r.id,

            status:
              r.status,

            version:
              r.version,

            generatedAt:
              r.generatedAt,

            count:
              r.count,

            error:
              r.error || null

          })
        ),


      // Tutte le stazioni

      stations
    });
  }
};