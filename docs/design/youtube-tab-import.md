# YouTube tab import

Issue #6. This is a design and a spike, not the importer. Pasting a YouTube link still does nothing: `YouTubeFrameImporter.can_handle` stays false, and a watch URL fails the `import.youtube_frames` job with `import.notImplemented`. The spike reads a local video or a folder of frames.

## Recommendation

Use a **hybrid**, and build it in that order:

1. **Classical geometry on the CPU** for everything that is a line or a duplicate: tab-region detection, stable-frame selection, de-duplication, scroll, bar lines, string lines. The spike shows this is reliable on both ASCII text tabs and rendered staves.
2. **A small OCR model on the cropped fret cells** for the actual numbers. Template matching (what the spike measures) is the right tool only when the font is known. For real lessons, run Tesseract 5 or PaddleOCR on each cell. Both are CPU libraries and stay out of the default image.
3. **A local vision-language model only as a fallback**, on the RTX 5070 Ti (16 GB), for cells the OCR call marks low-confidence and for technique symbols (hammer, pull, slide, bend). Do not run it on every frame of a ten-minute video.

The spike's classical pipeline, given the font it was shown, read **263 of 264** fret numbers with **no wrong frets** (precision 1, recall 0.996, F1 0.998) and a mean tab-region IoU of **0.987**. An unseen monospace font did not invent a fret either: it dropped one note (3 of 4, F1 0.857). That is the behavior we want from the first pass. A model that confidently prints the wrong fret is worse than a blank the review screen can fill in.

## Pipeline

Work runs as the existing job kind `import.youtube_frames`. Recognition of a real video is slow enough that a second process should claim only that kind from the same `jobs` table (the runner already supports this). The web process keeps the single job thread for Songsterr and file imports. The spike is fast enough to run in-process, which is all the tests do.

```
watch URL
  → yt-dlp (video file, background job)
  → ffmpeg samples frames
  → drop unstable and duplicate frames, track scroll
  → detect the tab region
  → read string lines and fret numbers
  → stitch systems into one ScoreDocument
  → align bar times with the audio
  → review screen
  → save through the importer (ImportResult → songs.create_song)
```

### 1. Download

Same tool Songsterr audio already uses (`fretbook/audio/ytdlp.py`), but it keeps a video instead of extracting an mp3. `video_download_command` builds a yt-dlp argv (no shell string): no playlist, 720p mp4 when YouTube offers one, output path as its own argument. The job runs it with the same timeout as audio downloads.

720p is enough. Fret digits at 1080p cost the vision model extra tokens and do not help the line detector. The download is best-effort. YouTube often refuses datacenter addresses, which this app already treats as "tab saved, upload the file yourself" for audio. The frame importer should do the same: accept a local video or a folder of frames when yt-dlp fails. That path is what the spike implements (`frames_dir` or `video_path` on the job payload).

### 2. Frames

`ffmpeg` is already in the runtime image. Sample at 2 fps to start (`extract_video_frames`). A tab that holds still for a bar does not need more, and a scroll is still visible at 2 fps. Later, raise the rate only while the average-hash distance between neighbors says the picture is moving.

Frames are PPM so the recognizer can read them without Pillow. Pillow is a dev dependency used to _draw_ the synthetic corpus, not to decode user frames.

### 3. Tab region

Two layouts, chosen from the image:

- **Rendered staff.** Rows whose longest ink run is at least 80 px and 12% of the width, grouped into an evenly spaced run of 4–8 lines. The staff line is then erased except where a glyph crosses it, so the numbers are not one connected blob. An `8` meets the line at its waist, so the crossing test looks a few pixels past the line, not only at the adjacent row.
- **ASCII tab.** Bar-line columns are ignored (they put ink on every row). The remaining bright rows are the dash rows. An evenly spaced run of those rows is the system, including a string that contains only dashes. A title above the tab is rejected because its spacing does not match.

