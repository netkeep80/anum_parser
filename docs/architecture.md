# Архитектура лаборатории

`anum_parser` — статическая веб-лаборатория для исполнения, сравнения и визуализации ачисел МТС.

Текущая нормативная семантика находится **не в этом репозитории**, а в точно зафиксированном пакете `@mts/core` из `netkeep80/anum_docs`.

```text
accepted MTS       = v0.14
package            = @mts/core@0.10.0
upstream SHA       = fcbc97e2279471c2c5effed57685c5f49ec856be
contract           = mts-contract/v0.14
conformance        = mts-conformance/v0.14
acceptance         = typescript-c1-acceptance/v0.7
artifact SHA256    = d8f183b0c6e7882b29ebe0c53eb97050ec392d990a82e7ac500fb896aa14afe3
consumer lock      = contracts/mts-core-consumer-lock.json
```

Версия пакета `@mts/core@0.10.0` сама по себе не является номером выпуска МТС. Точный выпуск определяется вместе состоянием исходного репозитория, контрактом, корпусом соответствия и контрольной суммой пакета.

Лабораторный идентификатор `anum-v0.4` также сохранён для совместимости корпуса и интерфейса и **не является номером выпуска МТС**.

Предыдущий exact consumer v0.11 остаётся неизменяемым непосредственным дифференциальным свидетельством:

```text
previous upstream SHA = 6b7f616c7b275310aebdbe998da13c5811c91391
previous contract     = mts-contract/v0.11
previous conformance  = mts-conformance/v0.11
previous artifact     = 6b4dbd701f46a6a339e20b892b8a5d9478bb40a9392415899291eb0fe30ddf9c
```

## 1. Главная граница доверия

Архитектура принятого четверичного пути устроена так:

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

Локальный адаптер не имеет права независимо определять принятые переходы `OPEN/CLOSE/VALUE`.

Локальный `deserializeStack` остаётся только для явно экспериментальных алгоритмов. Попытка использовать его как источник принятой семантики должна завершаться отказом.

## 2. Точная материализация потребителя

`anum_parser` не копирует текущий `anum_docs/ts/src/**` и не зависит от подвижной ветки `main`.

Перед тестами, проверками и публикацией выполняется:

```text
scripts/materialize-mts-core.mjs
```

Материализатор:

1. читает `contracts/mts-core-consumer-lock.json`;
2. получает ровно указанный коммит исходного репозитория;
3. проверяет принятый контракт и корпус соответствия;
4. выполняет `npm ci` и сборку в `anum_docs/ts`;
5. создаёт пакет через `npm pack`;
6. сверяет точную контрольную сумму SHA256;
7. копирует проверенный `dist/src` в исключённый из Git каталог `generated/mts-core/`;
8. вычисляет контрольную сумму сгенерированного дерева;
9. создаёт сведения о происхождении сгенерированного пакета.

`generated/` — только воспроизводимый результат сборки. Источником нормативной семантики остаётся принятый upstream-пакет, связанный с точным consumer lock.

Отдельный verifier дополнительно материализует **два** принятых выпуска — предыдущий v0.11 и текущий v0.14 — чтобы доказать их наблюдаемое соотношение на общей Q-поверхности.

## 3. Базовое тождество связи

Для МТС действует:

```text
(A ⟼ B) = (C ⟼ D)
⇔
A = C ∧ B = D
```

Связь полностью определяется полюсами. Локальный `AsetBuilder.ensureLink(start,end)` поэтому выполняет каноническую материализацию:

```text
если такая форма уже есть -> вернуть существующую ссылку
иначе -> добавить presentation record
```

Это не делает `AsetBuilder` источником нормативной семантики. В принятом пути решение **какую пару материализовать** приходит только от `@mts/core`.

Следствия:

- две записи одной формы в `.aset.json` запрещены;
- повтор ссылки в последовательности не создаёт новый экземпляр связи;
- повторный `A ⟼ B` может переиспользовать существующую запись представления;
- `R ⟼ R = R`.

## 4. Корневой базис и versioned Q-поверхности

Public legacy-Q13 execution сохраняет корневой базис, используемый лабораторией:

```text
R = R ⟼ R
O = O ⟼ R
C = R ⟼ C
L = O ⟼ C
U = C ⟼ O
```

Лабораторный `.anum4` остаётся строгим legacy-Q13 транспортом:

```text
[ -> O
] -> C
1 -> L
0 -> U
```

При этом принятая МТС v0.14 явно разделяет версии Q:

```text
Q14        = [ ] T F
legacy Q13 = [ ] 1 0
```

Q14 не принимает legacy `1/0`, legacy Q13 не принимает `T/F`, смешанный source запрещён. Допустим только явный versioned transcode; `anum_parser` его автоматически не выполняет. `R = ∞`, контекстные `.`/`:` и рекурсивный алфавит `8/9/6/1` не являются дополнительными знаками `.anum4`.

## 5. Строгий `.anum4` как граница представления

Локальный `.anum4`-разбор намеренно строже общего входного разбора upstream: он принимает только буквальные `[ ] 1 0` без пробелов и комментариев.

