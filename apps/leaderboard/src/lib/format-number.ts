export function formatCompactNumber(
  number: number,
  maximumFractionDigits = 1
): string {
  const formatter = Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits,
  });
  return formatter.format(number);
}