The region is the bar lines horizontally and the outer strings vertically. On the synthetic corpus the mean IoU against the drawn system is 0.987. String count selects a preset (4 → bass-4, 5 → bass-5, 6 → guitar-6, 7 → guitar-7). Reading the `EADGBE` label is not done: a `G` is easy to confuse with a `6`, and the label sits outside the bar lines on purpose.

### 4. Stable frames and de-duplication

Each frame gets an 8×8 average hash.

- A frame whose hash is within distance 6 of one already kept is a near-duplicate and is dropped.
- A frame far from both neighbors (distance > 18) is treated as a motion blur between two held frames and dropped. The first and last frames are always candidates.

### 5. Scroll

`estimate_scroll` shifts one frame's row-brightness profile against the next and takes the shift with the smallest difference. Positive means the tab moved down. It needs frames of equal size and is only meaningful for a single system moving as a block, which is the usual lesson-video scroll. A two-column page or a cut to a different angle will not track this way; those frames should start a new segment instead of contributing a scroll offset.

### 6. String lines and fret numbers

After the system is found, connected components are classified.

- A component that touches a bar line is not a note.
- A short, wide component is a dash and is ignored.
- A tall, thin component is the bar line.
- Anything else is rasterized into a 24×16 letterboxed bitmap and compared to templates for `0`–`9` and `x`. The spike builds those templates by drawing DejaVu Sans Mono at 32 px (the font is in `tests/fixtures/fonts/`, Bitstream Vera license). A match is kept when the Hamming distance is at most 100 of 384 and at least 8 better than the runner-up. That threshold is what keeps the title word "Lesson" and the string labels out of the tab.
- Two digits on the same string are one fret when the first is `1` or `2`, the gap is at most 18 px, and the value is at most 99. `x` is a dead note (`fret: 0`, `dead: true`).
- Horizontal position between bar lines maps onto the bar (3840 ticks in 4/4) and snaps to a 16th note (240 ticks). Notes that snap to the same tick are one chord. The spike does not read tuplets, ties, or repeats.

A second pass runs on a 3×3 median of the frame. The reading with more notes wins when the two confidences are within 0.25; otherwise the higher confidence wins. Salt noise is why that second pass exists. Clean frames keep the unfiltered reading.

### 7. Stitching

Each kept frame produces a list of per-bar note tuples. Consecutive frames are merged by the longest suffix/prefix of identical bars, then the bars are renumbered. A frame that repeats the previous system adds nothing. A scroll that advances by one bar keeps the new bar only. This is content overlap, not pixel overlap, so a cut that jumps back to an earlier bar with the same notes can over-merge. The review screen is the backstop. Different string counts in one clip are out of scope; the first frame's count is kept.

### 8. Timing and audio

The audio file is the same download, or the mp3 path Songsterr already uses. Each bar's `sync.points` entry is the timestamp of the first kept frame that contained it (`frame_index / fps` until ffmpeg reports real timestamps). Playback already prefers the user's taps over published points, so a bad frame time is corrected the same way as a bad Songsterr point (`fretbook/score/sync.py`). The spike writes those points. It does not try to hear the notes.

### 9. Review, then the importer

`import_score` returns a normal `ImportResult`. The job handler stores it with `_store_result`, the same function as Songsterr and file imports. `source_ref` is:

```json
{
  "needs_review": true,
  "pipeline": "classical-cv-spike",
  "frame_count": 12,
  "video_id": null
}
```

There is no draft column yet. The full feature should open a review screen on that flag before the import counts as finished: the recognized tab on a staff (alphaTab, the editor we already have), low-confidence cells highlighted, and a confirm action that clears `needs_review`. Until that screen exists, a local-file spike save is how the result is inspected, and a YouTube URL does not save anything.

Wrong frets are ordinary note edits. The screen does not need its own score model.

## Approaches

### Classical CV and OCR

