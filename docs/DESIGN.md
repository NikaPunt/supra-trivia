# Design

Four looks, chosen from the **Look** dropdown in the page footer (and in the host header). The choice is remembered on that device only, so the projector, each phone and the host can all use a different one.

| Look | Character |
|---|---|
| **Pirosmani** (default) | Black oilcloth, ochre and midnight blue, painted signboards, the night scene. Follows the device's light setting with a cream tablecloth version |
| **Supper club** | Your 0.1 look refined: warm black, cream and gold, a quiet serif, hairline rules |
| **Paper and ink** | A printed quiz sheet: warm paper, black ink, heavy rules, one vermilion, a stamped answer type |
| **Game show** | Saturated cobalt, a bright white board, chunky type, rounded shapes |

## The question screen
An open page, no frame: a header line (`Round 1: Hodgepodge · 1/6`), the question as written, and below it a note card about the secret theme. The room code and the player's name sit at the bottom. The same layout is used in all four looks.

## Screen sizes
Checked on every page, in every look, from a 360px phone through tablets and laptops to 1080p and 4K TVs (overflow, tap-target size, text size). The projector view scales with the screen. Tables become stacked rows on phones.

## Adding a look
Every look sets the same semantic tokens (`--ground`, `--panel`, `--accent`, `--board`, fonts, radius and so on) in one `html[data-design="name"]` block at the end of `public/styles.css`. Add the block, then add the name to `DESIGNS` in `public/js/common.js` and to the pattern in `public/js/theme.js`. A test keeps the stylesheet's braces balanced.

---

## Pirosmani: after Niko Pirosmani

The look takes its cue from the paintings of Niko Pirosmani (ნიკო ფიროსმანი, 1862-1918), the Georgian primitivist who painted shop signs and feast scenes, often on black oilcloth.

| Idea in the paintings | Where it shows up |
|---|---|
| Black oilcloth ground | The base colour (`--ground`), not a "dark mode" afterthought |
| Flat fields of colour: ochre, olive, midnight blue, vermilion, cream | The palette tokens at the top of `public/styles.css`; primary buttons are ochre, danger is vermilion, success is olive |
| The night sky, banded clouds, black birds, the vine pergola and feast table, the man in the red shirt and straw hat | `scene()` in `public/js/common.js`, an original flat SVG shown on the join, lobby and final screens |
| Painted signboards | The question is a midnight-blue "board" with a painted ochre border and a hairline inside it; the room code is a small sign |
| The cream tablecloth | The light theme, used automatically when the device is set to light |
| Hand-lettered type | Fraunces (soft, slightly wonky axes) for display, Alegreya Sans for text, Noto Georgian faces for Georgian script |

## Georgian touches (Pirosmani look only)
- "ვიქტორინა" (viktorina, quiz) beside the wordmark.
- "გაუმარჯოს!" (gaumarjos, the toast cry) on the final screens.
- The join page credits the painter: ნიკო ფიროსმანი.
The other three looks show none of this.

## Fonts
All self-hosted from `public/fonts/` (nothing loads from a third party), all SIL Open Font License 1.1: Fraunces, Alegreya Sans, Noto Georgian, and Bricolage Grotesque (Game show). Licence texts are in that folder.

## Changing it
- Colours: the `:root` block at the top of `public/styles.css` (and the light-mode override just below it).
- The scene: the `SCENE` string in `public/js/common.js`. It uses fixed colours on purpose, like a framed painting.
- The painting itself is not reproduced; the scene is original artwork in a similar palette and manner.
