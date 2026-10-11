import { UserInputError } from "../lib/errors.js";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateOnly(value: string, fieldName: string): string {
  if (!dateOnlyPattern.test(value)) {
    throw new UserInputError(`${fieldName} は YYYY-MM-DD 形式で指定してください。`);
  }
  const [yStr, mStr, dStr] = value.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new UserInputError(`${fieldName} に実在しないカレンダー日付が指定されています: ${value}`);
  }
  return value;
}

export function formatKkjDateRange(after?: string, before?: string): string | undefined {
  if (!after && !before) {
    return undefined;
  }
  if (after) {
    assertDateOnly(after, "after");
  }
  if (before) {
    assertDateOnly(before, "before");
  }
  if (after && before && after === before) {
    return after;
  }
  return `${after ?? ""}/${before ?? ""}`;
}

export function daysAgoDate(days: number, now = new Date()): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function todayDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Returns today's calendar date string (YYYY-MM-DD) in Japan Standard Time (UTC+9).
 */
export function todayDateJst(now = new Date()): string {
  const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jstTime.toISOString().slice(0, 10);
}

/**
 * Returns the calendar date string (YYYY-MM-DD) N days ago in Japan Standard Time (UTC+9).
 */
export function daysAgoDateJst(days: number, now = new Date()): string {
  const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jstTime.setUTCDate(jstTime.getUTCDate() - days);
  return jstTime.toISOString().slice(0, 10);
}

/**
 * Returns the calendar date string (YYYY-MM-DD) N days ahead in Japan Standard Time (UTC+9).
 */
export function daysAfterDateJst(days: number, now = new Date()): string {
  const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jstTime.setUTCDate(jstTime.getUTCDate() + days);
  return jstTime.toISOString().slice(0, 10);
}

export interface ParsedDateTime {
  date: Date;
  hasTime: boolean;
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/**
 * 日本の入札公示日時文字列（ISO形式、スラッシュ区切り、和暦、時刻付き、タイムゾーン指定対応）を解析する。
 * 不正な暦日（2026-02-31等）は繰り上がらずに null を返す。
 * 時刻にタイムゾーン指定がない場合は官公需標準のJST (UTC+9) として解釈する。
 */
export function parseJapaneseDateTime(value: string | undefined): ParsedDateTime | null {
  if (!value || value.trim() === "") {
    return null;
  }
  const trimmed = value.trim();

  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;

  const isoMatch = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const warekiMatch = /(?:令和|R)\s*(\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(trimmed);
    if (warekiMatch) {
      year = 2018 + Number(warekiMatch[1]);
      month = Number(warekiMatch[2]);
      day = Number(warekiMatch[3]);
    }
  }

  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }

  // Strict calendar validity check (prevents Date.UTC rollover on invalid days like 2026-02-31)
  const testDate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(testDate.getTime()) ||
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month - 1 ||
    testDate.getUTCDate() !== day
  ) {
    return null;
  }

  // Check for time component
  const timeMatch =
    /(?:[T\s])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?/.exec(trimmed);
  if (!timeMatch) {
    return {
      date: testDate,
      hasTime: false,
      year,
      month,
      day,
    };
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = timeMatch[3] ? Number(timeMatch[3]) : 0;
  const tz = timeMatch[4];

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }

  let utcMillis: number;
  if (tz) {
    if (tz === "Z" || tz === "z") {
      utcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
    } else {
      const tzMatch = /([+-])(\d{2}):?(\d{2})/.exec(tz);
      if (tzMatch) {
        const sign = tzMatch[1] === "+" ? 1 : -1;
        const tzHours = Number(tzMatch[2]);
        const tzMinutes = Number(tzMatch[3]);
        const offsetMillis = sign * (tzHours * 60 + tzMinutes) * 60 * 1000;
        utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMillis;
      } else {
        utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - 9 * 3600 * 1000;
      }
    }
  } else {
    // Japanese government announcements without explicit TZ are in JST (UTC+9)
    utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - 9 * 3600 * 1000;
  }

  const date = new Date(utcMillis);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    date,
    hasTime: true,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

/**
 * 和暦（令和N年M月D日）またはISO/slash日付文字列をDateに変換する
 */
export function parseJapaneseDateToDate(value: string | undefined): Date | null {
  const parsed = parseJapaneseDateTime(value);
  return parsed ? parsed.date : null;
}

export function extractDateComponents(
  value: string,
): { year: number; month: number; day: number } | null {
  const parsed = parseJapaneseDateTime(value);
  if (!parsed) {
    return null;
  }
  return { year: parsed.year, month: parsed.month, day: parsed.day };
}
