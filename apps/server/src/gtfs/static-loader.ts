import { parse } from "csv-parse";
import { Readable } from "node:stream";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  getRoutes,
  getStops,
  getTrips,
  getShapes,
  getStopTimes,
  getServiceCalendars,
  getCalendarExceptions,
  setGtfsLoaded,
  inferMode,
} from "./store.js";
import type {
  GeoJsonLineString,
  ServiceCalendar,
  StopTimeEntry,
  TripInfo,
} from "./store.js";
import type { TransitLine, Stop, TransitMode } from "@shared/types.js";

export async function loadGtfsStatic(): Promise<void> {
  logger.info("downloading GTFS static feed...");
  const dataDir = join(config.dataDir, "gtfs");
  await mkdir(dataDir, { recursive: true });

  const response = await fetch(config.gtfsStaticUrl);
  if (!response.ok) {
    throw new Error(`GTFS download failed: ${response.status}`);
  }

  const zipBuffer = await response.arrayBuffer();
  logger.info({ bytes: zipBuffer.byteLength }, "GTFS ZIP downloaded");

  const files = await extractZip(new Uint8Array(zipBuffer));
  await parseAllFiles(files);
  setGtfsLoaded(true);
  logStats();
}

async function extractZip(
  buffer: Uint8Array,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const decoder = new TextDecoder("utf-8");
  const rawEntries = parseZipLocalHeaders(buffer);

  for (const [name, { data, compressed }] of rawEntries) {
    if (!compressed) {
      files.set(name, decoder.decode(data));
    } else {
      try {
        const decompressed = inflateRawSync(data);
        files.set(name, decoder.decode(decompressed));
      } catch (err) {
        logger.warn({ name, err }, "failed to decompress ZIP entry");
      }
    }
  }

  return files;
}

function parseZipLocalHeaders(
  buf: Uint8Array,
): Map<string, { data: Uint8Array; compressed: boolean }> {
  const entries = new Map<string, { data: Uint8Array; compressed: boolean }>();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;

  while (offset < buf.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = buf.slice(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataStart = offset + 30 + nameLen + extraLen;
    const rawData = buf.slice(dataStart, dataStart + compressedSize);

    entries.set(name, { data: rawData, compressed: method === 8 });
    offset = dataStart + compressedSize;
  }

  return entries;
}

async function parseAllFiles(files: Map<string, string>): Promise<void> {
  const tasks: Promise<void>[] = [];

  const routesCsv = files.get("routes.txt");
  if (routesCsv) tasks.push(parseRoutes(routesCsv));

  const stopsCsv = files.get("stops.txt");
  if (stopsCsv) tasks.push(parseStops(stopsCsv));

  const tripsCsv = files.get("trips.txt");
  if (tripsCsv) tasks.push(parseTrips(tripsCsv));

  const shapesCsv = files.get("shapes.txt");
  if (shapesCsv) tasks.push(parseShapes(shapesCsv));

  const calendarCsv = files.get("calendar.txt");
  if (calendarCsv) tasks.push(parseCalendar(calendarCsv));

  const calendarDatesCsv = files.get("calendar_dates.txt");
  if (calendarDatesCsv) tasks.push(parseCalendarDates(calendarDatesCsv));

  await Promise.all(tasks);

  const stopTimesCsv = files.get("stop_times.txt");
  if (stopTimesCsv) await parseStopTimes(stopTimesCsv);
}

async function parseCsv(
  content: string,
): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const records: Record<string, string>[] = [];
    const stream = Readable.from(content);
    const parser = stream.pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true }),
    );
    parser.on("data", (row: Record<string, string>) => records.push(row));
    parser.on("end", () => resolve(records));
    parser.on("error", reject);
  });
}

async function parseRoutes(csv: string): Promise<void> {
  const rows = await parseCsv(csv);
  const routes = getRoutes();
  for (const row of rows) {
    const id = row["route_id"] ?? "";
    const shortName = row["route_short_name"] ?? "";
    const routeType = parseInt(row["route_type"] ?? "3", 10);
    const line: TransitLine = {
      id,
      shortName,
      longName: row["route_long_name"] ?? "",
      color: `#${row["route_color"] ?? "888888"}`,
      textColor: `#${row["route_text_color"] ?? "FFFFFF"}`,
      mode: inferMode(routeType, shortName),
      vehicleCount: 0,
      avgDelay: 0,
    };
    routes.set(id, line);
  }
}

