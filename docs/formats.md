# Форматы файлов лаборатории

Этот документ описывает текущие файловые границы `anum_parser`.

Теоретическая норма МТС находится в `anum_docs`. Для accepted четверичного исполнения лаборатория использует exact-pinned `@mts/core@0.10.0` / MTS v0.10 из `contracts/mts-core-consumer-lock.json`.

Лабораторный id `anum-v0.4` — стабильный id десериализатора и не является номером текущего MTS release.

## 1. Четверичный источник `.anum4`

`.anum4` — минимальная физическая запись четверичного ачисла без метаданных.

Допустимы ровно четыре ASCII-знака:

```text
[ ] 1 0
```

Правила:

- BOM запрещён;
- пробелы, переводы строки, комментарии и любые другие символы не игнорируются;
- `∞` не записывается как пятый знак;
- пустой файл разрешён;
- физическая последовательность символов и последовательность ссылок на абиты остаются разными представлениями.

Строгий `.anum4` parser — presentation boundary `anum_parser`. После проверки exact sequence передаётся в accepted `@mts/core.executeAbits`.

Текущий accepted laboratory deserializer id:

```text
anum-v0.4
```

Semantic authority:

```text
MTS v0.10
@mts/core@0.10.0
```

Контрольные примеры:

```text
ε      -> R
[]     -> R
1      -> L
10     -> L ⟼ U
[1]    -> R ⟼ L
[[]]   -> R
```

## 2. Строковый источник `.anums`

`.anums` — физическая последовательность Unicode-символов в UTF-8.

Правила:

- BOM запрещён;
- автоматическая Unicode-нормализация не выполняется;
- порядок Unicode-скаляров сохраняется;
- пустая строка разрешена;
- символы строки не считаются четверичными абитами автоматически.

Строковая десериализация имеет experimental status и не наследует accepted `@mts/core` authority автоматически.

## 3. Контейнер `.anum.json`

Самодокументируемый контейнер физического источника:

```json
{
  "format": "mts-anum",
  "version": "0.1",
  "kind": "quaternary",
  "profile": "mts-abit-v1",
  "data": "[10]"
}
```

Для строки используется:

```json
{
  "format": "mts-anum",
  "version": "0.1",
  "kind": "string",
  "encoding": "utf-8",
  "data": "abc"
}
```

Контейнер хранит source. Алгоритм и его semantic authority выбираются отдельно.

## 4. Асеть `.aset.json`

Текущая версия laboratory Aset format:

```text
mts-aset/0.2
```

Главный инвариант:

```text
identity = by-poles
```

То есть:

```text
(A ⟼ B) = (C ⟼ D)
⇔
A = C ∧ B = D
```

Две разные записи связей одной формы запрещены.

Минимальная структура:

```json
{
  "format": "mts-aset",
  "version": "0.2",
  "identity": "by-poles",
  "root": "R",
  "links": [
    {"id":"R", "start":"R", "end":"R"},
    {"id":"O", "start":"O", "end":"R"},
    {"id":"C", "start":"R", "end":"C"},
    {"id":"L", "start":"O", "end":"C"},
    {"id":"U", "start":"C", "end":"O"}
  ],
  "labels": {},
  "symbolSequences": [],
  "abitSequences": [],
  "linkSequences": [],
  "rootChains": [],
  "storedAnums": [],
  "provenance": {}
}
```

Технический `id` — address записи внутри конкретного файла. Он не является дополнительной смысловой характеристикой связи.

## 5. Корневой базис

Каждая `.aset.json` содержит канонический базис:

```text
R = R ⟼ R
O = O ⟼ R
C = R ⟼ C
L = O ⟼ C
U = C ⟼ O
```

Четверичный словарь:

```text
[ -> O
] -> C
1 -> L
0 -> U
```

Повтор абита повторяет ссылку в последовательности, но не создаёт новую связь.

Например:

