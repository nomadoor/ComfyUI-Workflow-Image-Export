# Engineering workflow

## Language

- Project prose language: Japanese

AI-only instructionsは英語で記述する。schemas、identifiers、template headings、tool keywords、canonical termsは英語を維持する。Issue、commit message、PR、ADR、repository documentationなど、人間がreviewする文章にはproject prose languageを使用する。

## Branch policy

- 承認された最初のrepository変更の直前にwork branchを作成する。
- default branch上で製品またはworkflow fileを変更しない。
- Phase 1がrepositoryを変更しない場合は、`GO`後、実装開始前にbranchを作成する。

## Specification and tickets

- 新機能とbehavior changeには仕様を要求する。
- 明確で小さいbug fix、behavior-preserving refactor、documentation、mechanical configurationでは仕様を省略できる。
- 複数sessionや複数agentにまたがるwork、または一つのcontext windowへ安全に収まらないworkにはticketを使用する。
- 仕様とticketの公開には、それぞれ明示的な承認が必要である。
- domain-docの承認は、承認されたglossaryまたはADR編集だけを許可する。

## Authorization

- `GO`は実装、test、internal review、およびそのreviewで見つかった安全な修正を許可する。
- `GO`はcommitを許可しない。
- commitは、diff、requirements、test、review findingsを含むcommit packetを提示した後、明示的な承認を必要とする。
- pushとPR作成はcommitとは別の承認を必要とする。PRは既定でDraftとする。
- Draft PRをreadyにするにはCI成功とユーザー承認が必要である。
- mergeは初期workflowの範囲外である。

## Implementation and review

- 新しいbehaviorとbug fixにはTDDを使用する。
- documentation、comments、behavior-preserving mechanical change、generated files、external configurationには、理由を記録したうえで例外を認める。
- 緊急修正では実装を先行できるが、直後にregression testを追加する。
- commit前に、uncommitted working tree全体をStandards、承認済みrequirements、仕様、ticket、関連domain docsと照合する。
- behavior-changing commitには、実装sessionとは別のread-only AI reviewを要求する。
- 別reviewにはrequirements source、仕様とticket、関連domain docs、diff、verification resultsを渡す。
- findingsはP0 / P1 / P2 / P3で分類する。P0とP1はcommitをblockする。
- P0またはP1を修正した後は再reviewする。
