# Архитектура лаборатории

`anum_parser` — статическая веб-лаборатория для исполнения, сравнения и визуализации ачисел МТС.

Текущая accepted semantic authority находится **не в этом репозитории**, а в exact-pinned пакете `@mts/core` из `netkeep80/anum_docs`.

```text
accepted MTS       = v0.10
package            = @mts/core@0.10.0
upstream SHA       = 957c818d82bd3211f2a59547fff28e8ed0ec4331
contract           = mts-contract/v0.10
conformance        = mts-conformance/v0.10
consumer lock      = contracts/mts-core-consumer-lock.json
```

Лабораторный id `anum-v0.4` сохранён для совместимости corpus/UI и **не является номером MTS release**.

MTS v0.11 на текущем upstream остаётся candidate / NOT ACCEPTED и не является production dependency `anum_parser`.

## 1. Главная граница доверия

Архитектура после синхронизации устроена так:

```text
strict physical input
        |
        v
local presentation validation
        |
        v
exact abit sequence
        |
        v
@mts/core.executeAbits          <-- semantic authority
        |
        v
instrumented StackAlgebra
        |
        v
AsetBuilder + trace projection  <-- presentation/visualization adapter
```

Критический инвариант:

```text
local adapter may materialize only link(start,end)
requests actually made by @mts/core
```

Он не имеет права независимо решать accepted `OPEN/CLOSE/VALUE` semantics.

Локальный `deserializeStack` остаётся только для явно `experimental` алгоритмов. Попытка использовать его с accepted status должна завершаться отказом.

## 2. Exact consumer materialization

`anum_parser` не vendor-ит текущий `anum_docs/ts/src/**` и не зависит от moving `main`.

Перед test/check/Pages выполняется:

```text
scripts/materialize-mts-core.mjs
```

Материализатор:

1. читает `contracts/mts-core-consumer-lock.json`;
2. получает ровно указанный upstream commit SHA;
3. проверяет accepted contract/conformance;
4. выполняет `npm ci` и build в `anum_docs/ts`;
5. делает `npm pack`;
6. сверяет exact SHA256 artifact;
7. копирует проверенный `dist/src` в gitignored `generated/mts-core/`;
8. вычисляет digest generated tree;
9. создаёт generated provenance JSON/ESM module.

`generated/` — только build product. Semantic authority остаётся upstream accepted package + exact lock.

## 3. Базовое тождество связи

Для МТС действует:

```text
(A ⟼ B) = (C ⟼ D)
⇔
A = C ∧ B = D
```

Связь полностью определяется полюсами. Локальный `AsetBuilder.ensureLink(start,end)` поэтому выполняет каноническую materialization операцию:

```text
если такая форма уже есть -> вернуть существующую ссылку
иначе -> добавить presentation record
```

Это не делает `AsetBuilder` semantic authority. В accepted path решение **какую пару материализовать** приходит только от `@mts/core`.

Следствия:

- две записи одной формы в `.aset.json` запрещены;
- повтор ссылки в последовательности не создаёт новый экземпляр связи;
- повторный `A ⟼ B` может переиспользовать existing presentation record;
- `R ⟼ R = R`.

## 4. Корневой базис и четыре абита

Accepted v0.10 сохраняет базис:

```text
R = R ⟼ R
O = O ⟼ R
C = R ⟼ C
L = O ⟼ C
U = C ⟼ O
```

Четверичный transport:

```text
[ -> O
] -> C
1 -> L
0 -> U
```

Q alphabet остаётся ровно:

```text
[ ] 1 0
```

`R = ∞` не является пятым абитом.

## 5. Strict `.anum4` как presentation boundary

Локальный `.anum4` parser намеренно строже upstream raw parser: он принимает только literal `[ ] 1 0` без whitespace/comments.

Это различие классифицировано differential evidence как:

```text
presentation-boundary-not-semantic-mismatch
```

То есть:

```text
.anum4 strict validation
  -> artifact.symbols
  -> @mts/core.executeAbits(artifact.symbols, algebra)
```

Не следует ослаблять `.anum4` grammar только потому, что upstream `parseRawQuaternary` поддерживает дополнительную raw normalization surface.

## 6. Два входных транспорта одного accepted runtime

### 6.1. Физический `.anum4`

```text
.anum4
  -> strict validation
  -> exact [ ] 1 0 sequence
  -> @mts/core.executeAbits
```

### 6.2. Existing carrier

`.aset.json` может быть явно прочитана через:

```text
provenance.representations.carrier
```

Лаборатория read-only разворачивает start-историю до `R`, получает `O/C/L/U`, восстанавливает `[ ] 1 0` и затем запускает **тот же** accepted runtime.

