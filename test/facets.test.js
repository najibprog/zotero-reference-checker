import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRefCheck } from "./helpers.js";

const R = loadRefCheck();

test("guesses the publication type of a reference from its text", () => {
  const cases = [
    ["Smith, J. (2019). A routing paper. Transportation Science, 53(4), 1–20.", "Journal article"],
    ["Cattaruzza D (2016) Vehicle routing. 4OR 14:223–259", "Journal article"],
    ["Doe, A. (2018). Fast heuristics. In Proceedings of the 12th Conference on AI (pp. 1–8).", "Conference paper"],
    ["Brown, K. (2015). Public Transportation Systems. Pearson Education, Upper Saddle River.", "Other"],
    ["Ceder, A. (2015). Public Transit Planning, 2nd edition. CRC Press.", "Book / chapter"],
    ["Lee, C. (2020). Bus scheduling. In: Smith, J. (Eds.), Handbook of Transit. Springer, pp. 1–30.", "Book / chapter"],
    ["Roe, L. (2021). Optimisation of last-mile delivery. PhD thesis, Université de Lyon.", "Thesis"],
    ["Kim, S. (2023). Learning to route. arXiv:2301.01234.", "Preprint"],
    ["Hansen, P. (2002). Variable neighborhood search. Working paper, GERAD.", "Report"],
  ];
  for (const [text, type] of cases) assert.equal(R.guessType(text), type, text);
});

test("uses the type and journal given by Crossref or OpenAlex", () => {
  assert.deepEqual({ ...R.rowFacets({ ref: { text: "x", type: "Journal article", journal: "  European Journal of\nOperational Research " } }) },
    { type: "Journal article", journal: "European Journal of Operational Research" });
  assert.deepEqual({ ...R.rowFacets({ ref: { text: "x", type: "Conference paper", journal: "" } }) },
    { type: "Conference paper", journal: "" });
  const w = R.openAlexWork({ type: "article", primary_location: { source: { display_name: "Omega", type: "journal" } }, authorships: [] });
  assert.equal(w.type, "Journal article");
  assert.equal(w.journal, "Omega");
  assert.equal(R.openAlexWork({ type: "article", primary_location: { source: { display_name: "arXiv", type: "repository" } } }).type, "Preprint");
  assert.equal(R.openAlexWork({ type: "book-chapter" }).type, "Book / chapter");
});

test("filter rows: journal names are grouped regardless of case and a leading 'The'", () => {
  const made = [];
  const el = (tag, cls, text) => {
    const e = { tag, className: cls, textContent: text, children: [], style: {}, dataset: {}, classList: { toggle() {} },
      append(...c) { this.children.push(...c); }, addEventListener() {}, remove() {} };
    made.push(e);
    return e;
  };
  const rows = [
    { ref: { text: "a", type: "Journal article", journal: "Omega" } },
    { ref: { text: "b", type: "Journal article", journal: "OMEGA" } },
    { ref: { text: "c", type: "Journal article", journal: "The Journal of Finance" } },
    { ref: { text: "d", type: "Conference paper" } },
  ];
  const state = { type: "", journal: "" };
  const f = R.facetFilters(el, rows, state, () => {});
  const labels = made.filter((e) => e.className === "refcheck-chip").map((e) => e.textContent);
  assert.deepEqual(labels, ["All types", "Journal article (3)", "Conference paper (1)", "All journals", "Omega (2)", "The Journal of Finance (1)"]);

  state.journal = R.compact("omega");
  assert.deepEqual(rows.map((r) => f.test(r)), [true, true, false, false]);
  state.journal = "";
  state.type = "Conference paper";
  assert.deepEqual(rows.map((r) => f.test(r)), [false, false, false, true]);
});
