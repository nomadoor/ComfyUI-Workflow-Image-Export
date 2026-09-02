# Domain docs

このrepositoryは単一のdomain contextとして扱う。

- Canonical glossary: root `CONTEXT.md`。現在は存在しないため、必要になった時点でdomain-modeling workflowを通して作成する。
- Requirements: `ops/requirements.md`
- Architecture decisions: `ops/adr/`
- Historical test and implementation notes: `ops/test-strategy.md`、`ops/notes.md`

domainまたはarchitectureを変更する前に、関連するrequirementsとADRを読む。既存ADRと矛盾する変更を黙って実装せず、矛盾を明示して判断を求める。

domain documentationの承認は、承認されたglossaryまたはADRの変更だけを許可する。製品実装、commit、push、Issue、PRは別の承認を必要とする。
