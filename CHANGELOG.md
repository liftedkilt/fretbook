# Changelog

## [0.1.3](https://github.com/liftedkilt/fretbook/compare/v0.1.2...v0.1.3) (2026-10-23)


### Features

* **import:** parse Guitar Pro files on the server ([16e9dc0](https://github.com/liftedkilt/fretbook/commit/16e9dc067c625be62885423474ddb2108d25c51f)), closes [#48](https://github.com/liftedkilt/fretbook/issues/48)
* render repeats, voltas, and D.S./D.C. in expanded order ([c1582d2](https://github.com/liftedkilt/fretbook/commit/c1582d2f1aaabd03e82a8ce0027e849407333873))

## [0.1.2](https://github.com/liftedkilt/fretbook/compare/v0.1.1...v0.1.2) (2026-10-23)


### Features

* import plain ASCII tab into a real score ([#114](https://github.com/liftedkilt/fretbook/issues/114)) ([1c9eaa5](https://github.com/liftedkilt/fretbook/commit/1c9eaa585bc7974ebbcd60191547291f2798a586))
* **jobs:** retry failed imports from the library ([2f109b4](https://github.com/liftedkilt/fretbook/commit/2f109b46017d13356f4b43480a803f259bf2d762))
* library export/import archive and `backup` command ([39deb90](https://github.com/liftedkilt/fretbook/commit/39deb906a954775554d6b8386c5df937aa9d01bc))
* library search, sorting, and paging for large libraries ([#108](https://github.com/liftedkilt/fretbook/issues/108)) ([1b9e526](https://github.com/liftedkilt/fretbook/commit/1b9e526e8477e7425efbd16c84da075866ac9d62))
* metronome, count-in, per-track mixer and pitch-preserving slowdown ([#123](https://github.com/liftedkilt/fretbook/issues/123)) ([0e4d430](https://github.com/liftedkilt/fretbook/commit/0e4d430862f1dec6a7fa0c24953d97c7f14dc3bb))
* microphone pitch detection engine (AudioWorklet) with an accuracy test harness ([#119](https://github.com/liftedkilt/fretbook/issues/119)) ([d3b6fd5](https://github.com/liftedkilt/fretbook/commit/d3b6fd5579e6b121080b462ac071a237add9f046))
* universal import for files, pasted text and links ([#122](https://github.com/liftedkilt/fretbook/issues/122)) ([14a2060](https://github.com/liftedkilt/fretbook/commit/14a20608e9587c4844a311342f9a9875becebf67))

## [0.1.1](https://github.com/liftedkilt/fretbook/compare/v0.1.0...v0.1.1) (2026-10-23)


### Features

* **db:** migration upgrade tests and automatic pre-migration backup ([#92](https://github.com/liftedkilt/fretbook/issues/92)) ([dd31737](https://github.com/liftedkilt/fretbook/commit/dd31737b87e78f13b7fd84f56ba0525367b8176c))
* report yt-dlp version, explain download failures, and optionally auto-update it ([#89](https://github.com/liftedkilt/fretbook/issues/89)) ([3ebaa08](https://github.com/liftedkilt/fretbook/commit/3ebaa08d08dec2ce0243974b30c819b49f30cc0e))
* versioned releases with release-please, changelog, and version in the app ([#96](https://github.com/liftedkilt/fretbook/issues/96)) ([33513b8](https://github.com/liftedkilt/fretbook/commit/33513b8ca2a1e906dbaa260a6ce58a81e291e561))
* **web:** reimagine UI & branding as Fretbook Studio for desktop, iPad, and mobile ([#14](https://github.com/liftedkilt/fretbook/issues/14)) ([e84c609](https://github.com/liftedkilt/fretbook/commit/e84c609064d48952b7743ea9c469672995414917))


### Bug Fixes

* **db:** remove duplicate SchemaVersionError alias that breaks mypy on main ([#107](https://github.com/liftedkilt/fretbook/issues/107)) ([ada6cab](https://github.com/liftedkilt/fretbook/commit/ada6cabea3922f6b3e9af7ef07ab32c4d7cf1089))
* keep openapi.json out of release-please so release PRs pass CI ([#106](https://github.com/liftedkilt/fretbook/issues/106)) ([3ccc23f](https://github.com/liftedkilt/fretbook/commit/3ccc23f3bcbdb11e92b720f42ff65e2727403798))

## Changelog

All notable changes to Fretbook are documented here. This file is maintained by
[release-please](https://github.com/googleapis/release-please) from Conventional Commit pull request titles.
