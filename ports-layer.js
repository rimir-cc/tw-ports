/*\
title: $:/plugins/rimir/ports/ports-layer.js
type: application/javascript
module-type: widget

<$ports-layer> — the one page-level overlay of rimir/ports. Rendered once from
the PageTemplate; its children are the wikitext flyout and dock.

It owns everything that needs the pointer:

* hovering a `.ports-handle` opens the port flyout (state FLYOUT), leaving
  handle and flyout closes it after CLOSE_DELAY; a click pins it
* pressing a `[data-ports-field]` row and moving past DRAG_THRESHOLD starts a
  drag (state DRAG): a wire follows the pointer, valid targets in the story and
  the dock (which opens itself) are highlighted, typing filters the dock, Esc
  cancels, releasing on a target writes the ref field
* pressing a filled row without moving toggles its target list
* the icon of a ref field in kind's field bar (`[data-kind-ref=yes]`, carrying
  `data-kind-src` / `data-kind-field`) is a drag source too: moving past
  DRAG_THRESHOLD drags from that field exactly like from its flyout row; a
  plain click still opens kind's field popup, the click after a drag is eaten
* on a multi-value field, Shift picks several targets in one drag: a Shift
  tap toggles the target under the pointer, holding Shift sweeps (every valid
  target the pointer moves onto is picked), a letter typed during the hold
  makes it typing and undoes the hold's picks. Picks get pinned wires (team
  members dashed); releasing links picks + the target under the pointer, also
  over empty space
* hovering a filled row draws wires to its targets that are on screen

The ref field write is one plain field write per drop (see connect.js); kind's
inverse sync mirrors it.

\*/

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;
var schema = require("$:/plugins/rimir/kind/schema.js");
var connect = require("$:/plugins/rimir/ports/connect.js");

var FLYOUT = "$:/temp/rimir/ports/flyout",
	DRAG = "$:/temp/rimir/ports/drag",
	RECENT_PREFIX = "$:/state/rimir/ports/recent/",
	NOTIFICATION = "$:/plugins/rimir/ports/notification",
	SVG_NS = "http://www.w3.org/2000/svg",
	DRAG_THRESHOLD = 5,
	CLOSE_DELAY = 300,
	RECENT_MAX = 5;

// Drop target kinds (dock tile, story tiddler, plus whatever bridges add): tiddlers
// with a CSS `selector` and the `title-attribute` that holds the tiddler title
var TARGET_TAG = "$:/tags/rimir/ports/target";

var PortsLayerWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

PortsLayerWidget.prototype = Object.create(Widget.prototype);

PortsLayerWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	var domNode = this.document.createElement("div");
	domNode.className = "ports-layer";
	this.domNode = domNode;
	parent.insertBefore(domNode, nextSibling);
	this.renderChildren(domNode, null);
	this.domNodes.push(domNode);
	if($tw.browser && this.document.addEventListener) {
		this.svg = this.document.createElementNS(SVG_NS, "svg");
		this.svg.setAttribute("class", "ports-wires");
		this.svg.setAttribute("aria-hidden", "true");
		domNode.appendChild(this.svg);
		this.bind();
		// A flyout left over from before a reload has no handle to sit at
		this.wiki.deleteTiddler(FLYOUT);
		this.wiki.deleteTiddler(DRAG);
	}
};

PortsLayerWidget.prototype.bind = function() {
	var self = this,
		doc = this.document;
	this.listeners = [
		[doc, "pointerover", function(e) { self.onPointerOver(e); }],
		[doc, "pointerout", function(e) { self.onPointerOut(e); }],
		[doc, "click", function(e) { self.onClick(e); }],
		[doc, "click", function(e) { self.eatClickAfterDrag(e); }, true],
		[doc, "pointerdown", function(e) { self.onPointerDown(e); }],
		[doc, "pointermove", function(e) { self.onPointerMove(e); }],
		[doc, "pointerup", function(e) { self.onPointerUp(e); }],
		[doc, "pointercancel", function() { self.endDrag(false); }],
		[doc, "keydown", function(e) { self.onKeyDown(e); }, true],
		[doc, "keyup", function(e) { self.onKeyUp(e); }, true],
		[doc.defaultView, "scroll", function() { self.relayout(); }, true],
		[doc.defaultView, "resize", function() { self.relayout(); }]
	];
	this.listeners.forEach(function(l) {
		l[0].addEventListener(l[1], l[2], {capture: !!l[3], passive: l[1] === "scroll"});
	});
};

