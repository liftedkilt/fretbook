"""Playback order: which written bars are played, and in what order.

The document stores bars as written. A song with repeats, voltas (alternate
endings), D.S./D.C. jumps and codas plays some bars several times and skips
others. This module expands the written bars into the played order, following
the rules alphaTab's synth uses (``MidiPlaybackController``), so the order here
is the order the player hears. ``web/src/lib/playback.ts`` is the same
algorithm and both are tested on ``tests/fixtures/playback-order.json``.

Sync marks are keyed by *played* bar index: the position in this list.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Protocol

# A song cannot expand past this many bars. Nested repeats of 32 would otherwise
# multiply into millions; the expansion stops instead of hanging a request.
MAX_PLAYED_BARS = 10_000


class BarLike(Protocol):
    """The fields of :class:`fretbook.score.model.Bar` the expansion reads."""

    @property
    def repeat_start(self) -> bool: ...
    @property
    def repeat_end(self) -> int: ...
    @property
    def alternate_endings(self) -> Sequence[int]: ...
    @property
    def directions(self) -> Sequence[str]: ...


# Jump directions, the state the pass enters after the jump, and the target the jump looks for.
_DA_CAPO = {"da_capo": 1, "da_capo_al_coda": 2, "da_capo_al_double_coda": 3, "da_capo_al_fine": 4}
_DAL_SEGNO = {"dal_segno": 1, "dal_segno_al_coda": 2, "dal_segno_al_double_coda": 3, "dal_segno_al_fine": 4}
_DAL_SEGNO_SEGNO = {
    "dal_segno_segno": 1,
    "dal_segno_segno_al_coda": 2,
    "dal_segno_segno_al_double_coda": 3,
    "dal_segno_segno_al_fine": 4,
}

_AFTER_JUMP, _TO_CODA, _TO_DOUBLE_CODA, _TO_FINE = 1, 2, 3, 4


@dataclass
class _Group:
    """A repeated stretch: where it opens and every bar that closes it."""

    opening: int = -1
    closings: list[int] = field(default_factory=list)
    closed: bool = False


@dataclass
class _Repeat:
    group: _Group
    opening: int
    iterations: list[int]
    closing_index: int = 0


def _groups(bars: Sequence[BarLike]) -> list[_Group]:
    """Assign every bar to a repeat group, as alphaTab's ``Score._addMasterBarToRepeatGroups`` does."""
    owners: list[_Group] = []
    opened: list[_Group] = []
    properly_opened = 0
    current: _Group | None = None
    for index, bar in enumerate(bars):
        if bar.repeat_start:
            if current is not None and current.closed:
                if opened:
                    opened.pop()
                properly_opened -= 1
            current = _Group()
            opened.append(current)
            properly_opened += 1
        elif current is None:
            current = _Group()
            opened.append(current)
        if current.opening < 0:
            current.opening = index
        owners.append(current)
        if bar.repeat_end > 0:
            current.closings.append(index)
            current.closed = True
            if properly_opened > 1:
                if opened:
                    opened.pop()
                properly_opened -= 1
                current = opened[-1] if opened else None
    return owners


def _endings_mask(bar: BarLike) -> int:
    mask = 0
    for ending in bar.alternate_endings:
        if 1 <= ending <= 31:
            mask |= 1 << (ending - 1)
    return mask


def _jump(directions: set[str], index: int, find: Callable[[str, int, bool], int]) -> tuple[int, int]:
    """Destination bar and next state of a D.C./D.S. jump on this bar, or ``(-1, 0)`` when none applies."""
    for names, target in ((_DA_CAPO, None), (_DAL_SEGNO, "segno"), (_DAL_SEGNO_SEGNO, "segno_segno")):
        for name, after in names.items():
            if name not in directions:
                continue
            destination = 0 if target is None else find(target, index, True)
            if destination >= 0:
                return destination, after
    return -1, 0


def played_bars(bars: Sequence[BarLike]) -> list[int]:
    """Written bar index of each played bar, in playing order."""
    count = len(bars)
    owners = _groups(bars)
    has = [{*bar.directions} for bar in bars]
    endings = [_endings_mask(bar) for bar in bars]

    def find(target: str, start: int, backwards_first: bool) -> int:
        forwards = [index for index in range(start, count) if target in has[index]]
        backwards = [index for index in range(start, -1, -1) if target in has[index]]
        first, second = (backwards, forwards) if backwards_first else (forwards, backwards)
        return first[0] if first else (second[0] if second else -1)

    played: list[int] = []
    stack: list[_Repeat] = []
    on_stack: set[int] = set()  # id() of the groups on the stack
    previous_endings = 0
    state = 0
    index = 0

    def reset_repeats() -> None:
        nonlocal previous_endings
        stack.clear()
        on_stack.clear()
        previous_endings = 0

    while index < count and len(played) < MAX_PLAYED_BARS:
        # Does this bar play on the current pass?
        should_play = True
        if state == 0:
            bar_endings = endings[index] or previous_endings
            group = owners[index]
            if index == group.opening and group.closed and id(group) not in on_stack:
                stack.append(_Repeat(group, index, [0] * len(group.closings)))
                on_stack.add(id(group))
                previous_endings = 0
                bar_endings = endings[index]
            if stack and bar_endings:
                repeat = stack[-1]
                previous_endings = bar_endings
                should_play = bool(bar_endings & (1 << repeat.iterations[repeat.closing_index]))
        if should_play:
            played.append(index)

        # Where does playback go next?
        directions = has[index]
        if directions and state == 0:
            destination, after = _jump(directions, index, find)
            if destination >= 0:
                index, state = destination, after
                reset_repeats()
                continue
        elif directions and state != _AFTER_JUMP:
            if state == _TO_CODA and "da_coda" in directions:
                destination = find("coda", index, False)
                if destination >= 0:
                    index, state = destination, 0
                    continue
            elif state == _TO_DOUBLE_CODA and "da_double_coda" in directions:
                destination = find("double_coda", index, False)
                if destination >= 0:
                    index, state = destination, 0
                    continue
            elif state == _TO_FINE and "fine" in directions:
                break
            index += 1
            continue
        if state != 0:
            index += 1
            continue

        # Plain repeats.
        extra = bars[index].repeat_end - 1
        if stack and extra > 0:
            repeat = stack[-1]
            if repeat.iterations[repeat.closing_index] < extra:
                index = repeat.opening
                repeat.iterations[repeat.closing_index] += 1
                for earlier in range(repeat.closing_index):
                    repeat.iterations[earlier] = 0
                repeat.closing_index = 0
                previous_endings = 0
            elif repeat.closing_index < len(repeat.group.closings) - 1:
                repeat.closing_index += 1
                index += 1
            else:
                stack.pop()
                on_stack.discard(id(repeat.group))
                index += 1
        else:
            index += 1
    return played


def occurrences(order: Sequence[int]) -> list[int]:
    """For each played bar, how many times its written bar was played before it."""
    seen: dict[int, int] = {}
    result: list[int] = []
    for written in order:
        result.append(seen.get(written, 0))
        seen[written] = seen.get(written, 0) + 1
    return result


def first_played(order: Sequence[int], written_count: int) -> list[int]:
    """Played index of the first play of each written bar; the played count where it is never played."""
    first = [len(order)] * written_count
    for position in range(len(order) - 1, -1, -1):
        first[order[position]] = position
    return first
