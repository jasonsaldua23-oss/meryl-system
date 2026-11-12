/**
 * High-Reliability Code 128 & 1D Barcode Decoder for Meryl Shoes POS
 *
 * Designed specifically for:
 * 1. Live laptop/desktop webcams (including mirrored feeds, uneven lighting, screen glare, and low-res 1-module blur)
 * 2. Uploaded barcode label PNGs and full-screen dark-mode screenshots containing a barcode card
 * 3. Multi-engine fallback (@ericblade/quagga2 + native BarcodeDetector)
 */
import Quagga from "@ericblade/quagga2";

// Official Code 128 module width patterns (values 0..106)
// Each entry is 6 digits representing [bar1, space1, bar2, space2, bar3, space3] (Stop 106 has 7 digits)
export const CODE128_PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const PATTERN_TO_VALUE = new Map<string, number>();
const NUMERIC_PATTERNS: number[][] = [];
CODE128_PATTERNS.forEach((pat, idx) => {
  PATTERN_TO_VALUE.set(pat, idx);
  if (idx <= 105) {
    NUMERIC_PATTERNS.push(pat.split("").map((d) => Number(d)));
  }
});

/**
 * Matches 6 run lengths against Code 128 symbols 0..105 using exact lookup first,
 * followed by minimum L1 distance matching for slightly blurred/quantized bars.
 */
function matchCode128Symbol(runs: number[], offset: number, maxError = 1.45): number | null {
  if (offset + 5 >= runs.length) return null;
  const r0 = runs[offset];
  const r1 = runs[offset + 1];
  const r2 = runs[offset + 2];
  const r3 = runs[offset + 3];
  const r4 = runs[offset + 4];
  const r5 = runs[offset + 5];
  const sum = r0 + r1 + r2 + r3 + r4 + r5;
  if (sum <= 3) return null;

  const unit = sum / 11;
  const n0 = r0 / unit;
  const n1 = r1 / unit;
  const n2 = r2 / unit;
  const n3 = r3 / unit;
  const n4 = r4 / unit;
  const n5 = r5 / unit;

  // Reject wildly out-of-range bars
  if (n0 > 5.2 || n1 > 5.2 || n2 > 5.2 || n3 > 5.2 || n4 > 5.2 || n5 > 5.2) return null;
  if (n0 < 0.35 || n1 < 0.35 || n2 < 0.35 || n3 < 0.35 || n4 < 0.35 || n5 < 0.35) return null;

  const m0 = Math.max(1, Math.min(4, Math.round(n0)));
  const m1 = Math.max(1, Math.min(4, Math.round(n1)));
  const m2 = Math.max(1, Math.min(4, Math.round(n2)));
  const m3 = Math.max(1, Math.min(4, Math.round(n3)));
  const m4 = Math.max(1, Math.min(4, Math.round(n4)));
  const m5 = Math.max(1, Math.min(4, Math.round(n5)));

  if (m0 + m1 + m2 + m3 + m4 + m5 === 11) {
    const exact = PATTERN_TO_VALUE.get(`${m0}${m1}${m2}${m3}${m4}${m5}`);
    if (exact !== undefined && exact <= 105) {
      const err =
        Math.abs(n0 - m0) +
        Math.abs(n1 - m1) +
        Math.abs(n2 - m2) +
        Math.abs(n3 - m3) +
        Math.abs(n4 - m4) +
        Math.abs(n5 - m5);
      if (err <= maxError) return exact;
    }
  }

  // Nearest-neighbor L1 search across the 106 Code 128 symbols
  let bestVal: number | null = null;
  let bestErr = maxError;
  for (let idx = 0; idx < 106; idx++) {
    const p = NUMERIC_PATTERNS[idx];
    const err =
      Math.abs(n0 - p[0]) +
      Math.abs(n1 - p[1]) +
      Math.abs(n2 - p[2]) +
      Math.abs(n3 - p[3]) +
      Math.abs(n4 - p[4]) +
      Math.abs(n5 - p[5]);
    if (err < bestErr) {
      bestErr = err;
      bestVal = idx;
    }
  }
  return bestVal;
}

/**
 * Checks if 7 run lengths match the Code 128 Stop pattern (2331112, 13 modules)
 */
