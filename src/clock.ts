/** 按部署时区读本地日期与时刻。 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts { date: string; md: string; hm: string; minutes: number }

export function localParts(tz: string, at: number): LocalParts {
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(new Date(at))) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    md: `${p.month}-${p.day}`,
    hm: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** `10-21 14:03`。 */
export const mdhm = (tz: string, at: number): string => {
  const p = localParts(tz, at);
  return `${p.md} ${p.hm}`;
};

export const toMinutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
