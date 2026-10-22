import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRefCheck } from "./helpers.js";

const R = loadRefCheck();

test("finds the last References heading, not one in the first part", () => {
  const body = "Abstract. See the References below. ".repeat(40);
  const text = body + "\nReferences\nSmith, J. (2019). A title. Journal, 1, 1–2.\n";
  const { section, found } = R.extractReferenceSection(text);
  assert.equal(found, true);
  assert.match(section, /^Smith, J\. \(2019\)/);
});

test("falls back to the end of the text when there is no heading", () => {
  const { found, start } = R.extractReferenceSection("x".repeat(1000));
  assert.equal(found, false);
  assert.equal(start, 650);
});

test("splits APA entries, including several on one line", () => {
  const section = [
    "Abioye, O. F., Dulebenets, M. A., & Pasha, J. (2019). A vessel schedule recovery problem. Transportation, 12, 1–10.",
    "Agarwal, R., & Ergun, O. (2008). Ship scheduling and network design for cargo routing. Transportation Science, 42, 175–196. Zhang, M., & Pel, A. J. (2016). Synchromodal hinterland freight transport. Journal of Transport Geography, 52, 1–10.",
  ].join("\n");
  const refs = R.splitReferences(section);
  assert.equal(refs.length, 3);
  assert.match(refs[2], /^Zhang, M\., & Pel/);
});

test("splits Springer/Vancouver entries run together", () => {
  const section = "Abdul Rahim MKI, Zhong Y, Aouam T (2014) Modelling the inventory-routing problem. Int J Prod Res 52:4351–4363 Aksen D, Kaya O, Salman FS (2014) An adaptive large neighborhood search algorithm. Eur J Oper Res 239:413–426 Andersson H, Hoff A (2010) Industrial aspects and literature survey. Comput Oper Res 37:1515–1536";
  const refs = R.splitReferences(section);
  assert.equal(refs.length, 3);
  assert.match(refs[1], /^Aksen D/);
});

test("splits numbered lists by following the numbering", () => {
  const section = "1. Balas E (1981) A restricted lagrangean approach. Math Programming 21:19-46 2. Balinski M (1964) On an integer program. Oper Res 12:300-304 3. Benders JF (1962) Partitioning procedures. Numer Math 4:238-252 4. Bodin LD (1981) The state of the art in routing. Report 81-001";
  const refs = R.splitReferences(section);
  assert.equal(refs.length, 4);
  assert.match(refs[3], /^4\. Bodin/);
});

test("splits bracket-numbered lists", () => {
  const section = "[1] A. Smith. First paper title here. J. Res., 2020.\n[2] B. Jones. Second paper title here. J. Res., 2021.\n[3] C. Lee. Third paper title here. J. Res., 2022.";
  assert.equal(R.splitReferences(section).length, 3);
});

test("cleans DOIs", () => {
  assert.equal(R.cleanDOI("https://doi.org/10.1016/J.EJOR.2021.02.009."), "10.1016/j.ejor.2021.02.009");
  assert.equal(R.cleanDOI("no doi here"), "");
});

test("compact() ignores case, accents, punctuation and line-break hyphens", () => {
  assert.equal(R.compact("Opti-\nmization: Ré-sumé"), R.compact("optimization resume"));
});

test("citationKey reads number, surname (with particles) and year", () => {
  assert.deepEqual({ ...R.citationKey({ text: "[7] Smith, J. (2019a). Title." }, 0) }, { num: 7, surname: "Smith", year: "2019a" });
  assert.equal(R.citationKey({ text: "van der Berg, A. (2018). Title." }, 0).surname, "der");
  assert.equal(R.citationKey({ text: "Van Anholt RG, Coelho LC (2016) Title." }, 3).surname, "Anholt");
  assert.equal(R.citationKey({ text: "x", author: "Laporte G.", year: "2009" }, 0).surname, "Laporte");
});

test("articleURL uses the DOI, or a Google Scholar search", () => {
  assert.equal(R.articleURL({ text: "… https://doi.org/10.1287/trsc.2016.0732" }), "https://doi.org/10.1287/trsc.2016.0732");
  assert.match(R.articleURL({ text: "Smith (2019) A title" }), /^https:\/\/scholar\.google\.com\/scholar\?q=/);
});

