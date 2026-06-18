# VSB body format

## Section headers

Lines matching (case insensitive):

- `verse`, `verse 1`, `verse 2`
- `chorus`, `chorus 2`
- `bridge`, `intro`, `outro`

## Chord charts

Pairs of lines where the first line contains chord tokens (`Am`, `Dm/A`, `Asus4`, etc.) aligned above the lyric line on the second line.

Example:

```
chorus
         Dm                    A
Fall til ro og kjenn at jeg er Herre
```

Converted to ChordPro inline chords at computed character positions.

## Multi-key

VSB `Key` field values like `D / E` map to:

- `{key: D}`
- `{meta: alt_keys=E}`