PortsLayerWidget.prototype.destroy = function(options) {
	(this.listeners || []).forEach(function(l) {
		l[0].removeEventListener(l[1], l[2], {capture: !!l[3]});
	});
	this.listeners = [];
	this.disarm();
	Widget.prototype.destroy.call(this, options);
};

PortsLayerWidget.prototype.refresh = function(changedTiddlers) {
	var changed = this.refreshChildren(changedTiddlers);
	// Content changes can move handles and targets; keep flyout and wires in place
	this.relayout();
	return changed;
};

// ---------- state helpers ----------

PortsLayerWidget.prototype.targetSpecs = function() {
	var wiki = this.wiki;
	return wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + TARGET_TAG + "]!is[draft]]").map(function(title) {
		var fields = wiki.getTiddler(title).fields;
		return {selector: fields.selector, attribute: fields["title-attribute"]};
	}).filter(function(spec) { return spec.selector && spec.attribute; });
};

PortsLayerWidget.prototype.targetSelector = function() {
	return this.targetSpecs().map(function(spec) { return spec.selector; }).join(", ");
};

// The tiddler an element stands for, or null
PortsLayerWidget.prototype.titleOf = function(el) {
	var spec = this.targetSpecs().filter(function(s) { return el.matches(s.selector); })[0];
	return spec ? el.getAttribute(spec.attribute) : null;
};

// The innermost drop target element at or around `el`
PortsLayerWidget.prototype.targetAround = function(el) {
	var selector = this.targetSelector();
	return selector && el && el.closest ? el.closest(selector) : null;
};

PortsLayerWidget.prototype.flyoutState = function() {
	var tiddler = this.wiki.getTiddler(FLYOUT);
	return tiddler ? tiddler.fields : null;
};

PortsLayerWidget.prototype.defOf = function(src, key) {
	var tiddler = this.wiki.getTiddler(src);
	return tiddler ? schema.fieldDef(this.wiki, tiddler.fields["kind.type"], key) : null;
};

PortsLayerWidget.prototype.notify = function(message) {
	$tw.notifier.display(NOTIFICATION, {variables: {"ports-message": message}});
};

// ---------- flyout ----------

PortsLayerWidget.prototype.openFlyout = function(handle, pinned) {
	var src = handle.getAttribute("data-ports-src"),
		exclude = handle.getAttribute("data-ports-exclude") || "",
		state = this.flyoutState();
	if(this.anchor && this.anchor !== handle) {
		this.anchor.classList.remove("is-open");
	}
	this.anchor = handle;
	this.pinned = !!pinned || (this.pinned && state && state.src === src);
	handle.classList.add("is-open");
	if(!state || state.src !== src || (state.exclude || "") !== exclude) {
		this.wiki.addTiddler({title: FLYOUT, src: src, exclude: exclude, expanded: "", "show-empty": ""});
	}
};

PortsLayerWidget.prototype.closeFlyout = function() {
	if(this.drag) {
		return;
	}
	this.disarm();
	if(this.anchor) {
		this.anchor.classList.remove("is-open");
	}
	this.anchor = null;
	this.pinned = false;
	this.peek = null;
	if(this.wiki.tiddlerExists(FLYOUT)) {
		this.wiki.deleteTiddler(FLYOUT);
	}
	this.drawWires();
};

PortsLayerWidget.prototype.armClose = function() {
	var self = this;
	if(this.drag || this.pinned || this.closeTimer) {
		return;
	}
	this.closeTimer = setTimeout(function() {
		self.closeTimer = null;
		self.closeFlyout();
	}, CLOSE_DELAY);
};

