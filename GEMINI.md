# RehabMotion 説明書

この文書は、別のモデルがこのリポジトリを壊さずに読めるように、2026-11-10 時点の実装を事実だけ書いたものです。推測でファイルを足したり、名前を変えたり、計算式を「整理」したりしないこと。

RehabMotion は、スマートフォンのブラウザだけで動く日本語の姿勢計測アプリです。写真または動画の立位を MediaPipe Pose で推定し、側面（矢状面）と正面・背面（前額面）のアライメントを端末内で計算して描きます。計測値はサーバーへ送りません。診断アプリではなく、画面の数値は参考表示です。

## 動かしてはいけない前提

- モジュール方式はブラウザの通常スクリプトだけです。Webpack、Vite、ES modules（`import` / `export`）は使いません。各 JS は即時実行関数で、共有オブジェクト `window.RehabMotion`（コード内では `RM`）に関数を足します。
- HTML の ID、クラス名、既存の関数名・引数の意味を変えないこと。`RM.drawSwayChart` は Canvas の波形描画そのものです。`js/app.js` の中にも同名の `drawSwayChart` がありますが、こちらはサンプルを渡して `RM.drawSwayChart` を呼ぶ側です。上書きしないこと。
- ファイル間の呼び出しは `RM.関数名` と `RM._hooks` です。`js/ui.js` がコントローラ側の関数を呼ぶときは `RM._hooks.renderFrameOnly`、`RM._hooks.drawSwayChart`、`RM._hooks.currentMediaSize` を使います。`boot` の先頭付近で代入されます。
- ピンチズームを止めないこと。viewport は `width=device-width, initial-scale=1.0, viewport-fit=cover` で、`user-scalable=no` は付けません。
- ページ全体の縦スクロールを潰さないこと。`html` と `body` は `height: auto`、`min-height: 100dvh`、`overflow-y: auto`、`touch-action: pan-y pinch-zoom` です。`overflow: hidden` と `height: 100dvh` を根に戻すと、下のボタンに届かなくなります。
- キャンバスと波線グラフの `touch-action` は `pan-y pinch-zoom` です。`none` にするとページのスワイプが止まります。
- ROM ドロワー `#rom-drawer` は `#screen-wrapper` の外、`#step-3` の中で `position: fixed` です。動画枠の `overflow: hidden` の中へ戻さないこと。スクロールするのは `.rom-panel` だけです。
- 臨床数値にマイナス符号を出さないこと。方向の言葉と絶対値だけです。身長の `−5` `−1` `+1` `+5` とコマ送り `−1F` `+1F` は操作ボタンなので符号を残します。
- プレビューは `file://` ではなくローカル HTTP です。例: リポジトリ直下で `python3 -m http.server 8765 --bind 127.0.0.1`。

## 読み込み順

`index.html` の末尾です。順番を変えないこと。`js/state.js` は `js/math.js` より前です。身長の保存値を読む `readStoredHeight` は、`RM.DEFAULT_HEIGHT_CM` が math で定義されたあと、`boot` の中で呼ばれます。

1. CDN `@mediapipe/camera_utils/camera_utils.js`
2. CDN `@mediapipe/pose/pose.js`
3. `js/mediapipe.js`
4. `js/state.js`
5. `js/math.js`
6. `js/render.js`
7. `js/ui.js`
8. `js/app.js`

CSS は `css/base.css`、`css/steps.css`、`css/analysis.css`、`css/hud.css`、`css/components.css` の順です。`css/style.css` は同じ 5 ファイルを `@import` しているだけで、HTML からは直接読んでいません。後のファイルが前の指定を上書きします。画面高さごとの調整は主に `components.css` の末尾にあり、そこへ残しています。

## 画面の流れ

ウィザードは 3 画面です。ヘッダーのステッパーは `01 撮影`、`02 身長`、`03 解析` です。

