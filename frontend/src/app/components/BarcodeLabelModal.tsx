import { useCallback, useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Copy, Printer, Check, Tag, Download } from "lucide-react";
import { toast } from "sonner";
import { formatSkuDisplay } from "../../lib/sku";

export interface BarcodeLabelProduct {
  sku: string;
  name: string;
  brand?: string;
  color?: string;
  size?: string;
  gender?: string;
  price?: number;
  srp?: number;
  unit_price?: number;
  category?: string;
}

interface BarcodeLabelModalProps {
  product: BarcodeLabelProduct | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Helper to derive realistic US / UK / CM shoebox size conversions from EU size
 * so the label looks like an authentic retail footwear box sticker.
 */
function getShoeSizeConversions(sizeRaw: string | undefined, genderRaw: string | undefined) {
  const euNum = Number(String(sizeRaw ?? "").trim());
  if (!Number.isFinite(euNum) || euNum < 20 || euNum > 55) {
    return {
      eu: sizeRaw || "N/A",
      us: "—",
      uk: "—",
      cm: "—",
    };
  }
  const isWomen = String(genderRaw ?? "").toLowerCase().includes("women");
  const isKids = String(genderRaw ?? "").toLowerCase().includes("kid");

  let us: number;
  let uk: number;
  if (isKids || euNum <= 34) {
    us = Number((euNum - 18.5).toFixed(1));
    uk = Number((euNum - 19.5).toFixed(1));
  } else if (isWomen) {
    us = Number((euNum - 30.5).toFixed(1));
    uk = Number((euNum - 32.5).toFixed(1));
  } else {
    us = Number((euNum - 33).toFixed(1));
    uk = Number((euNum - 34).toFixed(1));
  }
  const cm = Number((euNum * 0.666 - 1.5).toFixed(1));

  return {
    eu: String(euNum),
    us: String(us).replace(/\.0$/, ""),
    uk: String(uk).replace(/\.0$/, ""),
    cm: String(cm),
  };
}

export function BarcodeLabelModal({ product, isOpen, onClose }: BarcodeLabelModalProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [printCopies, setPrintCopies] = useState<number>(1);

  const displaySku = formatSkuDisplay(product?.sku, "MS-000001");

  // Resolve actual selling price (SRP first, then price, then unit_price * 1.25 fallback)
  const effectivePrice = Number(
    (product?.srp && product.srp > 0 ? product.srp : null) ??
      (product?.price && product.price > 0 ? product.price : null) ??
      (product?.unit_price && product.unit_price > 0 ? product.unit_price : 0),
  );

  const formattedPrice = `PHP ${effectivePrice.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const sizeInfo = getShoeSizeConversions(product?.size, product?.gender);

  const drawBarcode = useCallback(
    (node: SVGSVGElement | null) => {
      if (!node || !displaySku) return;
      try {
        JsBarcode(node, displaySku, {
          format: "CODE128",
          width: 2.1,
          height: 54,
          displayValue: true,
          text: displaySku,
          font: "monospace",
          fontOptions: "bold",
          fontSize: 13,
          textMargin: 4,
          margin: 4,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch (err) {
        console.error("JsBarcode render error:", err);
      }
    },
    [displaySku],
  );

  // Callback ref guarantees barcode renders the instant Radix Dialog mounts its portal
  const setSvgNode = useCallback(
    (node: SVGSVGElement | null) => {
      svgRef.current = node;
      if (node) {
        drawBarcode(node);
      }
    },
    [drawBarcode],
  );

  useEffect(() => {
    if (isOpen && svgRef.current) {
      drawBarcode(svgRef.current);
    }
  }, [isOpen, displaySku, drawBarcode]);

  const handleCopySku = () => {
    if (!displaySku) return;
    navigator.clipboard?.writeText(displaySku).then(
      () => {
        setCopied(true);
        toast.success(`Copied SKU: ${displaySku}`);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("Could not copy SKU to clipboard"),
    );
  };

  const handlePrint = () => {
    if (!product) return;
    const printWindow = window.open("", "_blank", "width=720,height=600");
    if (!printWindow) {
      toast.error("Please allow popups to print barcode labels");
      return;
    }

    const svgHtml = svgRef.current?.outerHTML ?? "";
    const copies = Math.max(1, Math.min(50, printCopies || 1));
    const labelsHtml = Array.from({ length: copies })
      .map(
        () => `
        <div class="shoebox-sticker">
          <div class="top-band">
            <span class="brand-store">MERYL SHOES</span>
            <span class="dept-pill">${(product.gender || "UNISEX").toUpperCase()} • ${(product.category || "FOOTWEAR").toUpperCase()}</span>
          </div>
          <div class="middle-grid">
            <div class="size-column">
              <div class="eu-label">EU SIZE</div>
              <div class="eu-number">${sizeInfo.eu}</div>
              <div class="sub-sizes">
                <div><span>US</span><strong>${sizeInfo.us}</strong></div>
                <div><span>UK</span><strong>${sizeInfo.uk}</strong></div>
                <div><span>CM</span><strong>${sizeInfo.cm}</strong></div>
              </div>
            </div>
            <div class="details-column">
              <div class="model-name">${product.name}</div>
              <div class="meta-line">BRAND: <strong>${(product.brand || "MERYL").toUpperCase()}</strong></div>
              <div class="meta-line">COLOR: <strong>${(product.color || "STANDARD").toUpperCase()}</strong></div>
              <div class="meta-line">STYLE SKU: <strong>${displaySku}</strong></div>
              <div class="price-box">
                <span class="srp-tag">SRP</span>
                <span class="srp-val">${formattedPrice}</span>
              </div>
            </div>
          </div>
          <div class="barcode-zone">
            ${svgHtml}
          </div>
        </div>
      `,
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Meryl Shoes - Retail Box Barcode (${displaySku})</title>
          <style>
            @page {
              size: auto;
              margin: 5mm;
            }
            body {
              font-family: "Arial Narrow", Arial, Helvetica, sans-serif;
              margin: 0;
              padding: 12px;
              background: #ffffff;
              color: #000000;
            }
            .labels-grid {
              display: flex;
              flex-wrap: wrap;
              gap: 6mm;
              justify-content: flex-start;
            }
            .shoebox-sticker {
              width: 82mm;
              border: 2px solid #000;
              border-radius: 4px;
              background: #fff;
              color: #000;
              overflow: hidden;
              box-sizing: border-box;
              page-break-inside: avoid;
            }
            .top-band {
              background: #000;
              color: #fff;
              padding: 3px 8px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 8pt;
              font-weight: 800;
              letter-spacing: 0.5px;
            }
            .middle-grid {
              display: flex;
              border-bottom: 1.5px solid #000;
            }
            .size-column {
              width: 26mm;
              border-right: 1.5px solid #000;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 4px;
              background: #f7f7f7;
            }
            .eu-label {
              font-size: 7pt;
              font-weight: 800;
              letter-spacing: 0.5px;
            }
            .eu-number {
              font-size: 24pt;
              font-weight: 900;
              line-height: 1;
              margin: 2px 0 4px;
            }
            .sub-sizes {
              width: 100%;
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              border-top: 1px solid #000;
              padding-top: 2px;
              font-size: 6.5pt;
              text-align: center;
            }
            .sub-sizes span {
              display: block;
              color: #444;
              font-size: 5.5pt;
            }
            .details-column {
              flex: 1;
              padding: 5px 8px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            .model-name {
              font-size: 10pt;
              font-weight: 900;
              text-transform: uppercase;
              line-height: 1.15;
              margin-bottom: 3px;
            }
            .meta-line {
              font-size: 7.5pt;
              color: #222;
              line-height: 1.3;
            }
            .price-box {
              margin-top: 4px;
              padding-top: 3px;
              border-top: 1px dashed #000;
              display: flex;
              justify-content: space-between;
              align-items: baseline;
            }
            .srp-tag {
              font-size: 7pt;
              font-weight: 800;
              background: #000;
              color: #fff;
              padding: 1px 4px;
            }
            .srp-val {
              font-size: 11pt;
              font-weight: 900;
            }
            .barcode-zone {
              padding: 4px 6px 2px;
              display: flex;
              justify-content: center;
              align-items: center;
              background: #fff;
            }
            .barcode-zone svg {
              max-width: 100%;
              height: auto;
              max-height: 20mm;
            }
          </style>
        </head>
        <body>
          <div class="labels-grid">
            ${labelsHtml}
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 750);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadPng = () => {
    if (!svgRef.current) return;
    try {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgRef.current);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(600, img.width * 2);
        canvas.height = Math.max(260, img.height * 2 + 40);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const x = (canvas.width - img.width * 1.8) / 2;
          const y = (canvas.height - img.height * 1.8) / 2;
          ctx.drawImage(img, x, y, img.width * 1.8, img.height * 1.8);
          const pngUrl = canvas.toDataURL("image/png");
          const a = document.createElement("a");
          a.href = pngUrl;
          a.download = `${displaySku}-barcode.png`;
          a.click();
          toast.success(`Downloaded ${displaySku}-barcode.png`);
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch {
      toast.error("Could not download barcode image");
    }
  };

  if (!product) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-[#16161f] border border-[#2e2e3d] text-white p-6 shadow-2xl rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-yellow-400">
            <Tag className="w-5 h-5" />
            <DialogTitle className="text-lg font-bold text-white">Product Barcode Label</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-zinc-400">
            Official retail shoebox Code 128 barcode sticker for Meryl Shoes inventory &amp; POS scanning.
          </DialogDescription>
        </DialogHeader>

        {/* Authentic Retail Shoebox Sticker Preview (inline styles bypass dark-theme .bg-white override) */}
        <div className="my-2 flex justify-center">
          <div
            style={{ backgroundColor: "#ffffff", color: "#000000", borderColor: "#111111" }}
            className="w-full max-w-[360px] rounded-lg border-2 shadow-xl overflow-hidden select-none"
          >
            {/* Top Black Brand Header Band */}
            <div
              style={{ backgroundColor: "#111111", color: "#ffffff" }}
              className="px-3 py-1.5 flex items-center justify-between"
            >
              <span className="font-black tracking-wider text-xs" style={{ color: "#facc15" }}>
                MERYL SHOES
              </span>
              <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "#e4e4e7" }}>
                {product.gender || "Unisex"} • {product.category || "Footwear"}
              </span>
            </div>

            {/* Middle Split: Left Big Size Box + Right Style & SRP Info */}
            <div className="flex" style={{ borderBottom: "2px solid #111111" }}>
              {/* Left Column: Authentic Shoebox EU/US/UK/CM Size Block */}
              <div
                style={{ backgroundColor: "#f4f4f5", borderRight: "2px solid #111111", color: "#000000" }}
                className="w-[108px] shrink-0 p-2 flex flex-col items-center justify-between text-center"
              >
                <span className="text-[10px] font-extrabold tracking-wider uppercase" style={{ color: "#3f3f46" }}>
                  EU SIZE
                </span>
                <span className="text-4xl font-black leading-none my-1" style={{ color: "#000000" }}>
                  {sizeInfo.eu}
                </span>
                <div
                  style={{ borderTop: "1.5px solid #111111" }}
                  className="w-full pt-1 grid grid-cols-3 gap-0.5 text-[10px]"
                >
                  <div>
                    <span className="block text-[8px] font-bold" style={{ color: "#52525b" }}>US</span>
                    <strong className="font-black" style={{ color: "#000000" }}>{sizeInfo.us}</strong>
                  </div>
                  <div style={{ borderLeft: "1px solid #d4d4d8", borderRight: "1px solid #d4d4d8" }}>
                    <span className="block text-[8px] font-bold" style={{ color: "#52525b" }}>UK</span>
                    <strong className="font-black" style={{ color: "#000000" }}>{sizeInfo.uk}</strong>
                  </div>
                  <div>
                    <span className="block text-[8px] font-bold" style={{ color: "#52525b" }}>CM</span>
                    <strong className="font-black" style={{ color: "#000000" }}>{sizeInfo.cm}</strong>
                  </div>
                </div>
              </div>

              {/* Right Column: Shoe Model, Brand, Colorway & Retail Price */}
              <div
                style={{ backgroundColor: "#ffffff", color: "#000000" }}
                className="flex-1 p-2.5 flex flex-col justify-between min-w-0"
              >
                <div>
                  <div
                    className="font-black text-sm uppercase leading-tight truncate"
                    style={{ color: "#000000" }}
                    title={product.name}
                  >
                    {product.name}
                  </div>
                  <div className="mt-1 space-y-0.5 text-[11px]" style={{ color: "#27272a" }}>
                    <div className="truncate">
                      <span className="font-semibold" style={{ color: "#52525b" }}>BRAND: </span>
                      <span className="font-bold uppercase" style={{ color: "#000000" }}>{product.brand || "Meryl"}</span>
                    </div>
                    <div className="truncate">
                      <span className="font-semibold" style={{ color: "#52525b" }}>COLOR: </span>
                      <span className="font-bold uppercase" style={{ color: "#000000" }}>{product.color || "Standard"}</span>
                    </div>
                    <div className="truncate">
                      <span className="font-semibold" style={{ color: "#52525b" }}>SKU: </span>
                      <span className="font-mono font-bold" style={{ color: "#000000" }}>{displaySku}</span>
                    </div>
                  </div>
                </div>

                {/* Perforated Retail Price Tag Strip */}
                <div
                  style={{ borderTop: "1.5px dashed #71717a" }}
                  className="mt-2 pt-1.5 flex items-center justify-between"
                >
                  <span
                    style={{ backgroundColor: "#111111", color: "#ffffff" }}
                    className="text-[9px] font-black px-1.5 py-0.5 rounded-sm tracking-wider uppercase"
                  >
                    RETAIL SRP
                  </span>
                  <span className="text-base font-black tracking-tight" style={{ color: "#000000" }}>
                    {formattedPrice}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Full-Width Scannable Code 128 Barcode Zone */}
            <div
              style={{ backgroundColor: "#ffffff", color: "#000000" }}
              className="px-3 pt-2 pb-1.5 flex flex-col items-center justify-center"
            >
              <svg ref={setSvgNode} className="w-full max-w-[310px] h-auto" />
              <div
                className="w-full flex justify-between items-center text-[9px] font-bold uppercase tracking-widest px-1 mt-0.5"
                style={{ color: "#52525b" }}
              >
                <span>CODE 128 • POS SCAN READY</span>
                <span>MERYL SHOES BACOLOD</span>
              </div>
            </div>
          </div>
        </div>

        {/* SKU Details & Actions */}
        <div className="bg-[#121218] border border-[#272736] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Official SKU:</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-yellow-300 text-sm">{displaySku}</span>
              <button
                type="button"
                onClick={handleCopySku}
                className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition"
                title="Copy SKU"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-[#20202e]">
            <span className="text-zinc-400">Print Quantity:</span>
            <div className="flex items-center gap-2">
              {[1, 2, 5, 10].map((qty) => (
                <button
                  key={qty}
                  type="button"
                  onClick={() => setPrintCopies(qty)}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                    printCopies === qty
                      ? "bg-yellow-400 text-red-950"
                      : "bg-[#20202e] text-zinc-300 hover:bg-[#2b2b3d]"
                  }`}
                >
                  {qty}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadPng}
            className="border-[#2e2e3d] bg-[#1e1e2a] text-yellow-300 hover:bg-[#2a2a3a] flex items-center gap-1.5 text-xs"
            title="Download barcode as PNG to test with camera or file scanner"
          >
            <Download className="w-3.5 h-3.5" />
            Save Barcode PNG
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-[#2e2e3d] bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handlePrint}
              className="bg-yellow-400 hover:bg-yellow-500 text-red-950 font-bold flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Print {printCopies > 1 ? `${printCopies} Labels` : "1 Label"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
