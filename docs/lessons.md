# Writing lessons

Fretbook teaches with **courses**: ordered lessons grouped into levels, with prerequisites, one set for guitar and one for bass. Lessons are plain Markdown files, so people and coding agents can write them, review them in a pull request, and share them as a zip.

This page is the format reference. To *use* the lessons, open **Lessons** in the sidebar (on a phone: **Tools → Lessons**). See [Learning a song](guides/lessons.md) for how lessons fit with the practice tools.

## Where lessons live

```text
lessons/                  built-in courses, shipped with Fretbook (fretbook/lessons/builtin/)
$FRETBOOK_LESSONS_DIR/    your own courses (default: $FRETBOOK_DATA_DIR/lessons)
    my-course/
        course.md         the course: title, track, levels, prerequisites
        01-first.md       a lesson
        02-second.md      another lesson
```

The folder name is the course id and the file name (without `.md`) is the lesson id. Ids use lowercase letters, digits and dashes, at most 64 characters, and cannot be `new` or `edit`. Fretbook reads the folder on every request, so a file you drop in appears at once, with no restart.

A file of yours replaces a built-in one with the **same course and lesson id**; the other lessons of the built-in course stay. Deleting your copy brings the built-in one back. Built-in lessons cannot be deleted.

A file with a mistake never stops the others loading. The Lessons page lists every problem (file, line and reason) for administrators.

## Who can edit

With sign-in (OIDC), **administrators** add and edit lessons; everyone else can only read and play them. Without sign-in the one person using the server is the administrator. Progress is always **per user**.

In the app: **Lessons → New course**, or a course's **New lesson** / **Edit lesson**. The editor is a Markdown text box with a live preview that is produced by the server's own parser, so what you see is what gets saved, and a mistake is reported with its line before you can save it. **Import a lesson pack** adds a zip (see below).

## A lesson file

```markdown
---
title: Em and Am
summary: Your first two chords.
level: chords
order: 1
requires: [01-the-open-strings]
---
Press just behind the fret, with the tips of your fingers.

```fretbook:chord
name: Em
```

```fretbook:pass
type: score
min_score: 80
min_bpm: 60
```
```

### Front matter

The header is a small, strict subset of YAML: `key: value` lines, `key: [a, b]` lists, a block list of `- item` lines under a key, `#` comments, and optional single or double quotes.

| Key | Meaning |
| --- | --- |
| `title` | Required. Shown as the page title, so do not repeat it as a heading. |
| `summary` | One line shown in the course list. |
| `level` | One of the course's level ids. Default: the course's first level. |
| `order` | A whole number; lessons sort by level, then `order`, then id. Default 0. |
| `requires` | Lessons of this course to finish first, `[a, b]`. Default: **the lesson before this one**, so a course is a straight line unless you say otherwise. `requires: []` makes a lesson open from the start. |

### The body

Markdown: headings (`#` to `###`), paragraphs, bullet and numbered lists, quotes, code blocks, **bold**, *italic*, `code` and links. Raw HTML is shown as text, and links may only be `http(s)` or relative. Start headings at `#`; they are shown one level below the page title.

### Blocks

A block is a fenced code block whose info string is `fretbook:<kind>`. Its lines are `key: value`.

| Block | Keys | Shows |
| --- | --- | --- |
| `fretbook:chord` | `name` (such as `Am7`), `instrument` (`guitar`, `bass` or `ukulele`; default `guitar`) | A chord diagram. |
| `fretbook:fretboard` | `notes` (`A C E`), or `root` and `scale` (`major`, `minor`, `major-pentatonic`, `minor-pentatonic`, `blues`); `instrument` | A fretboard with every place those notes sound. |
| `fretbook:tab` | the ASCII tab itself, at most 4,000 characters | A tab excerpt in a monospace box. |
| `fretbook:exercise` | `preset` (an id from **Tools → Exercises**, such as `pentatonicBox`, `openChordChanges`, `rootFifthOctave`), optional `title` | A button that opens the generated exercise in the generator, ready to play or save. |
| `fretbook:song` | `song` (a song id from your library), optional `title` | A link to the song. Library ids belong to one library, so use this in lessons you write for yourself, not in packs you share. |
| `fretbook:media` | `type` (`video` or `audio`), `src` (an `http(s)` link), optional `title` | A video or audio player. YouTube links are shown as a link that opens YouTube. |
| `fretbook:pass` | see below | How the lesson is passed. At most one per lesson. |

### Pass conditions

A lesson with no `fretbook:pass` block is finished with **Mark as done**. Otherwise:

| `type` | Keys | Passed when |
| --- | --- | --- |
| `score` | `min_score` (0 to 100, required), `min_bpm` (optional), `song` (optional) | A run scored at least `min_score` percent, at `min_bpm` or faster when given. |
| `wait` | `song` (optional) | Wait mode was completed. |

Without `song`, the learner reports the result themselves in the lesson (score and tempo, or "I played it in wait mode") and Fretbook checks it against the condition. With `song`, **Check my practice** looks in the [practice log](guides/practice.md#practice-log) for a scored run of that library song that meets the condition (its tempo is the song's tempo times the playback speed), or a wait-mode session. A finished lesson stays finished.

## A course file

```markdown
---
title: Guitar first steps
track: guitar
summary: Hold the guitar, play your first chords.
levels:
  - basics: Basics
  - chords: First chords
requires: [another-course]
---
```

| Key | Meaning |
| --- | --- |
| `title`, `track` | Required. `track` is `guitar` or `bass`. |
| `summary` | One line for the course card. |
| `levels` | The level ids in order, each as `id: Title`. Lessons name a level by id. |
| `requires` | Courses to finish completely before this course opens. |

Prerequisite loops, unknown ids and lessons in an unknown level are reported as problems and ignored.

## Lesson packs

A pack is a zip with the same layout, one folder per course:

```text
my-pack.zip
    my-course/course.md
    my-course/01-first.md
    my-course/02-second.md
```

**Lessons → Import a lesson pack** adds it to your lessons folder (a lesson for a course you already have needs no `course.md`). The whole pack is checked first and nothing is added if any file has a mistake. Packs are limited to 10 MB and 500 lessons, and other files in the zip are ignored. You can also unzip a pack into the lessons folder yourself.

## Backups

[Library backups](self-hosting/backups.md) of a single user include that person's lesson progress. Your own lesson files live in the lessons folder, outside the database and outside the library archive: back that folder up with your data directory.