async function parseStops(csv: string): Promise<void> {
  const rows = await parseCsv(csv);
  const stopsMap = getStops();
  for (const row of rows) {
    const id = row["stop_id"] ?? "";
    const locationType = parseInt(row["location_type"] ?? "0", 10);
    if (locationType === 1) continue;

    const stop: Stop = {
      id,
      name: row["stop_name"] ?? "",
      lat: parseFloat(row["stop_lat"] ?? "0"),
      lon: parseFloat(row["stop_lon"] ?? "0"),
      modes: [],
      wheelchairAccessible: row["wheelchair_boarding"] === "1",
    };
    stopsMap.set(id, stop);
  }
}

async function parseTrips(csv: string): Promise<void> {
  const rows = await parseCsv(csv);
  const tripsMap = getTrips();
  for (const row of rows) {
    const tripId = row["trip_id"] ?? "";
    const trip: TripInfo = {
      tripId,
      routeId: row["route_id"] ?? "",
      serviceId: row["service_id"] ?? "",
      shapeId: row["shape_id"] ?? "",
      headsign: row["trip_headsign"] ?? "",
      directionId: parseInt(row["direction_id"] ?? "0", 10),
    };
    tripsMap.set(tripId, trip);
  }
}

async function parseShapes(csv: string): Promise<void> {
  const rows = await parseCsv(csv);
  const shapesMap = getShapes();
  const grouped = new Map<string, { seq: number; lat: number; lon: number }[]>();

  for (const row of rows) {
    const shapeId = row["shape_id"] ?? "";
    const point = {
      seq: parseInt(row["shape_pt_sequence"] ?? "0", 10),
      lat: parseFloat(row["shape_pt_lat"] ?? "0"),
      lon: parseFloat(row["shape_pt_lon"] ?? "0"),
    };
    const existing = grouped.get(shapeId);
    if (existing) {
      existing.push(point);
    } else {
      grouped.set(shapeId, [point]);
    }
  }

  for (const [shapeId, points] of grouped) {
    points.sort((a, b) => a.seq - b.seq);
    const geojson: GeoJsonLineString = {
      type: "LineString",
      coordinates: points.map((p) => [p.lon, p.lat]),
    };
    shapesMap.set(shapeId, geojson);
  }
}

async function parseStopTimes(csv: string): Promise<void> {
  const rows = await parseCsv(csv);
  const stMap = getStopTimes();
  for (const row of rows) {
    const tripId = row["trip_id"] ?? "";
    const entry: StopTimeEntry = {
      stopId: row["stop_id"] ?? "",
      arrivalTime: row["arrival_time"] ?? "",
      departureTime: row["departure_time"] ?? "",
      stopSequence: parseInt(row["stop_sequence"] ?? "0", 10),
    };
    const existing = stMap.get(tripId);
    if (existing) {
      existing.push(entry);
    } else {
      stMap.set(tripId, [entry]);
    }
  }

  for (const [, entries] of stMap) {
    entries.sort((a, b) => a.stopSequence - b.stopSequence);
  }
}

async function parseCalendar(csv: string): Promise<void> {
  const rows = await parseCsv(csv);
  const calendars = getServiceCalendars();
  for (const row of rows) {
    const cal: ServiceCalendar = {
      serviceId: row["service_id"] ?? "",
      days: [
        row["monday"] === "1",
        row["tuesday"] === "1",
        row["wednesday"] === "1",
        row["thursday"] === "1",
        row["friday"] === "1",
        row["saturday"] === "1",
        row["sunday"] === "1",
      ],
      startDate: row["start_date"] ?? "",
      endDate: row["end_date"] ?? "",
    };
    calendars.set(cal.serviceId, cal);
  }
}

async function parseCalendarDates(csv: string): Promise<void> {
  const rows = await parseCsv(csv);
  const exceptions = getCalendarExceptions();
  for (const row of rows) {
    exceptions.push({
      serviceId: row["service_id"] ?? "",
      date: row["date"] ?? "",
      exceptionType: parseInt(row["exception_type"] ?? "1", 10),
    });
  }
}

function logStats(): void {
  logger.info(
    {
      routes: getRoutes().size,
      stops: getStops().size,
      trips: getTrips().size,
      shapes: getShapes().size,
      stopTimes: getStopTimes().size,
      calendars: getServiceCalendars().size,
    },
    "GTFS static data loaded",
  );
}
