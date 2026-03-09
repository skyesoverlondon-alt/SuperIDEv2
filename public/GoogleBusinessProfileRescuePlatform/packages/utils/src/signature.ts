export function shortSignature(value: string) {
  return btoa(value).slice(0, 16);
}
