import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Camera, Upload, RefreshCw, AlertCircle, CheckCircle2, Barcode } from "lucide-react";
import { toast } from "sonner";

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetectedSku: (sku: string) => void;
}

const SUPPORTED_BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.QR_CODE,
];

export function CameraBarcodeScannerModal({
  isOpen,
  onClose,
  onDetectedSku,
}: CameraBarcodeScannerModalProps) {
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [cameraLoading, setCameraLoading] = useState<boolean>(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [continuousMode, setContinuousMode] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  // Enumerate cameras when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (!active) return;
        if (devices && devices.length > 0) {
          setCameras(
            devices.map((d, idx) => ({
              id: d.id,
              label: d.label || `Camera ${idx + 1}`,
            })),
          );
          if (!selectedCameraId) {
            // Prefer rear/environment camera if available
            const backCam = devices.find((d) =>
              /back|rear|environment/i.test(d.label || ""),
            );
            setSelectedCameraId(backCam ? backCam.id : devices[0].id);
          }
        }
      })
      .catch(() => {
        // Will fallback to facingMode constraints
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  // Start / stop live camera barcode scanner
  useEffect(() => {
    if (!isOpen) return;

    let html5Scanner: Html5Qrcode | null = null;
    let isMounted = true;

    const handleDecode = (decodedText: string) => {
      const cleaned = String(decodedText ?? "").trim();
      if (!cleaned) return;

      const now = Date.now();
      // Debounce duplicate frames within 1.8s
      if (now - lastScanTimeRef.current < 1800) return;
      lastScanTimeRef.current = now;

      setLastScanned(cleaned);
      onDetectedSku(cleaned);

      if (!continuousMode) {
        onClose();
      }
    };

    const startScanner = async () => {
      setCameraLoading(true);
      setScanError(null);

      // Wait briefly for Dialog portal DOM node #pos-barcode-camera-reader to mount
      await new Promise((r) => setTimeout(r, 150));
      if (!isMounted) return;

      const container = document.getElementById("pos-barcode-camera-reader");
      if (!container) {
        setCameraLoading(false);
        return;
      }

      try {
        const scanner = new Html5Qrcode("pos-barcode-camera-reader", {
          formatsToSupport: SUPPORTED_BARCODE_FORMATS,
          verbose: false,
        });
        html5Scanner = scanner;

        const config = {
          fps: 15,
          qrbox: { width: 280, height: 120 },
          aspectRatio: 1.5,
        };

        if (selectedCameraId) {
          await scanner.start(
            selectedCameraId,
            config,
            (text) => handleDecode(text),
            () => {},
          );
        } else {
          try {
            await scanner.start(
              { facingMode: "environment" },
              config,
              (text) => handleDecode(text),
              () => {},
            );
          } catch {
            try {
              scanner.clear();
            } catch {}
            const fallbackScanner = new Html5Qrcode("pos-barcode-camera-reader", {
              formatsToSupport: SUPPORTED_BARCODE_FORMATS,
              verbose: false,
            });
            html5Scanner = fallbackScanner;
            await fallbackScanner.start(
              { facingMode: "user" },
              config,
              (text) => handleDecode(text),
              () => {},
            );
          }
        }

        if (!isMounted) {
          await scanner.stop().catch(() => {});
          try {
            scanner.clear();
          } catch {}
          return;
        }
        setCameraLoading(false);
      } catch (err: any) {
        if (!isMounted) return;
        console.warn("Camera barcode scanner error:", err);
        setCameraLoading(false);
        setScanError(
          "Could not access camera. Please allow browser camera permission or use 'Scan Barcode Image' below.",
        );
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      if (html5Scanner) {
        html5Scanner
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              html5Scanner?.clear();
            } catch {}
          });
      }
    };
  }, [isOpen, selectedCameraId, continuousMode]);

  // Scan barcode from an uploaded image or screenshot file
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      // 1. Try native BarcodeDetector if supported by Chromium/Edge
      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: ["code_128", "code_39", "ean_13", "qr_code"],
          });
          const bitmap = await createImageBitmap(file);
          const results = await detector.detect(bitmap);
          if (results && results.length > 0 && results[0].rawValue) {
            const code = String(results[0].rawValue).trim();
            setLastScanned(code);
            onDetectedSku(code);
            if (!continuousMode) onClose();
            return;
          }
        } catch {
          // Continue to Html5Qrcode fallback
        }
      }

      // 2. Fallback to Html5Qrcode file scanner
      const fileScanner = new Html5Qrcode("pos-barcode-file-temp", {
        formatsToSupport: SUPPORTED_BARCODE_FORMATS,
        verbose: false,
      });
      const decodedText = await fileScanner.scanFile(file, false);
      try {
        fileScanner.clear();
      } catch {}

      if (decodedText && decodedText.trim()) {
        const code = decodedText.trim();
        setLastScanned(code);
        onDetectedSku(code);
        if (!continuousMode) onClose();
        return;
      }

      toast.error("No Code 128 barcode detected in the selected image.");
    } catch {
      toast.error(
        "Could not read a barcode from that image. Try cropping closer to the barcode bars or holding the label steady.",
      );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-[#15151d] border border-[#2a2a3a] text-white p-5 shadow-2xl rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-yellow-400">
            <Camera className="w-5 h-5" />
            <DialogTitle className="text-base font-bold text-white">
              Camera Barcode Scanner (Code 128)
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-zinc-400">
            Point your webcam or phone camera at a Meryl Shoes Code 128 barcode label (e.g.{" "}
            <span className="font-mono text-yellow-300">MS-000001</span>), or upload a label image to scan immediately.
          </DialogDescription>
        </DialogHeader>

        {/* Camera Selector & Continuous Mode Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {cameras.length > 1 ? (
            <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
              <SelectTrigger className="h-8 text-xs bg-[#1c1c28] border-[#2e2e40] text-zinc-200 w-[210px]">
                <SelectValue placeholder="Select Camera" />
              </SelectTrigger>
              <SelectContent className="bg-[#1c1c28] border-[#2e2e40] text-zinc-100">
                {cameras.map((cam) => (
                  <SelectItem key={cam.id} value={cam.id} className="text-xs">
                    {cam.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <Barcode className="w-3.5 h-3.5 text-yellow-400" />
              Supports Code 128, EAN-13 &amp; SKU Barcodes
            </span>
          )}

          <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={continuousMode}
              onChange={(e) => setContinuousMode(e.target.checked)}
              className="rounded accent-yellow-400"
            />
            Keep open for multiple scans
          </label>
        </div>

        {/* Live Camera Viewfinder */}
        <div className="relative rounded-xl overflow-hidden bg-black border border-[#2d2d3d] min-h-[230px] flex items-center justify-center">
          <div id="pos-barcode-camera-reader" className="w-full" />
          <div id="pos-barcode-file-temp" className="hidden" />

          {cameraLoading && !scanError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-zinc-300 text-xs gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-yellow-400" />
              <span>Starting camera barcode scanner...</span>
            </div>
          )}

          {scanError && (
            <div className="p-5 text-center space-y-2">
              <AlertCircle className="w-7 h-7 text-red-400 mx-auto" />
              <p className="text-xs text-red-300">{scanError}</p>
            </div>
          )}
        </div>

        {/* Last Scanned Feedback */}
        {lastScanned && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-950/50 border border-emerald-500/30 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Last scanned barcode:
            </span>
            <span className="font-mono font-bold text-yellow-300">{lastScanned}</span>
          </div>
        )}

        {/* Footer Actions: Upload Barcode Image or Close */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="border-[#34344a] bg-[#1c1c28] text-yellow-300 hover:bg-[#252536] text-xs h-9"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Scan Barcode Image / Screenshot
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="text-zinc-300 hover:text-white text-xs h-9"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
