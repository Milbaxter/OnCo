# onco

[OnCo](https://onco.cc), the public cited knowledge graph of oncology, from the terminal. One binary, no runtime dependencies, Node 20 or later. It reads the same static API the site publishes at `https://onco.cc/api/v1/` (see https://onco.cc/api/), so nothing is scraped and nothing is invented.

```sh
npx onco search "HER2-low breast cancer" --kind drug
npm install -g onco && onco --help
```

## Commands

| Command | What it does |
|---|---|
| `onco search <query> [--kind k] [--limit n]` | Word search plus concept search, fused the way the site does it. Each hit says why it matched. |
| `onco get <id\|route\|url>` | One record: TL;DR, summary, key fields, connected records, sources. `--json` gives the raw record with its neighbours. |
| `onco list <kind> [--filter key=value ...] [--limit n]` | Every record of a kind, filtered on any field (`status=approved`, `modality=ADC`, `targets=trop2`, `phase=3`). |
| `onco ask "<question>" [--region UK]` | Ask OnCo: the cited, templated answer from https://onco.cc/ask/, built from record fields with one citation per sentence. No language model. |
| `onco context <id>` | The record as clean Markdown (`/api/v1/context/<id>.md`), ready to paste into a prompt. |
| `onco kinds` | The eighteen kinds with counts and one-line descriptions. |
| `onco export <kind> --csv\|--json` | The kind's published CSV (first line is the licence comment) or JSON array, to stdout. |
| `onco meta` | Build date, version and counts from `meta.json`. |

Ids are the last segment of a page URL: `https://onco.cc/drugs/trastuzumab-deruxtecan/` is `trastuzumab-deruxtecan`. Routes and full URLs are accepted wherever an id is. Kinds can be given as singular, plural or route (`drug`, `drugs`, `paper`, `key-papers`).

```sh
onco get tnbc
onco get /drugs/trastuzumab-deruxtecan/ --json | jq '.entity.approvals'
onco list trial --filter status=recruiting --filter cancers=tnbc
onco ask "What did DESTINY-Breast04 show?"
onco ask "Is Enhertu approved in the UK?" --region UK
onco export cancer --csv > cancers.csv
onco search NCT04595565
```

## Output and attribution

Human output ends with the line `Data from OnCo (onco.cc), CC BY-NC 4.0; commercial use needs a licence`. With `--json` or `--csv` the same line goes to stderr so stdout stays machine-readable. `--quiet` drops it from the terminal; the attribution obligation stays with whoever uses the data. Exit codes: 0 success, 1 not found or network, 2 usage.

Ask OnCo answers end with "OnCo is an orientation tool, not medical advice." Keep that line when you pass an answer on.

If Ask cannot read a record because of a connection failure, an HTTP error other than 404, or invalid JSON, it exits 1 and reports the error on stderr without printing an answer. A missing record (404 or a missing local file) can still be omitted from the answer. Failed reads can be retried; they are not retained in the process cache.

## Another copy of the API

`ONCO_API` (or `--api`) points the tool at any copy of `/api/v1`: a mirror, or a local directory such as `out/api/v1` after building the site, which works offline.

```sh
ONCO_API=./out/api/v1 onco search "PSMA radioligand"
onco --api https://mirror.example.org/api/v1 kinds
```

## How it works

The bundle contains the site's own browser-safe modules: the MiniSearch configuration behind the search box, the TF-IDF concept index reader, the Ask OnCo pipeline (`src/lib/ask-*.ts` in the repository) and the kind table from the schema. `onco ask` fetches `ask-index.json`, `search.json`, `embeddings.json` and `embeddings.bin` once, then the handful of records the question names, exactly as the page does. Files fetched once are cached for the process.

Licence: code MIT; data as stated on https://onco.cc/api/. Source and issues: https://github.com/judegomila/OnCo (`packages/onco-cli`).
