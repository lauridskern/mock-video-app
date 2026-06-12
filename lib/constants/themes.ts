// "Margelo" theme — light blue backdrop with a repeating plus-grid pattern.
// All sizes are fractions of the output width so the pattern stays the same
// size relative to the video at any resolution.
export const margeloTheme = {
  backgroundColor: "#cee1f5",
  plusColor: "#b1cbea",
  tileFraction: 0.08, // distance between plus centers
  plusSizeFraction: 0.016, // full width/height of one plus
  plusStrokeFraction: 0.002, // stroke thickness of the plus arms
};

const tileUnits = 200;
const center = tileUnits / 2;
const plusHalf = ((margeloTheme.plusSizeFraction / margeloTheme.tileFraction) * tileUnits) / 2;
const strokeWidth = (margeloTheme.plusStrokeFraction / margeloTheme.tileFraction) * tileUnits;

const margeloTileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tileUnits} ${tileUnits}"><path d="M${center} ${center - plusHalf}v${plusHalf * 2}M${center - plusHalf} ${center}h${plusHalf * 2}" stroke="${margeloTheme.plusColor}" stroke-width="${strokeWidth}" stroke-linecap="round" fill="none"/></svg>`;

export const margeloTileDataUri = `data:image/svg+xml,${encodeURIComponent(margeloTileSvg)}`;