| Piece                             | Role                                                                               | Where it runs              |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------------------- |
| OpenCV (`opencv-python-headless`) | Faster projections, morphology, connected components. Same algorithm as the spike. | Optional extra             |
| Tesseract 5 (LSTM)                | Digits on a cropped cell. One character, whitelist `0123456789x`.                  | Optional extra, CPU        |
| PaddleOCR (PP-OCRv4 / v5)         | Stronger on messy type and on dark themes. Heavier than Tesseract.                 | Optional extra, CPU or GPU |

The spike does not import OpenCV or Tesseract. `requirements.txt`, `requirements-dev.txt`, and the Dockerfile do not install them. `requirements-vision.txt` and the `vision` extra in `pyproject.toml` name the packages for a later phase. `optional_backends()` reports whether they import.

This path is deterministic, debuggable, and cheap. It will not read a bend arrow or a handwritten tab. Cell OCR still needs a good crop, which is why geometry stays in front of it.

### Local vision-language model (16 GB)

The card is an RTX 5070 Ti with 16 GB. Sizes below are weight files, before KV cache. A 1080p frame is on the order of 2,000 visual tokens for Qwen3-VL (about 0.3 GB of cache per image); four frames at once is over a gigabyte before the model writes. Leave that headroom.

| Model                    | Quantization                                                | Weights             | Fit                                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Qwen3-VL-8B-Instruct** | **Q6_K + mmproj F16**                                       | **6.8 GB + 1.3 GB** | **Preferred.** Room for a 1080p cache.                                                                                                                                                  |
| Qwen3-VL-8B-Instruct     | Q8_0 + mmproj F16                                           | 8.8 + 1.3 GB        | Best quality that still fits one image comfortably.                                                                                                                                     |
| Qwen3-VL-8B-Instruct     | Q4_K_M + mmproj F16                                         | 5.1 + 1.3 GB        | Use if several crops are in one prompt.                                                                                                                                                 |
| Qwen3-VL-8B-Instruct     | F16                                                         | 16.5 GB             | Does not fit once the projector and cache are counted.                                                                                                                                  |
| Qwen3-VL-4B-Instruct     | Q8_0 (Ollama `qwen3-vl:4b` is ~3.1 GB at the default quant) | ~3–7 GB             | Faster fallback if 8B is latency-bound.                                                                                                                                                 |
| Qwen2.5-VL-7B-Instruct   | Q8_0, or the ~5.6 GB Ollama default                         | 5.6–11 GB           | Previous generation. Use if Qwen3-VL weights are awkward to serve.                                                                                                                      |
| Gemma 3 12B              | Q4 (`gemma3:12b`, ~7.6 GB)                                  | ~7.6 GB             | Fits, but every image is crushed to a 896 px crop and 256 tokens. Fine fret digits will not survive that without pan-and-scan, and pan-and-scan multiplies the cost. Not the OCR model. |
| Llama 3.2 Vision 11B     | default Ollama tag ~7.3 GB                                  | ~7.3 GB             | Fits. Weaker document OCR than Qwen-VL in published comparisons.                                                                                                                        |
| MiniCPM-V 8B             | ~4.1 GB + ~1 GB projector                                   | ~5 GB               | Fits easily. A reasonable small fallback.                                                                                                                                               |
| Mistral Small 3.2 24B    | Q4 ~14.1 GB                                                 | ~14 GB              | Weights fit and leave under 2 GB. One or two 1080p frames consume that. Do not use it here.                                                                                             |
| Qwen3-VL 32B             | Q4 ~22 GB                                                   | ~22 GB              | Does not fit.                                                                                                                                                                           |

Serve Qwen3-VL-8B with an OpenAI-compatible local server (llama.cpp `llama-mtmd-cli` / `llama-server`, or vLLM with an AWQ build if one is published for that card). The prompt is the crop plus "read the fret numbers on each string, top string first, as JSON". Temperature 0. Validate the JSON against the score model and reject frets outside 0–24 or string counts that disagree with the line detector. A model that returns prose is a failed read, not a tab.

### Hybrid

