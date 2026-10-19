(function (global) {
  'use strict';

  const RM = global.RehabMotion = global.RehabMotion || {};
  const FRAME_STEP_SECONDS = 1 / 30;
  const HEIGHT_KEY = 'rehab-motion-height-cm';

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
      heightCm: readStoredHeight(),
      swaySamples: [],
      swayTarget: 'ear',
      swayPlot: null,
      swayScrubbing: false,
      openingSeek: false
    };

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

    function canvasLabel() {
      if (state.plane === 'frontal') {
        const frontal = state.frontal;
        const base = '前額面姿勢アライメント。左上をタップするとAI認識ステータスの表示を切り替えます。';
        if (!frontal || !frontal.ok) return base;
        return base
          + ' 頭部 ' + (frontal.headTilt && frontal.headTilt.text)
          + '、肩峰 ' + (frontal.shoulderLevel && frontal.shoulderLevel.text)
          + '、骨盤 ' + (frontal.pelvisLevel && frontal.pelvisLevel.text)
          + '、重心 ' + (frontal.cogShift && frontal.cogShift.text)
          + '。';
      }
      const base = '矢状面姿勢アライメント。左上をタップするとAI認識ステータスの表示を切り替えます。';
      const alignment = state.alignment;
      if (!alignment || !alignment.ok || !alignment.points) return base;
      return base
        + ' 耳垂 ' + RM.formatDeviation(alignment.points.ear && alignment.points.ear.cm)
        + '、肩峰 ' + RM.formatDeviation(alignment.points.shoulder && alignment.points.shoulder.cm)
        + '、大転子 ' + RM.formatDeviation(alignment.points.hip && alignment.points.hip.cm)
        + '、膝 ' + RM.ClinicalAngleFormatter.formatKnee(alignment.kneeAngleDeg).text
        + '。';
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

    function setSwayTarget(target) {
      const allowed = { ear: true, shoulder: true, hip: true, knee: true };
      state.swayTarget = allowed[target] ? target : 'ear';
      Array.prototype.forEach.call(swayButtons, function (button) {
        const on = button.getAttribute('data-joint') === state.swayTarget;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
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

    function paintMeasure(node, text) {
      const raw = String(text);
      if (node.dataset.raw === raw) return;
      node.dataset.raw = raw;
      node.textContent = '';
      const match = raw.match(/^(.*?)(\s*)(cm|°)(.*)$/);
      if (!match) {
        node.textContent = raw;
        return;
      }
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = match[1];
      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = match[3] + match[4];
      node.appendChild(num);
      node.appendChild(unit);
    }

    function splitClinical(text) {
      const raw = String(text || '—');
      if (raw === '—') return { dir: '', value: '—' };
      if (raw === '正常アライメント') return { dir: '正常アライメント', value: '' };
      const match = raw.match(/^(右偏位|左偏位|右下がり|左下がり|右側屈|左側屈|正常アライメント|正中|前|後|屈曲|伸展位|過伸展|伸展|前傾|後傾|垂直|前屈|後屈|中間位|外反|内反|水平)\s+(.+)$/);
      if (!match) return { dir: '', value: raw };
      return { dir: match[1], value: match[2] };
    }

    function setMetric(id, text, tone) {
      const node = document.getElementById(id);
      if (!node) return;
      const parts = splitClinical(text);
      const dirNode = node.querySelector('.hud-dir');
      if (dirNode && dirNode.textContent !== parts.dir) dirNode.textContent = parts.dir;
      const value = node.querySelector('.metric-value');
      if (value) paintMeasure(value, parts.value);
      if (node.dataset.tone !== tone) node.dataset.tone = tone;
    }

    function setAngleMetric(id, view) {
      if (!view || view.val === '—') {
        setMetric(id, '—', 'none');
        return;
      }
      const tone = view.status === 'alert' || view.status === 'warn' || view.status === 'ok'
        ? view.status
        : (view.isWarning ? 'warn' : 'ok');
      setMetric(id, view.text, tone);
    }

    function setClinicalBadge(id, view) {
      const node = document.getElementById(id);
      if (!node) return;
      node.textContent = view && view.badge ? view.badge : '';
    }

    function updateFrontalSummary() {
      const frontal = state.frontal;
      if (!frontal || !frontal.ok) {
        setMetric('metric-head-tilt', '—', 'none');
        setMetric('metric-shoulder-level', '—', 'none');
        setMetric('metric-pelvis-level', '—', 'none');
        setMetric('metric-cog', '—', 'none');
        setMetric('metric-knee-right', '—', 'none');
        setMetric('metric-knee-left', '—', 'none');
        setClinicalBadge('metric-knee-right-judge', null);
        setClinicalBadge('metric-knee-left-judge', null);
        return;
      }
      setMetric('metric-head-tilt', frontal.headTilt.text, frontal.headTilt.status);
      setMetric('metric-shoulder-level', frontal.shoulderLevel.text, frontal.shoulderLevel.status);
      setMetric('metric-pelvis-level', frontal.pelvisLevel.text, frontal.pelvisLevel.status);
      setMetric('metric-cog', frontal.cogShift.text, frontal.cogShift.status);
      setMetric('metric-knee-right', frontal.rightKnee.text, frontal.rightKnee.status);
      setMetric('metric-knee-left', frontal.leftKnee.text, frontal.leftKnee.status);
      setClinicalBadge('metric-knee-right-judge', frontal.rightKnee);
      setClinicalBadge('metric-knee-left-judge', frontal.leftKnee);
    }

    function updateSummary() {
      if (state.plane === 'frontal') {
        updateFrontalSummary();
        updateRom();
        updateNotes();
        return;
      }
      const alignment = state.alignment;
      const judge = document.getElementById('metric-knee-judge');
      const format = RM.ClinicalAngleFormatter;
      if (!alignment || !alignment.ok || !alignment.points) {
        setMetric('metric-ear', '—', 'none');
        setMetric('metric-shoulder', '—', 'none');
        setMetric('metric-hip', '—', 'none');
        setMetric('metric-knee', '—', 'none');
        setMetric('metric-trunk', '—', 'none');
        setMetric('metric-neck', '—', 'none');
        if (judge) judge.textContent = '';
      } else {
        setMetric('metric-ear', RM.formatDeviation(alignment.points.ear.cm), RM.deviationTone(alignment.points.ear.cm));
        setMetric('metric-shoulder', RM.formatDeviation(alignment.points.shoulder.cm), RM.deviationTone(alignment.points.shoulder.cm));
        setMetric('metric-hip', RM.formatDeviation(alignment.points.hip.cm), RM.deviationTone(alignment.points.hip.cm));
        const kneeView = format.formatKnee(alignment.kneeAngleDeg);
        setMetric('metric-knee', kneeView.text, RM.kneeTone(alignment.kneeAngleDeg));
        if (judge) judge.textContent = kneeView.val === '—' ? '' : (kneeView.badge || '');
        const rom = alignment.rom || {};
        setAngleMetric('metric-trunk', format.formatTrunk(rom.trunkDeg));
        setAngleMetric('metric-neck', format.formatNeck(rom.neckDeg));
      }
      updateRom();
      updateNotes();
    }

    function clinicalTone(view) {
      if (!view || view.val === '—') return 'none';
      if (view.status === 'alert' || view.status === 'warn' || view.status === 'ok') return view.status;
      return view.isWarning ? 'warn' : 'ok';
    }

    function paintRomValue(node, val) {
      const raw = val || '—';
      if (node.dataset.raw === raw) return;
      node.dataset.raw = raw;
      node.textContent = '';
      if (raw === '—') {
        node.textContent = '—';
        return;
      }
      const numeric = String(raw).replace('°', '');
      node.appendChild(document.createTextNode(numeric));
      const unit = document.createElement('small');
      unit.textContent = '°';
      node.appendChild(unit);
    }

    function setRom(id, view) {
      const node = document.getElementById(id);
      if (!node) return;
      const missing = !view || view.val === '—';
      paintRomValue(node, missing ? '—' : view.val);
      const dirNode = document.getElementById(id + '-dir');
      const dir = missing ? '' : (view.dir || '');
      if (dirNode && dirNode.textContent !== dir) dirNode.textContent = dir;
      const badgeNode = document.getElementById(id + '-badge');
      const badge = missing ? '' : (view.badge || '');
      if (badgeNode && badgeNode.textContent !== badge) badgeNode.textContent = badge;
      if (badgeNode) {
        badgeNode.className = 'rom-badge' + (missing || !view.status ? '' : ' ' + view.status);
      }
      const row = node.closest('.rom-item') || node.closest('.rom-row');
      const tone = clinicalTone(missing ? null : view);
      if (row && row.dataset.tone !== tone) row.dataset.tone = tone;
    }

    function updateRom() {
      const alignment = state.alignment;
      const rom = alignment && alignment.rom;
      const sideNote = document.getElementById('rom-side');
      const format = RM.ClinicalAngleFormatter;
      if (!alignment || !alignment.ok || !rom) {
        setRom('rom-shoulder', null);
        setRom('rom-elbow', null);
        setRom('rom-neck', null);
        setRom('rom-trunk', null);
        setRom('rom-hip', null);
        setRom('rom-knee', null);
        if (sideNote) sideNote.textContent = '手前側の腕と体幹を計測します。';
        return;
      }
      setRom('rom-shoulder', format.formatShoulder(rom.shoulderDeg));
      setRom('rom-elbow', format.formatElbow(rom.elbowDeg));
      setRom('rom-neck', format.formatNeck(rom.neckDeg));
      setRom('rom-trunk', format.formatTrunk(rom.trunkDeg));
      setRom('rom-hip', format.formatHip(rom.hipDeg));
      setRom('rom-knee', format.formatKnee(rom.kneeDeg));
      if (sideNote) {
        sideNote.textContent = alignment.sideLabel + '側（手前）の腕・体幹・下肢です。前方は' + alignment.facingLabel + '。';
      }
    }

    function setRomOpen(open) {
      state.isRomDrawerOpen = !!open;
      const drawer = document.getElementById('rom-drawer');
      const toggle = document.getElementById('btn-rom');
      if (drawer) {
        drawer.classList.toggle('is-open', state.isRomDrawerOpen);
        drawer.setAttribute('aria-hidden', state.isRomDrawerOpen ? 'false' : 'true');
        if ('inert' in drawer) drawer.inert = !state.isRomDrawerOpen;
      }
      if (toggle) toggle.setAttribute('aria-expanded', state.isRomDrawerOpen ? 'true' : 'false');
      if (state.step === 3) renderFrameOnly();
    }

    function updateNotes() {
      const alignment = state.alignment;
      const lines = [];
      if (state.plane === 'frontal' && state.frontal && state.frontal.ok) {
        lines.push('前額面として左右対称と水平傾斜を計測しています。');
        lines.push('校正は身長 ' + state.frontal.heightCm + ' cm の 94% を頭頂〜外果に対応づけています。');
      } else if (alignment && alignment.ok) {
        lines.push(alignment.sideLabel + '側面を計測。前方は' + alignment.facingLabel + '。');
        lines.push('校正は身長 ' + alignment.heightCm + ' cm の 94% を頭頂〜外果に対応づけています。');
      } else if (state.mode !== 'empty') {
        lines.push('姿勢を計測できません。全身の真横が写るように調整してください。');
      }
      if (alignment && alignment.warnings && alignment.warnings.length) {
        alignment.warnings.forEach(function (warning) { lines.push(warning); });
      }
      lines.push('参考表示です。診断は有資格者が行ってください。');
      const text = lines.join(' ');
      if (note.textContent !== text) note.textContent = text;
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

    function syncPlaneControls() {
      if (wrapper) wrapper.dataset.plane = state.plane;
      const sagittal = document.getElementById('plane-sagittal');
      const frontal = document.getElementById('plane-frontal');
      if (sagittal) {
        const on = state.plane !== 'frontal';
        sagittal.classList.toggle('is-active', on);
        sagittal.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      if (frontal) {
        const on = state.plane === 'frontal';
        frontal.classList.toggle('is-active', on);
        frontal.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    function showPlaneToast(plane) {
      const toast = document.getElementById('plane-toast');
      if (!toast) return;
      toast.textContent = plane === 'frontal' ? '🤖 正面姿勢を検出しました' : '🤖 側面姿勢を検出しました';
      toast.hidden = false;
      if (state.toastTimer) global.clearTimeout(state.toastTimer);
      state.toastTimer = global.setTimeout(function () {
        toast.hidden = true;
        state.toastTimer = 0;
      }, 2200);
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

    function formatClock(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
      const total = Math.floor(seconds);
      const minutes = Math.floor(total / 60);
      const remain = total % 60;
      return String(minutes).padStart(2, '0') + ':' + String(remain).padStart(2, '0');
    }

    function updateTimeLabel() {
      if (state.mode === 'image') {
        timeLabel.textContent = '静止画';
        return;
      }
      if (state.mode !== 'video') {
        timeLabel.textContent = '00:00 / 00:00';
        return;
      }
      timeLabel.textContent = formatClock(video.currentTime) + ' / ' + formatClock(video.duration);
    }

    function updateSeek() {
      if (state.scrubbing) return;
      if (state.mode !== 'video' || !Number.isFinite(video.duration) || video.duration <= 0) {
        seek.value = '0';
        return;
      }
      seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }

    function updateSourceLabel() {
      const label = state.sourceName || 'メディア未選択';
      sourceLabel.textContent = label;
      mediaName.textContent = state.sourceName ? '読み込み済み: ' + state.sourceName : 'メディア未選択';
    }

    function setPickStatus(text, tone) {
      pickStatus.textContent = text;
      if (tone) pickStatus.dataset.tone = tone;
      else pickStatus.removeAttribute('data-tone');
    }

    function syncPlayButton() {
      const playing = state.mode === 'video' && !video.paused && !video.ended;
      playButton.textContent = playing ? '一時停止' : '再生';
      playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }

    function syncTransport() {
      const videoMode = state.mode === 'video';
      playButton.disabled = !videoMode;
      frameBackButton.disabled = !videoMode;
      frameForwardButton.disabled = !videoMode;
      seek.disabled = !videoMode;
      syncPlayButton();
      updateTimeLabel();
      updateSeek();
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

    function syncPillarbox() {
      if (!wrapper || state.step !== 3) return;
      const rect = wrapper.getBoundingClientRect();
      const size = currentMediaSize();
      let bar = Math.round(rect.width * 0.16);
      if (rect.width > 2 && rect.height > 2 && size.width > 0 && size.height > 0) {
        const bounds = RM.getAspectFitBounds(rect.width, rect.height, size.width, size.height);
        bar = Math.max(0, Math.round(bounds.x));
      }
      wrapper.style.setProperty('--pillar', bar + 'px');
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
      setPickStatus('矢状面の全身が写る写真または動画を選んでください。');
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
        setPickStatus('準備完了。矢状面の全身を撮影するか、ファイルを選んでください。', 'ok');
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
