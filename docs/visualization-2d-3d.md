# Визуализация асети: постоянные 2D и 3D представления

Этот документ фиксирует пользовательскую и архитектурную границу визуализации `anum_parser`.

Ключевой принцип:

```text
Aset semantics
    |
    v
renderer-independent visual model
    |
    +--> 2D structural view
    |
    `--> 3D physical view
```

Оба режима являются **presentation projections одной и той же асети**. Ни 2D, ни 3D не изменяют тождество связей, формат `.aset.json`, правила десериализации или принятую семантику МТС.

Текущая semantic authority остаётся exact-pinned `@mts/core` / MTS v0.10. Геометрия, физический solver, камера, LOD, selection и debugger state находятся за semantic boundary.

## 1. 2D — структурная карта

2D остаётся постоянным режимом и не является fallback-only представлением.

Основная root-relative раскладка показывает конструктивную глубину относительно акорня:

```text
depth(R) = 0
radius(link) = depth(link) * layerSpacing
```

После схлопывания рекурсивных SCC связи одного структурного уровня лежат на одном точном радиусе. Angular postprocess может уменьшать визуальные пересечения, но не имеет права менять назначенный structural radius.

Поэтому 2D отвечает прежде всего на вопрос:

> насколько далеко данная связь находится от акорня по структуре построения?

Пользователь может переключать доступные Cytoscape layouts, масштабировать и перемещать 2D. Структурная root-relative раскладка остаётся поддерживаемой независимо от наличия WebGL.

## 2. 3D — механическая асеть

3D показывает другую, взаимодополняющую характеристику той же асети. Это не перенос 2D-координат в третью ось и не ещё один Cytoscape layout.

Физическая модель:

```text
GREEN link center = одноимённый точечный заряд
semantic arc      = механическая пружина
root R            = фиксирован в (0,0,0)
```

Для связи:

```text
X = A ⟼ B
```

визуальная и физическая топология совпадают:

```text
start: A <-> X
end:   X <-> B
```

Каждая non-self semantic arc создаёт ровно одну force spring. Self-loop остаётся видимой дугой, но не создаёт self-force.

В 3D положение определяется детерминированным балансом:

```text
spring attraction/compression
+
same-sign center repulsion
+
damping
+
optional weak structural-depth potential
```

Structural depth здесь не задаёт жёсткий радиус. При `k_depth=0` 3D остаётся полностью корректным spring/charge представлением.

## 3. Семантический RGB

Оба renderer используют один renderer-independent visual model и один semantic color authority:

```text
start  = RED   #ff657a
center = GREEN #67e8b3
end    = BLUE  #73a7ff
```

Для `X = A ⟼ B`:

```text
start arc: A -> X   RED -> GREEN
end arc:   X -> B   GREEN -> BLUE
```

BLUE arrowhead показывает направление конца связи.

Все центры связей, включая root, семантически GREEN. Root выделяется размером/halo, а не заменой semantic color.

Debugger, selection, hover, LOD и physical tension не имеют права переопределять этот RGB-канал. Для них используются отдельные presentation channels: halo, scale, label visibility и detail level.

## 4. 180 градусов в центре связи

Semantic centerline задаёт истинную 3D-ориентацию дуг. У GREEN-центра наружные касательные начала и конца антиподальны:

```text
T_start_green = -T_end_green
```

То есть две части связи выходят из её центра под 180 градусов в полном трёхмерном пространстве.

Видимая пружина навивается вокруг centerline. Её envelope обращается в ноль вместе с первой производной на endpoints, поэтому coil не меняет semantic endpoints и endpoint tangents.

## 5. Self-loop cases

Renderer различает все четыре геометрические ситуации:

```text
ordinary
start self-loop
end self-loop
double self-loop
```

Self-loop не удаляется ради производительности или LOD. Допускается уменьшить число сегментов, но semantic arc остаётся видимой.

Корневой kernel уже содержит executable примеры этих случаев:

```text
R = R ⟼ R   double self-loop
O = O ⟼ R   start self-loop
C = R ⟼ C   end self-loop
L = O ⟼ C   ordinary
U = C ⟼ O   ordinary
```

## 6. Readability postprocess и LOD

После physical settle выполняется отдельный bounded readability layer. Он измеряет и ограниченно корректирует presentation coordinates, не заменяя базовую физику.

World-space diagnostics:

```text
center-center proximity
curve-center proximity
curve-curve proximity
```

Readability correction:

- детерминирована;
- ограничена числом проходов и evaluation budgets;
- оставляет root точно в origin;
- может быть отвергнута, если физическая potential energy выросла выше разрешённого drift.

Camera-dependent LOD работает **после** settle:

```text
full -> near / root / selected / current
mid  -> reduced segments
far  -> simplified segments
```

При движении камеры меняется только presentation detail. World layout и force solver заново не запускаются.

Текущий product boundary — до 300 видимых связей. Machine guards используют bounded iteration/evaluation/object/vertex counts вместо хрупкого абсолютного wall-clock threshold.

## 7. Debugger, picking и камера

2D и 3D получают один debugger state из общей visual model.

В 3D:

- OrbitControls обеспечивают orbit/zoom/pan;
- Raycaster выбирает точный `linkId` по GREEN center mesh;
- current/selected/reused/hover отображаются отдельными halo/scale channels;
- labels являются presentation overlay;
- debugger step не перезапускает physical solver.

При переключении 2D <-> 3D renderer lifecycle симметричен: старые canvas, listeners, controls, geometries, materials и label layer освобождаются до создания следующего представления.

## 8. Graceful fallback

2D не зависит от успешного создания Three.js `WebGLRenderer`.

Если пользователь выбирает 3D, но WebGL context создать невозможно или 3D renderer падает до usable scene, приложение выполняет fail-closed переход:

```text
3D failure
  -> destroy partial 3D resources
  -> graphView = 2d
  -> rebuild structural 2D
  -> show explicit "3D недоступен" status
