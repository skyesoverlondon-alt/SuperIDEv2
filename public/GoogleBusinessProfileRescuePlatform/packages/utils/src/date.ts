export function addDays(iso: string, days: number) {
  const base = new Date(iso);
  base.setDate(base.getDate() + days);
  return base.toISOString();
}