```json
{
  "symbols": ["1", "1", "0"],
  "refs": ["L", "L", "U"]
}
```

## 6. `links`

Каждая materialized presentation link записывается как:

```json
{"id":"L42", "start":"L10", "end":"L11"}
```

Для одной пары `(start,end)` допускается не более одной записи.

Импорт обязан отвергать:

```json
{"id":"X", "start":"A", "end":"B"}
{"id":"Y", "start":"A", "end":"B"}
```

потому что по МТС это одна связь.

`labels` и `tags` — служебные metadata и не меняют semantic identity.

В accepted runtime локальный `AsetBuilder` materializes только пары, запрошенные `@mts/core` через `algebra.link(start,end)`.

## 7. Последовательности

### `symbolSequences`

Физическая последовательность символов:

```json
{
  "id": "source:0",
  "items": ["1", "1", "0"],
  "text": "110"
}
```

### `abitSequences`

Результат явного разрешения четверичного словаря:

```json
{
  "id": "abits:0",
  "profile": "mts-abit-v1",
  "symbols": ["[", "1", "0", "]"],
  "refs": ["O", "L", "U", "C"]
}
```

### `linkSequences`

Упорядоченный список ссылок:

```json
{
  "id": "links:0",
  "items": ["L", "L", "U"]
}
```

Повтор позиции не означает создание копии связи.

## 8. `rootChains`

Акорневая связь-последовательность строится как:

```text
prefix1 = R       ⟼ value1
prefix2 = prefix1 ⟼ value2
prefix3 = prefix2 ⟼ value3
```

Файл может сохранять удобное presentation представление роли:

```json
{
  "id": "carrier:0",
  "items": ["O", "L", "U", "C"],
  "head": "RC4"
}
```

Каждый шаг канонизируется. Уже существующая связь переиспользуется.

Поле `items` удобно для UI, но accepted existing-carrier path не обязан ему доверять: последовательность восстанавливается из start-истории выбранной связи.

## 9. Явно выбранная связь-носитель

Для чтения существующей асети через accepted `anum-v0.4` должна быть явно отмечена связь:

```json
{
  "provenance": {
    "representations": {
      "carrier": "RC4"
    }
  }
}
```

Лаборатория:

1. берёт указанную связь;
2. идёт по её полюсам `start` до `R`;
3. собирает конечные полюса в прямом порядке;
4. требует, чтобы каждый из них был `O`, `C`, `L` или `U`;
5. переводит их в `[ ] 1 0`;
6. передаёт exact sequence в тот же `@mts/core.executeAbits`.

Это read-only операция над входной асетью.

Отдельного accepted алгоритма скобок для связи-носителя нет.

## 10. `storedAnums`

Роль хранения может связывать carrier с denotation:

```json
{
  "id": "stored:0",
  "storageLink": "S1",
  "carrier": "RC4",
  "denotation": "D1"
}
```

`storageLink` имеет форму:

```text
carrier ⟼ denotation
```

Если связь такой формы уже существует, роль хранения ссылается на неё. Роль не создаёт вторую смысловую связь той же формы.

## 11. `provenance`

Для accepted четверичного результата provenance содержит source, laboratory deserializer id, status, exact semantic authority и presentation representations.

Пример формы:

```json
{
  "source": {
    "kind": "quaternary",
    "profile": "mts-abit-v1",
    "raw": "[10]"
  },
  "deserializer": "anum-v0.4",
  "status": "accepted",
  "traceVersion": "0.3",
  "semanticAuthority": {
    "kind": "exact-generated-package",
    "package": "@mts/core",
    "version": "0.10.0",
    "contract": "mts-contract/v0.10",
    "conformance": "mts-conformance/v0.10",
    "upstreamRepository": "netkeep80/anum_docs",
    "upstreamCommit": "957c818d82bd3211f2a59547fff28e8ed0ec4331",
    "artifactSha256": "0cd716b65fcdcfb8ca31ec3899f1a812f0b4c9dbfe46bfc1f31899b762cde007",
    "generatedTreeSha256": "<64 hex>",
    "consumerLock": "anum-parser-mts-core-consumer-lock/v0.1"
  },
  "representations": {
    "sourceSequence": "source:0",
    "abitSequence": "abits:0",
    "linkSequence": "links:0",
    "carrier": "RC4",
    "denotation": "D1"
  }
}
```