```

Ошибка 3D не должна блокировать parsing, debugger, сохранение данных или дальнейшую работу в 2D.

## 9. Browser acceptance

Browser acceptance запускается против **того же `_site`**, который собирает Pages:

```text
npm ci
npm run deps:prepare
npm run site:build
npm run browser:install
npm run test:browser
```

Browser harness exact-pins `@playwright/test` и Chromium через lockfile. Он не имеет отдельной test-only сборки приложения.

Основные gates являются machine-visible assertions, а screenshot — дополнительное evidence. Проверяются:

- permanent 2D default;
- инициализация Three.js scene из `_site`;
- RED/GREEN/BLUE в реальном framebuffer;
- ordinary/start-self/end-self/double-self geometry;
- BLUE arrow implementation;
- exact `linkId` picking;
- camera interaction;
- debugger presentation;
- repeated renderer disposal;
- WebGL failure -> usable 2D;
- touch viewport;
- branched и recursive SCC fixtures;
- dense 25-link fixture;
- N=300 performance budgets.

Browser screenshots/traces сохраняются CI как supplemental evidence. Pixel-perfect screenshot comparison не является semantic gate, потому что GPU/antialiasing могут различаться.

## 10. Что считать смыслом, а что представлением

Semantic facts:

```text
link identity
start/end poles
root
accepted deserialization result
visual semantic arc topology
RED/GREEN/BLUE roles
```

Presentation-only state:

```text
2D coordinates
3D coordinates
physical velocity/energy
readability corrections
camera
LOD
hover/selection halos
labels
canvas/WebGL resources
```

Главный invariant:

```text
presentation never mutates Aset semantics
```

Поэтому 2D и 3D можно сравнивать как два разных способа видеть одну асеть, но ни один из них не объявляется новой математической семантикой МТС.
