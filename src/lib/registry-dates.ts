/** Summarise the dates of successful snapshots, including older retained entries. */
export function registryDateRange(entries: Iterable<{ fetched: string }>): { oldest: string; newest: string } {
  let oldest = "", newest = "";
  for (const { fetched } of entries) {
    if (!fetched) continue;
    if (!oldest || fetched < oldest) oldest = fetched;
    if (fetched > newest) newest = fetched;
  }
  return { oldest, newest };
}

/** A date or an explicit range for text that follows the word "fetched". */
export function registryDateLabel(oldest: string, newest: string): string {
  if (!newest) return "on an unknown date";
  if (!oldest || oldest === newest) return newest;
  return `between ${oldest} and ${newest} (dates differ by product)`;
}