`semanticAuthority` относится только к accepted path. Experimental algorithms не должны копировать этот claim.

`generatedTreeSha256` идентифицирует materialized compiled tree, полученный после exact artifact verification; он не заменяет upstream commit/contract/artifact identity.

Если result получен чтением existing carrier, дополнительно фиксируется transport:

```json
{
  "transport": {
    "kind": "existing-carrier",
    "carrierRef": "RC4",
    "readOnly": true,
    "decodedBeforeAcceptedRuntime": true,
    "sourceAset": "mts-aset/0.2",
    "prefixCount": 5
  }
}
```

Старое поле:

```text
decodedBeforeStackMachine
```

больше не описывает current architecture и не должно использоваться для новых accepted результатов.

Эти provenance fields описывают происхождение, authority и presentation roles. Они не входят в semantic identity самой связи.

## 12. Два режима `.aset.json` в веб-лаборатории

Один и тот же файл можно использовать двумя явно различными способами:

```text
.aset.json — открыть асеть
.aset.json — прочитать carrier через ANUM v0.4
```

Первый режим только показывает existing Aset.

Второй режим использует selected carrier как transport, восстанавливает `[ ]10` и исполняет exact accepted `@mts/core` runtime, строя отдельную result projection.

## 13. Сериализация

Текущий реестр:

- `aset-json-v0` — сохранить `.aset.json`;
- `source-replay-v0` — точно вернуть исходный `.anum4` или `.anums`, если это подтверждает `provenance.source`;
- `source-envelope-v0` — сохранить тот же source в `.anum.json`.

Наличие произвольной асети не означает, что из неё можно однозначно восстановить исходное ачисло.

Следует различать:

```text
точное восстановление source
восстановление topology
semantic equivalence
```

## 14. Ошибки формата, transport и accepted execution

Format boundary не исправляет вход молча.

Основные local codes:

```text
invalid-utf8
bom-not-allowed
invalid-abit-symbol
unknown-format-version
invalid-aset
dangling-link-ref
duplicate-link-id
duplicate-link-form
missing-root
invalid-root-kernel
unsupported-round-trip
algorithm-undefined-transition
carrier-not-selected
unknown-carrier
not-rooted-sequence
non-abit
```

Accepted `@mts/core` stream failures `unexpected-close` и `unclosed-open` адаптируются к laboratory `algorithm-undefined-transition` с сохранением transition class.

## 15. Версионирование

Версия файлового формата меняется, когда меняется структура или фундаментальное обещание самого файла.

Изменение MTS release не требует автоматически менять `.anum4`: physical alphabet и laboratory deserializer id версионируются отдельно от semantic authority.

Текущий accepted laboratory id:

```text
anum-v0.4
```

Текущий semantic authority:

```text
MTS v0.10 / @mts/core@0.10.0
```

Следующий MTS release должен переключаться только через explicit consumer repin.

## 16. MTS v0.11 candidate boundary

На текущем observed `anum_docs` v0.11 остаётся candidate / NOT ACCEPTED:

```text
status = candidate
accepted = false
acceptanceReady = false
candidateRuntimeSelectable = false
```

Поэтому current file formats не объявляют top-level `.`/`TopBind` принятой `anum_parser` semantics и Q остаётся ровно `[ ] 1 0`.

После official upstream acceptance требуется отдельный migration slice с новым lock, package/artifact identity и executable evidence. До этого candidate не является production authority лаборатории.
