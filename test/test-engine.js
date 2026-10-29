/*\
title: $:/plugins/rimir/ports/test/test-engine.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the ports engine functions (wikitext) and their kind schema basis.

\*/
"use strict";

var PREFIX = "$:/test/ports/";

var FIELDS = [
	{key: "caption", typed: "text"},
	{key: "parent", typed: "ref", cardinality: "single", "ref-types": ["pt-person"]},
	{key: "owner", typed: "ref", cardinality: "single", "ref-types": ["pt-person"]},
	{key: "members", typed: "ref", cardinality: "multi", "ref-types": ["pt-person"]},
	{key: "status", typed: "enum", options: ["active", "archived"]}
];

function render(expr) {
	return $tw.wiki.renderText("text/plain", "text/vnd.tiddlywiki",
		"\\import $:/plugins/rimir/kind/engine $:/plugins/rimir/ports/engine\n" +
		"<$let type-tid=\"" + PREFIX + "type/pt-project\" opt-all=\"[!is[blank]]\" opt-active=\"[!status[archived]]\">" + expr + "</$let>");
}

function list(filter) {
	return render("<$text text={{{ " + filter + " +[format:titlelist[]join[ ]] }}}/>");
}

describe("ports engine", function() {

	var added = [];

	function add(fields) {
		$tw.wiki.addTiddler(fields);
		added.push(fields.title);
	}

	beforeAll(function() {
		add({title: PREFIX + "type/pt-project", "kind.type": "pt-project", "kind.fields": JSON.stringify(FIELDS)});
		add({title: PREFIX + "type/pt-person", "kind.type": "pt-person", "kind.fields": "[]"});
		add({title: "PT Anna Berger", "kind.type": "pt-person", caption: "Anna Berger"});
		add({title: "PT Tom", "kind.type": "pt-person"});
		add({title: "PT Old", "kind.type": "pt-person", status: "archived"});
		add({title: "PT Atlas", "kind.type": "pt-project", owner: "PT Anna Berger", members: "[[PT Anna Berger]] [[PT Tom]]"});
	});

	afterAll(function() {
		added.forEach(function(title) { $tw.wiki.deleteTiddler(title); });
	});

	it("lists only ref fields, in schema order, minus excluded ones", function() {
		expect(list("[function[ports.fields],<type-tid>,[]]")).toBe("parent owner members");
		expect(list("[function[ports.fields],<type-tid>,[parent]]")).toBe("owner members");
	});

	it("splits filled and empty ports", function() {
		expect(list("[function[ports.filled],<type-tid>,[PT Atlas],[]]")).toBe("owner members");
		expect(list("[function[ports.empty],<type-tid>,[PT Atlas],[]]")).toBe("parent");
	});

	it("keeps a single value with spaces whole and splits multi values", function() {
		expect(list("[function[ports.values],<type-tid>,[PT Atlas],[owner]]")).toBe("[[PT Anna Berger]]");
		expect(list("[function[ports.values],<type-tid>,[PT Atlas],[members]]")).toBe("[[PT Anna Berger]] [[PT Tom]]");
	});

	it("counts all links of an instance", function() {
		expect(list("[function[ports.count],<type-tid>,[PT Atlas],[]]")).toBe("3");
		expect(list("[function[ports.count],<type-tid>,[PT Atlas],[owner]]")).toBe("2");
	});

	it("offers candidates of the accepted kind, minus the source, filtered and searched", function() {
		expect(list("[function[ports.candidates],<type-tid>,[members],[PT Atlas],<opt-all>,[]]")).toBe("[[PT Anna Berger]] [[PT Old]] [[PT Tom]]");
		expect(list("[function[ports.candidates],<type-tid>,[members],[PT Atlas],<opt-active>,[]]")).toBe("[[PT Anna Berger]] [[PT Tom]]");
		expect(list("[function[ports.candidates],<type-tid>,[members],[PT Atlas],<opt-all>,[anna]]")).toBe("[[PT Anna Berger]]");
	});

	describe("option sources", function() {

		var sources = [];

		function source(name, fields) {
			var title = PREFIX + "os/" + name;
			$tw.wiki.addTiddler($tw.utils.extend({title: title, tags: "$:/tags/rimir/ports/option-source", filter: "[" + name + "]"}, fields));
			sources.push(title);
		}

		afterEach(function() {
			sources.forEach(function(title) { $tw.wiki.deleteTiddler(title); });
			sources = [];
		});

		function winner(field) {
			return render("<$text text={{{ [function[ports.option-source],<type-tid>,[" + field + "],[pt-project]] }}}/>");
		}

		it("picks the most specific matching source", function() {
			source("byref", {"ref-type": "pt-person"});
			source("byfield", {field: "members"});
			source("bykind", {kind: "pt-project", field: "members"});
			source("otherkind", {kind: "pt-other"});
			expect(winner("members")).toBe(PREFIX + "os/bykind");
			expect(winner("owner")).toBe(PREFIX + "os/byref");
		});

		it("falls back to the default filter without a source", function() {
			expect(render("<$text text={{{ [function[ports.option-filter],[]] }}}/>")).toBe("[!is[blank]]");
		});

		it("applies the shipped hide-archived source to every port", function() {
			expect(winner("members")).toBe("$:/config/rimir/ports/options/hide-archived");
		});
	});
});

describe("kind schema helpers", function() {

	var schema = require("$:/plugins/rimir/kind/schema.js");

	it("adds and removes values by cardinality", function() {
		var multi = {key: "m", cardinality: "multi"},
			single = {key: "s", cardinality: "single"},
			t = new $tw.Tiddler({title: "x", m: "A [[B C]]", s: "B C"});
		expect(schema.withValue(t, multi, "D E", true)).toBe("A [[B C]] [[D E]]");
		expect(schema.withValue(t, multi, "B C", false)).toBe("A");
		expect(schema.withValue(t, single, "Z", true)).toBe("Z");
		expect(schema.withValue(t, single, "B C", false)).toBe("");
		expect(schema.withValue(t, single, "other", false)).toBe("B C");
	});

	it("accepts only instances of the referenced kinds", function() {
		var wiki = new $tw.Wiki();
		wiki.addTiddler({title: "P", "kind.type": "person"});
		wiki.addTiddler({title: "T", "kind.type": "team"});
		wiki.addTiddler({title: "Type", "kind.type": "person", "kind.fields": "[]"});
		wiki.addTiddler({title: "Plain"});
		var def = {key: "r", "ref-types": ["person"]};
		expect(schema.accepts(wiki, def, "P")).toBe(true);
		expect(schema.accepts(wiki, def, "T")).toBe(false);
		expect(schema.accepts(wiki, def, "Type")).toBe(false);
		expect(schema.accepts(wiki, def, "Plain")).toBe(false);
		expect(schema.accepts(wiki, {key: "r"}, "T")).toBe(true);
	});
});
