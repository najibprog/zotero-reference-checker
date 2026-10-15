// Loads content/refcheck.js outside Zotero, with a minimal Zotero stub
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function loadRefCheck(libraryItems = []) {
  const items = libraryItems.map((r, i) => ({
    id: r.id ?? i + 1,
    deleted: false,
    isRegularItem: () => true,
    getField: (name) => r[name] || "",
    getCreators: () => (r.lastName ? [{ lastName: r.lastName }] : []),
  }));
  const context = {
    Zotero: {
      debug() {},
      Libraries: { getAll: () => [{ libraryID: 1, libraryType: "user" }] },
      Items: { getAll: async () => items },
    },
  };
  vm.createContext(context);
  const source = readFileSync(new URL("../content/refcheck.js", import.meta.url), "utf8");
  vm.runInContext(source + "\nthis.RefCheck = RefCheck;", context);
  return context.RefCheck;
}

/** Fake page data in the shape getPageTexts() builds, one rectangle per character */
export function fakePage(text) {
  const n = text.length;
  return {
    text,
    charAt: [...Array(n).keys()],
    rects: [...Array(n).keys()].map((i) => [i, 0, i + 1, 10]),
    breaks: Array(n).fill(false),
  };
}