1. Step 1 `#step-1` で写真、動画、または背面カメラを選びます。カメラ入力は `#camera-input` で `capture="environment"` です。写真は `#image-input`、動画は `#video-input` です。選ぶと Step 2 へ進みます。
2. Step 2 `#step-2` で身長を入れます。初期値は 160 cm、範囲は 50〜250 cm です。入力 `#height-input`、スライダー `#height-slider`、ピルは `data-height-delta` の −5/−1/+1/+5 です。値は `sessionStorage` のキー `rehab-motion-height-cm` に残します。「解析を開始する」 `#btn-start` で Step 3 です。
3. Step 3 `#step-3` で計測と描画をします。ヘッダーの「戻る」 `#btn-header-back` は 3→2→1、「再撮影」 `#btn-retake` はメディアを捨てて Step 1 に戻ります。

Step 1 の案内は正面と側面の両方です。ガイド枠 `.finder` に側面と正面のシルエットを並べ、側面モード（ケンダル理想重心線、頭部前方位、巻き肩、反張膝）と正面モード（肩・骨盤の水平傾斜、正中線重心偏位、O脚/X脚）をカードで示します。平面の判定は Step 3 に入ってから自動で行います。

## 1 フレームの処理

Step 3 で姿勢結果が返ると `onPoseResults` が動きます。

1. `results.poseLandmarks` を `state.rawLandmarks` に置く。時刻は `state.pendingSampleTime`。
2. `recomputeAlignment` が、同じランドマークで矢状面と前額面を両方計算する。原点の画素は `RM.getAspectFitBounds` でレターボックス後の領域に合わせる。
3. `detectBodyPlane` の結果を `applyDetectedPlane` に渡す。自信のある同じ平面が 2 回続いたとき、そのメディアでまだ自動決定しておらず、手動ロックも無いときだけ `state.plane` を一度決める。初回決定ではトーストを出さない。決定後に別平面が続いても `state.plane` は変えず、提案トーストだけを出す。解析中の表示変更は手動トグルで行う。
4. 動画なら矢状面の cm 偏位を `state.swaySamples` に積む。静止画は積まない。
5. `refresh` が DOM の数値を更新し、`renderFrameOnly` がキャンバスと波線を描く。

手動トグル `#plane-sagittal` / `#plane-frontal` は `setPlane` です。`state.planeLock` に選んだ平面を入れ、再推論せず `refresh` します。ロックは `clearAnalysis`（再撮影や新しいメディア）まで残ります。自動トーストは手動タップでは出しません。

動画を開いた直後は再生せず先頭フレームを描きます。`video.preload` は `auto` です。一時停止かつ先頭付近なら `currentTime` を 0.001 秒へ一度だけ送り、`seeked` で `renderVideoFrame` します。480 ms でも描きます。`play()` を待たないこと。再生中だけ `requestAnimationFrame` で描画と `sendToPose` を回します。ROM を開いても再生は止めません。

## ファイルの役割

### index.html

単一ページです。計測 UI、ファイル入力、キャンバス `#overlay`、動画 `#video`、静止画 `#still`、波線 `#sway-chart-canvas`、ROM `#rom-drawer` が全部ここにあります。ロジックは書きません。

### js/mediapipe.js

Pose の初期化と送信だけです。モデルは CDN から端末へ読みます。設定は `modelComplexity: 1`、`smoothLandmarks: true`、`minDetectionConfidence: 0.5`、`minTrackingConfidence: 0.5` です。GPU 初期化に失敗したら CPU で再試行します。

`RM.sendToPose(source, sampleTime)` は描けるメディアだけ送ります。動画は `readyState >= 2` かつ幅が正、画像は読み込み完了かつ幅が正です。推論中の次フレームは 1 枚だけ待ちます。`RM.isInferring` が真のあいだ新しい send は待ち行列へ回します。結果には `sampleTime` を足してからアプリのコールバックへ渡します。診断情報は `RM.aiDiagnostics`（`status`、`latencyMs`、`fps`、`visibility`、`error`）です。

`RM.invalidatePoseQueue()` は世代番号を進めて、古い結果と待ち行列を捨てます。メディアを取り換えるときに使います。

### js/state.js

