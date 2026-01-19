## 0. 目的

* ComfyUI上で表示されているワークフロー（Legacy / Nodes 2.0 を含む）を、**UIそのまま**画像としてエクスポートできる機能を提供する。
* 右クリックメニューは汚さず、**項目は1つのみ**にする。
* エクスポート設定はダイアログで行い、**Last used（前回使用設定）をデフォルトON**で保存する。
* 設定画面（ComfyUI Settings）から初期値（デフォルト）を変更できるようにする。
* 将来の多言語化に備えたフォルダ構成を採用する（ただし現時点で自作UIの翻訳は未実装）。

## 1. 対応環境

* ComfyUI（フロントエンドの更新に耐えられる実装方針：内部変数への強い依存を避け、feature detection中心）
* Legacy（LiteGraph）と Nodes 2.0（Vue/DOMベース）どちらでも動作
* 出力形式：PNG / WebP / SVG（初期から用意）

## 2. UI要件

### 2.1 右クリックメニュー

* キャンバス右クリック（コンテキストメニュー）に **1項目のみ**追加

  * 表示名：`Export Workflow Image…`
  * `…` でダイアログが開くことを示す
* 項目の左に **SVGアイコン**を表示（控えめ、単色、currentColor推奨）
* 右クリックメニューにはショートカット表記は出さない（横長回避）
* メニュー内での配置は可能な限り上の方（または区切り線直下）に置き、到達距離を短くする

### 2.2 エクスポートダイアログ（自作DOM）

* 自作DOMで構築（PrimeVue等に直接依存しない）
* 見た目はComfyUIのテーマに馴染むよう、可能ならCSS変数・既存クラスに寄せる（過剰な独自CSSは避ける）

#### Basic（常時表示）

* Format：Dropdown（PNG / WebP / SVG）
* Embed workflow：Toggle（デフォルトON）
* Background：Radio（UI / Transparent / Solid）

  * Solid選択時のみ Color Picker を表示
* Padding：Number（px）

#### Advanced（折りたたみ、デフォルトは閉）

* 出力解像度：Auto / 100% / 200%

  * 表記は “Quality” ではなく **Output resolution / 出力解像度**
* Max long edge：Number（px）
* If exceeded：Downscale / Tile
* Remember last used：Toggle（デフォルトON）

#### Footer

* 左：`Reset to defaults`（リンク風、目立たせすぎない）

  * クリックで **即時**デフォルトへ復帰（確認ダイアログは不要）
* 右：Cancel（弱） / Export（強）
* Export中はボタンを無効化し、スピナー等で処理中を表示

#### 既定値（初期）

* Format：PNG
* Background：UI
* Embed workflow：ON
* Remember last used：ON
* Padding：例 100（適宜調整可能）

### 2.3 通知

* エクスポート完了時：控えめなトースト（例：`Saved workflow.png`）
* 失敗時：簡潔なエラー表示（詳細はコンソール）

## 3. 機能要件（キャプチャ）

### 3.1 キャプチャ方式（基本）

* 原則として **DOMキャプチャを第一選択**とする（UIそのままを優先）
* LegacyでCanvasが主のケースでも、DOM上のプレビュー等が含まれるようにする

### 3.2 bounds（範囲計算）

* ノードだけではなく、**グループ枠・コメント等も含めた見た目の範囲**を取得する
* 可能ならDOM要素の `getBoundingClientRect()` の union を使用
* padding を bounds に加算

### 3.3 背景

* Background=Transparent：透過のまま出力（PNG/WebP）
* Background=Solid：指定色で必ず塗る（ユーザー設定に依存しない）
* Background=UI：現在のUI背景に合わせる
* 右端/下端が透明になる等の欠けが起きないよう、必要なら背面塗りを明示的に行う

### 3.4 テキストのはみ出し（重要）

* 問題対象は「スクショ画像の外」ではなく **ノード内の入力枠からテキストがはみ出す**こと
* DOMキャプチャではブラウザのoverflow/clipが反映されるため原理的に起きにくい
* もしCanvas合成を行う場合は、入力枠領域で必ず clip を適用し、スクロール状態も考慮する

### 3.5 最大サイズ制限

* Max long edge を超える場合の挙動：

  * Downscale：縮小して収める
  * Tile：タイルレンダリング＋合成
* 既定はAdvanced内で設定（普段は触らない想定）

### 3.6 ワークフロー埋め込み

* Embed workflow=ON の場合、出力に workflow JSON を埋め込む
* PNG/WebP/SVGそれぞれ埋め込み方式は実装選択（互換性を重視しつつ、将来の変更を見越してコードを分離）

## 4. 設定要件

* ComfyUI Settings から「デフォルト設定」を変更可能にする
* ダイアログは **Last used（前回値）をデフォルトで復元**する
* `Reset to defaults` は Settingsで定義されたデフォルトへ戻す

## 5. 実装要件（カスタムノードとして）

* `__init__.py` に `WEB_DIRECTORY` を定義し、フロントJSを配布する
* 可能な限り ComfyUIの拡張API・公開されているフックを利用し、内部構造依存を最小化する
* 例外時にComfyUI全体が壊れないよう try/catch を適所に配置

## 6. 非機能要件

* 更新耐性：ComfyUIアップデートで壊れにくい構造（feature detection / ルート要素探索の分離）
* パフォーマンス：巨大ワークフローでもフリーズしにくい（上限、タイル等）
* 可観測性：デバッグログは設定でON/OFF（将来）

---