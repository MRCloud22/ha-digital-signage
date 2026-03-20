export const WEEKDAYS = [
  { value: 1, label: 'Mo' },
  { value: 2, label: 'Di' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' },
  { value: 5, label: 'Fr' },
  { value: 6, label: 'Sa' },
  { value: 0, label: 'So' },
];

export function parseScheduleDays(daysValue) {
  if (!daysValue) return [];

  return `${daysValue}`
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value));
}

export function formatDuration(seconds, dynamic = false) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return dynamic ? 'dynamisch' : '0s';
  }

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (minutes === 0) {
    return dynamic ? `${remainingSeconds}s + Video` : `${remainingSeconds}s`;
  }

  return dynamic
    ? `${minutes}m ${remainingSeconds}s + Video`
    : `${minutes}m ${remainingSeconds}s`;
}

export function formatLastContact(value) {
  if (!value) return 'Nie';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unbekannt';

  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSeconds < 60) return `vor ${Math.max(diffSeconds, 0)}s`;
  if (diffSeconds < 3600) return `vor ${Math.floor(diffSeconds / 60)} min`;
  if (diffSeconds < 86400) return `vor ${Math.floor(diffSeconds / 3600)} h`;

  return date.toLocaleString('de-DE');
}

export function toDateTimeLocalValue(value) {
  if (!value) return '';

  const normalized = `${value}`.replace(' ', 'T');
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return normalized.slice(0, 16);
  }

  const pad = (part) => `${part}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDeviceInfo(value) {
  if (!value) return '';

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') return parsed;

    const parts = [
      parsed.platform,
      parsed.browser,
      parsed.userAgent,
      parsed.language,
    ].filter(Boolean);

    return parts.join(' | ') || value;
  } catch {
    return value;
  }
}

export function summarizeSchedule(schedule, playlists, layouts) {
  const targetList = schedule.target_type === 'layout' ? layouts : playlists;
  const target = targetList.find((entry) => entry.id === schedule.target_id);
  const dayLabels = parseScheduleDays(schedule.days_of_week)
    .map((value) => WEEKDAYS.find((day) => day.value === value)?.label)
    .filter(Boolean);

  const parts = [
    target ? target.name : 'Ziel fehlt',
    schedule.start_time || schedule.end_time ? `${schedule.start_time || '00:00'}-${schedule.end_time || '24:00'}` : null,
    dayLabels.length > 0 ? dayLabels.join(', ') : 'alle Tage',
  ].filter(Boolean);

  return parts.join(' | ');
}

export function buildScheduleForm(schedule = null) {
  return {
    id: schedule?.id || null,
    name: schedule?.name || '',
    targetType: schedule?.target_type || 'playlist',
    targetId: schedule?.target_id || '',
    priority: schedule?.priority ?? 0,
    startsAt: toDateTimeLocalValue(schedule?.starts_at),
    endsAt: toDateTimeLocalValue(schedule?.ends_at),
    startTime: schedule?.start_time || '',
    endTime: schedule?.end_time || '',
    daysOfWeek: parseScheduleDays(schedule?.days_of_week),
    isEnabled: schedule ? !!schedule.is_enabled : true,
  };
}

export function truncate(value, maxLength = 60) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}