Это различие классифицировано дифференциальным свидетельством как:

```text
presentation-boundary-not-semantic-mismatch
```

То есть:

```text
.anum4 strict validation
  -> artifact.symbols
  -> @mts/core.executeAbits(artifact.symbols, algebra)
```

Не следует ослаблять грамматику `.anum4` только потому, что `parseRawQuaternary` поддерживает дополнительную нормализацию исходного текста.

## 6. Два входных транспорта одного принятого runtime

### 6.1. Физический `.anum4`

```text
.anum4
  -> strict validation
  -> exact [ ] 1 0 sequence
  -> @mts/core.executeAbits
```

### 6.2. Существующий носитель

`.aset.json` может быть явно прочитана через:

```text
provenance.representations.carrier
```

Лаборатория только для чтения разворачивает историю начал до `R`, получает `O/C/L/U`, восстанавливает `[ ] 1 0` и затем запускает **тот же** принятый runtime.

```text
existing aset
  -> selected carrier
  -> read-only start history
  -> O/C/L/U
  -> [ ] 1 0
  -> @mts/core.executeAbits
```

Исходная асеть не изменяется.

Сведения транспорта используют:

```text
decodedBeforeAcceptedRuntime = true
```

а не историческое `decodedBeforeStackMachine`.

## 7. Как строится принятый trace

`@mts/core.executeAbits` возвращает нормативную последовательность операций и вызывает `algebra.link(start,end)` для построения семантических пар.

Локальная инструментированная алгебра записывает события:

```text
source index
start
end
returned local ref
created/reused
```

После исполнения `projectAcceptedTrace` восстанавливает удобные для отладчика кадры и проверяет:

```text
projected final result == upstream denotation
```

Если проекция расходится с upstream-денотатом, принятый путь завершается отказом.

Следовательно trace — наблюдаемая проекция исполнения, а не второй интерпретатор.

## 8. Экспериментальные алгоритмы

Текущие локальные эксперименты:

- `stack-group-value-v0` — исторический альтернативный вариант закрытия группы;
- `abit-flat-v0` — плоская свёртка;
- `string-flat-v0` — строковый эксперимент.

Они обязаны иметь `status=experimental` и не получают `semanticAuthority` принятого runtime.

Наличие экспериментального алгоритма не изменяет МТС и не создаёт второго принятого пути.

## 9. `.aset.json` как формат представления

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

`links` отображает локально материализованную топологическую проекцию. Технический `id` — адрес внутри файла, а не дополнительный уровень тождества связи.

Поле:

```text
identity = by-poles
```

фиксирует каноническую границу тождества.

## 10. Происхождение принятой семантики

Принятый результат содержит:

```text
provenance.status = accepted
provenance.deserializer = anum-v0.4
provenance.semanticAuthority.kind = exact-generated-package
```

и точную идентичность:

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

Таким образом машинно различаются:

```text
accepted upstream semantics
local presentation projection
experimental local semantics
```

Для текущего результата `contract/conformance/upstreamCommit/artifactSha256` указывают именно на принятый v0.14 release, даже при сохранённом package version `0.10.0`.

## 11. Пошаговый отладчик и визуализация

Отладчик показывает:

- позицию источника;
- текущий знак;
- разрешённую корневую ссылку;
- проекцию кадров и текущего значения;
- созданные и переиспользованные связи;
- видимые связи на данном шаге.

Новая связь становится видимой только после соответствующего нормативного вызова `link(start,end)`.

Визуализация связи `X = A ⟼ B`:

```text
A -> X -> B
```

является проекцией интерфейса и не меняет семантическое тождество.

## 12. Граница READ / материализации

Для лаборатории принципиально:

```text
найти / проверить != записать / materialize
не найдено != не существует
```

Чтение существующего носителя является операцией только для чтения над входной асетью. Результирующая проекция строится отдельно.

## 13. Исполняемое CI-свидетельство

CI имеет две независимые поверхности.

### Обычная проверка runtime

Перед `node --test` текущий принятый runtime материализуется из consumer lock. Обычные тесты импортируют принятый десериализатор через сгенерированный `@mts/core`.

### Проверка потребителя и дифференциальное свидетельство

Отдельный verifier выполняет:

```text
previous exact source = v0.11 / 6b7f616c...
current exact source  = v0.14 / fcbc97e2...
rebuild both
npm pack both
verify both artifact SHA256
consume through package root
reject deep source import
verify v0.14 contract + conformance + acceptance v0.7
verify Q14 [ ] T F / legacy Q13 [ ] 1 0 separation
compare shared legacy-Q13 corpus
compare shared legacy-Q13 failure classes
run local accepted projection against current v0.14 package
```

Общий корпус содержит 33 принятых `.anum4` случая. Для них предыдущий v0.11, текущий v0.14 public legacy-Q13 runtime и локальная проекция текущего runtime должны давать одинаковый наблюдаемый денотат.

Отдельно сравниваются общие классы ошибок. Строгость локального `.anum4` остаётся границей представления. Verifier также требует, чтобы acceptance manifest разрешал downstream repin и чтобы Q14/Q13 не смешивались неявно.