PortsLayerWidget.prototype.disarm = function() {
	clearTimeout(this.closeTimer);
	this.closeTimer = null;
};

PortsLayerWidget.prototype.flyoutNode = function() {
	return this.domNode.querySelector(".ports-flyout");
};

// The handle element may have been re-rendered since it was hovered
PortsLayerWidget.prototype.currentAnchor = function() {
	var state = this.flyoutState();
	if(!state) {
		return null;
	}
	if(this.anchor && this.document.body.contains(this.anchor)) {
		return this.anchor;
	}
	var self = this,
		found = Array.prototype.filter.call(this.document.querySelectorAll(".ports-handle"), function(el) {
			return el.getAttribute("data-ports-src") === state.src && isOnScreen(el);
		})[0] || null;
	this.anchor = found;
	if(found) {
		found.classList.add("is-open");
	}
	return found;
};

PortsLayerWidget.prototype.positionFlyout = function() {
	var fly = this.flyoutNode();
	if(!fly) {
		return;
	}
	var anchor = this.currentAnchor();
	if(!anchor) {
		this.closeFlyout();
		return;
	}
	var win = this.document.defaultView,
		r = anchor.getBoundingClientRect(),
		dock = this.domNode.querySelector(".ports-dock"),
		room = win.innerWidth - (dock ? dock.offsetWidth : 0) - 10,
		width = fly.offsetWidth,
		height = fly.offsetHeight,
		left = r.right + 12,
		top = r.top + r.height / 2 - 34;
	var onLeft = left + width > room;
	if(onLeft) {
		left = r.left - 12 - width;
	}
	left = Math.max(8, left);
	top = Math.min(Math.max(8, top), win.innerHeight - height - 8);
	fly.style.left = left + "px";
	fly.style.top = top + "px";
	fly.classList.toggle("ports-flyout--left", onLeft);
};

PortsLayerWidget.prototype.toggleExpanded = function(key) {
	var state = this.flyoutState();
	if(!state) {
		return;
	}
	var list = $tw.utils.parseStringArray(state.expanded || ""),
		i = list.indexOf(key);
	if(i === -1) {
		list.push(key);
	} else {
		list.splice(i, 1);
	}
	this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getTiddler(FLYOUT), {expanded: $tw.utils.stringifyList(list)}));
};

// ---------- pointer events ----------

PortsLayerWidget.prototype.onPointerOver = function(e) {
	if(this.drag || !e.target.closest) {
		return;
	}
	var handle = e.target.closest(".ports-handle");
	if(handle && e.pointerType === "mouse") {
		this.disarm();
		this.openFlyout(handle, false);
		return;
	}
	if(e.target.closest(".ports-flyout")) {
		this.disarm();
		var row = e.target.closest("[data-ports-field]"),
			key = row && row.classList.contains("is-filled") ? row.getAttribute("data-ports-field") : null;
		if(key !== this.peek) {
			this.peek = key;
			this.drawWires();
		}
	} else if(this.flyoutState()) {
		// Also covers leaving an element that was re-rendered under the pointer
		// (e.g. after unlinking), which gets no pointerout
		this.armClose();
	}
};

PortsLayerWidget.prototype.onPointerOut = function(e) {
	if(this.drag || !e.target.closest) {
		return;
	}
	var zone = ".ports-handle, .ports-flyout",
		from = e.target.closest(zone),
		to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(zone) : null;
	if(from && !to) {
		if(this.peek) {
			this.peek = null;
			this.drawWires();
		}
		this.armClose();
	}
};

PortsLayerWidget.prototype.onClick = function(e) {
	if(!e.target.closest) {
		return;
	}
	var handle = e.target.closest(".ports-handle");
	if(handle) {
		var state = this.flyoutState();
		if(state && this.pinned && state.src === handle.getAttribute("data-ports-src")) {
			this.pinned = false;
			this.closeFlyout();
		} else {
			this.openFlyout(handle, true);
		}
		return;
	}
	if(this.pinned && !e.target.closest(".ports-flyout")) {
		this.pinned = false;
		this.closeFlyout();
	}
};