// Styles where each entry ends with its year (SIAM, ACM, some IEEE / LNCS variants)
const yearLast = [
  "J.-F. Cordeau and G. Laporte. A tabu search heuristic for periodic and multi-depot routing. Networks, 30(2):105–119, 1997.",
  "M. Gendreau, A. Hertz, and G. Laporte. A tabu search heuristic for the vehicle routing problem. Management Science, 40(10):1276–1290, 1994.",
  "P. Toth and D. Vigo. The Vehicle Routing Problem. SIAM, Philadelphia, 2002.",
  "D. Pisinger. A general heuristic for vehicle routing problems. Computers & Operations Research, 34(8):2403–2435, 2007.",
];

test("splits year-ending entries, one per line, with 'and' and hyphenated initials", () => {
  const refs = R.splitReferences(yearLast.join("\n"));
  assert.equal(refs.length, 4);
  assert.match(refs[2], /^P\. Toth and D\. Vigo/);
  assert.match(refs[3], /^D\. Pisinger\./);
});

test("splits year-ending entries wrapped over several lines", () => {
  const section = [
    "J.-F. Cordeau and G. Laporte. A tabu search heuristic for periodic and",
    "multi-depot routing. Networks, 30(2):105–119, 1997.",
    "M. Gendreau, A. Hertz, and G. Laporte. A tabu search heuristic for the vehicle",
    "routing problem. Management Science, 40(10):1276–1290,",
    "1994.",
    "P. Toth and D. Vigo. The Vehicle Routing Problem. SIAM, Philadelphia, 2002.",
  ].join("\n");
  const refs = R.splitReferences(section);
  assert.equal(refs.length, 3);
  assert.match(refs[1], /1276–1290, 1994\.$/);
});

test("splits year-ending entries run together on one line", () => {
  const refs = R.splitReferences(yearLast.join(" "));
  assert.equal(refs.length, 4);
  assert.match(refs[0], /, 1997\.$/);
  assert.match(refs[1], /^M\. Gendreau, A\. Hertz/);
});

test("doesn't split APA entries after the year in parentheses", () => {
  const section = "Smith, J. (2019). A. B. testing of routing methods. J. Res., 1, 1–2.\nJones, B. (2018). An early study. J. Res., 2, 3–4.";
  const refs = R.splitReferences(section);
  assert.equal(refs.length, 2);
  assert.match(refs[0], /^Smith, J\. \(2019\)\. A\. B\. testing/);
});

test("splits year-ending entries whose first author has a multi-word surname", () => {
  const first = "T. Bektaş, T. G. Crainic, and T. Van Woensel. From Managing Urban Freight to Smart City Logistics Networks, volume 8 of Series on Computers and Operations Research, chapter 7, pages 143–188. World Scientific, 2017.";
  const second = "I. Ben Mohamed, W. Klibi, O. Labarthe, J.-C. Deschamps, and M. Z. Babai. Modelling and solution approaches for the interconnected city logistics. Int. J. Prod. Res., 55(9):2664–2684, 2017.";
  const third = "T. Van Woensel and J. Da Silva. A third paper on routing. Transp. Sci., 50(1):1–10, 2016.";
  for (const sep of [" ", "  ", "\n"]) {
    const refs = R.splitReferences([first, second, third].join(sep));
    assert.equal(refs.length, 3, JSON.stringify(sep));
    assert.match(refs[0], /World Scientific, 2017\.$/);
    assert.match(refs[1], /^I\. Ben Mohamed, W\. Klibi/);
    assert.match(refs[2], /^T\. Van Woensel and J\. Da Silva/);
  }
  // As copied from the PDF: lines wrapped in the middle of entries
  const wrapped = "T. Bektaş, T. G. Crainic, and T. Van Woensel. From Managing Urban Freight to Smart City\nLogistics Networks, volume 8 of Series on Computers and Operations Research, chapter 7, pages 143–188. World Scientific, 2017.\nI. Ben Mohamed, W. Klibi, O. Labarthe, J.-C. Deschamps, and M. Z. Babai. Modelling and\nsolution approaches for the interconnected city logistics. Int. J. Prod. Res., 55(9):2664–2684, 2017.";
  assert.equal(R.splitReferences(wrapped).length, 2);
});
