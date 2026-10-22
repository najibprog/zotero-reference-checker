import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRefCheck } from "./helpers.js";

const library = [
  { id: 1, title: "Adaptive online portfolio selection with transaction costs", DOI: "10.1016/j.ejor.2021.03.023", lastName: "Guo", date: "2021" },
  { id: 2, title: "Markov decision processes with risk-sensitive criteria: an overview", lastName: "Bäuerle", date: "2024" },
];
const R = loadRefCheck(library);
const none = new Set();

const work = (over) => ({
  id: "https://openalex.org/W1",
  doi: "https://doi.org/10.1016/J.EJOR.2021.03.023",
  display_name: "Adaptive online portfolio selection with transaction costs",
  publication_year: 2021,
  cited_by_count: 42,
  authorships: [
    { author: { display_name: "Sini Guo" } },
    { author: { display_name: "Jia-Wen Gu" } },
    { author: { display_name: "Wai-Ki Ching" } },
  ],
  primary_location: { source: { display_name: "European Journal of Operational Research" } },
  ...over,
});

test("turns an OpenAlex work into a reference", () => {
  const ref = R.openAlexWork(work());
  assert.equal(ref.doi, "10.1016/j.ejor.2021.03.023");
  assert.equal(ref.author, "Guo");
  assert.equal(ref.year, "2021");
  assert.equal(ref.citedBy, 42);
  assert.equal(ref.text, "Sini Guo et al. (2021). Adaptive online portfolio selection with transaction costs. European Journal of Operational Research");
});

test("handles missing fields and HTML in titles", () => {
  const ref = R.openAlexWork({ display_name: "Risk in <i>stochastic</i> models", authorships: [] });
  assert.equal(ref.doi, "");
  assert.equal(ref.title, "Risk in stochastic models");
  assert.equal(ref.text, "Risk in stochastic models");
  assert.equal(ref.citedBy, 0);
});

test("citing works match library items by DOI or title", async () => {
  const index = await R._buildIndex();
  const byDOI = R.openAlexWork(work());
  assert.equal(R.matchText(byDOI.text, index, none, byDOI).how, "DOI");

  const byTitle = R.openAlexWork(work({
    doi: "https://doi.org/10.1007/s00186-024-00857-0",
    display_name: "Markov decision processes with risk-sensitive criteria: an overview",
    authorships: [{ author: { display_name: "Nicole Bäuerle" } }],
  }));
  const m = R.matchText(byTitle.text, index, none, byTitle);
  assert.equal(m.how, "title");
  assert.equal(m.entry.id, 2);

  const missing = R.openAlexWork(work({ doi: null, display_name: "Something not in the library at all" }));
  assert.equal(R.matchText(missing.text, index, none, missing), null);
});