| Stage                                                                 | Who                                        |
| --------------------------------------------------------------------- | ------------------------------------------ |
| Download, sample, de-dupe, scroll, staff lines, bar lines, cell crops | Classical CV (the spike)                   |
| Digit in a crop, known or printed font                                | Tesseract or PaddleOCR                     |
| Crop the OCR rejects, or a symbol that is not a digit                 | Qwen3-VL-8B Q6_K, one crop at a time       |
| Chord vs. two-digit, bar identity, 4/4 grid                           | Rules in the spike, then the review screen |

Rules stay in charge of time and of which pixels are a string. The model is not asked to invent bar lines. That split is why a wrong model guess cannot move a whole system by a beat without failing a check the geometry already made.

## What the spike measured

Corpus: 4 pieces × 2 layouts (ASCII text, rendered staff) × 6 conditions = 48 frames, 264 notes. Pieces are a 4-string walk, a 6-string bar with a chord, fret 12, and a dead note, a two-bar system, and a bar with a rest. Conditions are clean, 1.2% salt-and-pepper, 0.7 px box blur, inverted colors, lowered contrast, and an 18×14 px shift. Drawing is Pillow and DejaVu Sans Mono 32 px. Templates are the same font, drawn once per glyph. The recognizer never sees the note list.

|                                                        |     Notes | Precision | Recall |    F1 |  Mean region IoU |
| ------------------------------------------------------ | --------: | --------: | -----: | ----: | ---------------: |
| Full corpus                                            | 263 / 264 |     1.000 |  0.996 | 0.998 |            0.987 |
| Every clean frame                                      |     exact |         1 |      1 |     1 | (included above) |
| Liberation Mono, DejaVu templates, one clean bass walk |     3 / 4 |         1 |   0.75 | 0.857 |            0.972 |

The single miss is the fret `8` on a rendered staff after salt: the staff line already cuts an `8` at the waist, and the noise finished the cut. It was dropped, not replaced. The Liberation probe dropped the fret `3` the same way. ASCII was exact in every condition, including salt, blur, dark, low contrast, and shift.

A two-frame H.264 round trip of the clean staff walk (ffmpeg, crf 16) still imported as 4-string bass with the right bar count. That test runs when ffmpeg is on the machine.

These numbers are an upper bound for YouTube. The font is known, the background is flat, nothing occludes the tab, and there is one system. They are a real measurement of the geometry and the matcher: the tests render pixels, then read them back, and they fail if a fret is wrong.

Run it:

```sh
python -m fretbook.importers.youtube_frames --self-test
```

A folder of frames or a local video:

```sh
python -m fretbook.importers.youtube_frames path/to/frames
```

The dev install needs Pillow (`requirements-dev.txt`) because that is what draws the corpus. The server image does not.

## How to estimate accuracy after this

The synthetic corpus stays as a regression test (`tests/test_youtube_frames.py`). It locks today's 263/264 so a change to the matcher cannot silently drop a clean fret or start inventing ones (precision must stay 1 on this set).

The number that decides whether the feature is good enough is a **golden set of real frames**:

1. About 20 lesson or play-along videos, picked to cover ASCII overlays, Guitar Pro / Songsterr-style staves, dark themes, scrolling, and a hand in front of the tab. Store the video id and a handful of timestamps, not the video.
2. A person writes the `ScoreDocument` for those moments. That file is the ground truth.
3. Report the same metrics as the spike: note precision, recall, F1 (a note matches when bar, 16th-note position, string, fret, and dead-flag agree), region IoU, and bar-count accuracy. Also report **corrections per bar** on the review screen, which is the number the user actually feels.
4. Split the report by layout (ASCII vs staff) and by condition (scroll, occlusion, compression). A single F1 will hide a layout that does not work.
5. Do not tune on the golden set and then quote it. Hold out a third of the videos.

Gate to start building the review UI: synthetic precision stays 1, and golden-set note F1 is at least 0.90 with precision at least 0.97. Below that, the screen is a re-entry form and the feature is not worth the download. The review screen does not go away after the gate. It stays until a later measurement says corrections are rare.