function isCode128Stop(runs: number[], offset: number): boolean {
  if (offset + 6 >= runs.length) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += runs[offset + i];
  if (sum <= 4) return false;
  const unit = sum / 13;
  const expected = [2, 3, 3, 1, 1, 1, 2];
  let error = 0;
  for (let i = 0; i < 7; i++) {
    const mod = runs[offset + i] / unit;
    if (mod < 0.35 || mod > 4.8) return false;
    error += Math.abs(mod - expected[i]);
  }
  return error < 2.1;
}

/**
 * Decodes a single 1D array of alternating bar/space run lengths (starting with a bar)
 */
export function decodeRunsAsCode128(runs: number[]): string | null {
  if (runs.length < 19) return null; // Start (6) + at least 1 char (6) + Checksum (6) + Stop (7)

  for (let startIdx = 0; startIdx <= runs.length - 19; startIdx += 2) {
    const startVal = matchCode128Symbol(runs, startIdx, 1.35);
    if (startVal !== 103 && startVal !== 104 && startVal !== 105) continue;

    const startSum =
      runs[startIdx] +
      runs[startIdx + 1] +
      runs[startIdx + 2] +
      runs[startIdx + 3] +
      runs[startIdx + 4] +
      runs[startIdx + 5];
    const startUnit = startSum / 11;

    // Verify quiet zone before start bar if not first run
    if (startIdx > 0) {
      const quietSpace = runs[startIdx - 1];
      if (quietSpace < startUnit * 3.5) continue;
    }

    const values: number[] = [startVal];
    let cursor = startIdx + 6;
    let foundStop = false;

    while (cursor + 6 < runs.length) {
      // Ensure symbol width stays consistent with the barcode's module size
      const symSum =
        runs[cursor] +
        runs[cursor + 1] +
        runs[cursor + 2] +
        runs[cursor + 3] +
        runs[cursor + 4] +
        runs[cursor + 5];
      if (symSum < startSum * 0.55 || symSum > startSum * 1.8) break;

      if (values.length >= 3 && isCode128Stop(runs, cursor)) {
        foundStop = true;
        break;
      }

      const sym = matchCode128Symbol(runs, cursor, 1.45);
      if (sym === null) break;
      values.push(sym);
      cursor += 6;
    }

    if (!foundStop || values.length < 3) continue;

    // Validate Code 128 Modulo 103 Checksum
    const receivedChecksum = values[values.length - 1];
    let calcSum = values[0];
    for (let i = 1; i < values.length - 1; i++) {
      calcSum += values[i] * i;
    }
    if (calcSum % 103 !== receivedChecksum) continue;

    // Decode symbols into string (supporting Code Set A, B & C switching)
    let mode: "A" | "B" | "C" = startVal === 103 ? "A" : startVal === 105 ? "C" : "B";
    let output = "";
    for (let i = 1; i < values.length - 1; i++) {
      const v = values[i];
      if (mode === "B") {
        if (v === 99) {
          mode = "C";
        } else if (v === 101) {
          mode = "A";
        } else if (v >= 0 && v <= 94) {
          output += String.fromCharCode(v + 32);
        }
      } else if (mode === "C") {
        if (v === 100) {
          mode = "B";
        } else if (v === 101) {
          mode = "A";
        } else if (v >= 0 && v <= 99) {
          output += String(v).padStart(2, "0");
        }
      } else if (mode === "A") {
        if (v === 100) {
          mode = "B";
        } else if (v === 99) {
          mode = "C";
        } else if (v >= 0 && v <= 63) {
          output += String.fromCharCode(v + 32);
        } else if (v >= 64 && v <= 95) {
          output += String.fromCharCode(v - 64);
        }
      }
    }

    const trimmed = output.trim();
    if (trimmed.length >= 2) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Extracts sub-pixel run lengths along a horizontal scanline by computing exact
 * linear-interpolated threshold crossing coordinates and taking their differences.
 * Always begins with a dark bar (`runs[0]` is a bar, `runs[1]` is a space, etc.).
 */
export function extractRunsFromRow(
  grayRow: Float32Array,
  width: number,
  threshold: number,
): number[] {
  const edges: number[] = [];
  let inBar = false;
  let started = false;

  for (let x = 0; x < width; x++) {
    const val = grayRow[x];
    const isDark = val < threshold;

    if (!started) {
      if (isDark) {
        started = true;
        inBar = true;
        if (x > 0) {
          const prev = grayRow[x - 1];
          const denom = prev - val;
          const frac = denom > 1e-3 ? Math.max(0, Math.min(1, (prev - threshold) / denom)) : 0.5;
          edges.push(x - 1 + frac);
        } else {
          edges.push(0);
        }
      }
      continue;
    }

    if (isDark !== inBar) {
      const prev = grayRow[x - 1];
      const denom = Math.abs(val - prev);
      const frac =
        denom > 1e-3 ? Math.max(0, Math.min(1, Math.abs(threshold - prev) / denom)) : 0.5;
      edges.push(x - 1 + frac);
      inBar = isDark;
    }
  }

  if (started) {
    edges.push(width);
  }

  const runs: number[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const len = edges[i + 1] - edges[i];
    if (len > 0) runs.push(len);
  }
  return runs;
}

/**
 * Extracts sub-pixel run lengths using a local moving-window adaptive threshold
 * to handle webcam glare, shadows, and uneven illumination across a label.
 */
function extractRunsAdaptive(
  grayRow: Float32Array,
  width: number,
  windowRadius: number,
  bias = 0,
): number[] {
  const prefix = new Float64Array(width + 1);
  for (let i = 0; i < width; i++) {
    prefix[i + 1] = prefix[i] + grayRow[i];
  }

  const diff = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const left = Math.max(0, x - windowRadius);
    const right = Math.min(width - 1, x + windowRadius);
    const localMean = (prefix[right + 1] - prefix[left]) / (right - left + 1);
    // diff[x] < 0 means darker than local neighborhood (bar)
    diff[x] = grayRow[x] - (localMean + bias);
  }

  return extractRunsFromRow(diff, width, 0);
}

/**
 * Applies a 1D unsharp mask along a scanline to restore 1-module bars blurred by
 * webcam optics or JPEG compression.
 */
function sharpenRow1D(src: Float32Array, width: number, amount = 0.85): Float32Array {
  const out = new Float32Array(width);
  out[0] = src[0];
  out[width - 1] = src[width - 1];
  for (let x = 1; x < width - 1; x++) {
    const laplacian = src[x] * 2 - src[x - 1] - src[x + 1];
    out[x] = Math.max(0, Math.min(255, src[x] + amount * laplacian));
  }
  return out;
}

/**
 * Attempts to decode a single 1D grayscale row (and its sharpened + reversed variants)
 */
function tryDecodeRowSignal(grayRow: Float32Array, width: number): string | null {
  let minLum = 255;
  let maxLum = 0;
  for (let x = 0; x < width; x++) {
    const v = grayRow[x];
    if (v < minLum) minLum = v;
    if (v > maxLum) maxLum = v;
  }
  if (maxLum - minLum < 28) return null;

  const sharpRow = sharpenRow1D(grayRow, width, 0.9);
  const revRow = new Float32Array(width);
  const revSharp = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    revRow[x] = grayRow[width - 1 - x];
    revSharp[x] = sharpRow[width - 1 - x];
  }

  // 1. Global thresholds on raw and 1D-sharpened scanlines (normal + mirrored)
  for (const ratio of [0.5, 0.43, 0.57, 0.36, 0.64]) {
    const th = minLum + (maxLum - minLum) * ratio;

    const d1 = decodeRunsAsCode128(extractRunsFromRow(grayRow, width, th));
    if (d1) return d1;

    const d2 = decodeRunsAsCode128(extractRunsFromRow(sharpRow, width, th));
    if (d2) return d2;

    const d3 = decodeRunsAsCode128(extractRunsFromRow(revRow, width, th));
    if (d3) return d3;

    const d4 = decodeRunsAsCode128(extractRunsFromRow(revSharp, width, th));
    if (d4) return d4;
  }

  // 2. Local moving-window adaptive thresholding (handles screen glare, shadows & dark UI borders)
  for (const radius of [14, 24]) {
    const a1 = decodeRunsAsCode128(extractRunsAdaptive(sharpRow, width, radius, -2));
    if (a1) return a1;

    const a2 = decodeRunsAsCode128(extractRunsAdaptive(revSharp, width, radius, -2));
    if (a2) return a2;
  }

  return null;
}

