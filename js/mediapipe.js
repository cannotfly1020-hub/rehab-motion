(function (global) {
  'use strict';

  const RM = global.RehabMotion = global.RehabMotion || {};

  const POSE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/';

  RM.aiDiagnostics = {
    latencyMs: 0,
    fps: 0,
    visibility: 0,
    status: 'idle',
    error: '',
    frameCount: 0,
    lastResultAt: 0
  };

  // 推論キューの多重実行ガード。pose.send が重なっている間は true。
  RM.isInferring = false;

  let pose = null;
  let poseReady = false;
  let generation = 0;
  let activeTicket = 0;
  let activeSendStartedAt = 0;
  let queuedImage = null;
  let userOnResults = null;

  function now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function locateFile(file) {
    return POSE_CDN + file;
  }

  function isDrawable(source) {
    if (!source) return false;
    if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
      return source.readyState >= 2 && source.videoWidth > 0 && source.videoHeight > 0;
    }
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      return source.complete && source.naturalWidth > 0 && source.naturalHeight > 0;
    }
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      return source.width > 0 && source.height > 0;
    }
    return false;
  }

  function meanVisibility(landmarks) {
    if (!landmarks || !landmarks.length) return 0;
    const indices = [0, 7, 8, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
    let sum = 0;
    let count = 0;
    for (let i = 0; i < indices.length; i += 1) {
      const landmark = landmarks[indices[i]];
      if (!landmark || typeof landmark.visibility !== 'number') continue;
      sum += landmark.visibility;
      count += 1;
    }
    return count ? sum / count : 0;
  }

  function updateDiagnostics(results) {
    const timestamp = now();
    RM.aiDiagnostics.latencyMs = Math.max(0, timestamp - activeSendStartedAt);
    if (RM.aiDiagnostics.lastResultAt) {
      const delta = timestamp - RM.aiDiagnostics.lastResultAt;
      if (delta > 0 && delta < 5000) {
        const instant = 1000 / delta;
        RM.aiDiagnostics.fps = RM.aiDiagnostics.fps
          ? RM.aiDiagnostics.fps * 0.75 + instant * 0.25
          : instant;
      }
    }
    RM.aiDiagnostics.lastResultAt = timestamp;
    RM.aiDiagnostics.frameCount += 1;

    const landmarks = results && results.poseLandmarks;
    if (!landmarks || !landmarks.length) {
      RM.aiDiagnostics.visibility = 0;
      RM.aiDiagnostics.status = 'no-pose';
      RM.aiDiagnostics.error = '';
      return;
    }
    RM.aiDiagnostics.visibility = meanVisibility(landmarks);
    RM.aiDiagnostics.status = 'tracking';
    RM.aiDiagnostics.error = '';
  }

  function pumpQueue() {
    if (!queuedImage || RM.isInferring || !poseReady) return;
    const next = queuedImage;
    queuedImage = null;
    RM.sendToPose(next);
  }

  function failSend(ticket, error) {
    RM.isInferring = false;
    if (ticket !== generation) return;
    RM.aiDiagnostics.status = 'error';
    RM.aiDiagnostics.error = (error && error.message) ? error.message : '推論に失敗しました';
    console.error('[RehabMotion] pose send failed', error);
    pumpQueue();
  }

  function finishSend(ticket) {
    RM.isInferring = false;
    if (ticket !== generation) return;
    if (RM.aiDiagnostics.status === 'running') {
      RM.aiDiagnostics.status = 'ready';
    }
    pumpQueue();
  }

  async function closePose() {
    generation += 1;
    const current = pose;
    pose = null;
    poseReady = false;
    if (current && typeof current.close === 'function') {
      try {
        await current.close();
      } catch (error) {
        console.error('[RehabMotion] pose close failed', error);
      }
    }
  }

  function attachPose(instance, onResults) {
    userOnResults = onResults;
    instance.onResults(function (results) {
      if (activeTicket !== generation) return;
      updateDiagnostics(results);
      if (typeof userOnResults !== 'function') return;
      try {
        userOnResults(results);
      } catch (error) {
        RM.aiDiagnostics.status = 'error';
        RM.aiDiagnostics.error = (error && error.message) ? error.message : '結果の処理に失敗しました';
        console.error('[RehabMotion] pose results failed', error);
      }
    });
  }

  async function setupPose(onResults, forceCpu) {
    const PoseCtor = global.Pose;
    if (typeof PoseCtor !== 'function') {
      throw new Error('MediaPipe Pose が読み込まれていません');
    }
    const instance = new PoseCtor({ locateFile: locateFile });
    const options = {
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    };
    if (forceCpu) options.useCpuInference = true;
    instance.setOptions(options);
    attachPose(instance, onResults);
    pose = instance;
    if (typeof instance.initialize === 'function') {
      await instance.initialize();
    }
    poseReady = true;
  }

  RM.invalidatePoseQueue = function invalidatePoseQueue() {
    generation += 1;
    queuedImage = null;
  };

  RM.sendToPose = function sendToPose(source) {
    if (!isDrawable(source)) return false;
    if (!pose || !poseReady) {
      queuedImage = source;
      return false;
    }
    if (RM.isInferring) {
      queuedImage = source;
      return false;
    }

    const ticket = generation;
    activeTicket = ticket;
    RM.isInferring = true;
    activeSendStartedAt = now();
    RM.aiDiagnostics.status = 'running';

    let pending;
    try {
      pending = pose.send({ image: source });
    } catch (error) {
      failSend(ticket, error);
      return false;
    }

    if (!pending || typeof pending.then !== 'function') {
      finishSend(ticket);
      return true;
    }

    pending.then(function () {
      finishSend(ticket);
    }).catch(function (error) {
      failSend(ticket, error);
    });
    return true;
  };

  RM.initPose = async function initPose(onResults) {
    RM.aiDiagnostics.status = 'loading';
    RM.aiDiagnostics.error = '';
    await closePose();
    try {
      await setupPose(onResults, false);
    } catch (error) {
      console.error('[RehabMotion] pose init failed, retrying on CPU', error);
      await closePose();
      await setupPose(onResults, true);
    }
    RM.aiDiagnostics.status = 'ready';
    pumpQueue();
  };
})(typeof window !== 'undefined' ? window : globalThis);