```text
existing aset
  -> selected carrier
  -> read-only start history
  -> O/C/L/U
  -> [ ] 1 0
  -> @mts/core.executeAbits
```

Исходная асеть не изменяется.

Transport provenance использует:

```text
decodedBeforeAcceptedRuntime = true
```

а не старое `decodedBeforeStackMachine`.

## 7. Как строится accepted trace

`@mts/core.executeAbits` возвращает authoritative operation sequence и вызывает `algebra.link(start,end)` для semantic pair construction.

Локальная instrumented algebra записывает эти события:

```text
source index
start
end
returned local ref
created/reused
```

После исполнения `projectAcceptedTrace` восстанавливает debugger-friendly frames и проверяет:

```text
projected final result == upstream denotation
```

Если projection расходится с upstream, accepted execution fail-closed.

Следовательно trace — наблюдаемая проекция, а не второй interpreter.

## 8. Experimental algorithms

Текущие локальные эксперименты:

- `stack-group-value-v0` — historical alternative CLOSE behavior;
- `abit-flat-v0` — flat fold;
- `string-flat-v0` — string experiment.

Они обязаны иметь `status=experimental` и не получают `semanticAuthority` provenance accepted runtime.

Наличие экспериментального алгоритма не изменяет МТС и не означает candidate acceptance.

## 9. `.aset.json` как presentation format

Файл хранит:

```text
links
labels/tags
symbolSequences
abitSequences
linkSequences
rootChains
storedAnums
provenance
```

`links` отображает локально материализованную topology projection. Technical `id` — address внутри файла, а не semantic Link identity.

Поле:

```text
identity = by-poles
```

фиксирует canonical equality boundary.

## 10. Accepted semantic provenance

Accepted result содержит:

```text
provenance.status = accepted
provenance.deserializer = anum-v0.4
provenance.semanticAuthority.kind = exact-generated-package
```

и exact identity:

```text
package
version
contract
conformance
upstreamRepository
upstreamCommit
artifactSha256
generatedTreeSha256
consumerLock
```

Это делает machine-visible различие между:

```text
accepted upstream semantics
local presentation projection
experimental local semantics
```

## 11. Пошаговый debugger и визуализация

Debugger показывает:

- source position;
- текущий token;
- resolved root ref;
- projected frames/current;
- produced/reused links;
- visible links на данном шаге.

Новая связь становится видимой только после соответствующего upstream semantic `link(start,end)` event.

Визуализация связи `X = A ⟼ B`:

```text
A -> X -> B
```

является UI projection и не меняет semantic identity.

## 12. READ / materialization boundary

Для лаборатории принципиально:

```text
найти / проверить != записать / materialize
не найдено != не существует
```

Existing-carrier read — read-only operation над входной асетью. Result projection строится отдельно.

## 13. CI evidence

CI имеет две независимые поверхности.

### Runtime/test job

Перед `node --test` exact runtime materialized из lock. Все обычные tests импортируют accepted deserializer уже через generated `@mts/core`.

### Consumer/differential job

Отдельно:

```text
exact source rebuild
npm pack
artifact SHA256
package-root smoke
deep-import rejection
local baseline vs accepted v0.10 differential
```

Differential evidence покрывает все accepted `.anum4` cases из `examples/cases.json` и stack failure classes.

## 14. GitHub Pages

Pages workflow также materializes exact runtime перед публикацией и копирует в `_site`:

```text
src/
examples/
docs/
generated/
package.json
```

Таким образом browser site и CI используют один и тот же consumer lock.

## 15. Граница с MTS v0.11

На текущем observed upstream v0.11 остаётся:

```text
status = candidate
accepted = false
acceptanceReady = false
candidateRuntimeSelectable = false
```

Поэтому `anum_parser` не должен:

- переключать production на moving `anum_docs/main`;
- локально реализовывать новый accepted-like interpreter для `TopBind(R,S)`;
- объявлять top-level `.` принятой current semantics;
- расширять Q;
- выдавать candidate research/runtime evidence за accepted release.

Пока candidate не accepted, правильная consumer стратегия — ждать upstream lifecycle.

После acceptance требуется отдельный explicit transition:

```text
new exact source SHA
new accepted contract/conformance
new package version/artifact digest
new consumer lock
new differential proof
new runtime/Pages evidence
```

## 16. Граница с `anum_docs`

`anum_docs` владеет MTS contracts, accepted runtime и release lifecycle.

`anum_parser` владеет:

```text
strict laboratory file boundaries
transport adapters
presentation Aset format
trace/debugger/visualizer
experimental comparisons
consumer verification
```

Главный архитектурный результат синхронизации:

```text
anum_parser no longer defines current MTS semantics locally
```
