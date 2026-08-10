# Форматы файлов лаборатории

Версия документа: `0.1-experimental`.

Форматы ниже предназначены для экспериментов `anum_parser`. Они не объявляют конкретный сериализатор нормативным для МТС.

## 1. Raw четверичное ачисло — `.anum4`

### Назначение

Минимальная физическая запись последовательности абитов без метаданных.

### Профиль `mts-abit-v1`

Допустимы ровно четыре ASCII-байта:

```text
[ ] 1 0
```

Правила:

- кодировка физически ASCII и тем самым валидный UTF-8;
- BOM запрещён;
- пробелы, CR/LF, комментарии и прочие символы не игнорируются молча;
- `∞` не хранится как пятый символ;
- пустой файл разрешён как пустая физическая последовательность;
- смысл пустой последовательности определяется выбранным десериализатором;
- файл хранит **последовательность символов**; превращение этих символов в **последовательность абитов** является отдельным шагом профиля.

Примеры:

```text
[]
[10]
[[10]]10
10[10]
```

## 2. Raw строковое ачисло — `.anums`

### Назначение

Точная человекочитаемая последовательность Unicode-символов.

Правила:

- кодировка UTF-8;
- BOM запрещён;
- Unicode normalization (`NFC/NFD/NFKC/NFKD`) не выполняется автоматически;
- порядок Unicode scalar values сохраняется;
- пустая строка разрешена;
- символы строки не считаются абитами автоматически;
- `a`, `window`, `🙂`, `[` — прежде всего символы исходной строки;
- перевод символов в exact refs требует явного словаря/профиля.

Примеры:

```text
abc
window(position)(x)(10)(int)
boolean(true)
🙂
```

## 3. Самодокументируемый artifact — `.anum.json`

Используется UI, тестами и обменом экспериментами. Raw-форматы он не заменяет.

Минимальный пример:

```json
{
  "format": "mts-anum",
  "version": "0.1",
  "kind": "quaternary",
  "profile": "mts-abit-v1",
  "data": "[10]",
  "provenance": {
    "status": "experimental"
  }
}
```

Для строки:

```json
{
  "format": "mts-anum",
  "version": "0.1",
  "kind": "string",
  "encoding": "utf-8",
  "data": "abc"
}
```

Поле `profile` описывает **физический/лексический профиль**, а не обязано задавать семантику десериализации. Алгоритм десериализации выбирается отдельно.

## 4. Наглядная асеть — `.aset.json`

### Цель

Сохранить exact топологию связей и одновременно показать служебные представления, не смешивая их с сетью.

### Базовая структура

```json
{
  "format": "mts-aset",
  "version": "0.1",
  "root": "R",
  "links": [
    {"id": "R", "start": "R", "end": "R", "tags": ["root"]},
    {"id": "L1", "start": "A", "end": "B"}
  ],
  "labels": {
    "R": "∞",
    "L1": "A⟼B"
  },
  "symbolSequences": [],
  "abitSequences": [],
  "linkSequences": [],
  "rootChains": [],
  "storedAnums": [],
  "provenance": {}
}
```

## 5. `links`: только exact связи

Каждая запись:

```json
{"id":"L42","start":"L10","end":"L11"}
```

`id` задаёт exact occurrence в пределах файла.

Следовательно, разрешено:

```json
{"id":"L1","start":"A","end":"B"}
{"id":"L2","start":"A","end":"B"}
```

`L1` и `L2` остаются разными exact occurrences.

`labels` и `tags` не изменяют топологию.

## 6. `symbolSequences`

Исходная последовательность символов:

```json
{
  "id": "source:0",
  "kind": "utf8-symbols",
  "items": ["a", "b", "c"],
  "text": "abc"
}
```

Это **не последовательность связей**.

## 7. `abitSequences`

После явного лексического разрешения:

```json
{
  "id": "abits:0",
  "profile": "mts-abit-v1",
  "symbols": ["[", "1", "0", "]"],
  "refs": ["O1", "L1", "N1", "C1"]
}
```

`symbols` — физические знаки, `refs` — выбранные exact occurrences абитов в конкретном эксперименте.

## 8. `linkSequences`

Упорядоченный список exact refs:

```json
{
  "id": "links:0",
  "items": ["A", "B", "C"]
}
```

Эта запись **не материализует** `(A⟼B)⟼C`. Она только фиксирует порядок ссылок.

## 9. `rootChains`

Конкретная связь-последовательность, исходящая из акорня:

```json
{
  "id": "carrier:abc",
  "sourceSequence": "links:0",
  "items": ["A", "B", "C"],
  "head": "RC3"
}
```

При этом в `links` должны существовать exact связи:

```text
RC1 = R   ⟼ A
RC2 = RC1 ⟼ B
RC3 = RC2 ⟼ C
```

`head` указывает на последнюю exact связь carrier.

## 10. `storedAnums`

Исторические схемы требуют различать связь/денотат и отдельную связь, кодирующую ачисло.

```json
{
  "id": "stored:0",
  "storageLink": "S1",
  "carrier": "RC3",
  "denotation": "D2",
  "serializer": "storage-link-v0",
  "status": "experimental"
}
```

Топология `S1` определяется выбранным serializer profile и обязана находиться в `links`.

Само присутствие `storedAnums` **не создаёт** `S1`.

## 11. `provenance`

Рекомендуемые поля:

```json
{
  "source": {
    "kind": "quaternary",
    "profile": "mts-abit-v1",
    "raw": "[10]"
  },
  "deserializer": "stack-group-value-v0",
  "serializer": null,
  "status": "experimental",
  "traceVersion": "0.1"
}
```

## 12. Round-trip уровни

Нужно различать три обещания:

### `source-round-trip`

Можно без потерь восстановить те же raw bytes/source text.

### `topology-round-trip`

Можно без потерь восстановить exact `links` с теми же ids и полюсами внутри artifact.

### `semantic-round-trip`

Serializer(deserializer(x)) даёт эквивалентный смысл по **конкретной** теории. Это самое сильное обещание и не предполагается автоматически.

## 13. Ошибки

Импортёр должен выдавать diagnostic, а не исправлять молча:

- `invalid-utf8`;
- `bom-not-allowed`;
- `invalid-abit-symbol`;
- `unknown-format-version`;
- `dangling-link-ref`;
- `duplicate-link-id`;
- `missing-root`;
- `unsupported-round-trip`;
- `algorithm-undefined-transition`.

## 14. Расширение форматов

Новая версия меняет `version`, если меняется структура файла. Новый вариант смысла **не обязан** менять формат: он должен получить новый `deserializer/serializer id`.

Это специально позволяет одному `.anum4` сравниваться десятками алгоритмов без переписывания самого входного файла.