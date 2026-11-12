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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("default");
  const [cameraLoading, setCameraLoading] = useState<boolean>(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [continuousMode, setContinuousMode] = useState<boolean>(false);

  // Start / stop native WebRTC video stream + BarcodeDetector / canvas decoder loop
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    let activeStream: MediaStream | null = null;
    let scanTimer: ReturnType<typeof setInterval> | null = null;
    let isDecodingFrame = false;

    const stopAllTracks = () => {
      try {
        if (scanTimer) {
          clearInterval(scanTimer);
          scanTimer = null;
        }
        if (activeStream) {
          activeStream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {}
          });
          activeStream = null;
        }
        if (videoRef.current && videoRef.current.srcObject) {
          try {
            const s = videoRef.current.srcObject as MediaStream;
            s.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {}
            });
          } catch {}
          videoRef.current.srcObject = null;
        }
      } catch {}
    };

    const handleDetectedCode = (rawText: string) => {
      try {
        const cleaned = String(rawText ?? "").trim();
        if (!cleaned || !isMounted) return;

        const now = Date.now();
        if (now - lastScanTimeRef.current < 1600) return;
        lastScanTimeRef.current = now;

        setLastScanned(cleaned);
        onDetectedSku(cleaned);

        if (!continuousMode) {
          stopAllTracks();
          onClose();
        }
      } catch {}
    };

    const initCamera = async () => {
      try {
        stopAllTracks();
        setCameraLoading(true);
        setScanError(null);

        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera API is not available in this browser context.");
        }

        let stream: MediaStream | null = null;
        try {
          if (selectedCameraId && selectedCameraId !== "default") {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { exact: selectedCameraId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
              audio: false,
            });
          } else {
            // Try environment/back camera first, then standard webcam
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: {
                  facingMode: { ideal: "environment" },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
                audio: false,
              });
            } catch {
              stream = await navigator.mediaDevices.getUserMedia({
                video: {
                  facingMode: { ideal: "user" },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
                audio: false,
              });
            }
          }
        } catch {
          // Basic fallback constraint
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (!isMounted) {
          if (stream) {
            stream.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {}
            });
          }
          return;
        }

        activeStream = stream;

        if (videoRef.current && stream) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Populate camera dropdown without triggering a re-render loop
        try {
          if (navigator.mediaDevices.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((d) => d.kind === "videoinput");
            if (isMounted && videoInputs.length > 0) {
              setCameras(
                videoInputs.map((d, idx) => ({
                  id: d.deviceId || `cam-${idx}`,
                  label: d.label || `Camera ${idx + 1}`,
                })),
              );
            }
          }
        } catch {}

        if (!isMounted) return;
        setCameraLoading(false);

        // Set up frame scanner (Native BarcodeDetector + Canvas fallback)
        let nativeDetector: any = null;
        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          try {
            nativeDetector = new (window as any).BarcodeDetector({
              formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "qr_code"],
            });
          } catch {
            nativeDetector = null;
          }
        }

        const offscreenCanvas = document.createElement("canvas");
        const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

        scanTimer = setInterval(async () => {
          if (!isMounted || isDecodingFrame) return;
          const videoEl = videoRef.current;
          if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;

          isDecodingFrame = true;
          try {
            // 1. Fast Chromium/Brave/Edge Native BarcodeDetector
            if (nativeDetector) {
              try {
                const detected = await nativeDetector.detect(videoEl);
                if (detected && detected.length > 0 && detected[0]?.rawValue) {
                  handleDetectedCode(detected[0].rawValue);
                  isDecodingFrame = false;
                  return;
                }
              } catch {}
            }

            // 2. Canvas frame snapshot fallback via Html5Qrcode.scanFile
            if (offscreenCtx) {
              const vw = videoEl.videoWidth;
              const vh = videoEl.videoHeight;
              offscreenCanvas.width = vw;
              offscreenCanvas.height = vh;
              offscreenCtx.drawImage(videoEl, 0, 0, vw, vh);

              const blob: Blob | null = await new Promise((resolve) =>
                offscreenCanvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
              );
              if (blob && isMounted) {
                const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
                const tempEl = document.getElementById("pos-barcode-file-temp");
                if (tempEl) {
                  const fileScanner = new Html5Qrcode("pos-barcode-file-temp", {
                    formatsToSupport: SUPPORTED_BARCODE_FORMATS,
                    verbose: false,
                  });
                  try {
                    const decoded = await fileScanner.scanFile(file, false);
                    if (decoded && decoded.trim()) {
                      handleDetectedCode(decoded.trim());
                    }
                  } catch {
                    // No barcode in this frame
                  } finally {
                    try {
                      fileScanner.clear();
                    } catch {}
                  }
                }
              }
            }
          } catch {}
          isDecodingFrame = false;
        }, 250);
      } catch (err: any) {
        if (!isMounted) return;
        setCameraLoading(false);
        const msg = String(err?.message || "").toLowerCase();
        if (msg.includes("permission") || msg.includes("denied") || err?.name === "NotAllowedError") {
          setScanError(
            "Camera permission was denied. Please allow camera access in your browser address bar, or click 'Scan Barcode Image' below.",
          );
        } else {
          setScanError(
            "Could not start camera stream (camera may be in use by another app). You can also click 'Scan Barcode Image' below.",
          );
        }
      }
    };

    initCamera();

    return () => {
      isMounted = false;
      stopAllTracks();
    };
  }, [isOpen, selectedCameraId, continuousMode]);

  // Scan barcode from an uploaded image or screenshot file
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      // 1. Try native BarcodeDetector first
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
        } catch {}
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
        "Could not read a barcode from that image. Try using 'Save Barcode PNG' from the Product Barcode Label window.",
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
            <span className="font-mono text-yellow-300">MS-000001</span>), or upload a saved barcode PNG.
          </DialogDescription>
        </DialogHeader>

        {/* Camera Selector & Continuous Mode Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {cameras.length > 1 ? (
            <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
              <SelectTrigger className="h-8 text-xs bg-[#1c1c28] border-[#2e2e40] text-zinc-200 w-[210px]">
                <SelectValue placeholder="Default Camera" />
              </SelectTrigger>
              <SelectContent className="bg-[#1c1c28] border-[#2e2e40] text-zinc-100">
                <SelectItem value="default" className="text-xs">
                  Auto / Default Camera
                </SelectItem>
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

        {/* Live Camera Viewfinder (React-managed <video> prevents DOM mutation crashes) */}
        <div className="relative rounded-xl overflow-hidden bg-black border border-[#2d2d3d] h-[240px] flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Aiming Reticle Overlay */}
          {!cameraLoading && !scanError && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="w-[260px] h-[100px] rounded-lg border-2 border-yellow-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] relative flex items-center justify-center">
                <div className="w-full h-[1.5px] bg-red-500/80 animate-pulse" />
              </div>
              <span className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-yellow-300 bg-black/70 px-2.5 py-0.5 rounded-full">
                Align barcode inside box
              </span>
            </div>
          )}

          <div id="pos-barcode-file-temp" className="hidden" />

          {cameraLoading && !scanError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-zinc-300 text-xs gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-yellow-400" />
              <span>Starting camera barcode scanner...</span>
            </div>
          )}

          {scanError && (
            <div className="absolute inset-0 bg-[#12121a] p-5 flex flex-col items-center justify-center text-center space-y-2">
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