共有状態 `RM.state` と、身長の読み書きです。フィールドの意味は次のとおりです。

| フィールド | 意味 |
| --- | --- |
| `step` | 1、2、3 の画面 |
| `mode` | `empty`、`image`、`video` |
| `videoUrl` / `videoEpoch` / `imageEpoch` | オブジェクト URL と、古い load を無視する世代 |
| `rawLandmarks` | 直近の MediaPipe 33 点。正規化座標 |
| `alignment` | 矢状面の計算結果。`ok` が偽なら未確定 |
| `frontal` | 前額面の計算結果 |
| `plane` | 今表示している平面。`sagittal` または `frontal` |
| `planeLock` | 手動選択。入っているあいだ、初回の自動決定はしない。`clearAnalysis` まで残る |
| `detectedPlane` / `planeStreak` | 同じ平面が続いた回数。2 回目で、未決定かつロック無しなら一度だけ `state.plane` を決める。決定後は提案トーストだけで、平面は変えない |
| `planeSeeded` | そのメディアで初回の自動決定を済ませたか。初期オブジェクトには無く、決めたあと、または `clearAnalysis` で入る |
| `toastTimer` | 平面トーストのタイマー |
| `hudCollapsed` | キャンバス左上の AI ステータスを畳んだか |
| `isRomDrawerOpen` | ROM ドロワーが開いているか |
| `scrubbing` | 再生シークバーを掴んでいるか |
| `rafId` | 再生ループの ID |
| `sourceName` | ファイル名 |
| `hudPointer` | AI ステータスをタップしたかの起点 |
| `heightCm` | 身長 cm。起動時に保存値で上書きする |
| `swaySamples` | `{t, ear, shoulder, hip, knee}` の cm 配列。最大 3600 点 |
| `swayTarget` | 波線の関節。`ear` `shoulder` `hip` `knee` |
| `swayPlot` | 波線の描画範囲。タップから時刻を出す |
| `swayScrubbing` | 波線をドラッグ中か |
| `openingSeek` | 先頭 0.001 秒へのシーク中か |
| `pendingSampleTime` | 初期オブジェクトには無く、姿勢結果が来てから入る |

`RM.FRAME_STEP_SECONDS` は `1/30` です。`RM.HEIGHT_KEY` は `rehab-motion-height-cm` です。`RM._hooks` は ui からコントローラ関数を呼ぶ入れ物です。

### js/math.js

生体力学の計算と、画面に出す臨床文です。キャンバスへは描きません。

定数:

- `RM.DEFAULT_HEIGHT_CM` は 160。
- `VERTEX_MALLEOLUS_OF_STATURE` は 0.94。頭頂から外果を身長の 94% とみなします。
- 頭頂はランドマークに無いので、耳の上を補います。耳から外果に対する割合は `0.075 / 0.885` です。
- `RM.THRESHOLDS.minVisibility` は 0.5。cm の色は絶対値 1.5 cm 以下が緑、3.0 cm 以下が黄、それを超えると赤です。

MediaPipe の番号は、その人の解剖的な左右です。カメラに向かうと、本人の右（12、24、26、28）は画像の左側、つまり x が小さい側に出ます。背面では逆になります。

| 番号 | 部位 |
| --- | --- |
| 0 | 鼻 |
| 7 / 8 | 左耳 / 右耳 |
| 11 / 12 | 左肩 / 右肩 |
| 13 / 14 | 左肘 / 右肘 |
| 15 / 16 | 左手首 / 右手首 |
| 23 / 24 | 左股関節 / 右股関節 |
| 25 / 26 | 左膝 / 右膝 |
| 27 / 28 | 左外果 / 右外果 |
| 29 / 30 | 左踵 / 右踵 |
| 31 / 32 | 左つま先 / 右つま先 |

`calculateSagittalAlignment(landmarks, userHeight, canvasWidth, canvasHeight, fitBounds)`:

