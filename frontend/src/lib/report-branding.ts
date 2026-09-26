import merylLogoBwUrl from "../assets/Meryl_Logo_BW.svg";

/** Letterhead used on exported reports (same store details as the receipts). */
export const REPORT_STORE = {
  name: "MERYL SHOES",
  tagline: "Official Retailer & Shoe Center",
  address: "Araneta Ave, Bacolod, 6100 Negros Occidental",
  contact: "TEL: (034) 435 0128",
};

export type ReportLogo = {
  /** PNG data URL (for Excel). */
  pngDataUrl: string;
  /** JPEG bytes as hex (for the hand-built PDF, via /ASCIIHexDecode /DCTDecode). */
  jpegHex: string;
  width: number;
  height: number;
};

let cached: Promise<ReportLogo | null> | null = null;

/**
 * The store logo rasterised in solid black on white, like the printed receipts.
 * Returns null if the logo cannot be drawn, so exports still work without it.
 */
export function loadReportLogo(): Promise<ReportLogo | null> {
  cached ??= (async () => {
    try {
      const svg = await (await fetch(merylLogoBwUrl)).text();
      const width = 1000;
      const height = Math.round((width * 741) / 2000);
      // The SVG is sized in percent; give it explicit pixels so it can be drawn.
      const sized = svg.replace(/<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${width}" height="${height}"`);
      const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      URL.revokeObjectURL(url);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, width, height);
      // Solid black ink on a white page, whatever colours the SVG uses.
      const pixels = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const alpha = pixels.data[i + 3] / 255;
        const ink = Math.round(255 * (1 - alpha));
        pixels.data[i] = ink;
        pixels.data[i + 1] = ink;
        pixels.data[i + 2] = ink;
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);

      // Crop the SVG's empty margin so the logo fills the letterhead.
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
          if (pixels.data[(py * width + px) * 4] < 200) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }
      let output = canvas;
      if (maxX > minX && maxY > minY) {
        const pad = 8;
        const cropX = Math.max(0, minX - pad);
        const cropY = Math.max(0, minY - pad);
        const cropW = Math.min(width, maxX + pad) - cropX;
        const cropH = Math.min(height, maxY + pad) - cropY;
        output = document.createElement("canvas");
        output.width = cropW;
        output.height = cropH;
        output.getContext("2d")?.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      }

      const jpegBase64 = output.toDataURL("image/jpeg", 0.92).split(",")[1] ?? "";
      const bytes = atob(jpegBase64);
      let jpegHex = "";
      for (let i = 0; i < bytes.length; i += 1) jpegHex += bytes.charCodeAt(i).toString(16).padStart(2, "0");

      return { pngDataUrl: output.toDataURL("image/png"), jpegHex, width: output.width, height: output.height };
    } catch {
      return null;
    }
  })();
  return cached;
}