// A press that can become a drag: a flyout row (source = the flyout's instance)
// or a ref field icon in kind's field bar (source named on the icon)
PortsLayerWidget.prototype.pressSource = function(target) {
	if(!target.closest) {
		return null;
	}
	var row = target.closest(".ports-flyout [data-ports-field]");
	if(row) {
		var state = this.flyoutState();
		return state ? {el: row, src: state.src, key: row.getAttribute("data-ports-field"), row: true} : null;
	}
	var icon = target.closest(".kind-field-bar [data-kind-ref='yes']");
	return icon ? {el: icon, src: icon.getAttribute("data-kind-src"), key: icon.getAttribute("data-kind-field"), row: false} : null;
};

PortsLayerWidget.prototype.onPointerDown = function(e) {
	this.eatClick = false;
	var source = e.button > 0 ? null : this.pressSource(e.target);
	if(!source) {
		return;
	}
	this.press = {source: source, x: e.clientX, y: e.clientY, id: e.pointerId};
	// A field bar icon sits in kind's popup button: leave the press alone so a
	// plain click still opens the field popup; capture only once a drag starts
	if(source.row) {
		if(source.el.setPointerCapture) {
			source.el.setPointerCapture(e.pointerId);
		}
		e.preventDefault();
	}
};

PortsLayerWidget.prototype.onPointerMove = function(e) {
	if(!this.press || e.pointerId !== this.press.id) {
		return;
	}
	if(!this.drag && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > DRAG_THRESHOLD) {
		this.startDrag(this.press.source, e);
	}
	if(this.drag) {
		// Shift held from before the drag, or a keyup lost to another window
		if(e.shiftKey !== !!this.drag.hold) {
			if(e.shiftKey) {
				this.startHold();
			} else {
				this.endHold();
			}
		}
		this.moveDrag(e.clientX, e.clientY);
	}
};

PortsLayerWidget.prototype.onPointerUp = function(e) {
	if(!this.press || e.pointerId !== this.press.id) {
		return;
	}
	var press = this.press;
	this.press = null;
	if(this.drag) {
		this.moveDrag(e.clientX, e.clientY);
		this.endDrag(true);
	} else if(press.source.row && press.source.el.classList.contains("is-filled")) {
		this.toggleExpanded(press.source.key);
	}
};

// The click that follows a drag from a field bar icon would open kind's popup
PortsLayerWidget.prototype.eatClickAfterDrag = function(e) {
	if(this.eatClick) {
		this.eatClick = false;
		e.preventDefault();
		e.stopPropagation();
	}
};

PortsLayerWidget.prototype.onKeyDown = function(e) {
	if(!this.drag) {
		if(e.key === "Escape" && this.flyoutState()) {
			this.pinned = false;
			this.closeFlyout();
		}
		return;
	}
	if(e.key === "Shift") {
		if(!e.repeat) {
			this.startHold();
		}
		return;
	}
	var search = this.drag.search;
	if(e.key === "Escape") {
		this.press = null;
		this.endDrag(false);
	} else if(e.key === "Backspace") {
		search = search.slice(0, -1);
	} else if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
		this.holdTyped();
		search += e.key;
	} else {
		return;
	}
	e.preventDefault();
	e.stopPropagation();
	if(this.drag && search !== this.drag.search) {
		this.drag.search = search;
		this.updateDrag({search: search});
	}
};

PortsLayerWidget.prototype.onKeyUp = function(e) {
	if(this.drag && e.key === "Shift") {
		this.endHold();
	}
};

// ---------- drag ----------

