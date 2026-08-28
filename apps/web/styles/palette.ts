/** Shared silver / steel hi-tech palette — muted gray family site-wide. */
export const atlasChrome = {
  ink: "#12141A",
  steelDeep: "#1E232C",
  steel: "#2A303A",
  steelMid: "#3A4250",
  silverBg: "#F4F5F6",
  silverPaper: "#FAFAFA",
  silverSoft: "#E8E9EB",
  text: "#E0E1E4",
  textMuted: "#A8AEB8",
  textOnLight: "#1A1C22",
  textSecondaryOnLight: "#5C6068",
  chrome: "#B4B7BE",
  chromeBright: "#D2D4D8",
  // Dark enough for white label/button text at WCAG 2.2 AA (4.5:1).
  accent: "#5C6570",
  accentHover: "#6A7380",
  onAccent: "#FFFFFF",
  border: "rgba(160, 164, 172, 0.22)",
  borderStrong: "rgba(160, 164, 172, 0.38)",
  glass: "rgba(28, 31, 38, 0.72)",
  glassSoft: "rgba(22, 25, 31, 0.58)",
  selected: "rgba(154, 158, 168, 0.18)",
  hover: "rgba(154, 158, 168, 0.10)",
} as const;

/**
 * Soft semantic status colors — calm, professional.
 * Filled Chip/Button mains are paired with contrastText that meets WCAG 2.2 AA.
 */
export const atlasStatus = {
  // Success — soft sage green
  successLight: "#E8F2EC",
  successMain: "#5A8A6E",
  successDark: "#4A7660",
  successText: "#1A1C22",

  // Warning — soft warm amber
  warningLight: "#FDF4E7",
  warningMain: "#B08B4A",
  warningDark: "#8A6D3A",
  warningText: "#1A1C22",

  // Error — soft dusty rose
  errorLight: "#FAEDEC",
  errorMain: "#B55A54",
  errorDark: "#964A45",
  errorText: "#FFFFFF",

  // Info — soft steel blue
  infoLight: "#EDF1F5",
  infoMain: "#5A7390",
  infoDark: "#4A6178",
  infoText: "#FFFFFF",
} as const;
