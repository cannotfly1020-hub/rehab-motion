/**
 * RehabMotion - js/math.js 自動回帰テストスイート
 *
 *   node test_math.js
 *   jsc test_math.js
 *
 * どちらもリポジトリ直下で実行する。npm パッケージは使わない。
 * formatDeviation は文字列を返す。臨床文は ClinicalAngleFormatter.formatNeck / formatKnee。
 */
var root = typeof globalThis !== 'undefined' ? globalThis : this;
if (typeof root.window === 'undefined') root.window = root;
if (typeof root.console === 'undefined') {
  root.console = {
    log: function () { print(Array.prototype.join.call(arguments, ' ')); },
    error: function () { print(Array.prototype.join.call(arguments, ' ')); }
  };
}

root.RehabMotion = root.RehabMotion || {};
var RM = root.RehabMotion;

var fsLoaded = false;
var loadError = '';
try {
  if (typeof require === 'function') {
    var fs = require('fs');
    var path = require('path');
    var mathCode = fs.readFileSync(path.join(__dirname, 'js/math.js'), 'utf8');
    eval(mathCode);
    fsLoaded = true;
  } else if (typeof readFile === 'function') {
    eval(readFile('js/math.js'));
    fsLoaded = true;
  } else if (typeof load === 'function') {
    load('js/math.js');
    fsLoaded = true;
  }
} catch (error) {
  loadError = error && error.message ? error.message : String(error);
}

function finish(code) {
  if (typeof process !== 'undefined' && typeof process.exit === 'function') process.exit(code);
  if (code) {
    // この macOS の jsc は quit() の引数を捨てて常に 0 で終わる。失敗は例外にして非ゼロにする。
    throw new Error('RehabMotion math tests failed');
  }
  if (typeof quit === 'function') quit();
}

if (!fsLoaded || typeof RM.calculateSagittalAlignment !== 'function') {
  console.error('❌ FATAL: js/math.js の読み込みに失敗しました。' + (loadError ? ' ' + loadError : ''));
  finish(1);
}

var passedCount = 0;
var failedCount = 0;

function assert(condition, testName, detail) {
  if (condition) {
    passedCount++;
    console.log('  ✅ PASS: ' + testName);
  } else {
    failedCount++;
    console.error('  ❌ FAIL: ' + testName + (detail ? ' -> ' + detail : ''));
  }
}

function assertNoMinus(text, testName) {
  var hasMinus = /-\d/.test(String(text));
  assert(!hasMinus, testName + ' (マイナス記号の排除確認)', '検出された文字列: "' + text + '"');
}

function textOf(value) {
  if (value && typeof value === 'object' && typeof value.text === 'string') return value.text;
  return value == null ? '' : String(value);
}

function createBaseLandmarks() {
  var lms = [];
  var i;
  for (i = 0; i <= 32; i++) {
    lms.push({ x: 0.5, y: 0.5, z: 0.0, visibility: 0.9 });
  }
  return lms;
}

function putLandmark(lms, index, x, y, visibility) {
  lms[index].x = x;
  lms[index].y = y;
  lms[index].visibility = visibility;
}

var canvasWidth = 400;
var canvasHeight = 800;
var fitBounds = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
var userHeightCm = 160;

console.log('\n======================================================');
console.log('🧪 RehabMotion 生体力学エンジン (js/math.js) 回帰テスト');
console.log('======================================================\n');

console.log('▶ [Suite 1] 定数定義および推定誤差（RM.UNCERTAINTY）の検証');
assert(RM.DEFAULT_HEIGHT_CM === 160, '標準身長は 160 cm であること');
assert(RM.UNCERTAINTY && RM.UNCERTAINTY.deviationCm === 1.5, '変位誤差は ±1.5 cm であること');
assert(RM.UNCERTAINTY && RM.UNCERTAINTY.jointDeg === 3.5, '関節角誤差は ±3.5° であること');
assert(RM.UNCERTAINTY && RM.UNCERTAINTY.tiltDeg === 2.0, '傾斜角誤差は ±2.0° であること');
assert(RM.THRESHOLDS && RM.THRESHOLDS.recurvatumDeg === -3, '反張膝の過伸展閾値定数が -3 であること');

