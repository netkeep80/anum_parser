# anum_parser

Отдельный экспериментальный репозиторий для сериализации, десериализации и визуализации ачисел.
**Публичный URL**: [https://netkeep80.github.io/anum_parser/](https://netkeep80.github.io/anum_parser/)

## Зачем он нужен

Лаборатория позволяет наглядно исполнять принятую десериализацию ачисел и одновременно сохранять рядом экспериментальные варианты для сравнения. Экспериментальный алгоритм сам по себе не изменяет нормативную МТС: принятие происходит отдельно в `anum_docs`.

Текущая normative boundary лаборатории:

```text
semantic authority = netkeep80/anum_docs
accepted MTS       = v0.10
runtime package    = @mts/core@0.10.0
consumer mode      = exact pinned artifact
```

`anum_parser` не копирует текущую семантику МТС и не поддерживает собственный accepted interpreter. Accepted четверичный путь делегирует исполнение `@mts/core.executeAbits` из exact-проверенного artifact.

Идентификатор `anum-v0.4` сохранён как стабильный **лабораторный id десериализатора**. Это не номер текущего релиза МТС.

На наблюдаемом upstream `anum_docs` MTS v0.11 остаётся candidate / NOT ACCEPTED. Лаборатория не подключает candidate как production runtime и не эмулирует его локально. После официального acceptance следующий переход должен быть отдельным explicit repin с новым exact SHA, contract/conformance и artifact digest.

## Главное различение

Лаборатория никогда не называет одним словом следующие представления:

1. последовательность исходных символов;
2. последовательность абитов;
3. связь;
4. упорядоченную последовательность ссылок на связи;
5. акорневую связь-последовательность, используемую как носитель;
6. связь, хранящую ачисло;
7. денотат, полученный конкретной десериализацией.

Для МТС действует базовая аксиома тождества связи:

```text
(A ⟼ B) = (C ⟼ D)
⇔
A = C ∧ B = D
```

То есть связь полностью определяется началом и концом. Две различные связи с одинаковыми полюсами в МТС невозможны. Технические `id` в лабораторных файлах являются только адресами записей, а не дополнительным уровнем тождества.

Это принципиально отличает используемую здесь модель МТС от модели сети дуплетов Теории связей, где отдельная ссылка связи и значение пары могут быть разными уровнями.

## Exact consumer boundary

Accepted runtime фиксируется в:

```text
contracts/mts-core-consumer-lock.json
```

Текущий lock связывает вместе:

```text
upstream repository = netkeep80/anum_docs
exact upstream SHA  = 957c818d82bd3211f2a59547fff28e8ed0ec4331
contract            = mts-contract/v0.10
conformance         = mts-conformance/v0.10
package             = @mts/core@0.10.0
artifact sha256     = 0cd716b65fcdcfb8ca31ec3899f1a812f0b4c9dbfe46bfc1f31899b762cde007
```

Lock также fail-closed фиксирует consumer policy:

```text
channel                              = accepted-current
floatingRefAllowed                   = false
candidateAllowedAsCurrent            = false
deepSourceImportAllowed              = false
vendoredCurrentSemanticSourceAllowed = false
```

Перед тестами и Pages deploy `scripts/materialize-mts-core.mjs` заново получает exact source SHA, проверяет accepted contract/conformance, собирает package, сверяет digest и только затем создаёт gitignored `generated/mts-core/`.

`generated/` — build product, а не второй источник семантики.

## Корневой транспорт

Четверичное ачисло передаёт ровно четыре абита:

```text
[ ] 1 0
```

Акорень `∞ = R` не является пятым абитом.

Строгий `.anum4` parser является **presentation boundary** лаборатории: файл должен содержать только literal `[ ] 1 0`. После проверки exact abit sequence передаётся в accepted `@mts/core.executeAbits`.

Контрольные примеры принятого runtime:

```text
ε     -> R
[]    -> R
1     -> L
10    -> L ⟼ U
[1]   -> R ⟼ L
[[]]  -> R
```

Локальный `AsetBuilder` при accepted execution не определяет переходы `OPEN/CLOSE/VALUE`: он только материализует вызовы `link(start,end)`, сделанные upstream runtime, и строит presentation/visualization projection.

## Два входных транспорта accepted runtime

Один accepted runtime имеет два входных пути.

Первый путь — обычный физический поток `.anum4`:

```text
.anum4
  -> strict local validation
  -> exact [ ] 1 0 sequence
  -> @mts/core.executeAbits
```

Второй путь — существующая асеть с явно указанной связью-носителем в `provenance.representations.carrier`. Лаборатория читает её только как конечную start-историю от `R`, восстанавливает `O/C/L/U`, переводит их обратно в `[ ] 1 0` и передаёт в **тот же** accepted runtime.

Таким образом, для связи-носителя нет второго алгоритма `OPEN/CLOSE/VALUE`, скрытого пятого абита или отдельной нормативной семантики. Исходная импортированная асеть при чтении не изменяется.

В интерфейсе эти действия разделены явно:

- `.aset.json — открыть асеть` — только показать уже существующую асеть;
- `.aset.json — прочитать carrier через ANUM v0.4` — восстановить четверичный transport и исполнить exact accepted `@mts/core` runtime.

## Форматы

- `.anum4` — исходное четверичное ачисло профиля `[ ] 1 0`;
- `.anums` — исходное строковое ачисло в UTF-8 без скрытой нормализации;
- `.anum.json` — самодокументируемый контейнер эксперимента;
- `.aset.json` — наглядный снимок канонической асети; его можно открыть как снимок или явно использовать отмеченную связь-носитель как вход accepted runtime.

Подробно: [`docs/formats.md`](docs/formats.md).

## Веб-лаборатория

Статическое приложение позволяет:

- вводить или загружать разные форматы;
- независимо выбирать десериализатор и сериализатор;
- сравнивать accepted и experimental алгоритмы на одном исходнике;
- отдельно видеть символы, абиты, последовательности ссылок, акорневые цепочки и связи-хранилища;
- пошагово видеть позицию источника, контекстную проекцию, `current` и изменения асети;
- наблюдать, как новые связи появляются в графе именно после upstream semantic operation;
- открыть `.aset.json` как готовую асеть или прочитать её явно отмеченный носитель;
- визуализировать асеть с перемещением, масштабированием и несколькими раскладками;
- сохранять `.aset.json` и без потерь восстанавливать исходную запись, когда это доказано происхождением данных.

GitHub Pages materializes и публикует тот же exact-pinned `@mts/core`, который проверяется CI. Production browser больше не исполняет старую локальную accepted stack machine.

## Десериализаторы

- `anum-v0.4` — **accepted laboratory id**: строгий четверичный input и existing-carrier transport делегируют semantics в exact `@mts/core` / MTS v0.10;
- `stack-group-value-v0` — **experimental**: локальная историческая stack machine, где группа возвращает внутреннее значение напрямую; не является нормативной МТС;
- `abit-flat-v0` — **experimental**: контрольная плоская свёртка четырёх абитов;
- `string-flat-v0` — **experimental**: строковая UTF-8 левая свёртка.

Локальный `deserializeStack` разрешён только для explicit experimental algorithms. Accepted path fail-closed от попытки использовать его как semantic authority.

## Provenance accepted результата

Accepted `.aset.json` фиксирует не только `status=accepted`, но и exact upstream authority:

```text
semanticAuthority.package
semanticAuthority.version
semanticAuthority.contract
semanticAuthority.conformance
semanticAuthority.upstreamRepository
semanticAuthority.upstreamCommit
semanticAuthority.artifactSha256
semanticAuthority.generatedTreeSha256
semanticAuthority.consumerLock
```

Это позволяет отличить смысловую норму от локального presentation adapter и не принять случайный moving/candidate runtime за current.

## Сериализаторы

- `aset-json-v0` — сохранить лабораторную `.aset.json`;
- `source-replay-v0` — без потерь вернуть исходное `.anum4` или `.anums` при наличии свидетельства происхождения;
- `source-envelope-v0` — сохранить тот же источник в `.anum.json`.

Лаборатория не предполагает, что произвольную асеть можно автоматически и однозначно сериализовать в ачисло.

## Корпус тестов

[`examples/cases.json`](examples/cases.json) содержит принятые четверичные входы, ошибочные границы, сравнительные эксперименты, исторические строки и Unicode.

CI проверяет одновременно:

- exact rebuild + SHA256 `@mts/core` artifact;
- package-root consumer boundary;
- differential corpus старого локального baseline против accepted v0.10;
- accepted runtime projection против прямого `@mts/core.executeAbits`;
- exact semanticAuthority provenance;
- совпадение физического transport и existing-carrier path;
- неизменность входной асети при чтении носителя;
- `[] = R` и схлопывание `R ⟼ R = R`;
- identity связей по полюсам;
- debugger/visualizer projection invariants;
- явную ненормативность experimental algorithms.

## MTS v0.11 candidate

Текущий consumer intentionally остаётся на accepted v0.10, пока upstream contract v0.11 содержит:

```text
status = candidate
accepted = false
acceptanceReady = false
candidateRuntimeSelectable = false
```

Новые candidate semantics (`TopBind(R,S)`, top-level `.`, nested contextual binding и дальнейшие C4/C5/C6 lifecycle slices) не должны реализовываться второй локальной semantic machine в `anum_parser`.

После official upstream acceptance требуется отдельный migration PR: новый exact lock, artifact digest, differential evidence, runtime tests и только затем production switch.

## Локальная проверка

Требуется Node.js 24 или новее и доступ к exact upstream Git SHA для materialization.

```bash
npm run check
npm test
```

Обе команды автоматически выполняют `npm run mts:prepare` перед импортом accepted runtime.

## Материалы

- [`docs/history.md`](docs/history.md) — историческая выжимка; старые версии там могут упоминаться как история;
- [`docs/formats.md`](docs/formats.md) — файловые форматы и provenance;
- [`docs/architecture.md`](docs/architecture.md) — current runtime/authority boundary;
- [`examples/cases.json`](examples/cases.json) — общий корпус примеров.

## Управление изменениями

Изменения проходят обязательную проверку `repo-guard`. Accepted MTS version меняется только explicit repin по machine-readable lock; moving `main` или candidate contract не считаются production authority.
