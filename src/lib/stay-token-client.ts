export function readStayToken(slug: string): string | null {
  try {
    return localStorage.getItem(`ci-stay:${slug}`);
  } catch {
    return null;
  }
}
