import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onError?: (error: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const SCANNER_ELEMENT_ID = 'barcode-scanner-region';

export default function BarcodeScanner({ onScan, onError, isOpen, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === 2 /* SCANNING */ || state === 3 /* PAUSED */) {
          await scannerRef.current.stop();
        }
      } catch {
        // Ignore stop errors during cleanup
      }
      scannerRef.current.clear();
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const startScanner = async () => {
      setIsStarting(true);
      try {
        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
        scannerRef.current = scanner;

        if (cancelled) return;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          decodedText => {
            onScan(decodedText);
            stopScanner();
            onClose();
          },
          () => {
            // QR code not found in frame — ignore
          },
        );
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to start camera';
          onError?.(message);
        }
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [isOpen, onScan, onError, onClose, stopScanner]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#0a1929] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Scan Barcode</h3>
          <button
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="rounded px-3 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
        </div>

        <div id={SCANNER_ELEMENT_ID} className="overflow-hidden rounded-md bg-black" style={{ minHeight: 250 }} />

        {isStarting && <p className="mt-3 text-center text-sm text-white/60">Starting camera...</p>}
      </div>
    </div>
  );
}
