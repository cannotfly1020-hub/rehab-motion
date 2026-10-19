(function (global) {
  'use strict';

  const RM = global.RehabMotion = global.RehabMotion || {};

  const REQUIRED = [
    'initPose',
    'sendToPose',
    'invalidatePoseQueue',
    'calculateSagittalAlignment',
    'calculateFrontalAlignment',
    'detectBodyPlane',
    'renderFrame',
    'getAspectFitBounds',
    'hitTestHud',
    'drawSwayChart',
    'formatDeviation',
    'formatKnee',
    'formatKneeJudgement',
    'formatSignedDeg',
    'formatUnsignedDeg',
    'deviationTone',
    'kneeTone'
  ];

  function boot() {
    const missing = REQUIRED.filter(function (name) { return typeof RM[name] !== 'function'; });
    if (missing.length || !RM.aiDiagnostics) {
      console.error('[RehabMotion] missing exports', missing);
      return;
    }

    const wrapper = document.getElementById('screen-wrapper');
    const canvas = document.getElementById('overlay');
    const video = document.getElementById('video');
    const still = document.getElementById('still');
    const playButton = document.getElementById('btn-play');
    const frameBackButton = document.getElementById('btn-step-back');
    const frameForwardButton = document.getElementById('btn-step-forward');
    const seek = document.getElementById('seek-bar');
    const timeLabel = document.getElementById('time-label');
    const sourceLabel = document.getElementById('source-label');
    const mediaName = document.getElementById('media-name');
    const note = document.getElementById('measure-note');
    const pickStatus = document.getElementById('pick-status');
    const heightInput = document.getElementById('height-input');
    const heightSlider = document.getElementById('height-slider');
    const headerBack = document.getElementById('btn-header-back');
    const retakeButton = document.getElementById('btn-retake');
    const startButton = document.getElementById('btn-start');
    const videoInput = document.getElementById('video-input');
    const imageInput = document.getElementById('image-input');
    const cameraInput = document.getElementById('camera-input');
    const swayCanvas = document.getElementById('sway-chart-canvas');
    const swayButtons = document.querySelectorAll('.sway-key');
    const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    const swayCtx = swayCanvas ? (swayCanvas.getContext('2d') || null) : null;

    if (!ctx) {
      console.error('[RehabMotion] canvas 2d context is unavailable');
      return;
    }

    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';

    const FRAME_STEP_SECONDS = RM.FRAME_STEP_SECONDS;
    const state = RM.state;

    function readStoredHeight() { return RM.readStoredHeight(); }
    function saveHeight(value) { return RM.saveHeight(value); }
    function canvasLabel() { return RM.canvasLabel.apply(null, arguments); }
    function setSwayTarget() { return RM.setSwayTarget.apply(null, arguments); }
    function paintMeasure() { return RM.paintMeasure.apply(null, arguments); }
    function splitClinical() { return RM.splitClinical.apply(null, arguments); }
    function setMetric() { return RM.setMetric.apply(null, arguments); }
    function setAngleMetric() { return RM.setAngleMetric.apply(null, arguments); }
    function setClinicalBadge() { return RM.setClinicalBadge.apply(null, arguments); }
    function updateFrontalSummary() { return RM.updateFrontalSummary.apply(null, arguments); }
    function updateSummary() { return RM.updateSummary.apply(null, arguments); }
    function clinicalTone() { return RM.clinicalTone.apply(null, arguments); }
    function paintRomValue() { return RM.paintRomValue.apply(null, arguments); }
    function setRom() { return RM.setRom.apply(null, arguments); }
    function updateRom() { return RM.updateRom.apply(null, arguments); }
    function setRomOpen() { return RM.setRomOpen.apply(null, arguments); }
    function updateNotes() { return RM.updateNotes.apply(null, arguments); }
    function syncPlaneControls() { return RM.syncPlaneControls.apply(null, arguments); }
    function showPlaneToast() { return RM.showPlaneToast.apply(null, arguments); }
    function formatClock() { return RM.formatClock.apply(null, arguments); }
    function updateTimeLabel() { return RM.updateTimeLabel.apply(null, arguments); }
    function updateSeek() { return RM.updateSeek.apply(null, arguments); }
    function updateSourceLabel() { return RM.updateSourceLabel.apply(null, arguments); }
    function setPickStatus() { return RM.setPickStatus.apply(null, arguments); }
    function syncPlayButton() { return RM.syncPlayButton.apply(null, arguments); }
    function syncTransport() { return RM.syncTransport.apply(null, arguments); }
    function syncPillarbox() { return RM.syncPillarbox.apply(null, arguments); }

    state.heightCm = readStoredHeight();
    RM._hooks.renderFrameOnly = renderFrameOnly;
    RM._hooks.drawSwayChart = drawSwayChart;
    RM._hooks.currentMediaSize = currentMediaSize;




    function setHeight(next) {
      const numeric = Number(next);
      const value = Math.min(250, Math.max(50, Math.round(Number.isFinite(numeric) ? numeric : state.heightCm)));
      state.heightCm = value;
      heightInput.value = String(value);
      heightSlider.value = String(value);
      saveHeight(value);
      if (state.step === 3 && state.rawLandmarks) {
        resetSway();
        recomputeAlignment();
      }
    }

    function currentMedia() {
      if (state.mode === 'video') return video;
      if (state.mode === 'image') return still;
      return null;
    }

    function currentMediaSize() {
      const media = currentMedia();
      if (!media) return { width: 0, height: 0 };
      return {
        width: media.videoWidth || media.naturalWidth || 0,
        height: media.videoHeight || media.naturalHeight || 0
      };
    }

    function stageMessage() {
      if (RM.aiDiagnostics.status === 'error' && state.mode === 'empty') {
        return RM.aiDiagnostics.error || 'モデルを初期化できませんでした';
      }
      if (state.mode === 'empty') return '横向きの立位動画または写真を選択してください';
      const size = currentMediaSize();
      if (!size.width || !size.height) return 'メディアを準備しています…';
      return '';
    }

    function stageHint() {
      if (state.mode === 'empty') return 'Kendall理想重心線（Plum Line）で偏位を表示します';
      return '';
    }


    function renderFrameOnly() {
      if (state.step !== 3) return;
      try {
        const size = currentMediaSize();
        RM.renderFrame(ctx, {
          media: currentMedia(),
          mediaWidth: size.width,
          mediaHeight: size.height,
          alignment: state.alignment,
          frontal: state.frontal,
          plane: state.plane,
          diagnostics: RM.aiDiagnostics,
          hudCollapsed: state.hudCollapsed,
          romOpen: state.isRomDrawerOpen,
          message: stageMessage(),
          hint: stageHint()
        });
        canvas.setAttribute('aria-label', canvasLabel());
        syncPillarbox();
        drawSwayChart();
      } catch (error) {
        console.error('[RehabMotion] render failed', error);
      }
    }

    function poseSampleTime() {
      if (state.mode === 'video' && Number.isFinite(video.currentTime)) return video.currentTime;
      return 0;
    }

    function requestPose(source) {
      RM.sendToPose(source, poseSampleTime());
    }

    function resetSway() {
      state.swaySamples = [];
      drawSwayChart();
    }

    function swayCm(alignment, key) {
      const point = alignment && alignment.ok && alignment.points ? alignment.points[key] : null;
      return point && typeof point.cm === 'number' ? point.cm : null;
    }

    function recordSway(sampleTime) {
      if (state.mode !== 'video') return;
      const time = Number(sampleTime);
      if (!Number.isFinite(time) || time < 0) return;
      const alignment = state.alignment;
      const point = {
        t: time,
        ear: swayCm(alignment, 'ear'),
        shoulder: swayCm(alignment, 'shoulder'),
        hip: swayCm(alignment, 'hip'),
        knee: swayCm(alignment, 'knee')
      };
      if (point.ear === null && point.shoulder === null && point.hip === null && point.knee === null) return;
      const samples = state.swaySamples;
      let index = 0;
      while (index < samples.length && samples[index].t < time - 0.045) index += 1;
      if (index < samples.length && Math.abs(samples[index].t - time) <= 0.05) {
        samples[index] = point;
      } else {
        samples.splice(index, 0, point);
      }
      if (samples.length > 3600) samples.splice(0, samples.length - 3600);
    }

    function drawSwayChart() {
      if (!swayCtx || state.step !== 3 || typeof RM.drawSwayChart !== 'function') return;
      const duration = state.mode === 'video' && Number.isFinite(video.duration) ? video.duration : 0;
      const current = state.mode === 'video' && Number.isFinite(video.currentTime) ? video.currentTime : 0;
      state.swayPlot = RM.drawSwayChart(swayCtx, {
        samples: state.swaySamples,
        duration: duration,
        currentTime: current,
        target: state.swayTarget,
        emptyLabel: state.mode === 'image' ? '静止画では波形を作りません' : '再生すると動揺を記録します'
      });
      if (swayCanvas) {
        const names = { ear: '耳垂', shoulder: '肩峰', hip: '大転子', knee: '膝' };
        const name = names[state.swayTarget] || '耳垂';
        swayCanvas.setAttribute('aria-label', name + 'の前後動揺。波形をタップするとその時刻へ移動します。');
      }
    }

    function resizeSwayChart() {
      if (!swayCanvas || state.step !== 3) return;
      const rect = swayCanvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (swayCanvas.width !== width || swayCanvas.height !== height) {
        swayCanvas.width = width;
        swayCanvas.height = height;
      }
      drawSwayChart();
    }


    function seekFromChart(clientX) {
      if (state.mode !== 'video' || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const rect = swayCanvas.getBoundingClientRect();
      const plot = state.swayPlot || { left: 26, right: Math.max(28, rect.width - 8) };
      const span = Math.max(1, plot.right - plot.left);
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - plot.left) / span));
      video.pause();
      video.currentTime = ratio * video.duration;
    }














    function refresh() {
      updateSummary();
      renderFrameOnly();
    }

    function recomputeAlignment() {
      if (!state.rawLandmarks) {
        state.alignment = null;
        refresh();
        return;
      }
      const size = currentMediaSize();
      const bounds = RM.getAspectFitBounds(canvas.width, canvas.height, size.width, size.height);
      state.alignment = RM.calculateSagittalAlignment(
        state.rawLandmarks,
        state.heightCm,
        canvas.width,
        canvas.height,
        bounds
      );
      state.frontal = RM.calculateFrontalAlignment(
        state.rawLandmarks,
        state.heightCm,
        canvas.width,
        canvas.height,
        bounds
      );
      if (state.alignment && typeof state.alignment.meanVisibility === 'number') {
        RM.aiDiagnostics.visibility = state.alignment.meanVisibility;
      }
      applyDetectedPlane(RM.detectBodyPlane(
        state.rawLandmarks,
        canvas.width,
        canvas.height,
        bounds
      ));
      recordSway(state.pendingSampleTime);
      refresh();
    }



    function applyDetectedPlane(detected) {
      if (!detected || !detected.confident || (detected.plane !== 'frontal' && detected.plane !== 'sagittal')) return;
      if (detected.plane === state.detectedPlane) {
        state.planeStreak = (state.planeStreak || 0) + 1;
      } else {
        state.detectedPlane = detected.plane;
        state.planeStreak = 1;
        return;
      }
      if (state.planeLock || state.planeStreak < 2) return;
      if (detected.plane === state.plane) return;
      state.plane = detected.plane;
      syncPlaneControls();
      showPlaneToast(detected.plane);
    }

    function setPlane(plane) {
      if (plane !== 'frontal' && plane !== 'sagittal') return;
      state.planeLock = plane;
      state.plane = plane;
      syncPlaneControls();
      if (state.step === 3) refresh();
    }

    function onPoseResults(results) {
      state.rawLandmarks = results && results.poseLandmarks ? results.poseLandmarks : null;
      state.pendingSampleTime = results && Number.isFinite(results.sampleTime) ? results.sampleTime : poseSampleTime();
      if (state.step === 3) recomputeAlignment();
    }








    function stopLoop() {
      if (!state.rafId) return;
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }

    function startLoop() {
      stopLoop();
      const tick = function () {
        renderFrameOnly();
        if (state.step === 3 && state.mode === 'video' && !video.paused && !video.ended) {
          requestPose(video);
          state.rafId = requestAnimationFrame(tick);
        } else {
          state.rafId = 0;
        }
      };
      state.rafId = requestAnimationFrame(tick);
    }

    function clearAnalysis() {
      RM.invalidatePoseQueue();
      state.rawLandmarks = null;
      state.alignment = null;
      state.frontal = null;
      state.plane = 'sagittal';
      state.planeLock = null;
      state.detectedPlane = 'sagittal';
      state.planeStreak = 0;
      syncPlaneControls();
      state.swaySamples = [];
      state.pendingSampleTime = null;
    }

    function clearVideo() {
      state.videoEpoch += 1;
      state.openingSeek = false;
      stopLoop();
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (state.videoUrl) {
        URL.revokeObjectURL(state.videoUrl);
        state.videoUrl = '';
      }
    }


    function resizeCanvas() {
      if (state.step !== 3) return false;
      resizeSwayChart();
      syncPillarbox();
      const rect = wrapper.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width === width && canvas.height === height) return false;
      canvas.width = width;
      canvas.height = height;
      if (state.rawLandmarks) recomputeAlignment();
      else renderFrameOnly();
      return true;
    }

    function renderVideoFrame() {
      if (state.mode !== 'video' || state.step !== 3) return;
      resizeCanvas();
      renderFrameOnly();
      if (video.readyState >= 2 && video.videoWidth > 0) requestPose(video);
    }

    function nudgeOpeningFrame() {
      if (state.mode !== 'video' || !video.paused) return;
      video.preload = 'auto';
      if (video.readyState < 1) return;
      const time = Number(video.currentTime);
      const nearStart = !Number.isFinite(time) || time < 0.0005;
      if (!nearStart) {
        renderVideoFrame();
        return;
      }
      const duration = Number(video.duration);
      const target = Number.isFinite(duration) && duration > 0.002 ? 0.001 : 0;
      if (!(target > 0) || Math.abs(time - target) < 0.0001) {
        renderVideoFrame();
        return;
      }
      if (state.openingSeek) return;
      state.openingSeek = true;
      const epoch = state.videoEpoch;
      try {
        video.currentTime = target;
      } catch (error) {
        state.openingSeek = false;
        renderVideoFrame();
        return;
      }
      global.setTimeout(function () {
        if (epoch !== state.videoEpoch) return;
        state.openingSeek = false;
        renderVideoFrame();
      }, 480);
    }

    function beginAnalysis() {
      global.requestAnimationFrame(function () {
        global.requestAnimationFrame(function () {
          resizeCanvas();
          if (state.mode === 'video') {
            nudgeOpeningFrame();
            return;
          }
          if (state.rawLandmarks) recomputeAlignment();
          else renderFrameOnly();
          if (state.mode === 'image') requestPose(still);
        });
      });
    }

    function goToStep(step) {
      if (step < 1 || step > 3) return;
      if ((step === 2 || step === 3) && state.mode === 'empty') return;
      document.documentElement.setAttribute('data-step-dir', step >= state.step ? 'forward' : 'back');
      state.step = step;
      [1, 2, 3].forEach(function (number) {
        const view = document.getElementById('step-' + number);
        const marker = document.getElementById('stepper-' + number);
        const active = number === step;
        view.classList.toggle('is-active', active);
        if (active) view.removeAttribute('hidden');
        else view.setAttribute('hidden', '');
        marker.classList.toggle('is-current', active);
        marker.classList.toggle('is-done', number < step);
        if (active) marker.setAttribute('aria-current', 'step');
        else marker.removeAttribute('aria-current');
      });
      headerBack.hidden = step === 1;
      retakeButton.hidden = step !== 3;
      headerBack.textContent = step === 3 ? '戻る' : '戻る';
      if (step !== 3) {
        video.pause();
        stopLoop();
      } else {
        beginAnalysis();
      }
    }

    function onMediaReady() {
      updateSourceLabel();
      syncTransport();
      setPickStatus(state.sourceName + ' を読み込みました。身長入力へ進みます。', 'ok');
      if (state.step === 1) goToStep(2);
    }

    function retake() {
      video.pause();
      stopLoop();
      clearVideo();
      still.removeAttribute('src');
      state.imageEpoch += 1;
      state.mode = 'empty';
      state.sourceName = '';
      clearAnalysis();
      syncTransport();
      updateSourceLabel();
      setPickStatus('正面または側面の全身が写る写真または動画を選んでください。');
      goToStep(1);
    }

    function pointerToCanvas(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 0, y: 0 };
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height)
      };
    }

    function loadVideoFile(file) {
      state.imageEpoch += 1;
      clearVideo();
      clearAnalysis();
      state.mode = 'video';
      state.sourceName = file.name;
      still.removeAttribute('src');
      state.videoEpoch += 1;
      const epoch = state.videoEpoch;
      const url = URL.createObjectURL(file);
      state.videoUrl = url;
      const onError = function () {
        video.removeEventListener('error', onError);
        if (epoch !== state.videoEpoch || !video.error) return;
        state.mode = 'empty';
        state.sourceName = '';
        RM.aiDiagnostics.status = 'error';
        RM.aiDiagnostics.error = '動画を開けませんでした';
        setPickStatus('動画を開けませんでした。別のファイルを選んでください。', 'alert');
        updateSourceLabel();
        goToStep(1);
      };
      video.addEventListener('error', onError);
      video.preload = 'auto';
      video.src = url;
      syncTransport();
      updateSourceLabel();
      setPickStatus('動画を読み込んでいます…');
    }

    function loadImageFile(file) {
      const epoch = state.imageEpoch + 1;
      state.imageEpoch = epoch;
      setPickStatus('写真を読み込んでいます…');
      const reader = new FileReader();
      reader.onerror = function () {
        if (epoch !== state.imageEpoch) return;
        setPickStatus('写真を読み込めませんでした。', 'alert');
      };
      reader.onload = function () {
        if (epoch !== state.imageEpoch) return;
        const show = function () {
          if (epoch !== state.imageEpoch) return;
          state.mode = 'image';
          state.sourceName = file.name;
          clearVideo();
          clearAnalysis();
          syncTransport();
          onMediaReady();
        };
        still.addEventListener('load', show, { once: true });
        still.addEventListener('error', function () {
          if (epoch !== state.imageEpoch) return;
          setPickStatus('写真を表示できませんでした。', 'alert');
        }, { once: true });
        still.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    }

    function togglePlay() {
      if (state.step !== 3 || state.mode !== 'video') return;
      if (video.paused || video.ended) {
        if (video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.001)) {
          video.currentTime = 0;
        }
        const pending = video.play();
        if (pending && typeof pending.catch === 'function') {
          pending.catch(function (error) {
            RM.aiDiagnostics.status = 'error';
            RM.aiDiagnostics.error = '動画を再生できませんでした';
            console.error('[RehabMotion] video play failed', error);
            refresh();
          });
        }
        return;
      }
      video.pause();
    }

    function stepFrame(direction) {
      if (state.step !== 3 || state.mode !== 'video' || !Number.isFinite(video.duration)) return;
      video.pause();
      const next = Math.min(video.duration, Math.max(0, video.currentTime + direction * FRAME_STEP_SECONDS));
      if (Math.abs(next - video.currentTime) < 0.0001) {
        renderFrameOnly();
        requestPose(video);
        return;
      }
      video.currentTime = next;
    }

    function refreshModelStatus() {
      if (state.step !== 1 || state.mode !== 'empty') return;
      if (RM.aiDiagnostics.status === 'ready') {
        setPickStatus('準備完了。正面または側面の全身を撮影するか、ファイルを選んでください。', 'ok');
      } else if (RM.aiDiagnostics.status === 'error') {
        setPickStatus(RM.aiDiagnostics.error || 'モデルを初期化できませんでした。', 'alert');
      } else {
        setPickStatus('姿勢推定モデルを読み込んでいます…');
      }
    }

    headerBack.addEventListener('click', function () {
      if (state.step === 3) goToStep(2);
      else if (state.step === 2) goToStep(1);
    });
    retakeButton.addEventListener('click', retake);
    startButton.addEventListener('click', function () {
      setHeight(heightInput.value);
      goToStep(3);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-height-delta]'), function (button) {
      button.addEventListener('click', function () {
        setHeight(state.heightCm + Number(button.getAttribute('data-height-delta')));
      });
    });
    heightSlider.addEventListener('input', function () { setHeight(heightSlider.value); });
    heightInput.addEventListener('input', function () {
      const value = Number(heightInput.value);
      if (value >= 50 && value <= 250) setHeight(value);
    });
    heightInput.addEventListener('change', function () {
      if (!heightInput.value) setHeight(RM.DEFAULT_HEIGHT_CM);
      else setHeight(heightInput.value);
    });

    const romToggle = document.getElementById('btn-rom');
    const romClose = document.getElementById('btn-rom-close');
    if (romToggle) {
      romToggle.addEventListener('click', function () {
        setRomOpen(!state.isRomDrawerOpen);
      });
    }
    if (romClose) {
      romClose.addEventListener('click', function () {
        setRomOpen(false);
        if (romToggle) romToggle.focus();
      });
    }

    playButton.addEventListener('click', togglePlay);
    frameBackButton.addEventListener('click', function () { stepFrame(-1); });
    frameForwardButton.addEventListener('click', function () { stepFrame(1); });

    seek.addEventListener('pointerdown', function () { state.scrubbing = true; });
    seek.addEventListener('pointerup', function () { state.scrubbing = false; });
    seek.addEventListener('pointercancel', function () { state.scrubbing = false; });
    seek.addEventListener('change', function () { state.scrubbing = false; });
    seek.addEventListener('input', function () {
      if (state.mode !== 'video' || !Number.isFinite(video.duration) || video.duration <= 0) return;
      state.scrubbing = true;
      video.pause();
      video.currentTime = (Number(seek.value) / 1000) * video.duration;
    });

    video.addEventListener('play', function () {
      syncPlayButton();
      if (state.step === 3) startLoop();
    });
    video.addEventListener('pause', function () {
      syncPlayButton();
      stopLoop();
      renderFrameOnly();
    });
    video.addEventListener('ended', function () {
      syncPlayButton();
      stopLoop();
      updateSeek();
      updateTimeLabel();
    });
    video.addEventListener('timeupdate', function () {
      updateSeek();
      updateTimeLabel();
      if (state.step === 3) drawSwayChart();
    });
    video.addEventListener('loadedmetadata', function () {
      if (state.mode !== 'video') return;
      syncTransport();
      onMediaReady();
    });
    video.addEventListener('loadeddata', function () {
      if (state.mode !== 'video') return;
      onMediaReady();
      nudgeOpeningFrame();
    });
    video.addEventListener('canplay', function () {
      if (state.mode !== 'video' || state.step !== 3 || !video.paused) return;
      nudgeOpeningFrame();
    });
    video.addEventListener('seeked', function () {
      if (state.mode !== 'video') return;
      state.openingSeek = false;
      updateSeek();
      updateTimeLabel();
      renderVideoFrame();
    });

    function takeFile(input, loader) {
      const file = input.files && input.files[0];
      input.value = '';
      if (file) loader(file);
    }
    cameraInput.addEventListener('change', function () { takeFile(cameraInput, loadImageFile); });
    imageInput.addEventListener('change', function () { takeFile(imageInput, loadImageFile); });
    videoInput.addEventListener('change', function () { takeFile(videoInput, loadVideoFile); });

    canvas.addEventListener('pointerdown', function (event) {
      const point = pointerToCanvas(event);
      if (!RM.hitTestHud(point.x, point.y)) {
        state.hudPointer = null;
        return;
      }
      state.hudPointer = { id: event.pointerId, x: point.x, y: point.y };
    });
    canvas.addEventListener('pointerup', function (event) {
      if (!state.hudPointer || state.hudPointer.id !== event.pointerId) return;
      const point = pointerToCanvas(event);
      const moved = Math.hypot(point.x - state.hudPointer.x, point.y - state.hudPointer.y);
      state.hudPointer = null;
      const scale = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
      if (moved > 12 * scale) return;
      if (!RM.hitTestHud(point.x, point.y)) return;
      state.hudCollapsed = !state.hudCollapsed;
      renderFrameOnly();
    });
    canvas.addEventListener('pointercancel', function () { state.hudPointer = null; });
    canvas.addEventListener('pointerleave', function () { state.hudPointer = null; });
    canvas.addEventListener('pointermove', function (event) {
      const point = pointerToCanvas(event);
      canvas.style.cursor = RM.hitTestHud(point.x, point.y) ? 'pointer' : 'default';
    });

    global.addEventListener('keydown', function (event) {
      if (event.code === 'Escape' && state.isRomDrawerOpen) {
        setRomOpen(false);
        return;
      }
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'LABEL') return;
      if (state.step !== 3) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        stepFrame(-1);
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        stepFrame(1);
      }
    });

    if (swayCanvas) {
      swayCanvas.addEventListener('pointerdown', function (event) {
        if (event.button != null && event.button !== 0) return;
        state.swayScrubbing = true;
        if (typeof swayCanvas.setPointerCapture === 'function') {
          try { swayCanvas.setPointerCapture(event.pointerId); } catch (error) { /* 既に解放されている */ }
        }
        seekFromChart(event.clientX);
      });
      swayCanvas.addEventListener('pointermove', function (event) {
        if (!state.swayScrubbing) return;
        seekFromChart(event.clientX);
      });
      const endSwayScrub = function () { state.swayScrubbing = false; };
      swayCanvas.addEventListener('pointerup', endSwayScrub);
      swayCanvas.addEventListener('pointercancel', endSwayScrub);
    }
    const planeSagittalButton = document.getElementById('plane-sagittal');
    const planeFrontalButton = document.getElementById('plane-frontal');
    if (planeSagittalButton) planeSagittalButton.addEventListener('click', function () { setPlane('sagittal'); });
    if (planeFrontalButton) planeFrontalButton.addEventListener('click', function () { setPlane('frontal'); });
    syncPlaneControls();
    Array.prototype.forEach.call(swayButtons, function (button) {
      button.addEventListener('click', function () {
        setSwayTarget(button.getAttribute('data-joint'));
      });
    });

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(function () { resizeCanvas(); });
      observer.observe(wrapper);
      if (swayCanvas) observer.observe(swayCanvas);
    }
    global.addEventListener('resize', resizeCanvas);
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', resizeCanvas);
    }
    global.addEventListener('orientationchange', function () {
      global.setTimeout(resizeCanvas, 200);
    });

    setHeight(state.heightCm);
    setRomOpen(false);
    syncTransport();
    updateSourceLabel();
    goToStep(1);
    refreshModelStatus();

    RM.initPose(onPoseResults).then(function () {
      refreshModelStatus();
    }).catch(function (error) {
      RM.aiDiagnostics.status = 'error';
      RM.aiDiagnostics.error = (error && error.message) ? error.message : '姿勢推定モデルを初期化できませんでした';
      console.error('[RehabMotion] pose init failed', error);
      refreshModelStatus();
    });

    RM.renderFrameOnly = renderFrameOnly;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
