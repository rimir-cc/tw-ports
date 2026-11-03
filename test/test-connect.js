/*\
title: $:/plugins/rimir/ports/test/test-connect.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for connect.js: what a drop of one or several targets (Shift picks)
writes, and the notification for it.

\*/
"use strict";

var schema = require("$:/plugins/rimir/kind/schema.js"),
	connect = require("$:/plugins/rimir/ports/connect.js");

var PREFIX = "$:/test/ports-connect/";

var TYPES = {
	"pc-person": [{key: "caption", typed: "text"}],
	"pc-team": [
		{key: "caption", typed: "text"},
		{key: "members", typed: "ref", cardinality: "multi", "ref-types": ["pc-person"]}
	],
	"pc-project": [
		{key: "members", typed: "ref", cardinality: "multi", "ref-types": ["pc-person"], caption: "Members"},
		{key: "owner", typed: "ref", cardinality: "single", "ref-types": ["pc-person"], caption: "Owner"}
	]
};

describe("ports connect", function() {

	var added = [];

	function add(fields) {
		$tw.wiki.addTiddler(fields);
		added.push(fields.title);
	}

	function def(key) {
		return schema.fieldDef($tw.wiki, "pc-project", key);
	}

	function plan(project, key, targets) {
		return connect.plan($tw.wiki, $tw.wiki.getTiddler(project), def(key), targets);
	}

	function message(project, key, targets) {
		return connect.message($tw.wiki, def(key), project, plan(project, key, targets));
	}

	beforeAll(function() {
		Object.keys(TYPES).forEach(function(key) {
			add({title: PREFIX + "type/" + key, "kind.type": key, "kind.fields": JSON.stringify(TYPES[key]),
				"kind.group-of": key === "pc-team" ? "members" : undefined});
		});
		["Ann", "Ben", "Cid", "Dan", "Eve", "Fay", "Gil"].forEach(function(name) {
			add({title: "PC " + name, "kind.type": "pc-person", caption: name});
		});
		add({title: "PC Team", "kind.type": "pc-team", caption: "Team", members: "[[PC Ann]] [[PC Ben]] [[PC Cid]]"});
		add({title: "PC Empty Team", "kind.type": "pc-team", caption: "Empty Team"});
		add({title: "PC Atlas", "kind.type": "pc-project", caption: "Atlas", members: "[[PC Ann]]", owner: "PC Dan"});
		add({title: "PC Blank", "kind.type": "pc-project", caption: "Blank"});
	});

	afterAll(function() {
		added.forEach(function(title) { $tw.wiki.deleteTiddler(title); });
	});

	it("adds several picks to a multi field in one value, in pick order", function() {
		var p = plan("PC Atlas", "members", ["PC Cid", "PC Ben"]);
		expect(p.added).toEqual(["PC Cid", "PC Ben"]);
		expect(p.value).toBe("[[PC Ann]] [[PC Cid]] [[PC Ben]]");
		expect(p.skipped).toBe(0);
	});

	it("skips targets that are linked already", function() {
		var p = plan("PC Atlas", "members", ["PC Ann", "PC Ben"]);
		expect(p.added).toEqual(["PC Ben"]);
		expect(p.skipped).toBe(1);
	});

	it("expands a picked group to the members it adds, never the group itself", function() {
		var p = plan("PC Atlas", "members", ["PC Team", "PC Eve"]);
		expect(p.items[0].members).toEqual(["PC Ann", "PC Ben", "PC Cid"]);
		expect(p.items[0].added).toEqual(["PC Ben", "PC Cid"]);
		expect(p.added).toEqual(["PC Ben", "PC Cid", "PC Eve"]);
		expect(p.value).not.toContain("PC Team");
		expect(p.skipped).toBe(1);
	});

	it("adds a person reached on its own and via a group once", function() {
		var p = plan("PC Blank", "members", ["PC Ben", "PC Team"]);
		expect(p.added).toEqual(["PC Ben", "PC Ann", "PC Cid"]);
		expect(p.skipped).toBe(1);
	});

	it("changes nothing when everything is linked already", function() {
		var p = plan("PC Atlas", "members", ["PC Ann"]);
		expect(p.added).toEqual([]);
		expect(p.value).toBe(null);
	});

	it("takes only the last target on a single-value field and reports the replaced one", function() {
		var p = plan("PC Atlas", "owner", ["PC Eve", "PC Fay"]);
		expect(p.items.length).toBe(1);
		expect(p.value).toBe("PC Fay");
		expect(p.replaced).toBe("PC Dan");
		expect(plan("PC Blank", "owner", ["PC Fay"]).replaced).toBe(null);
	});

	it("words one target like a single drop", function() {
		expect(message("PC Atlas", "members", ["PC Ben"])).toBe("Linked Ben as Members of Atlas.");
		expect(message("PC Atlas", "members", ["PC Ann"])).toBe("Ann is already linked as Members.");
		expect(message("PC Atlas", "owner", ["PC Eve"])).toBe("Replaced Dan with Eve as Owner of Atlas.");
	});

	it("words one group by its members", function() {
		expect(message("PC Atlas", "members", ["PC Team"])).toBe("Linked 2 members of Team as Members of Atlas (1 already linked).");
		expect(message("PC Blank", "members", ["PC Empty Team"])).toBe("Empty Team has no members to link as Members.");
	});

	it("lists several picks by name, long lists shortened", function() {
		expect(message("PC Atlas", "members", ["PC Ann", "PC Ben", "PC Cid"])).toBe("Linked Ben and Cid as Members of Atlas (1 already linked).");
		expect(message("PC Blank", "members", ["PC Ann", "PC Ben", "PC Cid", "PC Dan", "PC Eve", "PC Fay", "PC Gil"]))
			.toBe("Linked Ann, Ben, Cid, Dan, Eve and 2 more as Members of Blank.");
		expect(message("PC Atlas", "members", ["PC Ann", "PC Team"])).toBe("Linked Ben and Cid as Members of Atlas (2 already linked).");
	});

	it("says so when every pick is linked already", function() {
		expect(message("PC Atlas", "members", ["PC Ann", "PC Ann"])).toBe("Everything picked is already linked as Members.");
	});
});
