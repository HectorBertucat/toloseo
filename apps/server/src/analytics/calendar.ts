import { getDatabase } from "./db.js";
import { logger } from "../logger.js";

interface HolidayEntry {
  date: string;
  name: string;
}

interface VacationPeriod {
  name: string;
  start: string;
  end: string;
}

const FRENCH_HOLIDAYS: HolidayEntry[] = [
  { date: "01-01", name: "Jour de l'An" },
  { date: "05-01", name: "Fete du Travail" },
  { date: "05-08", name: "Victoire 1945" },
  { date: "07-14", name: "Fete Nationale" },
  { date: "08-15", name: "Assomption" },
  { date: "11-01", name: "Toussaint" },
  { date: "11-11", name: "Armistice" },
  { date: "12-25", name: "Noel" },
];

const ZONE_C_VACATIONS_2025_2026: VacationPeriod[] = [
  { name: "Toussaint", start: "2025-10-18", end: "2025-11-03" },
  { name: "Noel", start: "2025-12-20", end: "2026-01-05" },
  { name: "Hiver", start: "2026-02-07", end: "2026-02-23" },
  { name: "Printemps", start: "2026-04-04", end: "2026-04-20" },
  { name: "Ete", start: "2026-07-04", end: "2026-09-01" },
];

export async function loadCalendarContext(): Promise<void> {
  try {
    const db = getDatabase();
    const existingCount = db
      .query("SELECT COUNT(*) as c FROM calendar_context")
      .get() as { c: number };

    if (existingCount.c > 0) {
      logger.debug("calendar context already loaded");
      return;
    }

    insertHolidays(db);
    insertVacations(db);

    logger.info("calendar context loaded (holidays + zone C vacations)");
  } catch (err) {
    logger.error({ err }, "failed to load calendar context");
  }
}

function insertHolidays(db: ReturnType<typeof getDatabase>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO calendar_context (date, is_holiday, holiday_name)
    VALUES (?, 1, ?)
  `);

  const years = [2025, 2026, 2027];
  const insertAll = db.transaction(() => {
    for (const year of years) {
      for (const h of FRENCH_HOLIDAYS) {
        stmt.run(`${year}-${h.date}`, h.name);
      }
      insertEaster(db, year);
    }
  });

  insertAll();
}

function insertEaster(db: ReturnType<typeof getDatabase>, year: number): void {
  const easter = computeEasterDate(year);
  const easterMonday = addDays(easter, 1);
  const ascension = addDays(easter, 39);
  const pentecostMonday = addDays(easter, 50);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO calendar_context (date, is_holiday, holiday_name)
    VALUES (?, 1, ?)
  `);

  stmt.run(formatDate(easterMonday), "Lundi de Paques");
  stmt.run(formatDate(ascension), "Ascension");
  stmt.run(formatDate(pentecostMonday), "Lundi de Pentecote");
}

function computeEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function insertVacations(db: ReturnType<typeof getDatabase>): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO calendar_context
      (date, is_holiday, is_school_vacation, vacation_name, holiday_name)
    VALUES (
      ?,
      COALESCE((SELECT is_holiday FROM calendar_context WHERE date = ?), 0),
      1,
      ?,
      (SELECT holiday_name FROM calendar_context WHERE date = ?)
    )
  `);

  const insertAll = db.transaction(() => {
    for (const vac of ZONE_C_VACATIONS_2025_2026) {
      const start = new Date(vac.start);
      const end = new Date(vac.end);
      const cursor = new Date(start);

      while (cursor <= end) {
        const dateStr = formatDate(cursor);
        stmt.run(dateStr, dateStr, vac.name, dateStr);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  });

  insertAll();
}

export function isHoliday(date: string): boolean {
  const db = getDatabase();
  const row = db
    .query("SELECT is_holiday FROM calendar_context WHERE date = ?")
    .get(date) as { is_holiday: number } | null;
  return row?.is_holiday === 1;
}

export function isSchoolVacation(date: string): boolean {
  const db = getDatabase();
  const row = db
    .query("SELECT is_school_vacation FROM calendar_context WHERE date = ?")
    .get(date) as { is_school_vacation: number } | null;
  return row?.is_school_vacation === 1;
}
