## 0002: Offscreen Export (Classic) 現状ADR

### 状況

ComfyUI Classic (LiteGraph) の workflow JSON から、オフスクリーンで PNG を出力する実装を進行中。
UI の設定（背景色など）は触らず、画面キャンバスに依存しない export 専用の
`LGraph` / `LGraphCanvas` を毎回生成して描画している。

現時点の主な要件:
- UI への副作用なし
- DOM オーバーレイは不安定なため原則使わない
- 画像/動画は必ずサムネイルとして出す
- 透明はベストエフォート + フォールバック

### 決定

1. export は **オフスクリーン専用グラフ**で描画する。
   - `new LGraph()` + `new LGraphCanvas()` を毎回作成して破棄
2. bbox は graph のノード `pos/size` と `getBounding` を参照し、`padding` を追加。
3. DOM 合成は全面的に停止する。
   - DOM 依存のテキストや画像が壊れやすいため
4. マルチラインテキストは **DOM無しのフォールバック描画**で出す。
   - `drawWidgetTextFallback` を offscreen で直接描画
5. 画像は **live graph のノードにある media 情報**を export graph にコピーして描画。
   - `imgs` / `img` / `canvas` / `preview` などを移植
6. 動画は **サムネイルを必ず出す**方針。
   - `LoadVideo` の `images/animatedImages` が `{type, filename, subfolder}` 形式であることを確認
   - `/view?filename=...&subfolder=...&type=...` 経由で取得する方針
   - 動画URLの場合は video から 1 フレームを抽出して描画する方針

### 現状の成果

- ノード描画・背景・サイズは安定。
- 画像ノード（静止画）は表示できている。
- マルチラインの生テキストは表示できている。

### 未解決/課題

1. **動画サムネイルがまだ出ていない**
   - `LoadVideo` は `images/animatedImages` にメタ情報のみが載る。
   - `VHS_LoadVideo` は keys が空で、実体の所在が未確定。
2. **ズームアウト時でもテキストを表示**する必要がある
   - ComfyUI側ではズームアウトでテキストが省略されるが、export では常に表示したい。

### 次のアクション

1. VHS_LoadVideo の実体がどのプロパティに入るか特定し、サムネ取得経路を確定する。
2. ズームアウト時でもテキストが描かれるよう、フォールバック描画の強制表示を調整する。