console.log('\n▶ [Suite 2] フォーマッターの符号排除および頭頚部表記の検証');
var devPos = textOf(RM.formatDeviation(2.4));
assertNoMinus(devPos, '前方偏位フォーマット');
assert(devPos === '前 2.4 cm', '正の変位は「前 2.4 cm」であること', '実際: "' + devPos + '"');

var devNeg = textOf(RM.formatDeviation(-3.1));
assertNoMinus(devNeg, '後方偏位フォーマット');
assert(devNeg === '後 3.1 cm', '負の変位は符号なし「後 3.1 cm」であること', '実際: "' + devNeg + '"');

var devZero = textOf(RM.formatDeviation(0.0));
assertNoMinus(devZero, 'ゼロ偏位フォーマット');
assert(devZero === '正中 0.0 cm', '0変位は「正中 0.0 cm」であること', '実際: "' + devZero + '"');

var formatNeck = RM.ClinicalAngleFormatter && RM.ClinicalAngleFormatter.formatNeck;
assert(typeof formatNeck === 'function', 'ClinicalAngleFormatter.formatNeck があること');
if (typeof formatNeck === 'function') {
  var neckPos = formatNeck(12.5);
  assert(neckPos.dir === '頭頚部前傾' && neckPos.text.indexOf('頭頚部前傾') !== -1, '正の頚部傾斜は「頭頚部前傾」であること', '実際: "' + neckPos.text + '"');
  assertNoMinus(neckPos.text, '頭頚部前傾テキスト');
  var neckNeg = formatNeck(-8.0);
  assert(neckNeg.dir === '頭頚部後傾' && neckNeg.text.indexOf('頭頚部後傾') !== -1, '負の頚部傾斜は「頭頚部後傾」であること', '実際: "' + neckNeg.text + '"');
  assertNoMinus(neckNeg.text, '頭頚部後傾テキスト');
}

console.log('\n▶ [Suite 3] 膝の境界値検証（3.0°正常 vs 3.1°反張膝alert）');
var formatKnee = RM.ClinicalAngleFormatter && RM.ClinicalAngleFormatter.formatKnee;
assert(typeof formatKnee === 'function', 'ClinicalAngleFormatter.formatKnee があること');
if (typeof formatKnee === 'function') {
  var kneeBorder = formatKnee(-3.0);
  assert(kneeBorder.status !== 'alert', '過伸展 3.0° は alert（反張膝）にならないこと', 'status=' + kneeBorder.status + ' text=' + kneeBorder.text);
  assertNoMinus(kneeBorder.text, '過伸展 3.0° の表示');

  var kneeAlert = formatKnee(-3.1);
  assert(kneeAlert.status === 'alert', '過伸展 3.1° は alert であること', 'status=' + kneeAlert.status + ' text=' + kneeAlert.text);
  assert(String(kneeAlert.badge).indexOf('反張膝') !== -1, '過伸展 3.1° のバッジに「反張膝」が付くこと', 'badge="' + kneeAlert.badge + '"');
  assertNoMinus(kneeAlert.text, '過伸展 3.1° の表示');

  var kneeFlex = formatKnee(5.5);
  assert(kneeFlex.status === 'warn', '屈曲 5.5° は warn（屈曲拘縮疑い）であること', 'status=' + kneeFlex.status + ' badge=' + kneeFlex.badge);
  assert(String(kneeFlex.badge).indexOf('屈曲拘縮疑い') !== -1, '屈曲 5.5° のバッジに「屈曲拘縮疑い」が付くこと', 'badge="' + kneeFlex.badge + '"');
  assertNoMinus(kneeFlex.text, '屈曲 5.5° の表示');
}

console.log('\n▶ [Suite 4] 撮影条件逸脱フレームの「—」マスク化検証');
var hiddenAnkles = createBaseLandmarks();
putLandmark(hiddenAnkles, 27, 0.5, 0.9, 0.49);
putLandmark(hiddenAnkles, 28, 0.5, 0.9, 0.49);
var sagittalHidden = RM.calculateSagittalAlignment(hiddenAnkles, userHeightCm, canvasWidth, canvasHeight, fitBounds);
assert(sagittalHidden.ok === false, '足首の visibility が 0.5 未満なら矢状面は ok: false', 'ok=' + sagittalHidden.ok);
assert(sagittalHidden.points && sagittalHidden.points.ear && sagittalHidden.points.ear.text === '—', '足首見切れの耳表示は「—」', 'ear=' + (sagittalHidden.points && sagittalHidden.points.ear && sagittalHidden.points.ear.text));
assert(sagittalHidden.points && sagittalHidden.points.shoulder && sagittalHidden.points.shoulder.text === '—', '足首見切れの肩表示は「—」', 'shoulder=' + (sagittalHidden.points && sagittalHidden.points.shoulder && sagittalHidden.points.shoulder.text));

