import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRefCheck } from "./helpers.js";

const library = [
  { id: 1, title: "Vehicle routing problems with multiple trips", DOI: "10.1007/s10288-016-0306-2", lastName: "Cattaruzza", date: "2016" },
  { id: 2, title: "Public Transportation Systems", lastName: "Ceder", date: "2015" },
  { id: 3, title: "A shorter title", lastName: "Doe", date: "2020" },
  { id: 4, title: "Integrating public transport in sustainable last-mile delivery", extra: "DOI: 10.1016/J.EJOR.2024.01.001", lastName: "Delle Donne", date: "2024" },
  { id: 5, title: "Vehicle routing problems with multiple trips", lastName: "Cattaruzza", date: "2016" },
];
const R = loadRefCheck(library);
const none = new Set();

test("matches by DOI in the reference text", async () => {
  const index = await R._buildIndex();
  const m = R.matchText("Cattaruzza D (2016) Something else. 4OR. https://doi.org/10.1007/s10288-016-0306-2", index, none);
  assert.equal(m.how, "DOI");
  assert.equal(m.entry.id, 1);
});

test("matches a DOI stored in the Extra field", async () => {
  const index = await R._buildIndex();
  assert.equal(R.matchText("… doi:10.1016/j.ejor.2024.01.001", index, none).entry.id, 4);
});

test("matches by title, ignoring hyphenation and case", async () => {
  const index = await R._buildIndex();
  const m = R.matchText("Cattaruzza D, Absi N (2016b) Vehicle rout-ing problems with MULTIPLE trips. 4OR 14:223–259", index, none);
  assert.equal(m.how, "title");
  assert.equal(m.entry.ctitle, R.compact("Vehicle routing problems with multiple trips"));
});

test("short titles need the first author's name too", async () => {
  const index = await R._buildIndex();
  assert.equal(R.matchText("Brown K (2020) A shorter title. J.", index, none), null);
  assert.equal(R.matchText("Doe J (2020) A shorter title. J.", index, none).entry.id, 3);
});

test("never matches the open article itself", async () => {
  const index = await R._buildIndex();
  const m = R.matchText("https://doi.org/10.1007/s10288-016-0306-2", index, new Set([1]));
  assert.notEqual(m?.entry.id, 1);
});

test("unrelated references don't match", async () => {
  const index = await R._buildIndex();
  assert.equal(R.matchText("Golden BL (2008) The vehicle routing problem: latest advances. Springer", index, none), null);
});