- 手前側は、左右の外果のうち visibility が高い側です。原点 X はその外果です。
- 前方が画面のどちら側かは、つま先と踵、足りなければ鼻と耳で決めます。`facingSign` が +1 のとき画面右が前方です。
- `S_px2cm = |Y_頭頂 − Y_外果| / (身長cm × 0.94)`。
- 各点の cm は `(X − 原点X) × facingSign / S_px2cm` です。正が前方です。
- 耳、肩、股、膝の cm を持ちます。膝の cm は波線用で、骨格の目盛りは耳・肩・股だけです。
- 両外果が見えて正規化 X の間隔が 0.08 を超えると、「真横から撮影してください」という警告を付けます。結果自体は返します。
- 膝の臨床角は、股・膝・外果の内角を 180° から引いた符号付き角度です。表示はこの角度を `formatKnee` に通します。

`detectBodyPlane(landmarks, canvasWidth, canvasHeight, fitBounds)`:

- 肩幅は `|x12 − x11| × 表示幅`、身長は鼻（無ければ耳）から低いほうの外果までの `|Δy| × 表示高` です。幅と高さはキャンバス全面ではなく、画像が乗っている領域です。
- `R = 肩幅 / 身長` です。`R >= 0.14` かつ左右の肩と左右の股の visibility がともに 0.5 以上なら `frontal`、それ以外で自信があるなら `sagittal` です。点が足りないときは `sagittal` かつ `confident: false` で、表示平面は変えません。

`calculateFrontalAlignment(...)`:

- 原点 X は外果 27 と 28 の中点です。この X の鉛直が正中線です。
- 本人の右が画像のどちら側かは、右肩 x と左肩 x の大小で決めます。正面でも背面でも「右偏位」は本人の右です。
- 頭部（鼻、無ければ両耳の中点）、胸骨（両肩の中点）、重心として恥骨結合（両股の中点）の左右 cm を出します。HUD に出す重心は恥骨結合です。
- 肩と骨盤の水平は `|角度| <= 1` で「水平 0°」。本人の右が下がっていれば「右下がり」、左が下がっていれば「左下がり」です。3° を超えると warn です。
- 頭部側屈は耳 7 と 8 です。1° 以内は「中間位 0°」、それ以外は「右側屈」「左側屈」です。
- 膝は股・膝・外果の内角と 180° の差です。2° 以内は「正常アライメント」で角度を出しません。膝が正中側なら「外反」と「X脚傾向」、外側なら「内反」と「O脚傾向」です。5° を超えると warn です。
- cm の色は矢状面と同じで、1.5 cm 以下が ok、3 cm 以下が warn、超えが alert です。0 は「正中 0.0 cm」です。

臨床文 `RM.ClinicalAngleFormatter`（別名 `RM.RomFormatter`）は `{dir, label, val, value, text, isWarning, isFlex, badge, status}` を返します。`text` が画面の文です。`clinicalNumber` は `null`、`undefined`、空文字を無効にします。

| 関節 | 中間 | 正の方向 | 負の方向 | 注意 |
| --- | --- | --- | --- | --- |
| 肩 | 絶対値 1° 未満で中間位 | 屈曲 | 伸展 | 屈曲かつ 20° 超で warn |
| 肘 | 2° 未満で中間位 | 屈曲 | 過伸展 | 屈曲 30° 超、または過伸展 5° 超で warn |
| 頸 | 1° 未満で中間位 | 頭頚部前傾 | 頭頚部後傾 | 頭頚部前傾かつ 15° 超で warn。耳と肩を結ぶ線の鉛直傾きで、頸椎の屈曲角ではない |
| 体幹 | 1° 未満で垂直 0° | 前傾 | 後傾 | 絶対値 5° 超で warn |
| 股 | 1.5° 未満で中間位 | 屈曲 | 伸展 | 屈曲 10° 超で warn |
| 膝 | 絶対値 2° 以内は伸展位 0° | 屈曲 | 過伸展 | 過伸展の絶対値が 3° を超えると badge「反張膝 ⚠️」と status alert。屈曲の絶対値が 5° を超えると badge「屈曲拘縮疑い」と status warn |

