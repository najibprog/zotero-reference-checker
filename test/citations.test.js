import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRefCheck, fakePage } from "./helpers.js";

const R = loadRefCheck();
// Values created inside the vm context have their own Array prototype
const plain = (v) => JSON.parse(JSON.stringify(v));

const article = `1. Introduction
Routing has been studied widely (Smith et al., 2019; Jones, 2018). Mladenovi ́c and Hansen (1997) introduced VNS.
2. Literature review
Smith et al. (2019, 2020) extend this. Brown and Lee (2021) compare methods. Smith et al. propose more.
3. Methodology
We follow Jones (2018, p. 4).
4. Conclusions
Nothing cited here.
References
`;
const refs = [
  "Brown, A., & Lee, C. (2021). A comparison of methods. J. Res., 1, 1–2.",
  "Jones, B. (2018). An early study. J. Res., 2, 3–4.",
  "Mladenović, N., & Hansen, P. (1997). Variable neighborhood search. Comput. Oper. Res., 24, 1097–1100.",
  "Smith, J., Doe, K., & Roe, L. (2019). A routing paper. J. Res., 3, 5–6.",
  "Smith, J., Doe, K., & Roe, L. (2020). A later routing paper. J. Res., 4, 7–8.",
];

function setup() {
  const rows = refs.map((text) => ({ ref: { text } }));
  const body = article.slice(0, article.indexOf("References"));
  const info = R.citationInfo(rows, body);
  return { rows, body, info };
}

test("detects numbered sections in order", () => {
  const { body } = setup();
  const titles = plain(R.detectSections(body).map((s) => s.title));
  assert.deepEqual(titles, ["1. Introduction", "2. Literature review", "3. Methodology", "4. Conclusions"]);
});

test("detects unnumbered sections by common names", () => {
  const titles = plain(R.detectSections("Introduction\ntext\nLiterature Review\ntext\nTable 3 results\nConclusion\ntext").map((s) => s.title));
  assert.deepEqual(titles, ["Introduction", "Literature Review", "Conclusion"]);
});

test("author–year article is not mistaken for numeric", () => {
  const { info } = setup();
  assert.equal(info.useNumeric, false);
});

test("assigns each reference to the sections that cite it", () => {
  const { rows, body, info } = setup();
  const sections = R.detectSections(body);
  R.assignSections(rows, body, sections, info);
  const where = rows.map((r) => [...r.sections].sort());
  assert.deepEqual(where[0], [1]);          // Brown and Lee (2021)
  assert.deepEqual(where[1], [0, 2]);       // Jones, 2018 / Jones (2018, p. 4)
  assert.deepEqual(where[2], [0]);          // Mladenovi ́c (detached accent)
  assert.deepEqual(where[3], [0, 1]);       // Smith et al., 2019 / Smith et al. (2019, 2020)
  assert.deepEqual(where[4], [1]);          // second year in (2019, 2020)
});

test("numeric citations with ranges and lists", () => {
  assert.deepEqual([...R.bracketNumbers("2–4, 7")], [2, 3, 4, 7]);
  const body = "Intro [1]. More [2, 4–6] and [3]. Even more [5]; also [6].\n";
  const rows = [1, 2, 3, 4, 5, 6].map((n) => ({ ref: { text: `[${n}] Author${n} A. Title. 2020.` } }));
  const info = R.citationInfo(rows, body);
  assert.equal(info.useNumeric, true);
  R.assignSections(rows, body, [{ title: "All", start: 0, end: body.length }], info);
  assert.ok(rows.every((r) => r.sections.has(0)));
});

test("Cited in text finds every citation in the body, not in the reference list", () => {
  const page = fakePage(article.replace(/\n/g, " ") + refs.join(" "));
  const data = { pages: [page], refsAt: { page: 0, offset: article.indexOf("References") } };
  const key = R.citationKey({ text: refs[3] }, 3);
  const hits = R.findInPDF(data, { key, useNumeric: false }, "citation");
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.rects[0][0] < data.refsAt.offset));
});

test("Cited in text falls back to 'Smith et al.' without a year", () => {
  const page = fakePage("Intro. Smith et al. propose a method. References Smith, J. (2031). T.");
  const data = { pages: [page], refsAt: { page: 0, offset: page.text.indexOf("References") } };
  const hits = R.findInPDF(data, { key: { num: 1, surname: "Smith", year: "2031" }, useNumeric: false }, "citation");
  assert.equal(hits.length, 1);
});

test("In reference list finds the entry after the heading", () => {
  const page = fakePage(article.replace(/\n/g, " ") + refs.join(" "));
  const offset = article.indexOf("References");
  const data = { pages: [page], refsAt: { page: 0, offset } };
  const hits = R.findInPDF(data, { key: R.citationKey({ text: refs[1] }, 1), useNumeric: false }, "entry");
  assert.equal(hits.length, 1);
  assert.ok(hits[0].rects[0][0] > offset);
});

test("rectsFor returns one rectangle per line", () => {
  const page = fakePage("abcdef");
  page.breaks[2] = true;
  assert.deepEqual(plain(R.rectsFor(page, 1, 5)), [[1, 0, 3, 10], [3, 0, 5, 10]]);
});