## 14. GitHub Pages

Процесс публикации также материализует текущий точно зафиксированный runtime перед сборкой и копирует в `_site`:

```text
src/
examples/
docs/
generated/
package.json
```

Таким образом браузерный сайт, обычный CI и consumer verifier используют одну и ту же текущую фиксацию v0.14. Предыдущий exact consumer v0.11 материализуется только внутри дифференциальной проверки как неизменяемое свидетельство.

## 15. Принятая граница МТС v0.14

Upstream v0.14 является текущим принятым выпуском:

```text
contract = mts-contract/v0.14
conformance = mts-conformance/v0.14
acceptance = typescript-c1-acceptance/v0.7
accepted = true
acceptanceReady = true
requiredExecutableGates = 70
downstreamRepinAllowed = true
```

Для этой лаборатории наиболее важен versioned representation boundary:

- current Q14: `[ ] T F`;
- immutable legacy Q13: `[ ] 1 0`;
- `.anum4` остаётся строгим legacy-Q13 форматом;
- implicit transcode и mixed Q13/Q14 source запрещены;
- accepted execution приходит только из public `@mts/core`, не из локальной второй машины;
- exact v0.14 legacy-Q13 поведение сравнивается с предыдущим v0.11 consumer.

Более широкие законы v0.14 — ориентация контекста, разделение representation layers, generalized-MP non-regression и другие принятые положения — принадлежат `anum_docs`. `anum_parser` фиксирует release identity и проверяет только те наблюдаемые границы, которые реально потребляет.

## 16. Граница с `anum_docs`

`anum_docs` владеет:

```text
MTS contracts
accepted runtime
release lifecycle
contextual semantics
conformance evidence
```

`anum_parser` владеет:

```text
strict laboratory file boundaries
transport adapters
presentation Aset format
trace/debugger/visualizer
experimental comparisons
consumer verification
differential previous/current evidence
```

Главный архитектурный инвариант после v0.14 repin:

```text
anum_parser does not define current MTS semantics locally
```

А переход между принятыми выпусками всегда остаётся явной операцией:

```text
exact upstream SHA
accepted contract/conformance/acceptance
exact artifact SHA256
consumer lock
previous/current differential proof
runtime/browser evidence
canonical docs
```

## 17. Blueprint-проекция связей

Blueprint расположен полностью после семантической границы:

```text
accepted Aset
  -> projectAsetToVisualLinkNetwork
  -> VisualLinkNetwork
  -> @mts/visual createBlueprintInitialPositions/buildBlueprintGeometry
  -> parser-owned SVG DOM/lifecycle
```

`VisualLinkNetwork` — единственная production topology-модель визуализации. Старый parser-local topology DTO физически удалён.

### Семантическая граница

Связь `X = start(X) ⟼ end(X)` остаётся одной первичной сущностью. Центр в blueprint — точка представления той же связи, а не отдельный семантический узел. Геометрия, цвет, selection, drag, pan/zoom и debugger-state не меняют `Aset`, denotation или `semanticAuthority`.

### Shared geometry authority

Exact-pinned `@mts/visual` владеет общей blueprint-геометрией, C¹ spline construction, semantic anchors, finite self-link handling, palette и viewport math. `anum_parser` владеет только DOM lifecycle и consumer-specific presentation glue.

Accepted observable contract:

- one semantic Link → one SVG path;
- START/END anchors совпадают с центрами соответствующих Link;
- C¹ continuity сохраняется на внутренних стыках и в центре;
- self-start/self-end/full-self остаются конечными и невырожденными;
- fixed cubic-count не является API invariant;
- движение центра детерминированно repin'ит зависимые пути;
- selection/debugger могут менять акцент, но не semantic topology;
- повторные переключения view не накапливают SVG/listeners;
- serialized `Aset` остаётся неизменной.

## 18. Живая 3D-механическая проекция

3D также находится целиком после semantic boundary:

```text
accepted Aset
  -> projectAsetToVisualLinkNetwork
  -> VisualLinkNetwork
  -> @mts/visual createInitialPhysics3DState
  -> @mts/visual createLivePhysics3D
  -> @mts/visual/three renderer
```

Standalone `@mts/visual` является единственной production authority для initial 3D state, live physics, Three.js scene/picking/drag и topology transition. Старые parser-local 3D geometry/physics/renderer modules физически удалены.

Debugger-step 3D использует реальную reference-closed current-step `VisualLinkNetwork`: будущие связи отсутствуют в physics model до своего шага, а не маскируются поверх final topology. `Next/Prev` меняют shared network topology с сохранением mounted renderer/camera/controls там, где это допускает shared API.

UI-параметры физики, pause/reset, drag, camera, fullscreen, selection и fallback относятся только к presentation/mechanical state. Они не имеют права менять semantic `links`, identity, denotation, trace или `semanticAuthority`. При destroy/switch shared renderer lifecycle обязан освобождать графические ресурсы и listeners; browser acceptance проверяет отсутствие накопления ресурсов и корректный fallback в structural 2D.
