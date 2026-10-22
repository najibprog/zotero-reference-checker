import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRefCheck, fakePage } from "./helpers.js";

const R = loadRefCheck();
const plain = (v) => JSON.parse(JSON.stringify(v));

test("reads the surname from Crossref author fields with initials first", () => {
  assert.equal(R.citationKey({ text: "x", author: "ZC Yin", year: "2021" }, 0).surname, "Yin");
  assert.equal(R.citationKey({ text: "x", author: "J. Smith", year: "2021" }, 0).surname, "Smith");
  assert.equal(R.citationKey({ text: "x", author: "J.-F. Cordeau", year: "1997" }, 0).surname, "Cordeau");
  assert.equal(R.citationKey({ text: "x", author: "Artzner", year: "1999" }, 0).surname, "Artzner");
});

const numberedRefs = (n) => Array.from({ length: n }, (_, i) => ({ ref: { text: `Author${i + 1} A. Some title number ${i + 1}.` } }));

test("detects citations in parentheses: (3), (2–4), (1, 5)", () => {
  const rows = numberedRefs(6);
  const body = "Routing was studied (1, 5). Others (2–4) disagree. See also (6). Equation (1) holds.";
  const info = R.citationInfo(rows, body);
  assert.equal(info.useNumeric, true);
  assert.equal(info.numStyle, "paren");
  R.assignSections(rows, body, [{ title: "All", start: 0, end: body.length }], info);
  assert.ok(rows.every((r) => r.sections.has(0)));
});

test("detects superscript citations read as digits after words", () => {
  const rows = numberedRefs(6);
  const body = "Routing has been studied widely1,2 and recently.3 Some heuristics4–6 work well. CO2 emissions fall.";
  const info = R.citationInfo(rows, body);
  assert.equal(info.useNumeric, true);
  assert.equal(info.numStyle, "super");
  assert.deepEqual(plain(R.numericCitations(body, "super").map((c) => c.nums)), [[1, 2], [3], [4, 5, 6]]);
});

test("brackets stay preferred, and a few parentheses don't make an author–year paper numeric", () => {
  const rows = [
    { ref: { text: "Smith, J. (2019). A routing paper." } },
    { ref: { text: "Jones, B. (2018). An early study." } },
    { ref: { text: "Brown, A. (2021). A comparison." } },
  ];
  const body = "As Smith (2019) and Jones (2018) show, and Brown (2021) confirms, x = (1).";
  assert.equal(R.citationInfo(rows, body).useNumeric, false);
});

test("counts citations per section", () => {
  const rows = numberedRefs(3);
  const body = "1. Introduction\nWe cite [1] and [1, 2].\n2. Results\nAgain [1] and [3]. And [2–3].\n";
  const info = R.citationInfo(rows, body);
  const sections = R.detectSections(body + "3. Conclusion\nend\n4. Other\nx\n");
  R.assignSections(rows, body, sections.slice(0, 2), info);
  assert.deepEqual(plain([...rows[0].citeCounts]), [[0, 2], [1, 1]]);
  assert.deepEqual(plain([...rows[1].citeCounts]), [[0, 1], [1, 1]]);
  assert.deepEqual(plain([...rows[2].citeCounts]), [[1, 2]]);
});

test("finds a reference-list entry by its title when number and year don't help", () => {
  const page = fakePage("Body text. References Norman, J. F. Solid shape discri- mination from vision and haptics. Exp. Brain Res. 2012.");
  const data = { pages: [page], refsAt: { page: 0, offset: page.text.indexOf("References") } };
  const hits = R.findInPDF(data, { key: { num: 40, surname: "", year: "" }, useNumeric: true, numStyle: "bracket",
    title: "Solid shape discrimination from vision and haptics" }, "entry");
  assert.equal(hits.length, 1);
  assert.ok(hits[0].rects[0][0] >= page.text.indexOf("Solid"));
});

test("places sections in the PDF and keeps only the citations of one section", () => {
  const text = "1 Introduction We cite [1] here. 2. Literature review Then [1] again and [1] once more. References [1] A.";
  const page = fakePage(text);
  const data = { pages: [page], refsAt: { page: 0, offset: text.indexOf("References") } };
  const sections = [{ title: "1. Introduction" }, { title: "2. Literature review" }];
  const starts = R.sectionStartsInPDF(data, sections);
  assert.deepEqual(plain(starts), [0, text.indexOf("2. Literature")]);
  const hits = R.findInPDF(data, { key: { num: 1 }, useNumeric: true, numStyle: "bracket" }, "citation");
  assert.equal(hits.length, 3);
  assert.equal(R.hitsInSection(data, hits, sections, 0).length, 1);
  assert.equal(R.hitsInSection(data, hits, sections, 1).length, 2);
});

test("marks library matches that are Related items of the article", () => {
  const parent = { key: "PARENT", relatedItems: ["AAA"] };
  const rows = [
    { status: { item: { key: "AAA", relatedItems: [] } } },
    { status: { item: { key: "BBB", relatedItems: ["PARENT"] } } },
    { status: { item: { key: "CCC", relatedItems: [] } } },
    {},
  ];
  R.markRelated(rows, parent);
  assert.deepEqual(rows.map((r) => r.related), [true, true, false, false]);
});

test("fills DOI-only Crossref references with author, year and title", async () => {
  const R2 = loadRefCheck();
  R2.version = "test";
  const calls = [];
  // The vm context's Zotero stub: add what fillFromCrossref uses
  const ctxZotero = R2.__zotero;
  ctxZotero.Prefs = { get: () => "" };
  ctxZotero.Promise = { delay: async () => {} };
  ctxZotero.HTTP = {
    request: async (method, url) => {
      calls.push(url);
      return { response: { message: { items: [
        { DOI: "10.1007/S00221-012-3220-7", type: "journal-article", author: [{ family: "Norman" }],
          issued: { "date-parts": [[2012, 8]] }, title: ["Solid shape discrimination"], "container-title": ["Exp Brain Res"] },
      ] } } };
    },
  };
  const refs = [
    { text: "10.1007/s00221-012-3220-7", title: "", doi: "10.1007/s00221-012-3220-7", author: "", year: "" },
    { text: "Smith (2019) Known.", title: "Known", doi: "", author: "Smith", year: "2019" },
  ];
  await R2.fillFromCrossref(refs);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /filter=doi:10\.1007%2Fs00221-012-3220-7/);
  assert.equal(refs[0].author, "Norman");
  assert.equal(refs[0].year, "2012");
  assert.equal(refs[0].journal, "Exp Brain Res");
  assert.equal(refs[0].type, "Journal article");
  assert.match(refs[0].text, /^Norman \(2012\)\. Solid shape discrimination\. Exp Brain Res/);
  assert.equal(R2.citationKey(refs[0], 0).surname, "Norman");
});
