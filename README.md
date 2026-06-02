# VIC Flashcards

A GitHub-hosted vehicle-identification flashcard app. Vanilla HTML/CSS/JS — no build step, no framework, no CDN.

## How it works

- **The repo is the source of truth.** Vehicle images live in the `images_*` folders, committed as real `.png` files.
- **`cards.json`** is a committed manifest the app reads over HTTPS. A GitHub Action regenerates it on every push by scanning the image folders (merging, never wiping your edits).
- **The app writes back to the repo** via the GitHub REST API. You supply a fine-grained Personal Access Token (PAT) at runtime; it is cached only in your browser's `localStorage` and is **never** committed.

## Decks

| Folder         | Deck   |
| -------------- | ------ |
| `images_NATO`   | NATO   |
| `images_china`  | China  |
| `images_russia` | Russia |

Each image is named `<VehicleName>.png` — the filename (minus extension) is the card's answer.

## Adding cards

Just commit a new `.png` into the right `images_*` folder. The Action rebuilds `cards.json` automatically. Or add one in-app (it commits the image + manifest for you).

## Security

The PAT stays client-side. There is a **Forget token** button in the app. Never paste a token into any file in this repo.