test("rowsCitedIn finds the author–year citations in a selection", () => {
  const { rows, info } = setup();
  rows.forEach((row) => { row.useNumeric = info.useNumeric; });
  const pick = (text) => plain([...R.rowsCitedIn(rows, text)].sort());
  assert.deepEqual(pick("Routing has been studied widely (Smith et al., 2019; Jones, 2018)."), [1, 3]);
  assert.deepEqual(pick("Mladenovi ́c and Hansen (1997) introduced VNS."), [2]);
  assert.deepEqual(pick("Nothing cited here."), []);
});

test("rowsCitedIn follows numeric citations", () => {
  const rows = ["[1] A. One", "[2] B. Two", "[3] C. Three", "[4] D. Four"].map((text) => ({ ref: { text } }));
  rows.forEach((row, i) => { row.key = R.citationKey(row.ref, i); row.useNumeric = true; });
  assert.deepEqual(plain([...R.rowsCitedIn(rows, "as shown in [1, 3–4]")].sort()), [0, 2, 3]);
});

test("rowsCitedIn recognises a selected reference-list entry", () => {
  const rows = [
    { ref: { text: "Brown, A. (2021). A comparison of routing methods for buses. J. Res., 1, 1–2.", title: "" } },
    { ref: { text: "Jones, B. (2018). An early study.", title: "An early study of public transport networks", doi: "10.1000/xyz.1" } },
  ];
  assert.deepEqual(plain([...R.rowsCitedIn(rows, "A comparison of routing methods for buses. J. Res.")]), [0]);
  assert.deepEqual(plain([...R.rowsCitedIn(rows, "An early study of public\ntransport networks. doi:10.1000/xyz.1")]), [1]);
});

test("an organisation in capitals is found when cited capitalised", () => {
  const key = R.citationKey({ text: "FEVAD. (février 7, 2023). Chiffre d'affaires annuel du e-commerce." }, 0);
  assert.match("an increase of 41% (Fevad, 2023). This", R.authorYearRegex(key));
  assert.match("as reported by FEVAD (2023)", R.authorYearRegex(key));
});

test("finds names glued to the previous word, as in Zotero's PDF text", () => {
  const key = R.citationKey({ text: "Chapuis, C. (2020). Restoring public transit." }, 0);
  assert.match("underused out of the peak (seeChapuis et al. ,2020 ). There", R.authorYearRegex(key));
  assert.match("as reported inChapuis ( 2020), in Canada", R.authorYearRegex(key));
  // but not inside another capitalised name
  assert.doesNotMatch("MacChapuis (2020)", R.authorYearRegex(key));
});

test("numbered equations don't make an author–year paper look numeric", () => {
  const authors = ["Archetti", "Behiri", "Boudet", "Bruzzone", "Ceselli", "Chapuis", "Chauhan", "Cherkesly", "Church", "Cochrane"];
  const rows = authors.map((a) => ({ ref: { text: `${a}, A. (2019). A title of the work.` } }));
  const cites = authors.map((a) => `as shown by ${a} et al. (2019).`).join(" ");
  const equations = authors.map((_, i) => `x + y ≤ 1 (${i + 1})`).join("\n");
  const info = R.citationInfo(rows, cites + "\n" + equations + "\n" + equations);
  assert.equal(info.useNumeric, false);
});

test("selected text without the year still finds the reference by its authors", () => {
  const rows = [
    { ref: { text: "Ozturk, O., Patrick, J., 2018. An optimization model for freight transport." } },
    { ref: { text: "Chapuis, C., 2020. Restoring public transit amid COVID-19." } },
  ];
  rows.forEach((row, i) => { row.key = R.citationKey(row.ref, i); });
  assert.deepEqual([...R.rowsCitedIn(rows, "Ozturk and Patrick ,2018")], [0]);
  assert.deepEqual([...R.rowsCitedIn(rows, "Ozturk and Patrick")], [0]);
  assert.deepEqual([...R.rowsCitedIn(rows, "seeChapuis et al.")], [1]);
  assert.deepEqual([...R.rowsCitedIn(rows, "Chapuis")], [1]);
});

test("remembers where each reference is first cited, overall and per section", () => {
  const rows = ["Archetti, C. (2021). A.", "Boudet, B. (2007). B.", "Chapuis, C. (2020). C."].map((text) => ({ ref: { text } }));
  const body = "1. Introduction\nAs Chapuis (2020) and Archetti (2021) say.\n2. Literature review\nBoudet (2007) then Archetti (2021).\n3. Method\nNothing.\n";
  const info = R.citationInfo(rows, body);
  R.assignSections(rows, body, R.detectSections(body), info);
  const byFirst = [...rows.keys()].sort((a, b) => rows[a].firstAt - rows[b].firstAt);
  assert.deepEqual(byFirst, [2, 0, 1]);                         // Chapuis, Archetti, Boudet
  assert.ok(rows[1].firstPos.get(1) < rows[0].firstPos.get(1)); // in section 2: Boudet before Archetti
});
