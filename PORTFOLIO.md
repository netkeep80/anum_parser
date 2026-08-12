# Portfolio roadmap

`anum_parser` является экспериментальной лабораторией в portfolio [`netkeep80`](https://github.com/netkeep80).

Portfolio-level направление, приоритет, lifecycle, cross-repo dependencies и следующий gate **намеренно не дублируются здесь**. Authoritative sources:

- [netkeep80/roadmap](https://github.com/netkeep80/roadmap) — главный portfolio control plane;
- [Current status](https://github.com/netkeep80/roadmap/blob/main/STATUS.md) — live GitHub state;
- [Execution order](https://github.com/netkeep80/roadmap/blob/main/EXECUTION.md) — cross-repo gates;
- [Architecture](https://github.com/netkeep80/roadmap/blob/main/ARCHITECTURE.md) — canonical ownership/dependencies.

Эксперименты сериализации, десериализации и визуализации ачисел остаются local responsibility этого repository. Нормативные МТС/Anum contracts и принятие экспериментальной семантики принадлежат `netkeep80/anum_docs`.

```text
roadmap decides portfolio direction;
anum_docs owns normative MTS/Anum semantics;
this repository owns its laboratory experiments and UX;
GitHub facts feed the central live status.
```

Если эксперимент лаборатории претендует на нормативное значение, он сначала проходит обычный research/acceptance path в `anum_docs`; central roadmap обновляется только после portfolio-level изменения зависимостей или порядка работ.
