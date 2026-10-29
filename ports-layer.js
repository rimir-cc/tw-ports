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
* hovering a filled row draws wires to its targets that are on screen

The ref field write is a plain field write; kind's inverse sync mirrors it.

\*/

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;
var schema = require("$:/plugins/rimir/kind/schema.js");

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
		[doc, "pointerdown", function(e) { self.onPointerDown(e); }],
		[doc, "pointermove", function(e) { self.onPointerMove(e); }],
		[doc, "pointerup", function(e) { self.onPointerUp(e); }],
		[doc, "pointercancel", function() { self.endDrag(false); }],
		[doc, "keydown", function(e) { self.onKeyDown(e); }, true],
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

PortsLayerWidget.prototype.captionOf = function(title) {
	var tiddler = this.wiki.getTiddler(title);
	return (tiddler && tiddler.fields.caption) || title;
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

PortsLayerWidget.prototype.onPointerDown = function(e) {
	var row = e.target.closest && e.target.closest(".ports-flyout [data-ports-field]");
	if(!row || e.button > 0) {
		return;
	}
	this.press = {row: row, x: e.clientX, y: e.clientY, id: e.pointerId};
	if(row.setPointerCapture) {
		row.setPointerCapture(e.pointerId);
	}
	e.preventDefault();
};

PortsLayerWidget.prototype.onPointerMove = function(e) {
	if(!this.press || e.pointerId !== this.press.id) {
		return;
	}
	if(!this.drag && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > DRAG_THRESHOLD) {
		this.startDrag(this.press.row, e);
	}
	if(this.drag) {
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
	} else if(press.row.classList.contains("is-filled")) {
		this.toggleExpanded(press.row.getAttribute("data-ports-field"));
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
	var search = this.drag.search;
	if(e.key === "Escape") {
		this.press = null;
		this.endDrag(false);
	} else if(e.key === "Backspace") {
		search = search.slice(0, -1);
	} else if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
		search += e.key;
	} else {
		return;
	}
	e.preventDefault();
	e.stopPropagation();
	if(this.drag && search !== this.drag.search) {
		this.drag.search = search;
		this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getTiddler(DRAG), {search: search}));
	}
};

// ---------- drag ----------

PortsLayerWidget.prototype.startDrag = function(row, e) {
	var state = this.flyoutState(),
		key = row.getAttribute("data-ports-field"),
		def = state && this.defOf(state.src, key);
	if(!def) {
		return;
	}
	this.drag = {src: state.src, key: key, def: def, row: row, pos: {x: e.clientX, y: e.clientY}, hit: null, search: ""};
	this.peek = null;
	row.classList.add("is-source");
	this.document.body.classList.add("ports-dragging");
	this.wiki.addTiddler({title: DRAG, src: state.src, field: key, search: ""});
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
	return !!title && title !== this.drag.src && schema.accepts(this.wiki, this.drag.def, title);
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
	this.document.body.classList.remove("ports-dragging");
	Array.prototype.forEach.call(this.document.querySelectorAll(".ports-valid, .ports-hover"), function(el) {
		el.classList.remove("ports-valid", "ports-hover");
	});
	drag.row.classList.remove("is-source");
	this.wiki.deleteTiddler(DRAG);
	if(commit && drag.hit) {
		this.connect(drag.src, drag.def, this.titleOf(drag.hit));
	}
	this.drawWires();
	this.armClose();
};

PortsLayerWidget.prototype.connect = function(src, def, target) {
	var tiddler = this.wiki.getTiddler(src),
		caption = def.caption || def.key;
	if(schema.values(tiddler, def).indexOf(target) !== -1) {
		this.notify(this.captionOf(target) + " is already linked as " + caption + ".");
		return;
	}
	var replaced = def.cardinality !== "multi" && schema.values(tiddler, def)[0],
		update = {};
	update[def.key] = schema.withValue(tiddler, def, target, true);
	this.wiki.addTiddler(new $tw.Tiddler(tiddler, update, this.wiki.getModificationFields()));
	this.remember(def.key, target);
	this.notify((replaced ? "Replaced " + this.captionOf(replaced) + " with " : "Linked ") +
		this.captionOf(target) + " as " + caption + " of " + this.captionOf(src) +
		(def.inverse ? " (also listed on " + this.captionOf(target) + ")" : "") + ".");
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

PortsLayerWidget.prototype.findOnScreen = function(title) {
	var self = this,
		selector = this.targetSelector();
	return Array.prototype.filter.call(selector ? this.document.querySelectorAll(selector) : [], function(el) {
		return self.titleOf(el) === title && isOnScreen(el);
	})[0] || null;
};

PortsLayerWidget.prototype.drawWires = function() {
	if(!this.svg) {
		return;
	}
	var self = this,
		out = [];
	Array.prototype.forEach.call(this.document.querySelectorAll(".ports-peek"), function(el) {
		el.classList.remove("ports-peek");
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
		var from = centerOf(this.drag.row.querySelector(".ports-dot") || this.drag.row),
			to = this.drag.hit ? anchorOf(this.drag.hit, from) : this.drag.pos;
		out.push(wire("ports-wire--drag" + (this.drag.hit ? " is-snapped" : ""), from, to, this.drag.hit ? 4 : 3));
	}
	this.svg.innerHTML = out.join("");
};

// ---------- geometry ----------

function isOnScreen(el) {
	var r = el.getBoundingClientRect(),
		win = el.ownerDocument.defaultView;
	return r.width > 0 && r.bottom > 0 && r.top < win.innerHeight;
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