var oblique = createBaseLandmarks();
putLandmark(oblique, 27, 0.20, 0.9, 0.95);
putLandmark(oblique, 28, 0.80, 0.9, 0.95);
var sagittalOblique = RM.calculateSagittalAlignment(oblique, userHeightCm, canvasWidth, canvasHeight, fitBounds);
assert(sagittalOblique.ok === false, '両足首の X 間隔が 0.08 を超えると矢状面は ok: false', 'ok=' + sagittalOblique.ok + ' dx=' + Math.abs(oblique[27].x - oblique[28].x));

var hiddenShoulder = createBaseLandmarks();
putLandmark(hiddenShoulder, 11, 0.62, 0.28, 0.95);
putLandmark(hiddenShoulder, 12, 0.38, 0.28, 0.49);
putLandmark(hiddenShoulder, 23, 0.58, 0.55, 0.95);
putLandmark(hiddenShoulder, 24, 0.42, 0.55, 0.95);
putLandmark(hiddenShoulder, 27, 0.54, 0.92, 0.95);
putLandmark(hiddenShoulder, 28, 0.46, 0.92, 0.95);
var frontalHidden = RM.calculateFrontalAlignment(hiddenShoulder, userHeightCm, canvasWidth, canvasHeight, fitBounds);
assert(frontalHidden.ok === false, '肩の visibility が 0.5 未満なら前額面は ok: false', 'ok=' + frontalHidden.ok);
assert(frontalHidden.swayValues === null, '肩見切れの swayValues は null', 'swayValues=' + frontalHidden.swayValues);

console.log('\n▶ [Suite 5] 前額面の動揺計測値（swayValues）と解剖学的左右');
var frontalPose = createBaseLandmarks();
putLandmark(frontalPose, 0, 0.42, 0.16, 0.99);
putLandmark(frontalPose, 7, 0.58, 0.12, 0.99);
putLandmark(frontalPose, 8, 0.42, 0.12, 0.99);
putLandmark(frontalPose, 11, 0.64, 0.28, 0.99);
putLandmark(frontalPose, 12, 0.36, 0.28, 0.99);
putLandmark(frontalPose, 23, 0.58, 0.55, 0.99);
putLandmark(frontalPose, 24, 0.42, 0.55, 0.99);
putLandmark(frontalPose, 25, 0.57, 0.74, 0.99);
putLandmark(frontalPose, 26, 0.43, 0.74, 0.99);
putLandmark(frontalPose, 27, 0.55, 0.92, 0.99);
putLandmark(frontalPose, 28, 0.45, 0.92, 0.99);
var frontal = RM.calculateFrontalAlignment(frontalPose, userHeightCm, canvasWidth, canvasHeight, fitBounds);
assert(frontal.ok === true, '正面向きランドマークで前額面は ok: true', 'ok=' + frontal.ok + ' warnings=' + (frontal.warnings && frontal.warnings.join(' / ')));
assert(frontal.swayValues !== null, '正面向きの swayValues は null ではない', 'swayValues=' + JSON.stringify(frontal.swayValues));
assert(frontal.swayValues && typeof frontal.swayValues.head === 'number' && frontal.swayValues.head > 0, '本人の右偏位で head の動揺値は正', 'head=' + (frontal.swayValues && frontal.swayValues.head) + ' rightSign=' + frontal.rightSign);

console.log('\n------------------------------------------------------');
console.log('結果: ' + passedCount + ' passed, ' + failedCount + ' failed');
console.log('======================================================\n');

if (failedCount > 0) {
  console.error('❌ ' + failedCount + ' 件失敗');
  finish(1);
}
console.log('✅ 全テスト成功');
finish(0);