/**
 * Scans an ImageData buffer across 60 horizontal scanlines (with vertical 3-row averaging
 * to suppress sensor noise) in both normal and mirrored orientations.
 */
export function scanImageDataForCode128(imageData: ImageData): string | null {
  const { data, width, height } = imageData;
  if (width < 40 || height < 5) return null;

  const numScanlines = Math.min(72, Math.max(24, Math.floor(height / 6)));
  const grayRow = new Float32Array(width);

  for (let s = 1; s < numScanlines; s++) {
    const yCenter = Math.floor((height * s) / numScanlines);
    const y0 = Math.max(0, yCenter - 1);
    const y2 = Math.min(height - 1, yCenter + 1);

    // Average 3 adjacent vertical rows to cancel webcam sensor grain
    for (let x = 0; x < width; x++) {
      const i0 = (y0 * width + x) * 4;
      const i1 = (yCenter * width + x) * 4;
      const i2 = (y2 * width + x) * 4;
      const lum0 = 0.299 * data[i0] + 0.587 * data[i0 + 1] + 0.114 * data[i0 + 2];
      const lum1 = 0.299 * data[i1] + 0.587 * data[i1 + 1] + 0.114 * data[i1 + 2];
      const lum2 = 0.299 * data[i2] + 0.587 * data[i2 + 1] + 0.114 * data[i2 + 2];
      grayRow[x] = (lum0 + lum1 * 2 + lum2) * 0.25;
    }

    const decoded = tryDecodeRowSignal(grayRow, width);
    if (decoded) return decoded;
  }

  return null;
}