`formatDeviation(cm)` は矢状面の「前 1.2 cm」「後 1.2 cm」「正中 0.0 cm」です。`formatSignedDeg` も符号を捨てて `X.X°` にします。

### js/render.js

キャンバス描画だけです。DOM のサイド HUD は書きません。

- `RM.getAspectFitBounds(canvasWidth, canvasHeight, mediaWidth, mediaHeight)` は画像をキャンバスに収めた矩形です。座標はこの矩形の画素です。デバイスピクセル比で二重に掛けないこと。
- `RM.renderFrame(ctx, frame)` が 1 枚分です。`frame.plane === 'frontal'` かつ `frame.frontal.ok` のとき前額面を描きます。それ以外で矢状面が有効なら、片側の骨格、ROM 開放時の腕、ケンダル線（キャプション `Plum Line`、緑の破線、発光）を描きます。
- 前額面は正中の緑破線（キャプション `正中`）、耳・肩・股を結ぶ細い水平線と角度バッジ、左右の股〜膝〜外果です。膝の線の色は status に従い、ok が緑、warn が黄、alert が赤、点不足は灰です。
- キャンバス左上の AI ステータスは描画 HUD です。前額面なら「平面 前額面」、矢状面なら側面と前方の行を出します。左上の当たり判定は `RM.hitTestHud` です。
- `RM.drawSwayChart(ctx, model)` は前後動揺です。`model.target` は `ear` `shoulder` `hip` `knee` で、それ以外は耳です。色は耳 `#22d3ee`、肩 `#a78bfa`、股 `#fb923c`、膝 `#f472b6` です。0 cm は緑の破線、再生位置は白い縦線です。正の cm は上（前方）、負は下（後方）です。戻り値の `plot` は CSS 画素で、タップ位置から時刻を決めます。

### js/ui.js

DOM の文字と見た目だけです。計測はしません。

- `updateSummary` は `state.plane === 'frontal'` のとき前額面 HUD を書き、矢状面のとき既存の耳・肩・股・膝・体幹・頸を書きます。どちらも続けて ROM と注釈を更新します。
- 前額面の左 HUD は `#metric-head-tilt` 頭部、`#metric-shoulder-level` 肩峰、`#metric-pelvis-level` 骨盤です。右は `#metric-cog` 重心、`#metric-knee-right` 右膝、`#metric-knee-left` 左膝です。膝の補足は `#metric-knee-right-judge` と `#metric-knee-left-judge` です。
- 矢状面の左は `#metric-ear` `#metric-shoulder` `#metric-hip`、右は `#metric-knee`（補足 `#metric-knee-judge`）、`#metric-trunk`、`#metric-neck` です。表示の切替は `#screen-wrapper` の `data-plane` と CSS です。要素は消しません。
- `splitClinical` は「右下がり 1.8°」のような文を方向と数値に分けます。「正常アライメント」は数値なしです。
- `setRomOpen` は `#rom-drawer` と `#btn-rom` を更新し、Step 3 なら骨格を描き直します。ROM の ID は `rom-shoulder`、`rom-elbow`、`rom-neck`、`rom-trunk`、`rom-hip`、`rom-knee` と、それぞれの `-dir` `-badge` です。ROM は矢状面の `alignment.rom` を使います。
- `setSwayTarget` は `.sway-key` の `is-active` と `aria-pressed` を切り替え、波線を描き直します。
- `syncPlaneControls` はトグルの押下状態と `data-plane` を揃えます。`showPlaneToast` は約 2.2 秒で `#plane-toast` を隠します。
- 再生時刻、シークバー、ファイル名、Step 1 の `#pick-status`、黒帯幅 `--pillar` もここです。

### js/app.js

起動 `boot`、メディア、再生、シーク、イベントです。`document.readyState` が `loading` なら `DOMContentLoaded` で `boot` します。

`boot` は必要な `RM` 関数が揃っているか確認します。欠けるとコンソールへ出して止まります。そのあと動画の `playsInline`、`muted`、`preload = 'auto'` を設定し、`state.heightCm` を保存値にします。

ここにある主な関数:

