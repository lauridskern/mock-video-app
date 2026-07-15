import type { CSSProperties } from "react";
import { margeloTheme, margeloTileDataUri } from "@/lib/constants/themes";
import type { Background } from "@/lib/hooks/useMediabunny";

export const checkerboardBackground = [
  "linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%)",
  "linear-gradient(-45deg, rgba(0,0,0,0.08) 25%, transparent 25%)",
  "linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.08) 75%)",
  "linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.08) 75%)",
].join(", ");

export function buildPreviewSurfaceStyle(params: {
  background: Background;
  solidColor: string;
  isTransparentExport: boolean;
  aspectWidth: number;
  aspectHeight: number;
}): CSSProperties {
  const { background, solidColor, isTransparentExport, aspectWidth, aspectHeight } = params;
  const aspect = `${aspectWidth}/${aspectHeight}`;
  const base = {
    height: "100%",
    width: `calc(60vh * ${aspectWidth}/${aspectHeight})`,
    maxHeight: "60vh",
    aspectRatio: aspect,
  } as const;

  if (isTransparentExport) {
    return {
      ...base,
      backgroundColor: "#ffffff",
      backgroundImage: checkerboardBackground,
      backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0",
      backgroundSize: "24px 24px",
    };
  }

  if (background.type === "margelo") {
    // Tile size is a fraction of the surface width; the height percentage is
    // scaled by the aspect ratio so the tile stays square, matching the canvas.
    const tileWidthPercent = margeloTheme.tileFraction * 100;
    const tileHeightPercent = tileWidthPercent * (aspectWidth / aspectHeight);
    return {
      ...base,
      backgroundColor: margeloTheme.backgroundColor,
      backgroundImage: `url("${margeloTileDataUri}")`,
      backgroundPosition: "0 0",
      backgroundSize: `${tileWidthPercent}% ${tileHeightPercent}%`,
      backgroundRepeat: "repeat",
    };
  }

  if (background.type === "gradient") {
    return {
      ...base,
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`,
      backgroundPosition: "center center",
      backgroundSize: "100% 100%",
      backgroundRepeat: "no-repeat",
    };
  }

  const canvasColor = background.type === "color" ? background.color : solidColor;
  return {
    ...base,
    backgroundColor: canvasColor,
    backgroundImage: "none",
    backgroundPosition: "0% 0%",
    backgroundSize: "auto",
    backgroundRepeat: "no-repeat",
  };
}
