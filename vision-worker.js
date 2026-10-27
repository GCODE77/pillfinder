// 영상 분석을 화면과 다른 스레드에서 돌린다(실시간 윤곽 표시 중에도 화면이 멈추지 않게).
importScripts('vision.js');
self.onmessage = (e) => {
  const { id, img, opts } = e.data;
  try {
    const res = self.Vision.analyze(img, opts || {});
    const tr = res.crop ? [res.crop.detail.buffer, res.crop.raw.buffer, res.crop.relief.buffer] : [];
    self.postMessage({ id, res }, tr);
  } catch (err) {
    self.postMessage({ id, res: { ok: false, reason: 'error', error: String(err && err.stack || err) } });
  }
};
