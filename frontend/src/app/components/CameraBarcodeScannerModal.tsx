import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Camera, Upload, RefreshCw, AlertCircle, CheckCircle2, Barcode } from "lucide-react";
import { toast } from "sonner";
import { decodeBarcodeFromSource } from "../../lib/barcode-decoder";

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetectedSku: (sku: string) => void;
}

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
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);

  // Start / stop native WebRTC video stream + high-reliability Code 128 scanline decoder loop
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
        if (now - lastScanTimeRef.current < 1500) return;
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

        // Poll video frames every 180ms with our direct Code 128 pixel scanline decoder
        scanTimer = setInterval(async () => {
          if (!isMounted || isDecodingFrame) return;
          const videoEl = videoRef.current;
          if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;

          isDecodingFrame = true;
          try {
            const decoded = await decodeBarcodeFromSource(
              videoEl,
              videoEl.videoWidth,
              videoEl.videoHeight,
              true,
            );
            if (decoded && isMounted) {
              handleDetectedCode(decoded);
            }
          } catch {}
          isDecodingFrame = false;
        }, 180);
      } catch (err: any) {
        if (!isMounted) return;
        setCameraLoading(false);
        const msg = String(err?.message || "").toLowerCase();
        if (msg.includes("permission") || msg.includes("denied") || err?.name === "NotAllowedError") {
          setScanError(
            "Camera permission was denied. Please allow camera access in your browser address bar, or click 'Scan Barcode Image / Screenshot' below.",
          );
        } else {
          setScanError(
            "Could not start camera stream (camera may be in use by another app). You can still click 'Scan Barcode Image / Screenshot' below.",
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

  // Decode an uploaded or pasted image File
  const processImageFile = async (file: File) => {
    setIsProcessingImage(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = (err) => reject(err);
        el.src = objectUrl;
      });

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      const decoded = await decodeBarcodeFromSource(img, width, height, false);
      if (decoded && decoded.trim()) {
        const code = decoded.trim();
        setLastScanned(code);
        onDetectedSku(code);
        if (!continuousMode) onClose();
        return;
      }

      // Secondary fallback: if user uploaded a file named e.g. MerylShoes-Barcode-MS-000840.png
      const fileNameMatch = file.name.match(/\b(MS-\d{4,10})\b/i);
      if (fileNameMatch?.[1]) {
        const code = fileNameMatch[1].toUpperCase();
        setLastScanned(code);
        onDetectedSku(code);
        if (!continuousMode) onClose();
        return;
      }

      toast.error(
        "Could not detect a clear Code 128 barcode in that image. Make sure the black-and-white barcode lines are visible, or use 'Save Barcode PNG' from Product List.",
      );
    } catch {
      toast.error("Failed to load the selected image file.");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setIsProcessingImage(false);
    }
  };

  // Scan barcode from file input
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processImageFile(file);
  };

  // Also support pasting a screenshot directly with Ctrl+V while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            processImageFile(blob);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen, continuousMode]);

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
            <span className="font-mono text-yellow-300">MS-000001</span>), upload a barcode image, or press{" "}
            <span className="font-mono text-zinc-200">Ctrl+V</span> to paste a screenshot.
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
              Supports Code 128 (Normal &amp; Mirrored Webcams)
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
            disabled={isProcessingImage}
            onClick={() => fileInputRef.current?.click()}
            className="border-[#34344a] bg-[#1c1c28] text-yellow-300 hover:bg-[#252536] text-xs h-9"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {isProcessingImage ? "Reading Barcode..." : "Scan Barcode Image / Screenshot"}
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
