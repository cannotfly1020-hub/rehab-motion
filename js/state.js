(function (global) {
  'use strict';

  const RM = global.RehabMotion = global.RehabMotion || {};
  const FRAME_STEP_SECONDS = 1 / 30;
  const HEIGHT_KEY = 'rehab-motion-height-cm';
  RM.FRAME_STEP_SECONDS = FRAME_STEP_SECONDS;
  RM.HEIGHT_KEY = HEIGHT_KEY;
  RM._hooks = {};

function readStoredHeight() {
  try {
    const stored = Number(global.sessionStorage && global.sessionStorage.getItem(HEIGHT_KEY));
    if (stored >= 50 && stored <= 250) return Math.round(stored);
  } catch (error) {
    console.error('[RehabMotion] height storage read failed', error);
  }
  return RM.DEFAULT_HEIGHT_CM;
}

function saveHeight(value) {
  try {
    if (global.sessionStorage) global.sessionStorage.setItem(HEIGHT_KEY, String(value));
  } catch (error) {
    console.error('[RehabMotion] height storage write failed', error);
  }
}


  const state = {
    step: 1,
    mode: 'empty',
    videoUrl: '',
    videoEpoch: 0,
    imageEpoch: 0,
    rawLandmarks: null,
    alignment: null,
    frontal: null,
    plane: 'sagittal',
    planeLock: null,
    detectedPlane: 'sagittal',
    planeStreak: 0,
    toastTimer: 0,
    hudCollapsed: false,
    isRomDrawerOpen: false,
    scrubbing: false,
    rafId: 0,
    sourceName: '',
    hudPointer: null,
    heightCm: 160,
    swaySamples: [],
    swayTarget: 'ear',
    swayPlot: null,
    swayScrubbing: false,
    openingSeek: false
  };

  RM.state = state;
  RM.readStoredHeight = readStoredHeight;
  RM.saveHeight = saveHeight;
})(typeof window !== 'undefined' ? window : globalThis);
