# Changelog

## [0.1.4](https://github.com/liftedkilt/fretbook/compare/v0.1.3...v0.1.4) (2026-10-24)


### Features

* add a song to a setlist from the song page and library ([8e8125a](https://github.com/liftedkilt/fretbook/commit/8e8125abea49b1de4c7fe2e423e15bbf0d3222dc))
* answer chord-quality ear training by playing the chord ([9fa5ee1](https://github.com/liftedkilt/fretbook/commit/9fa5ee1834fcfa2efb2ef9804397ebb01b6bfd37))
* apply a capo suggestion to a chord sheet ([49e5b79](https://github.com/liftedkilt/fretbook/commit/49e5b7983411b0518309a5add2971a0e42a1091f))
* **audio:** audio latency calibration ([#67](https://github.com/liftedkilt/fretbook/issues/67)) ([e074ff7](https://github.com/liftedkilt/fretbook/commit/e074ff7236e9799019ae14a0bd64283bbd85a418))
* **chords:** chord diagrams, voicing picker and chord library ([#169](https://github.com/liftedkilt/fretbook/issues/169)) ([8711698](https://github.com/liftedkilt/fretbook/commit/8711698e182020254176e2c5a384e0ac0a91fdde))
* ear training and fretboard note trainer games ([#198](https://github.com/liftedkilt/fretbook/issues/198)) ([87c283d](https://github.com/liftedkilt/fretbook/commit/87c283da99a1c8c6537e988a71f827cc612421db))
* estimate bar marks from the audio (auto-sync) ([#201](https://github.com/liftedkilt/fretbook/issues/201)) ([09ac111](https://github.com/liftedkilt/fretbook/commit/09ac111dae6a6a8ffc14c8b8073b8f3e0ecadd47))
* estimate difficulty for chord sheets from their chords ([e62b63e](https://github.com/liftedkilt/fretbook/commit/e62b63e6067f5c702d5c7bae799794edbc84030a))
* estimate song difficulty and recommend what to practise next ([#199](https://github.com/liftedkilt/fretbook/issues/199)) ([433c515](https://github.com/liftedkilt/fretbook/commit/433c5155fa8374d86f3356910653fae825f99e0c))
* exercise generator for scales, arpeggios, chord changes and technique drills ([#193](https://github.com/liftedkilt/fretbook/issues/193)) ([089de21](https://github.com/liftedkilt/fretbook/commit/089de21d3e645c201f2da6b59aca25a7c8251b20))
* **import:** bulk import many files or a zip with duplicate detection ([a724920](https://github.com/liftedkilt/fretbook/commit/a72492012fc4723c235b6631c8c50830a818d43a))
* **import:** import chords and tabs from Ultimate Guitar links ([bac403b](https://github.com/liftedkilt/fretbook/commit/bac403bb229457a16633730f97ab4e6508f38f77)), closes [#50](https://github.com/liftedkilt/fretbook/issues/50)
* include trainer games in the library backup and restore ([616681e](https://github.com/liftedkilt/fretbook/commit/616681e61f10db913c23cc3537f75ac59169f475)), closes [#196](https://github.com/liftedkilt/fretbook/issues/196)
* **ingest:** watched inbox folder imports files dropped on the server ([#175](https://github.com/liftedkilt/fretbook/issues/175)) ([5172b9a](https://github.com/liftedkilt/fretbook/commit/5172b9a9e2b365608cafdd6e7de066aa363ed32e)), closes [#49](https://github.com/liftedkilt/fretbook/issues/49)
* installable web app with offline use ([#192](https://github.com/liftedkilt/fretbook/issues/192)) ([bde49ed](https://github.com/liftedkilt/fretbook/commit/bde49edbc039a4dbd1403909085ac26d5205e15e))
* **jobs:** separate worker process that claims job kinds from the shared queue ([aacb8d9](https://github.com/liftedkilt/fretbook/commit/aacb8d9c352aecfee53300b908e10e6763266bc1))
* **library:** tags, favourites and smart filters ([#138](https://github.com/liftedkilt/fretbook/issues/138)) ([8370e03](https://github.com/liftedkilt/fretbook/commit/8370e03db9ad8788b46b9687df363382a037f466))
* listen panel with input device and channel pickers and a level meter ([fa43f48](https://github.com/liftedkilt/fretbook/commit/fa43f48fba7ab0082d3ee211e0ad2b5a4186482a))
* **listen:** chords in wait mode ([#166](https://github.com/liftedkilt/fretbook/issues/166)) ([bda61e3](https://github.com/liftedkilt/fretbook/commit/bda61e33a47cebacb51ef3bb0be9763d29d9c7e2))
* **listen:** match played notes against the score for wait mode ([cf6d1d4](https://github.com/liftedkilt/fretbook/commit/cf6d1d41bb4fb438ee624ed3b26ef20b3c5e99df))
* **listen:** scored play-along with hit/early/late/miss grading and a results screen ([#174](https://github.com/liftedkilt/fretbook/issues/174)) ([1262337](https://github.com/liftedkilt/fretbook/commit/12623376f7656a07b78437a2f53ecfa43398fd76))
* log chord-sheet practice and cap idle wait-mode time ([86464e0](https://github.com/liftedkilt/fretbook/commit/86464e0d3a88e7a4d12fd836ed18500bf81eba8e))
* merge offline tab edits with newer server revisions ([8483d10](https://github.com/liftedkilt/fretbook/commit/8483d10ee328e875a6bc7491fcb05bc6d6aa8683))
* MIDI import and export with automatic fret assignment ([#177](https://github.com/liftedkilt/fretbook/issues/177)) ([682fac2](https://github.com/liftedkilt/fretbook/commit/682fac288ef4b6d65b24ca6d4c08d64ac1c2bef5))
* personal API tokens and fretbook-cli for scripted imports ([#158](https://github.com/liftedkilt/fretbook/issues/158)) ([ef5532e](https://github.com/liftedkilt/fretbook/commit/ef5532ea413348318b2bf66a33d96d79b61d275a))
* **player:** add Yousician-style scrolling note highway view ([8ccd7cb](https://github.com/liftedkilt/fretbook/commit/8ccd7cb12b6c3e0c106bf2c3628915ac08db6aab))
* **player:** fretboard view that follows playback ([cc7d76b](https://github.com/liftedkilt/fretbook/commit/cc7d76b2e36cce132e8c0914bad0326fe47a54dd)), closes [#60](https://github.com/liftedkilt/fretbook/issues/60)
* **practice:** practice log, stats dashboard, streaks and goals ([#168](https://github.com/liftedkilt/fretbook/issues/168)) ([eee5c23](https://github.com/liftedkilt/fretbook/commit/eee5c23c473e3a629cf80f2d25d31063b0cf1082))
* **practice:** speed trainer and saved practice loops ([86295d1](https://github.com/liftedkilt/fretbook/commit/86295d1c4572a46b1ecfaf33f54e59f3e415c6f6))
* queue sync marks, tags, favourites and practice sessions while offline ([#213](https://github.com/liftedkilt/fretbook/issues/213)) ([0e6cdf8](https://github.com/liftedkilt/fretbook/commit/0e6cdf887219c7bdd33d71445e53a6501912d478))
* rhythm trainer with timing feedback ([#194](https://github.com/liftedkilt/fretbook/issues/194)) ([c9e4d6c](https://github.com/liftedkilt/fretbook/commit/c9e4d6c927f12fa5f5202b9f4b34ba845cd740ed))
* setlists with ordered play-through ([2d93a7b](https://github.com/liftedkilt/fretbook/commit/2d93a7b0b4cfcd36680856297f56bc04a97750a5))
* smoother tuner readout, headstock layout and in-tune confirmation ([0aedd5d](https://github.com/liftedkilt/fretbook/commit/0aedd5d5169ca06e0f9ec4d0a0495228f7085d3b))
* stem separation with a per-stem mixer in the player ([eb74e1e](https://github.com/liftedkilt/fretbook/commit/eb74e1e48f992ce316e011cd9431335a6ce0bd3d))
* **tools:** foundation for standalone tuner and metronome ([5412777](https://github.com/liftedkilt/fretbook/commit/5412777e3e6c6ad831d59d40678974512cea2ccd))
* **tools:** standalone tuner and metronome with navigation ([2eef638](https://github.com/liftedkilt/fretbook/commit/2eef638ce2c04f260ba4bf9e7ba617971beb5f82))
* transpose, retune and convert tabs, and suggest capos for chord sheets ([#187](https://github.com/liftedkilt/fretbook/issues/187)) ([ca3175b](https://github.com/liftedkilt/fretbook/commit/ca3175b5c3011b37ed22f1019a9f7ce5e17c46ed))
* tuner for the song's tuning ([bdd461b](https://github.com/liftedkilt/fretbook/commit/bdd461bdb8eef54457f47f19a8fb6e873c1077f5))
* use the listen panel in wait mode and the trainers ([66196cc](https://github.com/liftedkilt/fretbook/commit/66196ccde444fc43a026e8654928a1a31697646d))
* wait mode, the cursor waits until you play the right note ([42ae4ea](https://github.com/liftedkilt/fretbook/commit/42ae4ea452c17120b3844acb6ebc98935af4c19d)), closes [#68](https://github.com/liftedkilt/fretbook/issues/68)


### Bug Fixes

* **docker:** refresh cached apt layer daily so security fixes land ([5d95466](https://github.com/liftedkilt/fretbook/commit/5d9546664abc96f57d0b03637477a67eb997891e))
* keep phone and tablet layouts inside the viewport ([e69701d](https://github.com/liftedkilt/fretbook/commit/e69701dfa15bd39c5297e7c7c45762c3b8d1c70c))
* keep the listen panel change inside web/ for the ui-only check ([a228cdc](https://github.com/liftedkilt/fretbook/commit/a228cdce50b0324df8a916e486db8bc91f66f4d3))
* keep the setlist play bar on screen while the score scrolls ([c075648](https://github.com/liftedkilt/fretbook/commit/c07564877d7c3ab60143ac5237dec37c5831d6ac))
* put Add to setlist in the song page menu so the hero actions don't overlap ([589098f](https://github.com/liftedkilt/fretbook/commit/589098fc9ec3b185e039eecd0132f416e51dc3b0))

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
