# canva-json-decode

Personal CLI (`~/scripts/canva-json-decode`) to deserialize Canva wire JSON using generated web TypeScript protos from a local checkout.

## Usage

Run from a Canva checkout (or set `CANVA_ROOT`):

```bash
canva-json-decode --proto FooResponse < body.json
canva-json-decode --proto Foo --list
canva-json-decode --proto FooResponse --pick 1 --input body.json
canva-json-decode --proto web/src/services/foo/foo_proto.ts:FooResponse --input body.json
```

Exact `export const <Name>` first, then substring `export const *<Name>*`. Writes a temp `.json` and opens it in Cursor (no stdout dump).

## Requirements

- Node
- Canva checkout with `node_modules` (`esbuild-wasm`) and `web/tsconfig.paths.json`
- `rg` on PATH, or `$CANVA_ROOT/bin/rg`
