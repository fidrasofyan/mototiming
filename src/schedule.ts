export type ScheduleBroadcast = {
  id?: string;
  date_start?: string;
  date_end?: string;
  name?: string;
  shortname?: string;
  type?: string;
  kind?: string;
  status?: string;
  gp_day?: number;
  category?: { name?: string; acronym?: string };
};

export type ScheduleEvent = {
  id?: string;
  timing_id?: string | number;
  name?: string;
  url?: string;
  date_start?: string;
  date_end?: string;
  time_zone?: string;
  circuit?: { name?: string };
  broadcasts?: ScheduleBroadcast[];
};

export type ScheduleEventGroup = {
  key: string;
  label: string;
  broadcasts: ScheduleBroadcast[];
};

export type CurrentScheduleSession = {
  shortName?: string;
  name?: string;
  category?: string;
};

function normalizeSessionValue(value?: string) {
  return (
    value
      ?.replace(/[™©®]/g, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\da-z]/gi, '')
      .toUpperCase() ?? ''
  );
}

export function isCurrentScheduleBroadcast(
  broadcast: ScheduleBroadcast,
  current?: CurrentScheduleSession
) {
  if (!current) return false;

  const currentShortName = normalizeSessionValue(current.shortName);
  const broadcastShortName = normalizeSessionValue(broadcast.shortname);
  const matchesShortName = Boolean(
    currentShortName && broadcastShortName && currentShortName === broadcastShortName
  );
  const matchesName = Boolean(
    !currentShortName || !broadcastShortName
      ? normalizeSessionValue(current.name) &&
          normalizeSessionValue(broadcast.name) &&
          normalizeSessionValue(current.name) === normalizeSessionValue(broadcast.name)
      : false
  );
  if (!matchesShortName && !matchesName) return false;

  const currentCategory = normalizeSessionValue(current.category);
  const broadcastCategory = normalizeSessionValue(
    broadcast.category?.name || broadcast.category?.acronym
  );
  return !currentCategory || !broadcastCategory || currentCategory === broadcastCategory;
}

export function getActiveScheduleGroup(
  groups: ScheduleEventGroup[],
  selectedKey?: string,
  timeZone?: string,
  now = new Date()
) {
  const selected = groups.find((group) => group.key === selectedKey);
  if (selected) return selected;

  const todayKey = formatDateKey(now, timeZone);
  const today = groups.find((group) => group.key === todayKey);
  if (today) return today;

  const datedGroups = groups.filter((group) => group.key !== 'unscheduled');
  const next = datedGroups.find((group) => group.key > todayKey);
  return next ?? datedGroups.at(-1) ?? groups.find((group) => group.key === 'unscheduled');
}

export function getScheduleTabNavigationIndex(key: string, currentIndex: number, tabCount: number) {
  if (tabCount <= 0) return undefined;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount;
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount;
  return undefined;
}

export function parseScheduleDate(value?: string) {
  if (!value) return undefined;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function isValidTimeZone(timeZone?: string) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function validDate(value?: string) {
  return parseScheduleDate(value)?.getTime();
}

export function selectScheduleEvent(events: ScheduleEvent[], eventId?: string, now = new Date()) {
  if (eventId) {
    const matched = events.find(
      (event) => String(event.timing_id ?? '') === eventId || event.id === eventId
    );
    if (matched) return matched;
  }

  const nowTime = now.getTime();
  const current = events.find((event) => {
    const start = validDate(event.date_start);
    const end = validDate(event.date_end);
    return start !== undefined && end !== undefined && start <= nowTime && nowTime <= end;
  });
  if (current) return current;

  const upcoming = events
    .filter((event) => {
      const start = validDate(event.date_start);
      return start !== undefined && start > nowTime;
    })
    .sort((a, b) => (validDate(a.date_start) ?? 0) - (validDate(b.date_start) ?? 0));
  if (upcoming[0]) return upcoming[0];

  return events
    .filter((event) => validDate(event.date_start) !== undefined)
    .sort(
      (a, b) =>
        (validDate(b.date_end) ?? validDate(b.date_start) ?? 0) -
        (validDate(a.date_end) ?? validDate(a.date_start) ?? 0)
    )[0];
}

function dateParts(date: Date, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      ...(timeZone ? { timeZone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  }
}

function formatDateKey(date: Date, timeZone?: string) {
  const parts = dateParts(date, timeZone);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatGroupLabel(date: Date, timeZone?: string) {
  const options: Intl.DateTimeFormatOptions = {
    ...(timeZone ? { timeZone } : {}),
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  };
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }
}

export function groupScheduleBroadcasts(event: ScheduleEvent): ScheduleEventGroup[] {
  const grouped = new Map<string, ScheduleBroadcast[]>();
  for (const broadcast of event.broadcasts ?? []) {
    const date = parseScheduleDate(broadcast.date_start);
    const key = date ? formatDateKey(date, event.time_zone) : 'unscheduled';
    const group = grouped.get(key) ?? [];
    group.push(broadcast);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => (a === 'unscheduled' ? 1 : b === 'unscheduled' ? -1 : a.localeCompare(b)))
    .map(([key, broadcasts]) => {
      const firstDate = parseScheduleDate(broadcasts[0]?.date_start);
      const label =
        key === 'unscheduled' || !firstDate
          ? 'Time to be announced'
          : formatGroupLabel(firstDate, event.time_zone);
      broadcasts.sort(
        (a, b) =>
          (validDate(a.date_start) ?? Number.MAX_SAFE_INTEGER) -
          (validDate(b.date_start) ?? Number.MAX_SAFE_INTEGER)
      );
      return { key, label, broadcasts };
    });
}

export function formatScheduleTime(value?: string, timeZone?: string) {
  const date = parseScheduleDate(value);
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...(timeZone ? { timeZone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }
}

export function formatScheduleRange(start?: string, end?: string, timeZone?: string) {
  const startLabel = formatScheduleTime(start, timeZone);
  const endLabel = formatScheduleTime(end, timeZone);
  if (startLabel === '—') return 'Time to be announced';
  return endLabel === '—' ? startLabel : `${startLabel}–${endLabel}`;
}