## Risks

- **YouTube will refuse the download** from many hosts. The local-file path has to be first-class, as it is for Songsterr audio today.
- **The tab is someone else's arrangement.** Saving a transcription into the user's library is the same copyright situation as the other importers. Do not build a public corpus from other people's videos.
- **Fonts.** Template matching is excellent on DejaVu and merely careful on Liberation (it missed a note, it did not lie). A Guitar Pro screenshot will not match DejaVu templates. That is why phase 2 swaps in Tesseract or PaddleOCR.
- **The staff line cuts digits** that cross it (`0`, `8`, `4`). The spike special-cases the waist of an `8` and still loses one under salt. Real antialiasing and compression will do this more often.
- **A column of `1`s can look like a bar line**, and a `G` label can look like a `6`. The spike avoids both by geometry (bar lines are thin and span the system; labels are outside the bars). A dense chord of all `1`s is the case that will break the rule.
- **Techniques are invisible** to this spike. Hammer-ons, slides, and bends will import as plain frets.
- **Timing is a grid**, not the performance. Sync points from frame time will be early or late by a fraction of a bar. Taps already fix that.
- **Scroll stitch can over-merge** two different bars that happen to contain the same frets.
- **One system only.** Multi-column lessons, several tracks, and a tab plus a chord chart on the same frame are not detected.
- **Tuning is a guess** from the string count. Drop D and a 5-string with a low B need the label, which we do not read yet.
- **A VLM will hallucinate a plausible fingering.** Accept its JSON only when the string count matches the line detector and every fret is in range. Otherwise keep the blank.
- **GPU work in the web process** would stall every other import. The worker that claims `import.youtube_frames` has to be separate before the VLM phase.
- **16 GB is not spare.** Qwen3-VL-8B at F16, and anything 24B at Q4 with a 1080p cache, will OOM or page. Stay at Q6_K or Q4_K_M for the 8B model.

## Phased plan

**Phase 0, this PR.** Design, synthetic corpus, classical reader, local-file job. YouTube URLs unchanged.

**Phase 1. Real frames.** Sample with ffmpeg, keep the geometry, and start the golden set. No model yet.

**Phase 2. Cell OCR.** Tesseract or PaddleOCR behind `requirements-vision.txt`, still optional. Re-measure the golden set.

**Phase 3. VLM fallback.** Qwen3-VL-8B-Instruct Q6_K on the 5070 Ti, only for rejected cells and technique symbols, in a worker process.

**Phase 4. Product path.** yt-dlp video job, frame timestamps copied into `sync.points`, review screen, confirm clears `needs_review`.

**Phase 5. The rest of a tab.** Tuning labels, more than one system per frame, hammer / pull / slide / bend.

### Follow-up issues

These are not filed yet.

1. **Sample local videos and select stable frames.** ffmpeg at 2 fps, average-hash de-dupe, scroll offset, a worker that claims only `import.youtube_frames`.
2. **Golden set and accuracy harness.** 20 videos, hand-written `ScoreDocument`s, the same precision / recall / F1 / IoU report as the spike, with a held-out split.
3. **Optional cell OCR.** Tesseract 5 or PaddleOCR on the spike's crops. Off by default. Compare against the 263/264 synthetic number and against the golden set.
4. **Qwen3-VL-8B fallback.** Q6_K + mmproj F16, temperature 0, JSON only, rejected when it disagrees with the line detector. Document the VRAM high-water mark on the 5070 Ti.
5. **Review screen.** Open a `needs_review` song in the editor, mark low-confidence notes, confirm before the import is final.
6. **yt-dlp video download and audio alignment.** Wire `download_video` into the URL job, and set `sync.points` from frame time. Keep the "upload it yourself" failure path.
7. **More than one system.** Scrolling multi-line lessons and two-column pages. Do not over-merge identical bars.
8. **Tuning labels and techniques.** Read the string names without treating `G` as a fret. Then hammer, pull, slide, and bend.
