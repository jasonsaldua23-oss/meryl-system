import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Copy, Printer, Check, Tag } from "lucide-react";
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
  category?: string;
}

interface BarcodeLabelModalProps {
  product: BarcodeLabelProduct | null;
  isOpen: boolean;
  onClose: () => void;
}

export function BarcodeLabelModal({ product, isOpen, onClose }: BarcodeLabelModalProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [printCopies, setPrintCopies] = useState<number>(1);

  const displaySku = formatSkuDisplay(product?.sku, "MS-000000");

  useEffect(() => {
    if (isOpen && product?.sku && svgRef.current) {
      try {
        JsBarcode(svgRef.current, product.sku, {
          format: "CODE128",
          width: 2,
          height: 48,
          displayValue: true,
          font: "monospace",
          fontSize: 13,
          textMargin: 4,
          margin: 6,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch (err: any) {
        console.error("JsBarcode render error:", err);
      }
    }
  }, [isOpen, product?.sku]);

  const handleCopySku = () => {
    if (!product?.sku) return;
    navigator.clipboard?.writeText(product.sku).then(
      () => {
        setCopied(true);
        toast.success(`Copied SKU: ${product.sku}`);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("Could not copy SKU to clipboard"),
    );
  };

  const handlePrint = () => {
    if (!product) return;
    const printWindow = window.open("", "_blank", "width=600,height=500");
    if (!printWindow) {
      toast.error("Please allow popups to print barcode labels");
      return;
    }

    const svgHtml = svgRef.current?.outerHTML ?? "";
    const copies = Math.max(1, Math.min(50, printCopies || 1));
    const labelsHtml = Array.from({ length: copies })
      .map(
        () => `
        <div class="label-card">
          <div class="header">
            <span class="store-name">MERYL SHOES</span>
            <span class="department">${product.gender || "Unisex"}</span>
          </div>
          <div class="product-title">${product.name}</div>
          <div class="product-meta">
            <span><strong>Brand:</strong> ${product.brand || "Meryl"}</span>
            <span><strong>Color:</strong> ${product.color || "Default"}</span>
            <span><strong>Size:</strong> ${product.size || "N/A"}</span>
          </div>
          <div class="price">PHP ${(Number(product.price) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="barcode-container">
            ${svgHtml}
          </div>
          <div class="footer">Internal Inventory Code 128</div>
        </div>
      `,
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Meryl Shoes - Print Barcode Label (${product.sku})</title>
          <style>
            @page {
              size: auto;
              margin: 4mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              padding: 10px;
              background: #fff;
              color: #000;
            }
            .labels-grid {
              display: flex;
              flex-wrap: wrap;
              gap: 8mm;
              justify-content: flex-start;
            }
            .label-card {
              width: 58mm;
              min-height: 40mm;
              padding: 3mm 4mm;
              border: 1px dashed #666;
              box-sizing: border-box;
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              page-break-inside: avoid;
            }
            .header {
              width: 100%;
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1.5px solid #000;
              padding-bottom: 1.5mm;
              margin-bottom: 1.5mm;
            }
            .store-name {
              font-weight: 900;
              font-size: 11pt;
              letter-spacing: 0.5px;
            }
            .department {
              font-size: 8pt;
              text-transform: uppercase;
              font-weight: 700;
            }
            .product-title {
              font-size: 9pt;
              font-weight: 700;
              max-width: 100%;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-bottom: 1mm;
            }
            .product-meta {
              font-size: 7.5pt;
              display: flex;
              gap: 4px;
              justify-content: center;
              margin-bottom: 1.5mm;
            }
            .price {
              font-size: 11pt;
              font-weight: 900;
              margin-bottom: 1mm;
            }
            .barcode-container svg {
              max-width: 52mm;
              height: auto;
              max-height: 22mm;
            }
            .footer {
              font-size: 6pt;
              color: #555;
              text-transform: uppercase;
              margin-top: 1mm;
            }
            @media print {
              .label-card {
                border: 1px solid #ccc;
              }
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
            Official internal Code 128 barcode for Meryl Shoes retail inventory &amp; POS scanning.
          </DialogDescription>
        </DialogHeader>

        {/* Physical Label Preview */}
        <div className="my-3 flex justify-center">
          <div className="w-[300px] bg-white text-black p-4 rounded-xl border border-zinc-300 shadow-md flex flex-col items-center select-none">
            {/* Header */}
            <div className="w-full flex justify-between items-center border-b-2 border-black pb-1 mb-2">
              <span className="font-extrabold tracking-wider text-xs text-red-600">MERYL SHOES</span>
              <span className="text-[10px] font-bold text-zinc-700 uppercase">{product.gender || "Unisex"}</span>
            </div>

            {/* Title & Brand */}
            <div className="font-bold text-xs text-center line-clamp-1 w-full">{product.name}</div>
            <div className="text-[10px] text-zinc-600 flex gap-2 mt-0.5">
              <span>{product.brand || "Meryl"}</span>
              <span>•</span>
              <span>{product.color || "Default"}</span>
              <span>•</span>
              <span className="font-semibold text-black">Size {product.size || "N/A"}</span>
            </div>

            {/* Price */}
            <div className="text-sm font-extrabold text-black my-1">
              PHP {(Number(product.price) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>

            {/* Barcode SVG */}
            <div className="w-full flex justify-center py-1">
              <svg ref={svgRef} className="max-w-full h-auto" />
            </div>

            <div className="text-[9px] text-zinc-500 uppercase tracking-widest mt-0.5">
              Code 128 • Store Standard
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
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-[#38384a] bg-transparent text-zinc-300 hover:bg-[#222230] text-xs h-9"
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={handlePrint}
            className="bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold text-xs h-9 flex items-center gap-1.5 shadow"
          >
            <Printer className="w-4 h-4" />
            Print {printCopies} Label{printCopies > 1 ? "s" : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

