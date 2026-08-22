# Архитектура лаборатории

`anum_parser` — статическая веб-лаборатория для исполнения, сравнения и визуализации ачисел МТС.

Текущая нормативная семантика находится **не в этом репозитории**, а в точно зафиксированном пакете `@mts/core` из `netkeep80/anum_docs`.

```text
accepted MTS       = v0.11
package            = @mts/core@0.10.0
upstream SHA       = 6b7f616c7b275310aebdbe998da13c5811c91391
contract           = mts-contract/v0.11
conformance        = mts-conformance/v0.11
artifact SHA256    = 6b4dbd701f46a6a339e20b892b8a5d9478bb40a9392415899291eb0fe30ddf9c
consumer lock      = contracts/mts-core-consumer-lock.json
```

Версия пакета `@mts/core@0.10.0` сама по себе не является номером выпуска МТС. Точный выпуск определяется вместе состоянием исходного репозитория, контрактом, корпусом соответствия и контрольной суммой пакета.

Лабораторный идентификатор `anum-v0.4` также сохранён для совместимости корпуса и интерфейса и **не является номером выпуска МТС**.

Предыдущая принятая МТС v0.10 остаётся неизменяемым дифференциальным свидетельством:

```text
previous upstream SHA = 957c818d82bd3211f2a59547fff28e8ed0ec4331
previous contract     = mts-contract/v0.10
previous conformance  = mts-conformance/v0.10
previous artifact     = 0cd716b65fcdcfb8ca31ec3899f1a812f0b4c9dbfe46bfc1f31899b762cde007
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

Отдельный verifier дополнительно материализует **два** принятых выпуска — предыдущий v0.10 и текущий v0.11 — чтобы доказать их наблюдаемое соотношение на общей Q-поверхности.

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

## 4. Корневой базис и четыре абита

Принятая МТС v0.11 сохраняет базис:

```text
R = R ⟼ R
O = O ⟼ R
C = R ⟼ C
L = O ⟼ C
U = C ⟼ O
```

Четверичный транспорт:

```text
[ -> O
] -> C
1 -> L
0 -> U
```

Алфавит Q остаётся ровно:

```text
[ ] 1 0
```

`R = ∞` не является пятым абитом. Контекстные знаки `.` и `:` также не являются Q-абитами.

Это важно для v0.11: новый принятый контекстный смысл не расширяет физический `.anum4`-транспорт лаборатории.

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

Текущие локальные эксперерименты:

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

Для текущего результата `contract/conformance/upstreamCommit/artifactSha256` указывают именно на принятый v0.11 release, даже при сохранённом package version `0.10.0`.

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
previous exact source = v0.10 / 957c818d...
current exact source  = v0.11 / 6b7f616c...
rebuild both
npm pack both
verify both artifact SHA256
consume through package root
reject deep source import
compare shared Q corpus
compare shared Q failure classes
verify accepted v0.11 contract/conformance obligations
```

Общий Q-корпус содержит 33 принятых случая из `examples/cases.json`. Для них предыдущий v0.10, текущий v0.11 и локальная проекция текущего runtime должны давать одинаковый наблюдаемый денотат.

Отдельно сравниваются общие классы ошибок четверичного исполнения. Строгость локального `.anum4` остаётся классифицированной границей представления, а не семантическим расхождением.

V0.11-специфические контекстные обязательства не подменяются Q-дифференциалом: verifier отдельно требует их из принятого upstream-контракта и корпуса соответствия.

## 14. GitHub Pages

Процесс публикации также материализует текущий точно зафиксированный runtime перед сборкой и копирует в `_site`:

```text
src/
examples/
docs/
generated/
package.json
```

Таким образом браузерный сайт, обычный CI и consumer verifier используют одну и ту же текущую фиксацию v0.11. Предыдущая v0.10 материализуется только внутри дифференциальной проверки как неизменяемое свидетельство.

## 15. Принятая граница МТС v0.11

В upstream v0.11 принята как текущий выпуск:

```text
status = accepted
accepted = true
acceptanceReady = true
coverageState = complete
acceptanceBlockers = []
```

Её наблюдаемое изменение включает:

```text
TopBind(R,S)
top-level . -> R
.. -> ExactSequence([R,R]) -> Pair(R,R)=R
nearest structural A:E binding
Q alphabet = [ ] 1 0
```

Архитектурное следствие для `anum_parser` состоит не в добавлении второй контекстной машины. Лаборатория:

- переключает нормативное происхождение на точный принятый v0.11 artifact;
- сохраняет текущий `.anum4` как Q-путь `[ ] 1 0`;
- не вводит `.` или `:` в Q;
- не реализует локально `TopBind(R,S)` или вложенную `A:E`-привязку;
- проверяет эти принятые свойства по upstream contract/conformance evidence;
- доказывает наблюдаемую совместимость общей Q-поверхности с предыдущим точным v0.10 runtime.

Поэтому принятие v0.11 не размывает границу ответственности потребителя: новая семантика принадлежит `anum_docs`, а `anum_parser` только точно фиксирует и проверяет принятую зависимость.

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

Главный архитектурный инвариант после v0.11 repin:

```text
anum_parser does not define current MTS semantics locally
```

А переход между принятыми выпусками всегда остаётся явной операцией:

```text
exact upstream SHA
accepted contract/conformance
exact artifact SHA256
consumer lock
previous/current differential proof
runtime/browser evidence
canonical docs
```

## 17. Blueprint-проекция связей

Режим `graphView = blueprint` расположен полностью после построения `Aset` и общей модели `visualModel`:

```text
accepted Aset
  -> visualModel
  -> pure blueprint geometry
  -> SVG renderer
```

Геометрическая идея адаптирована из `konard/links-visuals` по точному снимку `f377441533e4f10fa94aaa07138b684df88234b1`, опубликованному под лицензией `Unlicense`. В `anum_parser` переносится форма связи, но не отдельная цветовая или семантическая система.

Для связи `X = A ⟼ B` действуют инварианты представления:

- центр `X` остаётся `GREEN`;
- начало формы закреплено на центре `A`;
- конец формы закреплён на центре `B`;
- первая половина сохраняет `RED -> GREEN`;
- вторая половина сохраняет `GREEN -> BLUE`;
- синяя стрелка отмечает конец;
- самопетля остаётся конечной и видимой.

Перетаскивание меняет только координаты центров представления. Зависимые начала и концы пересчитываются из уже существующих `startId/endId`; семантическая `Aset` не изменяется. Панорамирование, масштабирование, вписывание, выбор и состояние отладчика также относятся только к представлению.

Средство отрисовки использует локальный `SVG` без отдельной зависимости от D3. Геометрический модуль не импортирует Cytoscape, Three.js или `@mts/core`: он получает готовый `visualModel` и возвращает только геометрию.

Жизненный цикл симметричен другим представлениям: при переходе из `blueprint` снимаются обработчики событий, удаляется его `SVG` и очищается локальное состояние средства отрисовки. Повторные циклы `2D -> blueprint -> 3D -> 2D` не должны накапливать графические поверхности или обработчики. Отказ WebGL относится только к 3D и не должен делать `blueprint` недоступным.

Браузерный контракт отдельно доказывает, что выбор и отладчик не перекрашивают смысловой `RGB`, перетаскивание с последующим изменением размера и вписыванием сохраняет конечные координаты, а сериализованная `Aset` до и после визуальных действий остаётся той же.

## 18. Живая 3D-механическая проекция

Живой 3D-режим находится целиком **после** семантической границы. Его конвейер:

```text
accepted Aset
  -> visualModel
  -> deterministic readable 3D layout
  -> livePhysicalSimulation3d
  -> Three.js renderer
```

Ни `livePhysicalSimulation3d`, ни Three.js renderer не имеют права менять `links`, тождество связей, denotation, trace или `semanticAuthority`. Во время интерактивной работы меняются только механические и presentation-состояния:

```text
positions / velocities
physics options
pinned nodes during drag
camera
selection / hover
fullscreen presentation
```

### Механические инварианты

- root всегда зафиксирован в `(0,0,0)`;
- self-loop остаётся видимым, но исключён из набора силовых пружин;
- начало связи имеет градиент `RED -> GREEN`;
- конец связи имеет градиент `GREEN -> BLUE`;
- две касательные, выходящие из GREEN-центра одной связи, строго противоположны на 180° в истинном 3D;
- semantic RGB не используется для кодирования debugger state.

### Wake / sleep

Пользовательский drag и изменение параметров физики будят существующую simulation. `pause` прекращает physics integration, но не уничтожает renderer и не запрещает навигацию камерой. После `settleWindow` устойчивых шагов simulation переходит в sleep и больше не планирует лишние physics ticks.

Изменение камеры через OrbitControls вызывает только пересчёт presentation LOD и render. Оно не будит уснувшую физику и не меняет координаты механической асети.

`reset` создаёт новое механическое состояние из сохранённой исходной детерминированной 3D-раскладки и нулевых скоростей, сохраняя presentation selection и сам renderer.

### Renderer lifecycle и ресурсы

Один live tick не пересоздаёт renderer или scene. Динамические пружины и LOD могут заменять `BufferGeometry`, но старая геометрия перед заменой обязательно освобождается через `dispose()`.

`destroy3dRenderer` является полной lifecycle-границей. Он обязан:

- отменить активный `requestAnimationFrame`;
- отключить `ResizeObserver`;
- снять listener OrbitControls и вызвать `dispose()` controls;
- снять pointer/touch listeners и освободить pointer capture;
- освободить geometry/material scene objects;
- освободить WebGL renderer;
- удалить canvas и label layer;
- удалить renderer state из локального `WeakMap`.

Поэтому повторные циклы `2D -> 3D -> 2D` не должны накапливать canvas, label layers, observers, listeners или RAF.

### Fullscreen

Fullscreen является только изменением presentation workspace. Используется native Fullscreen API, а при его недоступности — CSS viewport fallback. В обоих вариантах остаются теми же:

```text
renderer
scene
camera
selected link
live simulation
physics parameters
pause state
```

Переход вызывает только `resize3dRenderer` и не требует повторной десериализации или пересоздания semantic/physical state. Выход доступен кнопкой и `Esc`.

### Browser-level контракт

Browser acceptance проверяет интеграционно, что:

- drag свободной связи передаёт возмущение другим свободным узлам, а root остаётся в origin;
- charge, spring stiffness и damping применяются live;
- pause/resume/reset не меняют semantic Aset;
- reset воспроизводим;
- settled simulation засыпает, а camera-only navigation не будит её;
- fullscreen resize/exit сохраняет текущую асеть, renderer, selection и physics state;
- повторные fullscreen и `2D <-> 3D` циклы не накапливают renderer resources;
- debugger и обычный selection продолжают работать поверх 3D;
- отказ WebGL чисто возвращает structural 2D.

Это фиксирует конечную архитектурную границу: live 3D — исследовательская механическая проекция уже существующей асети, а не альтернативное вычисление МТС.