PortsLayerWidget.prototype.startDrag = function(source, e) {
	var def = source.src && source.key && this.defOf(source.src, source.key);
	if(!def || def.typed !== "ref") {
		this.press = null;
		return;
	}
	var row = source.el;
	if(!source.row) {
		// From here on the drag owns the pointer: no text selection, and the
		// click that ends it must not reach kind's popup button
		if(row.setPointerCapture) {
			row.setPointerCapture(e.pointerId);
		}
		var selection = this.document.defaultView.getSelection && this.document.defaultView.getSelection();
		if(selection) {
			selection.removeAllRanges();
		}
		this.eatClick = true;
	}
	this.drag = {src: source.src, key: source.key, def: def, row: row, pos: {x: e.clientX, y: e.clientY}, hit: null, search: "",
		picked: [], plan: null, hold: null};
	this.peek = null;
	row.classList.add("is-source");
	this.document.body.classList.add("ports-dragging");
	this.wiki.addTiddler({title: DRAG, src: source.src, field: source.key, search: ""});
	var self = this;
	var selector = this.targetSelector();
	Array.prototype.forEach.call(selector ? this.document.querySelectorAll(selector) : [], function(el) {
		if(self.isValid(self.titleOf(el))) {
			el.classList.add("ports-valid");
		}
	});
	this.drawWires();
};

PortsLayerWidget.prototype.isValid = function(title) {
	return !!title && title !== this.drag.src &&
		(schema.accepts(this.wiki, this.drag.def, title) || !!schema.groupMembers(this.wiki, this.drag.def, title));
};

PortsLayerWidget.prototype.hitTest = function(x, y) {
	var target = this.targetAround(this.document.elementFromPoint(x, y));
	return target && this.isValid(this.titleOf(target)) ? target : null;
};

PortsLayerWidget.prototype.moveDrag = function(x, y) {
	var self = this;
	this.drag.pos = {x: x, y: y};
	var hit = this.hitTest(x, y);
	if(hit !== this.drag.hit) {
		if(this.drag.hit) {
			this.drag.hit.classList.remove("ports-hover");
		}
		if(hit) {
			hit.classList.add("ports-hover");
		}
		this.drag.hit = hit;
		this.sweep(hit);
	}
	if(!this.frame) {
		this.frame = requestAnimationFrame(function() {
			self.frame = null;
			self.drawWires();
		});
	}
};

PortsLayerWidget.prototype.endDrag = function(commit) {
	var drag = this.drag;
	if(!drag) {
		return;
	}
	this.drag = null;
	this.document.body.classList.remove("ports-dragging", "ports-collecting");
	Array.prototype.forEach.call(this.document.querySelectorAll(".ports-valid, .ports-hover"), function(el) {
		el.classList.remove("ports-valid", "ports-hover");
	});
	drag.row.classList.remove("is-source");
	this.wiki.deleteTiddler(DRAG);
	var targets = drag.picked.slice(0),
		hit = drag.hit && this.titleOf(drag.hit);
	if(hit && targets.indexOf(hit) === -1) {
		targets.push(hit);
	}
	if(commit && targets.length) {
		this.connect(drag.src, drag.def, targets);
	}
	this.drawWires();
	this.armClose();
};

PortsLayerWidget.prototype.updateDrag = function(fields) {
	this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getTiddler(DRAG), fields));
};

// One write for all targets of a drop (see connect.js)
PortsLayerWidget.prototype.connect = function(src, def, targets) {
	var self = this,
		tiddler = this.wiki.getTiddler(src),
		plan = connect.plan(this.wiki, tiddler, def, targets);
	if(plan.value !== null) {
		var update = {};
		update[def.key] = plan.value;
		this.wiki.addTiddler(new $tw.Tiddler(tiddler, update, this.wiki.getModificationFields()));
		targets.forEach(function(target) { self.remember(def.key, target); });
	}
	this.notify(connect.message(this.wiki, def, src, plan));
};

// ---------- picking ----------

// One Shift hold. `added` are the picks this hold made (undone if it turns into
// typing); `tap` is a target that was already picked under the pointer when
// Shift went down: releasing Shift without having swept unpicks it.

PortsLayerWidget.prototype.startHold = function() {
	if(!this.drag || this.drag.hold || this.drag.def.cardinality !== "multi") {
		return;
	}
	var title = this.drag.hit && this.titleOf(this.drag.hit);
	this.drag.hold = {added: [], typed: false, swept: false, tap: null};
	if(title && this.drag.picked.indexOf(title) !== -1) {
		this.drag.hold.tap = title;
	} else {
		this.pick(title);
	}
	this.document.body.classList.add("ports-collecting");
	this.drawWires();
};

