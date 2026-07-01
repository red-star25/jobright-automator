export function cleanAiText(text: string): string {
  return String(text || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsUnsupportedPlaceholder(text: string): boolean {
  const value = String(text || "");
  return /\b(?:XYZ\s*(?:Corp|Inc|Company)?|ABC\s*(?:Corp|Inc|Company)?|Acme\s*(?:Corp|Inc|Company)?|Example\s*(?:Corp|Inc|Company)?|Company\s*Name|Project\s*Name)\b/i.test(
    value
  );
}

export function aiTextLooksReadable(text: string): boolean {
  const sample = cleanAiText(text);
  if (sample.length < 250) return false;
  const englishWords = sample.match(/\b[A-Za-z][A-Za-z+.#-]{2,}\b/g) || [];
  if (englishWords.length < 45) return false;
  const readableChars = sample.match(/[A-Za-z0-9\s.,;:()@/+&_'’\-#]/g) || [];
  if (readableChars.length / sample.length < 0.82) return false;
  return /(education|experience|project|skills|university|college|software|engineer|developer|intern|github|linkedin|email|coursework|programming|javascript|python|java|react|node|sql)/i.test(
    sample
  );
}
