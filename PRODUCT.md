# filmscraper

## Product purpose

Find every movie screening near a ZIP code over a chosen date window, and surface the ones that are easy to miss: rare formats like 70MM and IMAX 70MM, films down to their last few theaters, and one-night repertory or special-event screenings. Output is a markdown table meant to be pasted into a post.

## Register

product

## Users

One person: Reese, in San Antonio. Technical, runs the CLI directly, and uses the web view when he wants to adjust a date window and eyeball the result before publishing. Not a general audience, not multi-tenant, no accounts.

## Usage scene

At a desk, deliberately, a few times a week. He is composing something for publication, not monitoring a system. The screen holds a table he reads carefully and then copies. Sessions are short and end in a paste.

## Tone

Plain and factual. The interface says what it found and gets out of the way. No persuasion, no encouragement, no personality in the chrome. The movie titles are the only interesting words on screen and nothing should compete with them.

## Strategic principles

- **The table is the product.** Every pixel of chrome is overhead. Controls should read as a single line of settings, not a form to fill out.
- **Notes carry the value.** A blank Notes cell is a correct and common answer; scarcity and rare formats are what the eye should catch.
- **Say when the data is partial.** An evening run misses showtimes that already started. Silence would read as "nothing playing."
- **Markdown is the deliverable.** Rendering is for reading; copying is the actual exit.

## Anti-references

- Cinema-themed dark UI with amber accents, film-reel motifs, ticket-stub borders. The category reflex.
- Dashboard framing: stat tiles, counters, "29 movies found!" hero numbers.
- Anything flashy. Explicitly requested: very minimal, barely styled, not flashy.
- Cards, toasts, eyebrow labels, modals.
