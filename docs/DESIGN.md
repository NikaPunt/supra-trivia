# Design: after Niko Pirosmani

The look takes its cue from the paintings of Niko Pirosmani (ნიკო ფიროსმანი, 1862-1918), the Georgian primitivist who painted shop signs and feast scenes, often on black oilcloth.

| Idea in the paintings | Where it shows up |
|---|---|
| Black oilcloth ground | The base colour (`--ground`), not a "dark mode" afterthought |
| Flat fields of colour: ochre, olive, midnight blue, vermilion, cream | The palette tokens at the top of `public/styles.css`; primary buttons are ochre, danger is vermilion, success is olive |
| The night sky, banded clouds, black birds, the vine pergola and feast table, the man in the red shirt and straw hat | `scene()` in `public/js/common.js`, an original flat SVG shown on the join, lobby and final screens |
| Painted signboards | The question is a midnight-blue "board" with a painted ochre border and a hairline inside it; the room code is a small sign |
| The cream tablecloth | The light theme, used automatically when the device is set to light |
| Hand-lettered type | Fraunces (soft, slightly wonky axes) for display, Alegreya Sans for text, Noto Georgian faces for Georgian script |

## Georgian touches
- "ვიქტორინა" (viktorina, quiz) beside the wordmark.
- "გაუმარჯოს!" (gaumarjos, the toast cry) on the final screens, and as the winner's cheer.
- The join page credits the painter: ნიკო ფიროსმანი.

## Fonts
All self-hosted from `public/fonts/` (nothing loads from a third party), all SIL Open Font License 1.1. Licence texts are in that folder.

## Changing it
- Colours: the `:root` block at the top of `public/styles.css` (and the light-mode override just below it).
- The scene: the `SCENE` string in `public/js/common.js`. It uses fixed colours on purpose, like a framed painting.
- The painting itself is not reproduced; the scene is original artwork in a similar palette and manner.
