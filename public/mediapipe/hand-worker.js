self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      // The npm package also ships a CommonJS bundle whose exports can be reused in a classic Worker.
      self.exports = {};
      importScripts(new URL('vision-worker-bundle.js', self.location.href).href);
      const { FilesetResolver, HandLandmarker } = self.exports;
      const directory = new URL('./', self.location.href);
      const files = await FilesetResolver.forVisionTasks(new URL('wasm', directory).href);
      async function setup(delegate) {
        return HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: new URL('hand_landmarker.task', directory).href, delegate },
          runningMode: 'VIDEO', numHands: 2,
          minHandDetectionConfidence: .53, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
        });
      }
      let delegate = data.preference;
      try {
        self.landmarker = await setup(delegate);
      } catch (error) {
        if (delegate === 'CPU') throw error;
        delegate = 'CPU';
        self.landmarker = await setup(delegate);
      }
      self.postMessage({ type: 'ready', delegate });
      return;
    }
    const result = self.landmarker.detectForVideo(data.bitmap, data.timestamp);
    self.postMessage({ type: 'frame', result, timestamp: data.timestamp });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  } finally {
    data.bitmap?.close();
  }
};
