import { z } from 'zod';
import { FirefliesTranscriptError } from './errors.js';

export type FirefliesTranscript = {
  id: string; title: string; date: number; duration: number; participants: string[];
  meeting_link?: string | null | undefined; calendar_id?: string | null | undefined; cal_id?: string | null | undefined;
  is_live?: boolean | null | undefined; summary_status?: string | null | undefined;
  speakers: { id: number; name: string }[];
  sentences: { speaker_id: string; speaker_name: string; text: string; start_time: string }[];
};
export const UNTITLED = 'Untitled call';
const MAX_START_TIME_SECONDS = 604_800;
const START_TIME = /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,12})?$/u;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const EMAIL_LOCAL = /^[A-Za-z0-9._%+-]{1,64}$/u;
const EMAIL_DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;

function isEmail(value: string): boolean {
  const separator = value.indexOf("@");
  if (separator <= 0 || separator !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, separator);
  const labels = value.slice(separator + 1).split(".");
  return EMAIL_LOCAL.test(local)
    && labels.length >= 2
    && labels.every((label) => EMAIL_DOMAIN_LABEL.test(label));
}

function isFirefliesStartTime(value: string): boolean {
  return derivedStartTime(value) !== null;
}

function derivedStartTime(value: string): number | null {
  if (!START_TIME.test(value)) return null;
  const decimalIndex = value.indexOf(".");
  const wholeText = decimalIndex === -1 ? value : value.slice(0, decimalIndex);
  const fractionText = decimalIndex === -1 ? "" : value.slice(decimalIndex + 1);
  const whole = Number(wholeText);
  if (
    whole > MAX_START_TIME_SECONDS
    || (whole === MAX_START_TIME_SECONDS && /[1-9]/u.test(fractionText))
  ) {
    return null;
  }
  const derived = Number(value);
  return Number.isFinite(derived) && derived >= 0 && derived <= MAX_START_TIME_SECONDS
    ? derived
    : null;
}

const singleLine = (value: unknown): string => typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
const idKey = (value: unknown): string => typeof value === "number" || typeof value === "string" ? String(value) : "";

/** A start the transcript schema accepts stays byte-for-byte; a number of seconds becomes its decimal string when
 * that fits; anything else is "0". */
function liveStart(value: unknown): string {
  if (typeof value === "string" && isFirefliesStartTime(value)) return value;
  const seconds = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  const decimal = Number.isFinite(seconds) && seconds >= 0 ? seconds.toFixed(3) : "0";
  return isFirefliesStartTime(decimal) ? decimal : "0";
}

/** Every line that has text, attributed as the line itself says: a line's own speaker name wins over the speakers
 * list, and a speaker whose id does not fit the schema (null, "spk_1", or one id shown under two names) gets a
 * reserved id counted down from 9999 instead of losing the line. Start times preserve accepted decimal strings. */
function liveLines(raw: Record<string, unknown>): { speakers: { id: number; name: string }[]; sentences: FirefliesTranscript['sentences'] } {
  const listNames = new Map<string, string>();
  for (const speaker of Array.isArray(raw.speakers) ? raw.speakers : []) {
    if (isRecord(speaker) && idKey(speaker.id) && singleLine(speaker.name)) listNames.set(idKey(speaker.id), singleLine(speaker.name));
  }
  const speakers: { id: number; name: string }[] = [];
  const ids = new Map<string, number>();
  let reserved = 9_999;
  const speakerId = (key: string, name: string): number => {
    const known = ids.get(`${key}\u0000${name}`);
    if (known !== undefined) return known;
    const own = /^[0-9]{1,4}$/u.test(key) && !speakers.some(speaker => speaker.id === Number(key)) ? Number(key) : null;
    let id = own;
    while (id === null) {
      if (!speakers.some(speaker => speaker.id === reserved)) id = reserved;
      reserved -= 1;
    }
    ids.set(`${key}\u0000${name}`, id);
    speakers.push({ id, name });
    return id;
  };
  const sentences = (Array.isArray(raw.sentences) ? raw.sentences : []).flatMap(line => {
    if (!isRecord(line) || typeof line.text !== "string" || !line.text.trim()) return [];
    const key = idKey(line.speaker_id);
    // A speaker named nowhere keeps its id in its name, so two unnamed speakers are never merged into one.
    const name = singleLine(line.speaker_name) || listNames.get(key) || (/^[\w.+-]{1,40}$/u.test(key) ? `Speaker ${key}` : "Speaker");
    return [{ speaker_id: String(speakerId(key, name)), speaker_name: name, text: line.text, start_time: liveStart(line.start_time) }];
  });
  return { speakers, sentences };
}

/**
 * A real transcript fitted to the normalized schema:
 * `date` may be fractional milliseconds and empty fields come back null. Participants are the emails found (a
 * comma-joined entry is split), sorted so the payload hash is stable. Unknown fields are left out.
 */
function liveTranscriptInput(raw: Record<string, unknown>): Record<string, unknown> {
  const meetingInfo = z.object({ summary_status: z.string().nullable().optional() }).nullable().optional()
    .safeParse(raw.meeting_info);
  const summaryStatus = meetingInfo.success ? meetingInfo.data?.summary_status : undefined;
  const participants = new Set((Array.isArray(raw.participants) ? raw.participants : [])
    .flatMap(value => typeof value === "string" ? value.split(",").map(email => email.trim()) : [])
    .filter(email => isEmail(email)));
  return {
    id: raw.id, title: singleLine(raw.title) || UNTITLED,
    date: typeof raw.date === "number" ? Math.trunc(raw.date) : raw.date, duration: raw.duration,
    participants: [...participants].sort(),
    // No key for an absent value: the transcript schema's canonical-JSON bound refuses `undefined`.
    ...Object.fromEntries(["meeting_link", "calendar_id", "cal_id", "is_live"]
      .filter(key => raw[key] !== undefined).map(key => [key, raw[key]])),
    ...(summaryStatus === undefined ? {} : { summary_status: summaryStatus }),
    ...liveLines(raw),
  };
}


const transcriptSchema = z.object({
  id: z.string(), title: z.string(), date: z.number(), duration: z.number(), participants: z.array(z.string()),
  meeting_link: z.string().nullable().optional(), calendar_id: z.string().nullable().optional(),
  cal_id: z.string().nullable().optional(), is_live: z.boolean().nullable().optional(),
  summary_status: z.string().nullable().optional(),
  speakers: z.array(z.object({ id: z.number(), name: z.string() })),
  sentences: z.array(z.object({ speaker_id: z.string(), speaker_name: z.string(), text: z.string(), start_time: z.string() })),
});

export function normalizeTranscript(raw: Record<string, unknown>): FirefliesTranscript {
  const parsed = transcriptSchema.safeParse(liveTranscriptInput(raw));
  if (!parsed.success) throw new FirefliesTranscriptError(parsed.error.issues[0]?.path.map(String).join('.') ?? 'transcript');
  return parsed.data;
}
