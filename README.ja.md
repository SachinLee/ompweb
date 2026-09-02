# ompweb

[![npm version](https://img.shields.io/npm/v/@kahme247/ompweb.svg?logo=npm&color=e05d44)](https://www.npmjs.com/package/@kahme247/ompweb)
[![node version](https://img.shields.io/node/v/@kahme247/ompweb.svg?logo=node.js&color=44cc11)](https://nodejs.org)
[![license](https://img.shields.io/github/license/kahme247/ompweb.svg?color=44cc11)](./LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/@kahme247/ompweb.svg?color=44cc11)](https://www.npmjs.com/package/@kahme247/ompweb)
[![GitHub stars](https://img.shields.io/github/stars/kahme247/ompweb.svg?logo=github)](https://github.com/kahme247/ompweb/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/kahme247/ompweb/pulls)

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

コミュニティ：[OMPWEB Discord に参加](https://discord.gg/evqgGzRfM5)

[oh-my-pi (omp)](https://github.com/can1357/oh-my-pi) コーディングエージェント向けのモダンな Web UI です。ローカルの omp セッションを読み込み、ブラウザから対話、プロジェクト閲覧、設定管理、ファイルプレビューを行えるワークスペースを提供します。

![ompweb — デモ](docs/demo.gif)

<details>
<summary>スクリーンショット（ライト / ダークテーマ）</summary>

![ompweb — ライトテーマ](docs/screenshot-light.png)

![ompweb — ダークテーマ](docs/screenshot-dark.png)

</details>

## 必要条件

- [omp](https://github.com/can1357/oh-my-pi) がインストールされ、`PATH` に含まれていること（または `OMP_WEB_OMP_BIN` で指定）
- Node.js `>= 22.19.0`

## クイックスタート

**インストールせずに直接実行:**

```bash
npx @kahme247/ompweb@latest
```

**またはグローバルにインストール:**

```bash
npm install -g @kahme247/ompweb
ompweb
```

**エンジニアリングワークフローで共有 Web UI を使う場合:**

```powershell
ompw --web
```

`ompw` は `my-engineering-workflow` が提供します。`ompweb` は同名コマンドを再登録しません。
`ompw --web` は 1 つの Web サービスだけを起動または再利用します。複数のプロジェクトを
同じ UI で管理し、各ライブ OMP 子プロセスはそれぞれの session cwd を使用します。

設定ファイルを直接指定する場合:

```powershell
ompweb --omp-config "D:\my-works\claude-skills\my-engineering-workflow\config\omp-workflow.yml"
```

続いて [http://127.0.0.1:30177](http://127.0.0.1:30177) を開きます。サーバーの準備が整うと、CLI はブラウザを自動的に開こうとします。ompweb はデフォルトで `127.0.0.1` で待ち受けます。

### CLI オプション

```bash
ompweb --port 8080              # カスタムポート
ompweb --hostname 0.0.0.0       # 信頼できるネットワークに公開
ompweb -p 8080 -H 0.0.0.0       # オプションを組み合わせる
ompweb --no-open                # ブラウザを自動的に開かない
ompweb --omp-config "D:\path\to\engineering-workflow.yml" # ライブ OMP 子プロセスの設定

ompweb --password "a-long-random-password" # パスワードのみのサインインを有効化（Windows でも同様）

PORT=8080 ompweb                # 環境変数にも対応
OMP_WEB_HOSTNAME=0.0.0.0 ompweb # ネットワーク公開を明示的に有効化
OMP_WEB_PASSWORD='a-long-random-password' ompweb # 環境変数でも同様（POSIX）
# Windows: $env:OMP_WEB_PASSWORD="secret"; ompweb
OMP_WEB_NO_OPEN=1 ompweb        # バックグラウンドサービスとして実行する場合に便利
```

## 主な機能

- **リアルタイムチャット**: ローカルの `omp` エージェントとストリーミング対話。
- **セッション管理**: プロジェクトごとに履歴を一覧表示、分岐やフォークにも対応。
- **ライブタスク＆サブエージェント**: Todo リストと稼働中サブエージェントの進捗を折りたたみパネルでリアルタイム表示。
- **ファイル閲覧・プレビュー**: チャットと並べてファイルを閲覧、コード・Markdown・画像・音声・PDF をプレビュー。
- **Git Worktree サポート**: サイドバーから直接 Git ワークツリーを切り替え・管理。
- **GUI 設定管理**: 設定ファイルを直接編集することなく、モデル、API キー、MCP サーバー、スキル、プラグイン、OMP 設定を変更可能。
- **スラッシュコマンド・ショートカット**: `/plan`、`/review`、`/fix`、`/test` などの定型プロンプトと `⌘K` / `Ctrl+K` コマンドパレット。
- **テーマと多言語対応**: ペーパー調のライト/ダークテーマ、英語・簡体字中国語・日本語に完全対応。

## 環境変数

## 設定

| 変数 | 意味 |
| --- | --- |
| `PORT` | サーバーポート（デフォルト `30177`。`-p/--port` が優先） |
| `OMP_WEB_HOSTNAME` | バインドするホスト名（デフォルト `127.0.0.1`。`-H/--hostname` が優先） |
| `OMP_WEB_PASSWORD` | サインイン画面用の任意のパスワード |
| `OMP_WEB_NO_OPEN` | `1`/`true` を設定するとブラウザの自動起動をスキップ |
| `OMP_WEB_OMP_BIN` | `PATH` にない場合の `omp` バイナリ絶対パス |
| `OMP_WEB_OMP_CONFIG` / `--omp-config` | すべてのライブ OMP 子プロセスへ渡す設定ファイル |
| `PI_CODING_AGENT_DIR` | 別の omp agent ディレクトリ（デフォルト `~/.omp/agent`） |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | サーバーサイドリクエスト用の標準プロキシ変数 |

## アーキテクチャ

ompweb は Node 上でホストされる Next.js アプリで、インストール済みの `omp` バイナリを操作します。エージェント自体は同梱していません:

- **ライブセッション**: `omp --mode rpc-ui`（stdio 上の NDJSON）を、アクティブなセッションごとに 1 つの子プロセスとして起動します。そのため、エージェントのバージョンは常にインストールされているものと完全に一致します。
- **セッション閲覧**: omp のセッションファイル（`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`）を直接読み込みます。タイトル変更、アーカイブ、削除は、OMP のライブ書き込みと競合しないよう保護されたネイティブファイルのメンテナンス操作です。
- **モデルと認証**: omp 子プロセスに対する RPC コマンドを使用します。モデルパネルは omp エージェントディレクトリ内の `models.yml` を編集します。
- **スキルとプラグイン**: omp のスキルディレクトリ（`~/.omp/agent/skills`、プロジェクトの `.omp/skills`、互換ディレクトリ）をスキャンし、プラグイン管理には `omp plugin` を呼び出します。
- **ファイルアクセス**: ファイルの閲覧とプレビューは、選択したプロジェクトディレクトリとセッションに現れる作業ディレクトリに限定されます。
- **フォークとセッション内ブランチの違い**: フォークは新しい `.jsonl` ファイルを作成します。「ここから編集」は同じセッションファイル内に別のブランチを作成します。

## 開発

```bash
git clone https://github.com/kahme247/ompweb.git
cd ompweb
npm install
npm run dev
```

ローカル開発サーバーは [http://127.0.0.1:30178](http://127.0.0.1:30178) で起動します。

### チェックコマンド

```bash
npm run typecheck   # 型チェック (TypeScript)
npm run lint        # ESLint
npm test            # テスト実行
```

> **注意**: ローカル開発中に `npm run build` を実行しないでください（`.next/` が生成され `npm run dev` に影響を与える恐れがあります）。

## クレジットとライセンス

- [agegr/pi-web](https://github.com/agegr/pi-web) (MIT) をベースに [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 向けに適合・拡張したフォークです。
- [MIT ライセンス](./LICENSE) のもとで公開されています。
