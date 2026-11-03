# Ports

Link TiddlyWiki tiddlers the way node editors connect blocks: every `ref` field of a [kind](https://github.com/rimir-cc/tw-kind) instance becomes a *port*. Drag a wire from a port onto another tiddler, and the link is written into the field. The story river stays your workspace — no extra view.

## Features

- **One quiet handle per tiddler** — a dot on the tiddler's right border, visible only while you hover the tiddler. Filled when the tiddler has links, with the number of links next to it.
- **Port flyout** — hovering the handle slides out the ports as labelled rows (icon, caption, linked target or count). Filled ports come first; with more than four ports, the empty ones wait behind *+ N empty ports* and show which kinds they accept.
- **Drag to connect** — press a port and drag: a wire follows the pointer, tiddlers that fit the port are outlined, and the wire snaps onto the one under the pointer. Release to link. Single-value fields are replaced, multi-value fields get the target added.
- **Drag from the field bar** — the icon of a ref field in kind's field bar (tiddler view and stream rows) is a port too: drag it onto a tiddler or a dock tile to add a link to that field, exactly like dragging the port's flyout row. A plain click still opens kind's field popup.
- **Several targets in one drag** — on a multi-value port, **tap Shift** over a target to pick it (tap again to unpick), or **hold Shift and sweep** across tiles and tiddlers to pick every one the pointer moves onto. Keep dragging, type to filter, pick more; each pick gets its own wire, a picked team also dashed wires to the members it adds. The dock counts what the drop will do ("3 picked · 5 to link · 1 already linked"). Release links all picks at once, plus the target under the pointer — also over empty space. Esc cancels everything. Shift + a letter still types a capital into the search and picks nothing.
- **Groups** — on a multi port that takes persons but not teams, a team (a kind with `kind.group-of`) is a valid target too, in the story and in the dock ("team · 3 members"). Dropping it adds the team's members that are not linked yet; the team itself is not stored.
- **Context dock** — a slim strip on the right screen edge. While you drag, it opens by itself and lists what fits the port: recent targets first, then all candidates. Keep holding and type to filter; Esc cancels. It closes again on release. Click the strip to open it by hand and search all kind instances. Clicking a tile opens that instance in the story; a port dropped on a tile only links it.
- **Option sources** — config tiddlers that narrow the dock per port, kind or accepted type. Ships with one that hides archived instances.
- **Targets at a glance** — hovering a filled port draws wires to its targets on screen; clicking it lists them, each with × to unlink.
- **Both ends** — set `inverse` on the kind field and kind mirrors the link onto the target.

## Prerequisites

- [rimir/kind](https://github.com/rimir-cc/tw-kind) — schema (which fields are ports and what they accept) and `inverse` sync
- [rimir/theme](https://github.com/rimir-cc/tw-theme)
- Optional: [rimir/streams-ports](https://github.com/rimir-cc/tw-streams-ports) for ports on sq/streams rows

## Quick Start

1. Open a tiddler that has a `kind.type` whose kind defines `ref` fields.
2. Hover the tiddler, then the dot on its right border.
3. Drag a port onto another tiddler in the story, or into the dock that opens on the right.
4. Hover the port again to see the new wire; click it to list or unlink targets.
5. To link several at once, tap Shift over each target while dragging (or hold Shift and sweep), then release.

## License

MIT — see [LICENSE.md](LICENSE.md).