PortsLayerWidget.prototype.sweep = function(hit) {
	var hold = this.drag.hold,
		title = hit && this.titleOf(hit);
	if(hold && !hold.typed && title && title !== hold.tap) {
		hold.swept = true;
		this.pick(title);
	}
};

PortsLayerWidget.prototype.pick = function(title) {
	if(title && this.drag.picked.indexOf(title) === -1) {
		this.drag.picked.push(title);
		this.drag.hold.added.push(title);
		this.syncPicked();
	}
};

// A letter typed while Shift is down is a capital for the search, not a pick
PortsLayerWidget.prototype.holdTyped = function() {
	var hold = this.drag.hold;
	if(!hold || hold.typed) {
		return;
	}
	hold.typed = true;
	if(hold.added.length) {
		this.drag.picked = this.drag.picked.filter(function(title) { return hold.added.indexOf(title) === -1; });
		hold.added = [];
		this.syncPicked();
	}
};

PortsLayerWidget.prototype.endHold = function() {
	var hold = this.drag && this.drag.hold;
	if(!hold) {
		return;
	}
	this.drag.hold = null;
	this.document.body.classList.remove("ports-collecting");
	if(hold.tap && !hold.swept && !hold.typed) {
		this.drag.picked.splice(this.drag.picked.indexOf(hold.tap), 1);
		this.syncPicked();
	}
	this.drawWires();
};

// The dock shows what the picks add; the wires need the members of picked groups
PortsLayerWidget.prototype.syncPicked = function() {
	var plan = connect.plan(this.wiki, this.wiki.getTiddler(this.drag.src), this.drag.def, this.drag.picked);
	this.drag.plan = this.drag.picked.length ? plan : null;
	this.updateDrag({
		picked: $tw.utils.stringifyList(this.drag.picked),
		"picked-links": String(plan.added.length),
		"picked-skipped": String(plan.skipped)
	});
	this.drawWires();
};

PortsLayerWidget.prototype.remember = function(key, target) {
	var title = RECENT_PREFIX + key,
		list = this.wiki.getTiddlerList(title).filter(function(t) { return t !== target; });
	list.unshift(target);
	this.wiki.addTiddler({title: title, list: list.slice(0, RECENT_MAX)});
};

// ---------- wires ----------

PortsLayerWidget.prototype.relayout = function() {
	var self = this;
	if(this.layoutFrame || !this.svg) {
		return;
	}
	this.layoutFrame = requestAnimationFrame(function() {
		self.layoutFrame = null;
		self.positionFlyout();
		self.drawWires();
	});
};

// Every visible element that stands for `title` (a story tiddler and a dock tile can both be there)
PortsLayerWidget.prototype.allOnScreen = function(title) {
	var self = this,
		selector = this.targetSelector();
	return Array.prototype.filter.call(selector ? this.document.querySelectorAll(selector) : [], function(el) {
		return self.titleOf(el) === title && isOnScreen(el);
	});
};

PortsLayerWidget.prototype.findOnScreen = function(title) {
	return this.allOnScreen(title)[0] || null;
};

// Marks every visible element of a pick and wires the dock tile, else the first one
PortsLayerWidget.prototype.pinWire = function(out, from, title, cls, wireCls, dot) {
	var els = this.allOnScreen(title);
	els.forEach(function(el) { el.classList.add(cls); });
	var el = els.filter(function(e) { return e.hasAttribute("data-ports-target"); })[0] || els[0];
	if(el) {
		out.push(wire(wireCls, from, anchorOf(el, from), dot));
	}
};

