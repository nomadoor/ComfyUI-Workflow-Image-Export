# ADR 0016: Classic 書き出しは clone グラフだけで描画する

## Status

Accepted

## Context

Classic の通常サイズの書き出しとプレビューは、表示中の `app.graph` に
2 つ目の `LGraphCanvas` を結び付けて描画していた。Tile 経路だけが、
serialize したワークフローから作る clone グラフで描画していた。

画面のグラフに結び付けたキャンバスは、画面側の状態を書き換える。
そのため、ノードの位置・サイズ、Widget のレイアウト、DOM Widget のスタイル、
`primaryCanvas`、`list_of_graphcanvas`、`LGraphCanvas._measureText`、
`devicePixelRatio` を書き出し後に戻す live render guard が必要になっていた。

frontend 1.58 では、選択状態がグラフ単位のストアに移った。`LGraphCanvas` の
コンストラクタは `clear()` で選択を解除するため、書き出しのたびに
ユーザーの選択が消えた。ダイアログは次のプレビューで選択なしと判定して
Scope を無効にし、グラフ全体を書き出していた。guard に戻す項目を足しても、
frontend がグラフ単位の状態を増やすたびに同じ壊れ方が起きる。

画面のグラフで描画を続けていた唯一の有効な理由は、実行時にだけ存在する画像
（Load Image のプレビュー、実行結果の `node.imgs`）だった。clone はこれを
持たないため描けなかった（ADR 0014 の 2026-09-15 追記）。

## Decision

1. Classic の PNG/WebP 書き出しとダイアログのプレビューは、すべて
   `exportWorkflowPng()` の clone 描画を使う。`captureLegacy()` と
   live render guard は削除する。経路の判定は出力の倍率と Tile の要否だけを
   決める。
2. 実行時の画像は ADR 0015 の描画モデルが書き出し開始時に取得する。
   `node.imgs` のすべてが origin-clean な場合に限り、その画像要素を
   `runtimePreviews` として保持する。clone の同じ ID のノードに渡し、
   LiteGraph 本来のプレビュー Widget に描かせる。アニメーションの
   プレビューは DOM Widget の経路のまま扱う。汚染される画像は渡さない。
3. 書き出し用の `LGraphCanvas` は `skip_events` と `skip_render` を指定して
   作る。イベントの登録も描画ループも行わない。
4. 書き出し用キャンバスは、画面のキャンバスで読み込み済みの grid 画像を
   共有する。新しい `Image` を作ると、その load イベントが解放済みの
   キャンバスを再描画してエラーになるため。
5. 巨大グラフ用の近似サムネイルは、clone が本来の描画をするノードには
   重ねない。
6. clone には画面のルートグラフ ID を渡さない。LiteGraph は使用中の ID を
   警告付きで拒否し、新しい ID を発行するため、最初から新しい ID にする。
7. markdown Widget の foreignObject 画像化は書き出しだけで行い、プレビューでは
   テキストとして描く（ADR 0009）。

## Consequences

- 書き出しもプレビューも、画面のグラフ、選択、serialize 結果、
  `graphToPrompt()` を変更しない。frontend 1.58.5 で確認した。
- 既定ワークフローと Load Image の通常書き出しは、旧経路の出力と
  ピクセル単位で一致した。
- プレビューは `previewFast`（約 1 MP 上限）で描画する。Scope を有効にすると
  4 パスで合成するため、旧経路の矩形塗りよりも正確だが重くなる。
- clone の構築は、サードパーティ製ノードの `onAdded` や `onConfigure` を
  プレビューのたびに実行する。VHS の動画ノードでは、clone ごとに
  ローカルサーバーへの動画の問い合わせが発生する。出力を持つノードでは、
  frontend が clone 用に出力画像を読み込み直す。
- 汚染される画像を 1 枚でも含むノードは、書き出し全体を失敗させず、
  そのノードのプレビューだけを省く。
- 旧通常経路は markdown を常にテキストで描いていた。書き出しは Tile 経路と
  同じ画像化にそろう。
- サブグラフ内部のノードの実行時画像は取得しない。サブグラフノードに
  プロモートされたプレビューは描かれない可能性がある（未検証）。

## Relationship

ADR 0015 の決定 7 と ADR 0014 の「Tile は閾値まで live renderer に残す」を
置き換える。ADR 0014 の決定 3 のうち、実行時のメディアを clone に
コピーしない原則は、origin-clean を確認した画像に限って緩める。