/**
 * Runs Quagga2 over a data URL with multiple patch sizes
 */
async function runQuaggaOnDataUrl(dataUrl: string): Promise<string | null> {
  for (const patchSize of ["medium", "small", "large", "x-small"] as const) {
    try {
      const code = await new Promise<string | null>((resolve) => {
        Quagga.decodeSingle(
          {
            src: dataUrl,
            numOfWorkers: 0,
            locate: true,
            locator: {
              patchSize,
              halfSample: false,
            },
            decoder: {
              readers: ["code_128_reader", "code_39_reader", "ean_reader"],
            },
          },
          (result) => {
            if (result?.codeResult?.code) {
              resolve(String(result.codeResult.code).trim());
            } else {
              resolve(null);
            }
          },
        );
      });
      if (code) return code;
    } catch {}
  }
  return null;
}

/**
 * Decodes a barcode from an HTMLVideoElement, HTMLImageElement, or HTMLCanvasElement
 * using:
 * 1. Direct 1D Code 128 scanline pixel decoder (native resolution + 2x upscaled + mild rotations)
 * 2. Native BarcodeDetector (if supported by OS/browser)
 * 3. Quagga2 multi-scale locator
 */
export async function decodeBarcodeFromSource(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  fastMode = false,
): Promise<string | null> {
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // 1. Scan at native resolution with our exact Code 128 scanline decoder
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const fullData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);
  const directHit = scanImageDataForCode128(fullData);
  if (directHit) return directHit;

  // 2. Scan 2x upscaled (critical for full-screen screenshots where barcode bars are 1-2px wide)
  if (sourceWidth < 1800) {
    const upW = Math.min(2400, sourceWidth * 2);
    const upH = Math.min(2400, sourceHeight * 2);
    canvas.width = upW;
    canvas.height = upH;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, upW, upH);
    const upData = ctx.getImageData(0, 0, upW, upH);
    const upHit = scanImageDataForCode128(upData);
    if (upHit) return upHit;
  }

  // 3. Test slight rotation angles (±6 deg) for hand-held phone/label tilts
  for (const deg of [-6, 6, -12, 12]) {
    if (fastMode && Math.abs(deg) > 6) continue;
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    ctx.save();
    ctx.translate(sourceWidth / 2, sourceHeight / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(source, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
    ctx.restore();
    const rotData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);
    const rotHit = scanImageDataForCode128(rotData);
    if (rotHit) return rotHit;
  }

  // 4. Try Native Chromium BarcodeDetector if available
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    try {
      const detector = new (window as any).BarcodeDetector({
        formats: ["code_128", "code_39", "ean_13", "qr_code"],
      });
      const results = await detector.detect(source);
      if (results && results.length > 0 && results[0]?.rawValue) {
        return String(results[0].rawValue).trim();
      }
    } catch {}
  }

  // 5. In full image-upload mode (not fast live-video frame), also run Quagga2 multi-scale
  if (!fastMode) {
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
    const fullUrl = canvas.toDataURL("image/png");
    const quaggaFull = await runQuaggaOnDataUrl(fullUrl);
    if (quaggaFull) return quaggaFull;
  }

  return null;
}
