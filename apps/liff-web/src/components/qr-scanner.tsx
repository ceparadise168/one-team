import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface QrScannerProps {
  onScan: (decodedText: string) => void;
  active: boolean;
}

const SCANNER_ELEMENT_ID = 'qr-reader';

export function QrScanner({ onScan, active }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active) return;

    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          onScanRef.current(decodedText);
        },
        () => {}
      )
      .catch((err) => {
        console.error('QR scanner start failed:', err);
      });

    return () => {
      scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {});
      scannerRef.current = null;
    };
  }, [active]);

  return (
    <div
      id={SCANNER_ELEMENT_ID}
      style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}
    />
  );
}
