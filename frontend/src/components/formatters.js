export const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
export const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', timeZone: 'UTC' }).format(new Date(value));
