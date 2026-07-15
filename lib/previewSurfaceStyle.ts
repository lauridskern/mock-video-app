import type { CSSProperties } from "react";
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

  if (background.type === "pattern") {
    return {
      ...base,
      backgroundColor: "transparent",
      backgroundImage: `url(${background.url})`,
      backgroundPosition: "center center",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
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
