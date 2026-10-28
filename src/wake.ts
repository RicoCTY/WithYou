const LATIN_EVA = /(?<![A-Za-z])eva(?![A-Za-z])/gi;
const CJK_EVA = /伊娃|伊華|依娃|埃娃/g;

export function extractRequest(transcript: string): string | null {
  const text = transcript
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  let found = false;
  const rest = text
    .replace(LATIN_EVA, () => {
      found = true;
      return " ";
    })
    .replace(CJK_EVA, () => {
      found = true;
      return " ";
    });
  if (!found) return null;

  return rest
    .replace(/[，,。！？!?、.~…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
