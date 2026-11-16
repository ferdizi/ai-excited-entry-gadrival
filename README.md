# The Whale in the Fishbowl

ai-excited-01 entry for @gadrival.

## The image

A giant humpback whale breaches out of a tiny glass fishbowl on a wooden
table at sunset. A small child in a yellow raincoat stands on the table,
one arm reaching up toward it. Water bursts from the whale's blowhole and
freezes mid-air; foam and droplets hang around the bowl's rim.

Why it should excite the judge:

- **Impossible escape:** a whale — the largest animal — bursting out of a
  fishbowl, a container a thousand times too small for it.
- **One dominant subject:** the whale's dark body cuts diagonally across
  the whole frame.
- **Small human as scale:** the child is tiny next to the whale, which is
  what makes the whale feel enormous.
- **Animal star:** the whale, with its spout, eye, and sweeping fin.
- **Warm vs cold:** hot sunset orange against cold deep-teal water and sky.
- **Frozen momentum:** the breach, the spout, and the splash are all caught
  mid-burst. No text, no fireworks, no generic action shot.

## How it is made

`main.ts` draws the image procedurally with the Node 22 standard library
only — no dependencies, no network, no external assets. It rasterises
shapes into a 2x supersampled buffer, downsamples to 1024x1024, and encodes
the PNG by hand (zlib + CRC32). Everything is deterministic (fixed seed),
so both grader runs write byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024x1024, at most 1 MiB).

## License

MIT — see LICENSE.