PortsLayerWidget.prototype.drawWires = function() {
	if(!this.svg) {
		return;
	}
	var self = this,
		out = [];
	Array.prototype.forEach.call(this.document.querySelectorAll(".ports-peek, .ports-picked, .ports-picked-member"), function(el) {
		el.classList.remove("ports-peek", "ports-picked", "ports-picked-member");
	});
	var fly = this.flyoutNode(),
		state = this.flyoutState();
	if(this.peek && !this.drag && fly && state) {
		var dot = fly.querySelector("[data-ports-field=\"" + cssEscape(this.peek) + "\"] .ports-dot"),
			def = this.defOf(state.src, this.peek);
		if(dot && def) {
			var a = centerOf(dot);
			schema.values(this.wiki.getTiddler(state.src), def).forEach(function(target) {
				var el = self.findOnScreen(target);
				if(el) {
					el.classList.add("ports-peek");
					var b = anchorOf(el, a);
					out.push(wire("ports-wire--peek", a, b, 3));
				}
			});
		}
	}
	if(this.drag && this.document.body.contains(this.drag.row)) {
		var from = centerOf(this.drag.row.querySelector(".ports-dot") || this.drag.row);
		this.refreshHit();
		// Pinned wires to the picks; a picked group also to its members it adds
		(this.drag.plan ? this.drag.plan.items : []).forEach(function(item) {
			self.pinWire(out, from, item.target, "ports-picked", "ports-wire--picked", 3.5);
			(item.members ? item.added : []).forEach(function(member) {
				self.pinWire(out, from, member, "ports-picked-member", "ports-wire--member", 2.5);
			});
		});
		var to = this.drag.hit ? anchorOf(this.drag.hit, from) : this.drag.pos;
		out.push(wire("ports-wire--drag" + (this.drag.hit ? " is-snapped" : ""), from, to, this.drag.hit ? 4 : 3));
	}
	this.svg.innerHTML = out.join("");
};

// The dock re-renders its tiles while typing: find the target under the pointer again
PortsLayerWidget.prototype.refreshHit = function() {
	var hit = this.drag.hit;
	if(hit && !this.document.body.contains(hit)) {
		hit = this.hitTest(this.drag.pos.x, this.drag.pos.y);
		if(hit) {
			hit.classList.add("ports-hover");
		}
		this.drag.hit = hit;
	}
};

// ---------- geometry ----------

// Inside the window, and for a dock tile inside the visible part of the dock list
function isOnScreen(el) {
	var r = el.getBoundingClientRect(),
		list = el.closest(".ports-dock-list"),
		box = list ? list.getBoundingClientRect() : {top: 0, bottom: el.ownerDocument.defaultView.innerHeight};
	return r.width > 0 && r.bottom > box.top && r.top < box.bottom;
}

function centerOf(el) {
	var r = el.getBoundingClientRect();
	return {x: r.left + r.width / 2, y: r.top + r.height / 2};
}

// Where a wire ends on a target: a dock tile on its left edge, a tiddler at
// its own handle (or its title row), on the side facing the wire's start
function anchorOf(el, from) {
	var r = el.getBoundingClientRect();
	if(el.hasAttribute("data-ports-target")) {
		return {x: r.left, y: r.top + r.height / 2};
	}
	var y = r.top + r.height / 2;
	if(el.classList.contains("tc-tiddler-frame")) {
		var handle = el.querySelector(".ports-handle--tiddler");
		y = handle ? centerOf(handle).y : r.top + Math.min(40, r.height / 2);
	}
	return {x: from.x > r.right - 20 ? r.right : r.left, y: y};
}

function wire(cls, a, b, dot) {
	var dx = Math.max(40, Math.abs(b.x - a.x) * 0.45),
		dir = b.x >= a.x ? 1 : -1,
		d = "M" + a.x + "," + a.y + " C" + (a.x + dx) + "," + a.y + " " + (b.x - dx * dir) + "," + b.y + " " + b.x + "," + b.y;
	return "<path class=\"ports-wire " + cls + "\" d=\"" + d + "\"/><circle class=\"ports-wire-end\" cx=\"" + b.x + "\" cy=\"" + b.y + "\" r=\"" + dot + "\"/>";
}

function cssEscape(s) {
	return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}

exports["ports-layer"] = PortsLayerWidget;
