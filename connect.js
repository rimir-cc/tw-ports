/*\
title: $:/plugins/rimir/ports/connect.js
type: application/javascript
module-type: library

What dropping one or more targets on a ref field writes, apart from the pointer
handling in ports-layer.js.

plan(wiki, tiddler, def, targets)  — the links the drop adds and the new value
message(wiki, def, src, plan)      — the notification for it

A target is an instance the field accepts, or a group (kind.group-of) whose
members it accepts: a group adds its members, never itself. Titles already in
the field, or reached twice (a person picked on its own and via a team), are
added once. A single-value field takes only the last target.

\*/

"use strict";

var schema = require("$:/plugins/rimir/kind/schema.js");

var LIST_MAX = 5;

/*
Returns {items, added, skipped, replaced, value}:
  items    — per target: {target, members (null unless a group), added}
  added    — the titles that get linked, in drop order
  skipped  — how many titles the targets stand for that were linked already
  replaced — the old value of a single-value field that gets replaced, or null
  value    — the new field value, or null when nothing changes
*/
exports.plan = function(wiki, tiddler, def, targets) {
	var current = schema.values(tiddler, def),
		multi = def.cardinality === "multi",
		seen = current.slice(0),
		added = [],
		skipped = 0;
	var items = (multi ? targets : targets.slice(-1)).map(function(target) {
		var members = schema.accepts(wiki, def, target) ? null : (schema.groupMembers(wiki, def, target) || []),
			links = (members || [target]).filter(function(title) {
				if(seen.indexOf(title) !== -1) {
					skipped++;
					return false;
				}
				seen.push(title);
				return true;
			});
		added = added.concat(links);
		return {target: target, members: members, added: links};
	});
	return {
		items: items,
		added: added,
		skipped: skipped,
		replaced: !multi && added.length && current[0] || null,
		value: !added.length ? null : (multi ? $tw.utils.stringifyList(current.concat(added)) : added[0])
	};
};

exports.message = function(wiki, def, src, plan) {
	var caption = def.caption || def.key,
		cap = function(title) { return exports.captionOf(wiki, title); },
		one = plan.items.length === 1 ? plan.items[0] : null,
		of = " as " + caption + " of " + cap(src);
	if(one && !one.members) {
		return !plan.added.length ? cap(one.target) + " is already linked as " + caption + "." :
			(plan.replaced ? "Replaced " + cap(plan.replaced) + " with " : "Linked ") + cap(one.target) + of +
			(def.inverse ? " (also listed on " + cap(one.target) + ")" : "") + ".";
	}
	if(!plan.added.length) {
		return !one ? "Everything picked is already linked as " + caption + "." :
			one.members.length ? "All members of " + cap(one.target) + " are already linked as " + caption + "." :
			cap(one.target) + " has no members to link as " + caption + ".";
	}
	var what = one ? plan.added.length + " member" + (plan.added.length === 1 ? "" : "s") + " of " + cap(one.target) :
		listOf(plan.added.map(cap));
	return "Linked " + what + of + (plan.skipped ? " (" + plan.skipped + " already linked)" : "") + ".";
};

exports.captionOf = function(wiki, title) {
	var tiddler = wiki.getTiddler(title);
	return (tiddler && tiddler.fields.caption) || title;
};

// "A, B and C", or "A, B, C, D, E and 3 more"
function listOf(names) {
	if(names.length === 1) {
		return names[0];
	}
	var shown = names.slice(0, names.length > LIST_MAX ? LIST_MAX : names.length - 1),
		rest = names.length - shown.length;
	return shown.join(", ") + " and " + (names.length > LIST_MAX ? rest + " more" : names[names.length - 1]);
}
