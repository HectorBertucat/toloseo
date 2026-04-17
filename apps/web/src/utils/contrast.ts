// WCAG relative-luminance based contrast helpers for Tisseo line colors.

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  let h = match[1]!;
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: string, bg: string): number {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function pickReadableTextColor(
  background: string,
  hint?: string | null,
): string {
  const candidates = [hint, "#ffffff", "#1a1216", "#000000"].filter(
    (c): c is string => typeof c === "string" && c.length > 0,
  );
  for (const c of candidates) {
    if (contrastRatio(c, background) >= 4.5) return c;
  }
  return contrastRatio("#ffffff", background) >
    contrastRatio("#000000", background)
    ? "#ffffff"
    : "#000000";
}

export { contrastRatio, pickReadableTextColor };
