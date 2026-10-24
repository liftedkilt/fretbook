# AI assistant settings

Fretbook can use a language model to review tabs it generates and to write easier versions of a song. This page covers
who pays for it, how keys are stored, and the limits. Open **Settings** to find the controls. In single-user mode the
one user manages everything; with sign-in, the administrator sees the server settings and everyone sees their own key.

## Provider (administrator)

| Provider | What to enter |
| --- | --- |
| Off | Turns the AI features off. Transcription that does not need a model still works. |
| Local (Ollama) | The Ollama URL, for example `http://pop-os:11434`, and a model name. No key. |
| Anthropic | A model name and the shared API key. The base URL is optional. |
| OpenAI-compatible | A model name, the shared API key, and the API base URL for a compatible server (default `https://api.openai.com/v1`). |

## Keys

- The **shared key** is set by the administrator. After you save it, it is never shown again; leave the field blank to
  keep it, or use *Remove shared key*.
- Anyone can save **their own key** in Settings. It is used only for that person's requests.
- Keys are encrypted in the database. The encryption key is `FRETBOOK_SECRET_KEY` if you set it, otherwise a random one
  that Fretbook creates once in `$FRETBOOK_DATA_DIR/secret.key`. Keep that file out of any backup that sits next to the
  database. If it is lost, saved keys can no longer be read and must be entered again.

## Who may use what

The administrator sets an access mode for each user:

- `own_key` (the default for new users): the user must bring their own key.
- `shared`: the user may use the shared key, within a quota.
- `disabled`: no access.

A user in `shared` mode who has saved their own key uses it first, and those requests do not count against the quota.

## Limits

- Per user, for the shared key: generations per day, generations per month, and an optional monthly spend cap in
  dollars. A blank field means no limit. New users start at 20 per day and 200 per month. Spend is estimated from token
  counts and rough list prices, so treat it as a guide, not an invoice.
- Instance-wide: an optional monthly dollar cap on the shared key, as a backstop.
- Local models cost nothing, but the per-user count limits still apply if set, and the rate limit always applies.
- Rate limit: a few requests per minute per user (5 by default; the administrator can change it).
- An identical request (same song and difficulty) is answered from a saved result without calling the model or using
  quota.

A request over a limit is refused with a message saying which limit was hit. The administrator sees a notice when a user
reaches 80% of a limit, and a usage log with the user, time, model, input and output tokens, and estimated cost, with
per-user totals.