- `setHeight` は 50〜250 に丸め、入力とスライダーと `sessionStorage` を更新します。Step 3 でランドマークがあるときは波線を消して再計算します。
- `renderFrameOnly` は Step 3 だけ `RM.renderFrame` を呼び、アクセシブル名、黒帯、波線を更新します。
- `recordSway` は動画の矢状面 cm だけを記録します。前額面表示中でも波線の材料は矢状面です。
- `resizeCanvas` はラッパーと波線の実寸にキャンバスを合わせます。倍率は `devicePixelRatio` の最大 2 です。サイズが変わってランドマークがあるときは再計算します。
- `nudgeOpeningFrame` と `renderVideoFrame` が先頭フレームです。
- `goToStep` が画面遷移です。Step 3 に入ると `beginAnalysis` です。
- `loadVideoFile` / `loadImageFile` がファイルを開きます。`takeFile` は input を空に戻してからローダーへ渡します。
- `togglePlay` と `stepFrame` が再生と 1/30 秒のコマ送りです。キーボードは Step 3 で、入力欄以外の Space、左右矢印だけ `preventDefault` します。
- `clearAnalysis` は姿勢、平面、ロック、波線を初期に戻します。`clearVideo` は世代を進めて URL を解放します。

イベントは再生ボタン、コマ送り、シーク、動画の `play` `pause` `ended` `timeupdate` `loadedmetadata` `loadeddata` `canplay` `seeked`、ファイル 3 種、キャンバスの AI ステータス折りたたみ、波線のドラッグ、平面トグル、ROM、リサイズ、身長、戻る、再撮影です。

## CSS の担当

| ファイル | 担当 |
| --- | --- |
| `css/base.css` | `:root` の色、リセット、フォント、`html`/`body` のスクロールとセーフエリア、`.app`、ヘッダー、ステッパー、画面切替のアニメーション |
| `css/steps.css` | Step 1 のガイドと撮影カード、Step 2 の身長ダイヤルとピル、共通ボタン |
| `css/analysis.css` | `.screen-wrapper`、Step 3 の再生バーとシーク、解析バー、輸送コントロール。古い集計用の `.summary` も残っている |
| `css/hud.css` | `.side-hud-left` / `.side-hud-right`、臨床バッジ、グラス、平面トグル、`data-plane` による HUD の表示切替 |
| `css/components.css` | 波線、ROM ドロワーと内部スクロール、トースト。末尾に短い画面用の `@media` |

色は背景 `#090d16` から `#0f172a`、強調 `#10b981` と `#34d399`、ガラスは `rgba(15, 23, 42, 0.75)` 前後です。動画枠は高さ `70dvh`、最大 `74dvh` で、短い画面では中身を縮め、ページ自体はスクロールします。

サイド HUD は動画の左右の黒帯に置きます。幅は `min(22%, 108px, max(var(--pillar), 64px))` です。左 HUD は上の AI ステータスを避けるため `padding-top: 64px` です。HUD は `pointer-events: none` です。

## 変更するときの見方

- 数値の意味を変えるなら `js/math.js` だけを見て、描画と DOM を一緒に変えないこと。表示文は formatter の `text` を DOM がそのまま使います。
- 線や色を変えるなら `js/render.js` です。サイドの数字は `js/ui.js` です。
- 再生やファイルを変えるなら `js/app.js` です。ui の関数をアプリ側から呼ぶときは、既存のブリッジ関数（`updateSummary()` のように同名で `RM` へ委譲する関数）を使うか、`RM.関数` を直接呼ぶこと。ui からアプリの関数を呼ぶ新経路は `RM._hooks` に足すこと。
- レイアウトを変えるなら、その部品の CSS ファイルだけを変えること。`@media` を前のファイルへ移すと、後ろの通常ルールに上書きされて、短い画面の指定が効かなくなります。
- 新しいグローバル名を増やさないこと。共有するものは `RM` に足します。
- このアプリはバンドルしません。新しいファイルを足すなら `index.html` の script または link に、依存より後ろで追加します。
