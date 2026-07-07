'use client';

// قراءة الباركود: BarcodeDetector الأصلي إن وُجد، وإلا ZXing (يغطي Safari/iOS)
const BD_FORMATS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'itf', 'upc_a', 'upc_e', 'qr_code'];

let zxingModule;
function loadZXing() {
  if (!zxingModule) zxingModule = import('@zxing/browser');
  return zxingModule;
}

export async function decodeBarcodeFromFile(file) {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await new window.BarcodeDetector({ formats: BD_FORMATS }).detect(bitmap);
      bitmap.close?.();
      if (codes[0]?.rawValue) return codes[0].rawValue;
    } catch { /* جرّب ZXing */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const { BrowserMultiFormatReader } = await loadZXing();
    const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
    return result?.getText() || '';
  } catch {
    return '';
  } finally {
    URL.revokeObjectURL(url);
  }
}

// مسح مباشر بالكاميرا؛ يعيد دالة إيقاف. onResult(text) عند أول قراءة ناجحة.
export async function startBarcodeScanner(video, onResult) {
  const constraints = { audio: false, video: { facingMode: { ideal: 'environment' } } };

  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: BD_FORMATS });
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped || video.readyState < 2) return;
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) { onResult(codes[0].rawValue); }
      } catch { /* تجاهل إطاراً فاشلاً */ }
    }, 280);
    return () => {
      stopped = true;
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }

  const { BrowserMultiFormatReader } = await loadZXing();
  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
    if (result?.getText()) onResult(result.getText());
  });
  return () => controls.stop();
}
