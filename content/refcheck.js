/* global Zotero, Services */
/* eslint-disable no-unused-vars */

var HTML_NS = "http://www.w3.org/1999/xhtml";
var DOI_RE = /\b10\.\d{4,9}\/[^\s"<>]+/gi;
var PREF_SOURCE = "extensions.refcheck.source";
var PREF_ONLY_LIB = "extensions.refcheck.onlyInLibrary";
// Unnumbered section headings recognised on a line of their own
var SECTION_NAMES = new Set([
  "introduction", "background", "literature review", "review of the literature", "related work",
  "related literature", "related research", "prior research", "previous research", "state of the art",
  "theoretical background", "theoretical framework", "conceptual framework", "theory", "theory and hypotheses",
  "hypotheses", "hypothesis development", "hypotheses development", "research model",
  "methodology", "methods", "method", "materials and methods", "research method", "research methodology",
  "research design", "data", "data and methods", "data and methodology", "sample and data", "model",
  "problem description", "problem definition", "problem statement", "mathematical model", "formulation",
  "solution approach", "solution method", "case study", "analysis", "empirical analysis", "experiments",
  "numerical experiments", "computational experiments", "computational results", "results", "findings",
  "results and discussion", "discussion", "implications", "managerial implications", "practical implications",
  "theoretical implications", "limitations", "limitations and future research", "future research",
  "conclusion", "conclusions", "concluding remarks", "conclusion and future research",
  "conclusions and future research", "conclusions and perspectives",
  "introducción", "conclusión", "conclusiones", "revue de littérature", "revue de la littérature",
  "méthodologie", "résultats", "discussion et conclusion", "einleitung", "fazit",
]);

var PREF_ELS_KEY = "extensions.refcheck.elsevierApiKey";
var PREF_ELS_TOKEN = "extensions.refcheck.elsevierInstToken";
var PREF_CROSSREF_EMAIL = "extensions.refcheck.crossrefEmail";
var PREF_OPENALEX_KEY = "extensions.refcheck.openalexApiKey";
var PREF_CITEDBY_SORT = "extensions.refcheck.citedBySort";
var CITEDBY_PAGE_SIZE = 100;
// Publication types offered by the Type filter, in display order
var PUB_TYPES = ["Journal article", "Conference paper", "Book / chapter", "Thesis", "Report", "Preprint", "Other"];
var ITEM_TYPE_TO_PUB = {
  journalArticle: "Journal article", conferencePaper: "Conference paper", book: "Book / chapter",
  bookSection: "Book / chapter", thesis: "Thesis", report: "Report", preprint: "Preprint",
};
var CONFERENCE_RE = /\b(?:proceedings|proc\.|conference|symposium|workshop|congress|colloquium)\b/i;
// Journals shown before "More"
var TOP_JOURNALS = 8;
var HOMEPAGE = "https://github.com/najibprog/zotero-reference-checker";
// DOI prefixes used by Elsevier journals (ScienceDirect)
var ELSEVIER_PREFIXES = ["10.1016/", "10.1006/", "10.1053/", "10.1054/", "10.1067/", "10.1078/", "10.1383/", "10.1157/"];

// Headings that open a reference list (case-sensitive on purpose: the lowercase
// word "references" is common in body text)
var HEADINGS = [
  "References", "REFERENCES", "References and Notes", "REFERENCES AND NOTES",
  "References Cited", "REFERENCES CITED", "Reference List", "REFERENCE LIST",
  "Bibliography", "BIBLIOGRAPHY", "Works Cited", "WORKS CITED",
  "Literature Cited", "LITERATURE CITED",
  "Références", "RÉFÉRENCES", "Références bibliographiques", "RÉFÉRENCES BIBLIOGRAPHIQUES",
  "Bibliographie", "BIBLIOGRAPHIE", "Literaturverzeichnis", "LITERATURVERZEICHNIS",
  "Referencias", "REFERENCIAS", "Bibliografía", "BIBLIOGRAFÍA",
  "Riferimenti bibliografici", "RIFERIMENTI BIBLIOGRAFICI",
];

// First author written initials first: "J. Smith,", "J.-F. Cordeau and", "M. A. de Souza &", "D. Pisinger.",
// including surnames of several capitalised words: "I. Ben Mohamed,", "T. Van Woensel and"
var INITIALS_FIRST = "\\p{Lu}\\.(?:\\s?-?\\p{Lu}\\.)*\\s?(?:(?:van|von|de|der|den|da|di|du|le|la|dos|del)\\s)*"
  + "\\p{Lu}[\\p{L}'’\\-]+(?:\\s\\p{Lu}[\\p{L}'’\\-]+){0,2}(?:,|\\.|\\s+(?:and|&)\\s)";

// A line that looks like the start of a new reference entry
var REF_START_RE = new RegExp(
  "^(?:[•▪◦·\\-–]\\s*)?(?:"
    + "\\[\\d{1,3}\\]"                                             // [12]
    + "|\\d{1,3}[.)]\\s+\\S"                                       // 12. / 12)
    + "|\\p{Lu}[\\p{L}'’\\-]+(?:\\s(?:van|von|de|der|den|da|di|du|le|la|dos|del)(?=\\s))*"
    + "(?:\\s\\p{Lu}[\\p{L}'’\\-]+)?,\\s*(?:\\p{Lu}\\.|\\p{Lu}\\p{Ll}+)" // Smith, J. / Smith, John
    + "|" + INITIALS_FIRST                                         // J. Smith, / J.-F. Cordeau and
    + "|\\p{Lu}[\\p{L}'’\\-]+\\s(?:\\p{Lu}\\.\\s?)+[,(]"                // Smith J., / Smith J. A. (
  + ")",
  "u"
);

// Inline split points when several entries run together on one line: year-ending styles,
// APA/Harvard "…, 1–10. Smith, J." and Springer/Vancouver "…, 52:4351–4363 Smith AB, Jones C"
var INLINE_SPLIT_RES = [
  // Entries that end with their year: "…, 40(10):1276–1290, 1994. P. Toth and D. Vigo. …"
  new RegExp("(?<=[\\s,;:](?:1[89]|20)\\d{2}[a-z]?\\.)\\s+(?=" + INITIALS_FIRST + ")", "u"),
  new RegExp(
    // (not right after an initial: "M. Gendreau, A. Hertz" is one author list)
    "(?<=[.)\\]])(?<!(?:^|[\\s.\\-])\\p{Lu}\\.)\\s+(?=(?:\\d{1,3}\\.\\s+)?\\p{Lu}[\\p{L}'’\\-]+(?:\\s\\p{Lu}[\\p{L}'’\\-]+)?,\\s(?:\\p{Lu}\\.|\\p{Lu}\\p{Ll}+,))",
    "u"
  ),
  new RegExp(
    "(?<=[.)\\]\\d])\\s+(?=\\p{Lu}[\\p{L}'’\\-]+(?:\\s\\p{Lu}[\\p{Ll}'’\\-]+)?\\s\\p{Lu}{1,4}(?:-\\p{Lu})?(?:,\\s|\\s\\(\\d{4}))",
    "u"
  ),
];

var RefCheck = {
  id: null,
  version: null,
  rootURI: null,
  paneID: null,
  notifierID: null,
  windows: new Set(),

  _index: null,
  _indexPromise: null,
  _textCache: new Map(),
  _crossrefCache: new Map(),
  _citedByCache: new Map(),
  _openAlexIDs: new Map(),
  _lastProps: null,
  _waitingForConnector: false,
  _refreshTimer: null,

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    // Lets the preferences pane reach the plugin
    Zotero.RefCheck = this;
  },

  log(msg) {
    Zotero.debug("[Reference Checker] " + msg);
  },

  // ---------------------------------------------------------------------------
  // Window / registration
  // ---------------------------------------------------------------------------

  addToWindow(win) {
    let doc = win.document;
    win.MozXULElement.insertFTLIfNeeded("refcheck.ftl");
    if (!doc.getElementById("refcheck-stylesheet")) {
      let link = doc.createElementNS(HTML_NS, "link");
      link.id = "refcheck-stylesheet";
      link.rel = "stylesheet";
      link.href = this.rootURI + "content/refcheck.css";
      doc.documentElement.appendChild(link);
    }
    // A click on the "Back" side-bar icon returns to the article (Zotero would only scroll to the section)
    win.refcheckBackClick = (event) => {
      let hit = event.composedPath().some((n) => n.getAttribute?.("data-pane") === this.backPaneID && n.closest?.("item-pane-sidenav"));
      if (hit) this.goBack(win);
    };
    doc.addEventListener("click", win.refcheckBackClick, true);
    this.windows.add(win);
  },

  addToAllWindows() {
    for (let win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  removeFromWindow(win) {
    let doc = win.document;
    doc.getElementById("refcheck-stylesheet")?.remove();
    if (win.refcheckBackClick) doc.removeEventListener("click", win.refcheckBackClick, true);
    doc.querySelector('[href="refcheck.ftl"]')?.remove();
    this.windows.delete(win);
  },

  removeFromAllWindows() {
    for (let win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.removeFromWindow(win);
    }
  },

  /** Run one startup step; a failure is logged and doesn't stop the other steps */
  async step(name, fn) {
    try {
      await fn();
      this.log(`startup: ${name} OK`);
    }
    catch (e) {
      Zotero.logError(e);
      this.startupErrors.push(`${name}: ${e}\n${e.stack || ""}`);
    }
  },

  /** Append an error to reference-checker-errors.log in the Zotero data folder (kept small) */
  async logErrorToFile(context, e) {
    Zotero.logError(e);
    try {
      let path = PathUtils.join(Zotero.DataDirectory.dir, "reference-checker-errors.log");
      let old = (await IOUtils.exists(path)) ? await IOUtils.readUTF8(path) : "";
      let entry = `[${new Date().toISOString()}] ${this.version} ${context}: ${e}\n${e?.stack || ""}\n\n`;
      await IOUtils.writeUTF8(path, (old + entry).slice(-20000));
    }
    catch (_) {}
  },

  /** Only leave a log file in the Zotero data folder when startup went wrong */
  async writeStartupLog() {
    let path = PathUtils.join(Zotero.DataDirectory.dir, "reference-checker-startup.log");
    if (!this.startupErrors.length) {
      await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
      return;
    }
    let text = `Reference Checker ${this.version} — ${new Date().toISOString()}\n`
      + this.startupErrors.join("\n\n") + "\n";
    await IOUtils.writeUTF8(path, text).catch(() => {});
  },

  async register() {
    this.startupErrors = [];
    let icon = this.rootURI + "content/icons/icon.svg";

    await this.step("preferences pane", async () => {
      this.prefPaneID = await Zotero.PreferencePanes.register({
        pluginID: this.id,
        src: this.rootURI + "content/preferences.xhtml",
        label: "Reference Checker",
        image: icon,
      });
    });

    await this.step("item pane section", () => {
      this.paneID = Zotero.ItemPaneManager.registerSection({
        paneID: "refcheck-references",
        pluginID: this.id,
        header: { l10nID: "refcheck-section-header", icon },
        sidenav: { l10nID: "refcheck-section-sidenav", icon },
        sectionButtons: [
          {
            type: "rescan",
            icon: "chrome://zotero/skin/16/universal/refresh.svg",
            l10nID: "refcheck-rescan",
            onClick: (props) => {
              this._index = null;
              this.renderSection(props, { force: true });
            },
          },
        ],
        onItemChange: ({ item, setEnabled }) => {
          setEnabled(this.isEligible(item));
          return true;
        },
        onRender: () => {},
        onAsyncRender: async (props) => {
          await this.renderSection(props, {});
        },
      });
      if (!this.paneID) throw new Error("registerSection returned false (invalid options)");
    });

    await this.step("back section", () => {
      // Temporary side-bar icon below ours, shown after "Show" / "Open PDF" to return to the article
      this.backPaneID = Zotero.ItemPaneManager.registerSection({
        paneID: "refcheck-back",
        pluginID: this.id,
        header: { l10nID: "refcheck-back-header", icon: this.rootURI + "content/icons/back.svg" },
        sidenav: { l10nID: "refcheck-back-sidenav", icon: this.rootURI + "content/icons/back.svg" },
        onItemChange: ({ item, setEnabled }) => {
          setEnabled(!!(this._focus?.away && item && item.id !== this._focus.itemID));
          return true;
        },
        onRender: ({ body }) => this.renderBackSection(body),
      });
    });

    await this.step("notifier", () => {
      this.notifierID = Zotero.Notifier.registerObserver(
        {
          notify: (event, type, ids) => {
            // Annotations are items too; creating them while reading shouldn't rebuild the index
            let onlyAnnotations = ids.every((id) => Zotero.Items.get(id)?.isAnnotation?.());
            if (!onlyAnnotations && ["add", "modify", "delete", "trash", "refresh"].includes(event)) {
              this._index = null;
              if (event === "add" || event === "modify") this.scheduleRefresh();
            }
          },
        },
        ["item"],
        "refcheck"
      );
    });

    await this.step("tab notifier", () => {
      // Back in the reader after "Show" or "Open PDF": scroll the panel to the row used
      this.tabNotifierID = Zotero.Notifier.registerObserver(
        {
          notify: (event, type, ids) => {
            let f = this._focus;
            if (!f || !f.body.isConnected) return;
            let win = f.body.ownerDocument.defaultView;
            if (event === "select" && (ids?.[0] ?? win.Zotero_Tabs?.selectedID) === f.tabID) {
              // Back on the article: no more "Back to" buttons, scroll to the row used
              f.away = false;
              win.setTimeout(() => {
                let list = f.body.querySelector(".refcheck-view .refcheck-list");
                if (list && f.body.refcheckSection?.value !== "citedby") this.restoreRow(f.body, f.itemID, list);
              }, 400);
            }
            // The other tab's panel may not re-render (item already shown), so add the button now and once it has
            this.updateBackButtons(win.document);
            win.setTimeout(() => this.updateBackButtons(win.document), 400);
          },
        },
        ["tab"],
        "refcheck-tabs"
      );
    });

    await this.step("reader popup", () => {
      Zotero.Reader.registerEventListener(
        "renderTextSelectionPopup",
        (event) => this.onTextSelectionPopup(event),
        this.id
      );
    });
  },

  unregister() {
    if (this.paneID) {
      Zotero.ItemPaneManager.unregisterSection(this.paneID);
      this.paneID = null;
    }
    if (this.backPaneID) {
      Zotero.ItemPaneManager.unregisterSection(this.backPaneID);
      this.backPaneID = null;
    }
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }
    if (this.tabNotifierID) {
      Zotero.Notifier.unregisterObserver(this.tabNotifierID);
      this.tabNotifierID = null;
    }
    // Reader listeners are removed automatically by plugin ID on shutdown,
    // but do it explicitly in case of a reload without restart
    Zotero.Reader._unregisterEventListenerByPluginID?.(this.id);
    if (this.prefPaneID) {
      Zotero.PreferencePanes.unregister(this.prefPaneID);
      this.prefPaneID = null;
    }
    delete Zotero.RefCheck;
  },

  isEligible(item) {
    if (!item) return false;
    if (item.isRegularItem()) return true;
    return item.isAttachment() && (item.isPDFAttachment() || item.isEPUBAttachment?.() || item.isSnapshotAttachment?.());
  },

  // ---------------------------------------------------------------------------
  // Library index
  // ---------------------------------------------------------------------------

  async getIndex() {
    if (this._index) return this._index;
    if (!this._indexPromise) {
      this._indexPromise = this._buildIndex().finally(() => {
        this._indexPromise = null;
      });
    }
    this._index = await this._indexPromise;
    return this._index;
  },

  async _buildIndex() {
    let t = Date.now();
    let entries = [];
    let byDOI = new Map();
    let byTitle = new Map();
    for (let library of Zotero.Libraries.getAll()) {
      if (library.libraryType === "feed") continue;
      let items = await Zotero.Items.getAll(library.libraryID, true, false);
      for (let item of items) {
        if (!item.isRegularItem()) continue;
        let title = this.field(item, "title");
        let ctitle = this.compact(title);
        let doi = this.cleanDOI(this.field(item, "DOI"))
          || this.cleanDOI((this.field(item, "extra").match(/^DOI:\s*(\S+)/im) || [])[1])
          || this.cleanDOI(this.field(item, "url"));
        if (ctitle.length < 10 && !doi) continue;
        let creator = item.getCreators()[0];
        let entry = {
          id: item.id,
          title,
          ctitle,
          doi,
          cdoi: doi ? this.compact(doi) : "",
          cauthor: creator ? this.compact(creator.lastName || creator.firstName || "") : "",
          author: creator ? (creator.lastName || creator.firstName || "") : "",
          year: (this.field(item, "date").match(/\d{4}/) || [""])[0],
        };
        entries.push(entry);
        if (doi) {
          if (!byDOI.has(doi)) byDOI.set(doi, []);
          byDOI.get(doi).push(entry);
        }
        if (ctitle.length >= 10) {
          if (!byTitle.has(ctitle)) byTitle.set(ctitle, []);
          byTitle.get(ctitle).push(entry);
        }
      }
    }
    this.log(`Indexed ${entries.length} items in ${Date.now() - t} ms`);
    return { entries, byDOI, byTitle };
  },

  field(item, name) {
    try {
      return item.getField(name) || "";
    }
    catch (e) {
      return "";
    }
  },

  compact(s) {
    return (s || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  },

  cleanDOI(s) {
    if (!s) return "";
    let m = String(s).match(/10\.\d{4,9}\/[^\s"<>]+/i);
    if (!m) return "";
    return m[0].replace(/[.,;:)\]}>]+$/, "").toLowerCase();
  },

  /**
   * Find the library entry cited by a piece of reference text.
   * @returns {{ entry, how } | null}
   */
  matchText(text, index, excludeIDs, { doi, title } = {}) {
    let isExcluded = (e) => excludeIDs.has(e.id);
    let firstAllowed = (list) => list && list.find((e) => !isExcluded(e));

    let dois = [];
    if (doi) dois.push(this.cleanDOI(doi));
    for (let m of (text || "").matchAll(DOI_RE)) dois.push(this.cleanDOI(m[0]));
    for (let d of dois) {
      let e = firstAllowed(index.byDOI.get(d));
      if (e) return { entry: e, how: "DOI" };
    }

    if (title) {
      let e = firstAllowed(index.byTitle.get(this.compact(title)));
      if (e) return { entry: e, how: "title" };
    }

    let compact = this.compact((text || "") + " " + (title || ""));
    if (compact.length < 10) return null;
    let best = null;
    for (let e of index.entries) {
      if (isExcluded(e)) continue;
      if (e.cdoi && e.cdoi.length >= 10 && compact.includes(e.cdoi)) {
        return { entry: e, how: "DOI" };
      }
      if (e.ctitle.length < 10 || !compact.includes(e.ctitle)) continue;
      // Short titles are only trusted when the first author's name is present too
      if (e.ctitle.length < 25 && (!e.cauthor || !compact.includes(e.cauthor))) continue;
      if (!best || e.ctitle.length > best.ctitle.length) best = e;
    }
    return best ? { entry: best, how: "title" } : null;
  },

  /** All library entries whose title/DOI appears in a block of text */
  matchAllInText(text, index, excludeIDs) {
    let compact = this.compact(text);
    let found = [];
    let seen = new Set();
    for (let e of index.entries) {
      if (excludeIDs.has(e.id)) continue;
      let pos = -1;
      if (e.cdoi && e.cdoi.length >= 10) pos = compact.indexOf(e.cdoi);
      if (pos < 0 && e.ctitle.length >= 25) pos = compact.indexOf(e.ctitle);
      if (pos < 0) continue;
      let key = e.doi || e.ctitle;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ pos, entry: e });
    }
    return found.sort((a, b) => a.pos - b.pos).map((x) => x.entry);
  },

  /** Pick the best copy of a matched work (duplicates may exist) and see if it has a file */
  async resolveStatus(entry, index) {
    let candidates = new Set([entry]);
    for (let e of index.byDOI.get(entry.doi) || []) candidates.add(e);
    for (let e of index.byTitle.get(entry.ctitle) || []) candidates.add(e);
    let first = null;
    for (let e of candidates) {
      let item = Zotero.Items.get(e.id);
      if (!item || item.deleted) continue;
      first = first || item;
      let att = await item.getBestAttachment();
      if (att && await att.fileExists()) {
        return { item, attachment: att };
      }
    }
    return first ? { item: first, attachment: null } : null;
  },

  // ---------------------------------------------------------------------------
  // Getting the references of the current article
  // ---------------------------------------------------------------------------

  /** Resolve the regular (parent) item and the attachment whose text we read */
  async resolveTarget(item, tabType) {
    let attachment = null;
    let parent = null;
    if (tabType === "reader") {
      let win = Zotero.getMainWindow();
      let reader = win && Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
      if (reader) {
        let readerItem = Zotero.Items.get(reader.itemID);
        if (readerItem && (readerItem.id === item.id || readerItem.parentItemID === item.id)) {
          attachment = readerItem;
        }
      }
    }
    if (item.isRegularItem()) {
      parent = item;
      if (!attachment) {
        let best = await item.getBestAttachment();
        if (best && await best.fileExists()) attachment = best;
      }
    }
    else if (item.isAttachment()) {
      attachment = attachment || item;
      parent = item.parentItem || null;
    }
    return { parent, attachment };
  },

  async getAttachmentText(attachment) {
    if (this._textCache.has(attachment.id)) return this._textCache.get(attachment.id);
    let text = "";
    if (attachment.isPDFAttachment()) {
      try {
        ({ text } = await Zotero.PDFWorker.getFullText(attachment.id, null, true));
      }
      catch (e) {
        this.log("PDFWorker failed, falling back to attachmentText: " + e);
      }
    }
    if (!text) {
      text = (await attachment.attachmentText) || "";
    }
    if (this._textCache.size > 20) this._textCache.delete(this._textCache.keys().next().value);
    this._textCache.set(attachment.id, text);
    return text;
  },

  extractReferenceSection(text) {
    let best = -1;
    let headingLength = 0;
    for (let h of HEADINGS) {
      let re = new RegExp(
        "(?:^|[\\n.!?]\\s*|\\s{2,}|\\d\\s+)" + h.replace(/ /g, "\\s+") + "\\s*(?::|\\n|(?=\\[?\\d|\\p{Lu}))",
        "gu"
      );
      for (let m of text.matchAll(re)) {
        if (m.index > best) {
          best = m.index;
          headingLength = m[0].length;
        }
      }
    }
    // Ignore a "References" heading that sits in the first third (table of contents, etc.)
    if (best >= 0 && best > text.length * 0.3) {
      return { section: text.slice(best + headingLength), found: true, start: best };
    }
    let start = Math.floor(text.length * 0.65);
    return { section: text.slice(start), found: false, start };
  },

  /**
   * Find the top-level sections of the article body.
   * Numbered headings ("2. Literature review", "II. METHOD") are used when at least 3 follow
   * each other in order; otherwise well-known heading names on a line of their own.
   * @returns {{ title: string, start: number, end: number }[]}
   */
  detectSections(body) {
    let lines = [];
    let re = /[^\n]+/g;
    let m;
    while ((m = re.exec(body))) lines.push({ text: m[0].trim(), pos: m.index });

    let roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
    let looksLikeTitle = (t) => t.length >= 3 && t.length <= 90 && !/[.:;,]$/.test(t)
      && t.split(/\s+/).length <= 12 && !/^(?:Fig|Figure|Table|Tab|Eq|Algorithm)\b/i.test(t)
      && (t.match(/\d/g) || []).length <= 3 && /\p{L}{3}/u.test(t);

    let numbered = [];
    let expected = 1;
    for (let line of lines) {
      let nm = line.text.match(/^(\d{1,2})\.?\s+(\p{Lu}.*)$/u)
        || line.text.match(/^([IVX]{1,4})\.\s+(\p{Lu}.*)$/u);
      if (!nm) continue;
      let n = /^\d/.test(nm[1]) ? parseInt(nm[1]) : roman[nm[1]];
      if (n === expected && looksLikeTitle(nm[2])) {
        numbered.push({ title: `${nm[1]}. ${nm[2]}`, pos: line.pos });
        expected++;
      }
    }

    let headings = numbered;
    if (numbered.length < 3) {
      headings = lines
        .filter((l) => l.text.length <= 60 && SECTION_NAMES.has(l.text.replace(/[:.]$/, "").replace(/^\d{1,2}\.?\s+/, "").toLowerCase()))
        .map((l) => ({ title: l.text.replace(/[:.]$/, ""), pos: l.pos }));
      // Keep the first occurrence of each name (later ones are usually running headers)
      let seen = new Set();
      headings = headings.filter((h) => !seen.has(h.title.toLowerCase()) && seen.add(h.title.toLowerCase()));
    }
    return headings.map((h, i) => ({
      title: h.title.replace(/\s+/g, " "),
      start: h.pos,
      end: i + 1 < headings.length ? headings[i + 1].pos : body.length,
    }));
  },

  /** Number, first-author surname and year of a reference, for finding its in-text citations */
  citationKey(ref, index) {
    let text = (ref.text || "").trim();
    let num = null;
    let nm = text.match(/^\[(\d{1,3})\]|^(\d{1,3})[.)]\s/);
    if (nm) num = parseInt(nm[1] || nm[2]);

    let source = ref.author || text.replace(/^(?:\[\d{1,3}\]|\d{1,3}[.)])\s*/, "").replace(/^[•▪◦·\-–]\s*/, "");
    let words = source.match(/[\p{L}'’\-]+/gu) || [];
    // Author fields from Crossref may put the initials first: "ZC Yin", "J. Smith", "J.-F. Cordeau"
    if (ref.author) {
      let names = words.filter((w) => !/^-?(?:\p{Lu}-?){1,3}$/u.test(w));
      if (names.length) words = names;
    }
    let particles = ["van", "von", "de", "der", "den", "da", "di", "du", "le", "la", "dos", "del", "ten", "ter"];
    let surname = words[0] || "";
    if (particles.includes(surname.toLowerCase()) && words[1]) {
      surname = words[1];
    }
    let year = String(ref.year || (text.match(/\b(?:1[89]|20)\d{2}[a-z]?\b/) || [""])[0]);
    return { num: num || index + 1, surname: surname.length >= 2 ? surname : "", year };
  },

  /**
   * Citation key of every row, and the article's citation style: author–year, or numeric
   * with numbers in brackets [3], in parentheses (3) or as superscripts (routing3,4).
   * @returns {{ useNumeric: boolean, numStyle: "bracket"|"paren"|"super", byNum: Map }}
   */
  citationInfo(rows, body) {
    rows.forEach((row, i) => { row.key = this.citationKey(row.ref, i); });
    // Decide the style by which one actually locates more references:
    // brackets like [0, 1] in formulas must not make an author–year paper look numeric
    let flat = this.searchable(body.replace(/\s+/g, " ")).s;
    let byAuthorYear = rows.filter((row) => this.authorYearRegex(row.key)?.test(flat)).length;
    let best = { style: "bracket", count: 0 };
    for (let style of ["bracket", "paren", "super"]) {
      let cited = new Set();
      for (let c of this.numericCitations(flat, style)) {
        for (let n of c.nums) if (n <= rows.length) cited.add(n);
      }
      // Parentheses and superscripts are also used for equations and formulas: ask for more evidence
      let needed = style === "bracket" ? 0 : Math.max(3, rows.length * 0.3);
      if (cited.size > best.count && cited.size >= needed) best = { style, count: cited.size };
    }
    return {
      useNumeric: best.count > byAuthorYear,
      numStyle: best.style,
      byNum: new Map(rows.map((row, i) => [row.key.num, i])),
    };
  },

  /**
   * Numeric citations in a text, in one style.
   * @param {"bracket"|"paren"|"super"} style - "[3, 5–7]", "(3, 5–7)", or superscripts read as
   *   digits right after a word or punctuation: "routing3,5–7 and", "studied.12"
   * @returns {{ index, end, nums: number[] }[]}
   */
  numericCitations(text, style = "bracket") {
    let list = "(\\d{1,3}(?:\\s*[–\\-,;]\\s*\\d{1,3})*)";
    let re = style === "paren" ? new RegExp(`\\(${list}\\)`, "g")
      : style === "super" ? /(?<=\p{Ll}{2}[.,;:)]?|\p{Ll}[.,;:)])(\d{1,3}(?:[–\-,]\d{1,3})*)(?=[\s.,;:)]|$)/gu
        : new RegExp(`\\[${list}\\]`, "g");
    let found = [];
    for (let m of text.matchAll(re)) {
      found.push({ index: m.index, end: m.index + m[0].length, nums: this.bracketNumbers(m[1]) });
    }
    return found;
  },

  /**
   * Text prepared for matching names: accents removed, and the detached accents PDFs
   * often produce ("Mladenovi ́c", "Ro ̈pke") dropped. map[k] = index in the original text.
   */
  searchable(text) {
    let accent = /[\u0300-\u036f\u02b0-\u02ff\u00a8\u00b4\u00b8]/;
    let s = "";
    let map = [];
    for (let i = 0; i < text.length; i++) {
      let ch = text[i];
      if (accent.test(ch) || (ch === " " && accent.test(text[i + 1] || ""))) continue;
      let base = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      for (let k = 0; k < base.length; k++) {
        s += base[k];
        map.push(i);
      }
    }
    return { s, map };
  },

  /** Numbers cited by a bracket group: "[2–4, 7]" → [2, 3, 4, 7] */
  bracketNumbers(inner) {
    let nums = [];
    for (let part of inner.split(/[,;]/)) {
      let [a, b] = part.split(/[–\-]/).map((x) => parseInt(x));
      if (isNaN(a)) continue;
      if (isNaN(b) || b < a || b - a > 50) b = a;
      for (let n = a; n <= b; n++) nums.push(n);
    }
    return nums;
  },

  /** Regex for an author–year citation: surname followed by its year within a short distance */
  /**
   * Regex for an author–year citation in searchable() text: the first author's surname followed
   * by the year, e.g. "Smith (2019)", "Smith et al. (2019)", "Smith et al., 2019", "Smith et al. 2019",
   * "(Smith and Jones, 2018)", "Smith et al. (2019a, 2020)", "Smith (2019, p. 4)"
   */
  authorYearRegex(key, flags = "u") {
    let sur = this.surnamePattern(key);
    if (!sur || !key.year) return null;
    let yearRe = /[a-z]$/.test(key.year) ? key.year : key.year + "(?![a-z])";
    return new RegExp(`${sur}[^()\\[\\]]{0,70}?\\(?[^()\\[\\]]{0,30}?${yearRe}`, flags);
  },

  /** Weaker fallback without the year: "Smith et al.", "Smith and Jones", "Smith & Lee", "Smith’s" */
  etAlRegex(key, flags = "u") {
    let sur = this.surnamePattern(key);
    if (!sur) return null;
    return new RegExp(`${sur}(?:\\s*et\\s*al\\.?|\\s+(?:and|&)\\s+\\p{Lu}[\\p{L}'’\\-]+|['’]s\\b)`, flags);
  },

  surnamePattern(key) {
    if (!key.surname) return null;
    let sur = this.searchable(key.surname).s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `(?<![\\p{L}])${sur}(?![\\p{L}])`;
  },

  /**
   * For every reference, the set of sections where it is cited.
   * Handles numeric citations ([3], [2–5], [1, 4]) and author–year citations
   * (Smith et al., 2019 / Smith and Jones (2018)).
   */
  assignSections(rows, body, sections, info) {
    let flat = this.searchable(body.replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2").replace(/\s+/g, " ")).s;
    // Section offsets shift slightly after flattening; rescale them
    let scale = flat.length / Math.max(1, body.length);
    let regexes = info.useNumeric ? [] : rows.map((row) => this.authorYearRegex(row.key, "gu"));

    // row.citeCounts: number of citations of the reference in each section
    rows.forEach((row) => {
      row.sections = new Set();
      row.citeCounts = new Map();
    });
    let count = (i, si) => {
      rows[i].sections.add(si);
      rows[i].citeCounts.set(si, (rows[i].citeCounts.get(si) || 0) + 1);
    };
    sections.forEach((sec, si) => {
      let text = flat.slice(Math.floor(sec.start * scale), Math.ceil(sec.end * scale));
      if (info.useNumeric) {
        for (let c of this.numericCitations(text, info.numStyle)) {
          for (let n of new Set(c.nums)) {
            let i = info.byNum.get(n);
            if (i !== undefined) count(i, si);
          }
        }
        return;
      }
      regexes.forEach((re, i) => {
        if (!re) return;
        for (let _ of text.matchAll(re)) count(i, si);
      });
    });
  },

  /**
   * Rows cited in a piece of selected text: its citations ([3], [2–5], Smith et al., 2019),
   * or, for a selected entry of the reference list, the reference whose DOI/title/text it holds.
   * @returns {Set<number>} row indexes
   */
  rowsCitedIn(rows, text) {
    let found = new Set();
    let flat = this.searchable((text || "").replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2").replace(/\s+/g, " ")).s;
    let numeric = rows.find((row) => row.useNumeric);
    if (numeric) {
      let byNum = new Map(rows.map((row, i) => [row.key?.num, i]));
      for (let c of this.numericCitations(flat, numeric.numStyle)) {
        for (let n of c.nums) {
          if (byNum.has(n)) found.add(byNum.get(n));
        }
      }
    }
    else {
      rows.forEach((row, i) => {
        if (row.key && this.authorYearRegex(row.key)?.test(flat)) found.add(i);
      });
    }
    if (found.size) return found;

    let compact = this.compact(text);
    rows.forEach((row, i) => {
      let doi = row.ref.doi || row.match?.entry.doi;
      let title = this.compact(row.ref.title || row.match?.entry.title);
      if ((doi && compact.includes(this.compact(doi))) || (title.length >= 20 && compact.includes(title))) found.add(i);
    });
    // References read from the PDF have no separate title: the selection is part of the entry
    if (!found.size && compact.length >= 30) {
      rows.forEach((row, i) => {
        if (this.compact(row.ref.text).includes(compact)) found.add(i);
      });
    }
    return found;
  },

  // ---------------------------------------------------------------------------
  // Jumping to a reference in the open PDF
  // ---------------------------------------------------------------------------

  /**
   * Text of every PDF page, with the rectangle of each character, cached per reader.
   * Uses getPageData() from Zotero's own pdf.js build (the same data its search uses).
   */
  async getPageTexts(reader) {
    if (reader._refcheckPages) return reader._refcheckPages;
    await reader._initPromise;
    let internal = reader._internalReader;
    let view = internal?._primaryView || internal?._lastView;
    await view?.initializedPromise;
    let viewWin = view?._iframeWindow;
    let pdf = viewWin?.PDFViewerApplication?.pdfDocument;
    if (!pdf) throw new Error("This document isn't a PDF, or it isn't loaded yet");
    if (typeof pdf.getPageData !== "function") throw new Error("Unsupported Zotero reader version (no getPageData)");

    let pages = [];
    let failures = [];
    for (let p = 0; p < pdf.numPages; p++) {
      let chars = [];
      try {
        // Arguments must be cloned into the viewer's compartment, or it can't read them
        let args = Components.utils.cloneInto({ pageIndex: p }, viewWin);
        chars = (await pdf.getPageData(args))?.chars || [];
      }
      catch (e) {
        failures.push(`page ${p}: ${e}`);
      }
      // text[k] comes from charAt[k]; whitespace between words/lines maps to the previous char
      let text = "";
      let charAt = [];
      let rects = [];
      let breaks = [];
      for (let i = 0; i < chars.length; i++) {
        let c = chars[i];
        let u = String(c.u ?? c.c ?? "");
        let r = c.rect;
        rects.push(r ? [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])] : null);
        breaks.push(!!(c.lineBreakAfter || c.paragraphBreakAfter));
        for (let k = 0; k < u.length; k++) charAt.push(i);
        text += u;
        if (c.spaceAfter || c.lineBreakAfter || c.paragraphBreakAfter) {
          text += " ";
          charAt.push(i);
        }
      }
      pages.push({ text, charAt, rects, breaks });
    }

    if (!pages.some((page) => page.text.trim())) {
      throw new Error(`No text could be read from the PDF pages (${failures.slice(0, 3).join("; ") || "pages are empty"})`);
    }

    // Where the reference list starts: the last References/Bibliography heading
    let refsAt = null;
    for (let p = pages.length - 1; p >= 0 && !refsAt; p--) {
      for (let h of HEADINGS) {
        let idx = pages[p].text.lastIndexOf(h);
        if (idx >= 0 && (!refsAt || idx > refsAt.offset)) refsAt = { page: p, offset: idx };
      }
    }
    reader._refcheckPages = { pages, refsAt };
    return reader._refcheckPages;
  },

  /** Rectangles (one per line) covering text offsets [start, end) of a page */
  rectsFor(page, start, end) {
    let first = page.charAt[start];
    let last = page.charAt[Math.max(start, end - 1)];
    if (first === undefined || last === undefined) return [];
    let rects = [];
    let cur = null;
    for (let i = first; i <= last; i++) {
      let r = page.rects[i];
      if (r) {
        cur = cur ? [Math.min(cur[0], r[0]), Math.min(cur[1], r[1]), Math.max(cur[2], r[2]), Math.max(cur[3], r[3])] : [...r];
      }
      if ((page.breaks[i] || i === last) && cur) {
        rects.push(cur);
        cur = null;
      }
    }
    return rects;
  },

  /**
   * Places in the PDF where a reference appears.
   * @param {"citation"|"entry"} what - in-text citations (body) or its entry in the reference list
   * @param {object} ref - { key, useNumeric, numStyle, title, doi } of the row
   * @returns {{ pageIndex, rects, pos }[]} pos orders hits through the whole document
   */
  findInPDF(data, ref, what) {
    let { pages, refsAt } = data;
    let { key, useNumeric, numStyle } = ref;
    let inBody = (p, offset) => !refsAt || p < refsAt.page || (p === refsAt.page && offset < refsAt.offset);
    let starts = this.pageStarts(data);

    // Matches of one method over all pages; name and title methods search the accent-free text
    let search = (method) => {
      let found = [];
      pages.forEach((page, p) => {
        page.norm ||= this.searchable(page.text);
        let hits = [];
        let collect = (re, onNorm) => {
          if (!re) return;
          let text = onNorm ? page.norm.s : page.text;
          for (let m of text.matchAll(re)) {
            let a = m.index;
            let b = m.index + m[0].length;
            if (onNorm) {
              a = page.norm.map[a];
              b = page.norm.map[b - 1] + 1;
            }
            hits.push([a, b]);
          }
        };
        if (method === "numeric") {
          if (what === "citation") {
            for (let c of this.numericCitations(page.text, numStyle)) {
              if (c.nums.includes(key.num)) hits.push([c.index, c.end]);
            }
          }
          else {
            collect(new RegExp(`\\[${key.num}\\]`, "g"));
            collect(new RegExp(`(?<![\\d.])${key.num}\\.\\s+\\p{Lu}`, "gu"));
          }
        }
        else if (method === "authorYear") collect(this.authorYearRegex(key, "gu"), true);
        else if (method === "etAl") collect(this.etAlRegex(key, "gu"), true);
        else if (method === "title") collect(this.titleRegex(ref.title), true);
        else if (method === "doi" && ref.doi) {
          collect(new RegExp(ref.doi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "\\/\\s*"), "gi"));
        }
        // "(?<![\d.])12 Smith" — numbered lists without a dot or bracket
        else if (method === "bareNumber") collect(new RegExp(`(?<![\\d.,:;–\\-])${key.num}\\s+\\p{Lu}\\p{L}`, "gu"));

        hits = hits.filter(([a]) => (what === "citation" ? inBody(p, a) : !inBody(p, a)));
        for (let [a, b] of hits) {
          let rects = this.rectsFor(page, a, b);
          if (rects.length) found.push({ pageIndex: p, rects, pos: starts[p] + a });
        }
      });
      return found;
    };

    // Most likely style first, then the other one, then the name without a year.
    // For the list entry, its title or DOI is the surest sign; numbers and names come after.
    let methods = useNumeric ? ["numeric", "authorYear"] : ["authorYear", "numeric"];
    if (what === "citation") methods.push("etAl");
    else methods = ["title", "doi", ...methods, "bareNumber"];
    for (let method of methods) {
      if (["numeric", "bareNumber"].includes(method) && !key?.num) continue;
      if (["authorYear", "etAl"].includes(method) && !key) continue;
      let found = search(method);
      if (found.length) return what === "entry" ? found.slice(0, 1) : found;
    }
    return [];
  },

  /** Regex for the first words of a title, across line breaks and hyphenation, in searchable() text */
  titleRegex(title) {
    let words = this.searchable(title || "").s.match(/[\p{L}\p{N}]+/gu) || [];
    if (words.join("").length < 15) return null;
    let pattern = words.slice(0, 8).map((w) => w.split("").map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("-?\\s?"))
      .join("[^\\p{L}\\p{N}]{1,4}");
    return new RegExp(pattern, "giu");
  },

  /** Offset of each page's text in the whole document, to order hits and sections */
  pageStarts(data) {
    if (!data.starts) {
      let pos = 0;
      data.starts = data.pages.map((page) => {
        let start = pos;
        pos += page.text.length + 1;
        return start;
      });
    }
    return data.starts;
  },

  /**
   * Where each detected section starts in the PDF (same order as `sections`), found by its
   * heading; null for a heading that can't be found. Cached per set of headings.
   */
  sectionStartsInPDF(data, sections) {
    let cacheKey = sections.map((s) => s.title).join("\n");
    if (data.sectionStarts?.key === cacheKey) return data.sectionStarts.value;
    let starts = this.pageStarts(data);
    let after = { p: 0, offset: 0 };
    let value = sections.map((sec) => {
      // "2. Literature review" may be printed "2 Literature review" or "2.Literature review"
      let words = this.searchable(sec.title).s.replace(/^(\d{1,2}|[IVX]{1,4})\.\s*/, "").match(/[\p{L}\p{N}]+/gu) || [];
      let num = (sec.title.match(/^(\d{1,2}|[IVX]{1,4})\./) || [])[1];
      if (!words.length) return null;
      let re = new RegExp((num ? `(?<![\\p{L}\\p{N}.])${num}\\.?\\s*` : "") + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]{1,3}"), "gu");
      for (let p = after.p; p < data.pages.length; p++) {
        let page = data.pages[p];
        page.norm ||= this.searchable(page.text);
        re.lastIndex = 0;
        for (let m of page.norm.s.matchAll(re)) {
          let offset = page.norm.map[m.index];
          if (p === after.p && offset < after.offset) continue;
          after = { p, offset: offset + 1 };
          return starts[p] + offset;
        }
      }
      return null;
    });
    data.sectionStarts = { key: cacheKey, value };
    return value;
  },

  /** Hits of a citation search that fall in one section (all hits when the section can't be placed) */
  hitsInSection(data, hits, sections, si) {
    let starts = this.sectionStartsInPDF(data, sections);
    let start = starts[si];
    if (start == null) return hits;
    let end = starts.slice(si + 1).find((x) => x != null) ?? Infinity;
    return hits.filter((h) => h.pos >= start && h.pos < end);
  },

  /**
   * Button handler: go to the next place where this reference appears. With a section chosen,
   * only its citations in that section are visited. The button then shows "2/3".
   */
  async jumpTo(row, what, button, label) {
    let win = Zotero.getMainWindow();
    let reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
    if (!reader) return;
    let section = what === "citation" ? row.currentSection?.() : null;
    let si = section != null && /^\d+$/.test(section) ? parseInt(section) : null;
    let cacheKey = what + (si === null ? "" : "|" + si);
    try {
      row.hits ||= {};
      row.hitIndex ||= {};
      if (!row.hits[cacheKey]) {
        button.textContent = "Searching…";
        let data = await this.getPageTexts(reader);
        let all = row.hits[what] || this.findInPDF(data, {
          key: row.key, useNumeric: row.useNumeric, numStyle: row.numStyle,
          title: row.ref.title || row.match?.entry.title || "", doi: row.ref.doi || row.match?.entry.doi || "",
        }, what);
        row.hits[what] = all;
        row.hits[cacheKey] = si === null ? all : this.hitsInSection(data, all, row.sectionList || [], si);
        row.hitIndex[cacheKey] = -1;
      }
      let hits = row.hits[cacheKey];
      if (!hits.length) {
        // Diagnostic for unsupported layouts: what was searched and what the page text looks like
        let data = reader._refcheckPages;
        let mid = data?.pages[Math.floor(data.pages.length / 2)];
        this.logErrorToFile(`not found (${what})`, new Error(JSON.stringify({
          key: row.key, useNumeric: row.useNumeric, numStyle: row.numStyle, title: row.ref.title, pages: data?.pages.length,
          refsAt: data?.refsAt, sample: mid?.text.slice(0, 300),
        })));
        button.textContent = what === "citation" ? "Citation not found" : "Entry not found";
        return;
      }
      row.hitIndex[cacheKey] = (row.hitIndex[cacheKey] + 1) % hits.length;
      let hit = hits[row.hitIndex[cacheKey]];
      await reader.navigate({ position: { pageIndex: hit.pageIndex, rects: hit.rects } });
      button.textContent = what === "citation" ? `${label} ${row.hitIndex[cacheKey] + 1}/${hits.length} ›` : label;
    }
    catch (e) {
      this.logErrorToFile(`jumpTo(${what})`, e);
      button.textContent = "Unavailable";
      button.title = String(e.message || e);
    }
  },

  splitReferences(section) {
    let text = section.replace(/\r\n?/g, "\n").replace(/\u00ad/g, "");
    let parts = this.splitNumbered(text);
    let numbered = !!parts;

    if (!parts) {
      let lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        parts = [];
        let cur = "";
        for (let line of lines) {
          let prevEnds = /(?:[.)\]]|\d|\/\S+)\s*$/.test(cur);
          if (cur && prevEnds && REF_START_RE.test(line)) {
            parts.push(cur);
            cur = line;
          }
          else {
            cur = cur ? this.joinLine(cur, line) : line;
          }
        }
        if (cur) parts.push(cur);
      }
      else {
        parts = [text];
      }
      // Lines/paragraphs may still hold several entries run together
      for (let re of INLINE_SPLIT_RES) {
        parts = parts.flatMap((p) => p.split(re));
      }
    }

    let refs = [];
    for (let p of parts) {
      p = p.replace(/\s*\n\s*/g, " ").replace(/(\p{Ll})- (\p{Ll})/gu, "$1$2").replace(/\s+/g, " ").trim();
      if (!p) continue;
      if (!numbered && p.length < 40 && refs.length) {
        refs[refs.length - 1] += " " + p;
        continue;
      }
      refs.push(p);
    }
    return refs.filter((r) => r.length >= 25);
  },

  /** Split "[1] … [2] …" or "1. … 2. …" by following the numbering in sequence */
  splitNumbered(text) {
    let formats = [
      (n) => `\\[${n}\\]`,
      (n) => `(?<=^|\\s)${n}\\.\\s+(?=\\p{Lu})`,
    ];
    for (let fmt of formats) {
      let positions = [];
      let pos = 0;
      for (let n = 1; n < 1000; n++) {
        let re = new RegExp(fmt(n), "gu");
        re.lastIndex = pos;
        let m = re.exec(text);
        // Entries are rarely longer than ~2500 characters
        if (!m || (positions.length && m.index - pos > 2500)) break;
        positions.push(m.index);
        pos = m.index + m[0].length;
      }
      if (positions.length >= 3) {
        return positions.map((p, i) => text.slice(p, positions[i + 1]));
      }
    }
    return null;
  },

  joinLine(a, b) {
    // Re-join words hyphenated across lines ("informa-" + "tion")
    if (/\p{Ll}-$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
    return a + " " + b;
  },

  async getCrossrefReferences(doi) {
    if (this._crossrefCache.has(doi)) return this._crossrefCache.get(doi);
    let refs = null;
    try {
      // Crossref etiquette: identify the tool, and add a contact email if the user gave one
      // (requests with an email go to Crossref's faster "polite" pool)
      let email = (Zotero.Prefs.get(PREF_CROSSREF_EMAIL, true) || "").trim();
      let url = "https://api.crossref.org/works/" + encodeURIComponent(doi)
        + (email ? "?mailto=" + encodeURIComponent(email) : "");
      let xhr = await Zotero.HTTP.request("GET", url, {
        responseType: "json",
        timeout: 20000,
        headers: {
          Accept: "application/json",
          "X-User-Agent": `ReferenceChecker/${this.version} (${HOMEPAGE})`,
        },
      });
      let list = xhr.response?.message?.reference;
      if (Array.isArray(list) && list.length) {
        refs = list.map((r) => {
          let title = r["article-title"] || r["volume-title"] || r["series-title"] || "";
          let text = (r.unstructured || "").trim()
            || [r.author, r.year && `(${r.year})`, title, r["journal-title"]].filter(Boolean).join(". ");
          let journal = r["journal-title"] || "";
          let volume = r["volume-title"] || r["series-title"] || "";
          let type = journal ? (CONFERENCE_RE.test(journal) ? "Conference paper" : "Journal article")
            : volume ? (CONFERENCE_RE.test(volume) ? "Conference paper" : "Book / chapter") : "";
          return {
            text: text || r.DOI || "", title, doi: r.DOI ? this.cleanDOI(r.DOI) : "",
            author: r.author || "", year: r.year || "", journal, type,
          };
        });
        await this.fillFromCrossref(refs);
      }
    }
    catch (e) {
      this.log(`Crossref lookup failed for ${doi}: ${e}`);
    }
    this._crossrefCache.set(doi, refs);
    return refs;
  },

  crossrefURL(path) {
    let email = (Zotero.Prefs.get(PREF_CROSSREF_EMAIL, true) || "").trim();
    return "https://api.crossref.org/" + path + (email ? (path.includes("?") ? "&" : "?") + "mailto=" + encodeURIComponent(email) : "");
  },

  /**
   * Many publishers deposit references as a bare DOI. Without the first author and the year,
   * their citations can't be found in the text, so fetch those from Crossref (40 DOIs per request).
   */
  async fillFromCrossref(refs) {
    let missing = refs.filter((r) => r.doi && !r.doi.includes(",") && (!r.author || !r.year || !r.title));
    let types = {
      "journal-article": "Journal article", "proceedings-article": "Conference paper", book: "Book / chapter",
      "book-chapter": "Book / chapter", monograph: "Book / chapter", "edited-book": "Book / chapter",
      dissertation: "Thesis", report: "Report", "posted-content": "Preprint",
    };
    let chunks = [];
    for (let i = 0; i < missing.length; i += 40) chunks.push(missing.slice(i, i + 40));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        let filter = chunk.map((r) => "doi:" + encodeURIComponent(r.doi)).join(",");
        let get = () => Zotero.HTTP.request("GET",
          this.crossrefURL(`works?filter=${filter}&rows=${chunk.length}&select=DOI,author,editor,issued,title,container-title,type`), {
            responseType: "json",
            timeout: 30000,
            headers: { Accept: "application/json", "X-User-Agent": `ReferenceChecker/${this.version} (${HOMEPAGE})` },
          });
        // Crossref sometimes refuses bursts of requests: try once more after a pause
        let xhr = await get().catch(async () => {
          await Zotero.Promise.delay(1500);
          return get();
        });
        let byDOI = new Map((xhr.response?.message?.items || []).map((it) => [this.cleanDOI(it.DOI), it]));
        for (let r of chunk) {
          let it = byDOI.get(r.doi);
          if (!it) continue;
          let first = (it.author || it.editor || [])[0];
          r.author ||= first?.family || first?.name || "";
          r.year ||= String(it.issued?.["date-parts"]?.[0]?.[0] || "");
          r.title ||= (it.title || [])[0] || "";
          r.type ||= types[it.type] || "";
          if (!r.journal && it.type === "journal-article") r.journal = (it["container-title"] || [])[0] || "";
          // A bare DOI says nothing to the reader: show the work instead
          if (/^\s*(?:https?:\/\/(?:dx\.)?doi\.org\/)?(?:10\.\S+)?\s*$/i.test(r.text)) {
            r.text = [r.author + (r.year ? ` (${r.year})` : ""), r.title, r.journal].filter((x) => x.trim()).join(". ")
              + (r.doi ? ". https://doi.org/" + r.doi : "");
          }
        }
      }
      catch (e) {
        this.log("Crossref DOI lookup failed: " + e);
      }
    }));
  },

  /**
   * @returns {Promise<{ refs, source, mode, error? }>}
   *   mode "list"    – refs is the full list of references
   *   mode "matches" – references could not be separated; refs only holds library matches
   */
  async collectReferences(parent, attachment, force) {
    let source = Zotero.Prefs.get(PREF_SOURCE, true) || "auto";
    let doi = parent ? this.cleanDOI(this.field(parent, "DOI") || this.field(parent, "extra")) : "";

    if (force) {
      if (attachment) this._textCache.delete(attachment.id);
      if (doi) this._crossrefCache.delete(doi);
    }

    if ((source === "auto" || source === "crossref") && doi) {
      let refs = await this.getCrossrefReferences(doi);
      if (refs) return { refs, source: "Crossref", mode: "list" };
      if (source === "crossref") {
        return { refs: [], source: "Crossref", mode: "list", error: "Crossref has no reference list for this DOI." };
      }
    }
    if (source === "crossref" && !doi) {
      return { refs: [], source: "Crossref", mode: "list", error: "This item has no DOI, so Crossref cannot be queried." };
    }

    if (!attachment) {
      return { refs: [], source: "PDF", mode: "list", error: "No PDF file is available for this item." };
    }
    let text = await this.getAttachmentText(attachment);
    if (!text.trim()) {
      return { refs: [], source: "PDF", mode: "list", error: "No text could be extracted from this file (scanned PDF without OCR?)." };
    }
    let { section, found } = this.extractReferenceSection(text);
    let refs = this.splitReferences(section).map((t) => ({ text: t, title: "", doi: "" }));
    // Sanity check: real reference entries almost always carry a year
    let withYear = refs.filter((r) => /\b(?:1[89]|20)\d{2}\b/.test(r.text)).length;
    if (refs.length >= 2 && withYear >= refs.length * 0.6) {
      return { refs, source: found ? "PDF" : "PDF (no References heading found)", mode: "list" };
    }
    return { refs: [], section, source: "PDF", mode: "matches" };
  },

  // ---------------------------------------------------------------------------
  // Item pane section
  // ---------------------------------------------------------------------------

  async renderSection(props, { force }) {
    let { body, item, tabType, setSectionSummary } = props;
    this._lastProps = props;
    if (!item || !this.isEligible(item)) return;

    let token = String(Date.now() + Math.random());
    body.dataset.refcheckToken = token;
    let stale = () => body.dataset.refcheckToken !== token;

    let el = this.elementMaker(body.ownerDocument);

    let { parent, attachment } = await this.resolveTarget(item, tabType);
    if (stale()) return;

    let root = el("div", "refcheck");
    body.replaceChildren(root);
    this.updateBackButtons(body.ownerDocument);

    // In the library view, don't parse every selected item automatically
    if (tabType !== "reader" && !force && body.refcheckScanFor !== item.id) {
      let btn = el("button", "refcheck-scan", "Check references against my library");
      btn.addEventListener("click", () => {
        body.refcheckScanFor = item.id;
        this.renderSection(props, { force: false });
      });
      root.append(btn);
      setSectionSummary?.("");
      return;
    }

    root.append(el("div", "refcheck-status", "Reading references…"));

    let index, result;
    try {
      [index, result] = await Promise.all([
        this.getIndex(),
        this.collectReferences(parent, attachment, force),
      ]);
    }
    catch (e) {
      Zotero.logError(e);
      if (!stale()) root.replaceChildren(el("div", "refcheck-status", "Error: " + e.message));
      return;
    }
    if (stale()) return;

    let excludeIDs = new Set([parent?.id, item.id].filter(Boolean));
    let rows = [];
    if (result.mode === "list") {
      for (let ref of result.refs) {
        let match = this.matchText(ref.text, index, excludeIDs, ref);
        // The library item knows the first author and year when the reference doesn't
        if (match) {
          ref.author ||= match.entry.author;
          ref.year ||= match.entry.year;
          ref.title ||= match.entry.title;
        }
        rows.push({ ref, match });
      }
    }
    else {
      for (let entry of this.matchAllInText(result.section, index, excludeIDs)) {
        rows.push({
          ref: { text: "", title: "", doi: entry.doi, author: entry.author, year: entry.year },
          match: { entry, how: "title" },
        });
      }
    }

    // Where in the article each reference is cited
    let sections = [];
    if (attachment && rows.length) {
      try {
        let text = await this.getAttachmentText(attachment);
        let body = text.slice(0, this.extractReferenceSection(text).start);
        let info = this.citationInfo(rows, body);
        rows.forEach((row) => {
          row.useNumeric = info.useNumeric;
          row.numStyle = info.numStyle;
        });
        // Without a parsed list, reference numbers are unknown: numeric citations can't be followed
        if (result.mode === "matches" && info.useNumeric) rows.forEach((row) => { delete row.key; });
        sections = this.detectSections(body);
        if (sections.length) this.assignSections(rows, body, sections, info);
      }
      catch (e) {
        Zotero.logError(e);
      }
      if (stale()) return;
    }

    // Resolve PDF availability for matched rows
    await Promise.all(rows.map(async (row) => {
      if (row.match) row.status = await this.resolveStatus(row.match.entry, index);
    }));
    if (stale()) return;
    this.markRelated(rows, parent);
    rows.forEach((row) => { row.sectionList = sections; });

    let inLib = rows.filter((r) => r.status);
    let withFile = inLib.filter((r) => r.status.attachment);

    // ---- toolbar
    let toolbar = el("div", "refcheck-toolbar");
    let summary = el("div", "refcheck-summary");
    if (result.mode === "list") {
      summary.textContent = `${inLib.length} of ${rows.length} references in your library · ${withFile.length} with PDF`;
    }
    else {
      summary.textContent = `${inLib.length} works from your library cited · ${withFile.length} with PDF`;
    }
    let related = rows.filter((r) => r.related).length;
    if (related) summary.textContent += ` · ${related} related`;
    setSectionSummary?.(`${inLib.length} in library · ${withFile.length} PDF`);
    toolbar.append(summary);

    let controls = el("div", "refcheck-controls");
    let onlyLabel = el("label", "refcheck-only");
    let only = el("input");
    only.type = "checkbox";
    only.checked = !!Zotero.Prefs.get(PREF_ONLY_LIB, true);
    onlyLabel.append(only, " Only in library");
    controls.append(onlyLabel);

    let chips = (options, current, onPick) => this.chips(el, options, current, onPick);

    let source = Zotero.Prefs.get(PREF_SOURCE, true) || "auto";
    controls.append(
      el("span", "refcheck-source-label", "Source:"),
      chips(
        [
          { value: "auto", label: "Auto", title: "Crossref when available, otherwise the PDF text" },
          { value: "crossref", label: "Crossref" },
          { value: "pdf", label: "PDF text" },
        ],
        source,
        (value) => {
          Zotero.Prefs.set(PREF_SOURCE, value, true);
          this.renderSection(props, { force: false });
        }
      )
    );

    // Section filter (kept when the panel re-renders for the same item).
    // The last chip, "Cited by", shows the articles that cite this one instead of its references.
    // "Selected text" appears when text is selected in the PDF and shows the references cited in it.
    let saved = body.refcheckSection?.itemID === item.id ? body.refcheckSection : null;
    let wantedSection = saved?.value || "";
    let selectedRows = new Set(saved?.selection ? this.rowsCitedIn(rows, saved.selection) : []);
    if (wantedSection === "selection" && !selectedRows.size) wantedSection = "";
    if (!["", "none", "citedby", "selection"].includes(wantedSection) && !sections[parseInt(wantedSection)]) wantedSection = "";
    let doi = parent ? this.cleanDOI(this.field(parent, "DOI") || this.field(parent, "extra")) : "";
    let knownTotal = this._citedByCache.get(doi + "|" + (Zotero.Prefs.get(PREF_CITEDBY_SORT, true) || "cited"))?.total;
    let citedByLabel = (total) => "Cited by" + (total === undefined ? "" : ` (${total})`);

    let sectionRow = el("div", "refcheck-section-filter");
    let options = [
      { value: "", label: `All (${rows.length})` },
      { value: "selection", label: `Selected text (${selectedRows.size})` },
    ];
    sections.forEach((sec, si) => {
      let count = rows.filter((r) => r.sections?.has(si)).length;
      options.push({ value: String(si), label: `${sec.title} (${count})`, disabled: !count });
    });
    let notCited = sections.length ? rows.filter((r) => !r.sections?.size).length : 0;
    if (notCited) {
      options.push({ value: "none", label: `Citation not located (${notCited})`,
        title: "References whose citation could not be found in the text" });
    }
    options.push({ value: "citedby", label: citedByLabel(knownTotal),
      title: "Articles that cite this one (from OpenAlex)" });
    let sectionChips = chips(options, wantedSection, (value) => {
      wantedSection = value;
      saved = { ...saved, itemID: item.id, value };
      body.refcheckSection = saved;
      applyFilter();
    });
    let selectionChip = [...sectionChips.children].find((c) => c.dataset.value === "selection");
    let showSelectionChip = () => {
      selectionChip.textContent = `Selected text (${selectedRows.size})`;
      selectionChip.title = "References cited in the text selected in the PDF: "
        + (saved?.selection || "").replace(/\s+/g, " ").slice(0, 200);
      selectionChip.style.display = selectedRows.size ? "" : "none";
    };
    showSelectionChip();

    let activate = (value) => {
      wantedSection = value;
      for (let c of sectionChips.children) c.classList.toggle("refcheck-chip-active", c.dataset.value === value);
      showSelectionChip();
      applyFilter();
    };
    // Called when text is selected in the PDF: show only the references cited in it
    body.refcheckSelect = (text) => {
      let found = this.rowsCitedIn(rows, text);
      if (!found.size) {
        body.refcheckClearSelection();
        return 0;
      }
      selectedRows = found;
      // Remember the list shown before, to go back to it when the text is deselected
      let before = wantedSection === "selection" ? saved?.before || "" : wantedSection;
      saved = { itemID: item.id, value: "selection", selection: text, before };
      body.refcheckSection = saved;
      activate("selection");
      return found.size;
    };
    // Called when the text is deselected
    body.refcheckClearSelection = () => {
      if (!saved?.selection) return;
      let back = wantedSection === "selection" ? saved.before || "" : wantedSection;
      selectedRows = new Set();
      saved = { itemID: item.id, value: back };
      body.refcheckSection = saved;
      activate(back);
    };
    sectionRow.append(el("div", "refcheck-source-label", sections.length ? "Cited in section:" : "Show:"), sectionChips);
    toolbar.append(controls, sectionRow);
    root.replaceChildren(toolbar);

    // ---- references view and cited-by view; only one is visible
    let refsView = el("div", "refcheck-view");
    let citedView = el("div", "refcheck-view");
    root.append(refsView, citedView);

    refsView.append(el("div", "refcheck-note", "References from " + result.source
      + (result.mode === "matches" ? " (individual entries could not be separated; showing library matches only)" : "")));

    let list = el("ol", "refcheck-list");
    let facetState = body.refcheckFacets?.itemID === item.id ? body.refcheckFacets : { itemID: item.id, type: "", journal: "" };
    body.refcheckFacets = facetState;
    let facets = this.facetFilters(el, rows, facetState, () => applyFilter());
    if (result.error) refsView.append(el("div", "refcheck-status", result.error));
    else if (!rows.length) refsView.append(el("div", "refcheck-status", "No references found."));
    else refsView.append(facets.element, list);

    let rerender = () => this.renderSection(props, { force: false });
    let applyFilter = () => {
      let showCited = wantedSection === "citedby";
      refsView.style.display = showCited ? "none" : "";
      citedView.style.display = showCited ? "" : "none";
      if (showCited && !citedView.refcheckLoaded) {
        citedView.refcheckLoaded = true;
        this.renderCitedBy(citedView, el, {
          props, parent, doi, only, force, rerender,
          onTotal: (total) => {
            let chip = [...sectionChips.children].find((c) => c.dataset.value === "citedby");
            if (chip) chip.textContent = citedByLabel(total);
          },
        });
      }
      citedView.refcheckApply?.();
      rows.forEach((row, i) => {
        row.updateCiteButton?.(wantedSection);
        let li = list.children[i];
        if (!li) return;
        let show = !(only.checked && !row.status) && facets.test(row);
        if (wantedSection === "selection") show = show && selectedRows.has(i);
        else if (wantedSection === "none") show = show && !row.sections?.size;
        else if (wantedSection !== "") show = show && !!row.sections?.has(parseInt(wantedSection));
        // Inline style so no stylesheet rule can override it
        li.style.display = show ? "" : "none";
      });
    };
    only.addEventListener("change", () => {
      Zotero.Prefs.set(PREF_ONLY_LIB, only.checked, true);
      applyFilter();
    });

    rows.forEach((row, i) => {
      row.currentSection = () => wantedSection;
      list.append(this.buildRow(el, row, i, props, rerender));
    });
    applyFilter();
    this.restoreRow(body, item.id, list);
  },

  /** row.parent and row.related: whether each library match is a Related item of the article */
  markRelated(rows, parent) {
    let keys = new Set(parent?.relatedItems || []);
    for (let row of rows) {
      row.parent = parent;
      let other = row.status?.item;
      row.related = !!other && (keys.has(other.key) || (other.relatedItems || []).includes(parent?.key));
    }
  },

  elementMaker(doc) {
    return (tag, cls, text) => {
      let e = doc.createElementNS(HTML_NS, tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
  },

  // Zotero's window doesn't support HTML <select> dropdowns reliably, so use clickable chips
  chips(el, options, current, onPick) {
    let box = el("div", "refcheck-chips");
    for (let opt of options) {
      let chip = el("button", "refcheck-chip", opt.label);
      chip.dataset.value = opt.value;
      chip.disabled = !!opt.disabled;
      if (opt.title) chip.title = opt.title;
      chip.classList.toggle("refcheck-chip-active", opt.value === current);
      chip.addEventListener("click", () => {
        for (let c of box.children) c.classList.toggle("refcheck-chip-active", c === chip);
        onPick(opt.value);
      });
      box.append(chip);
    }
    return box;
  },

  /** Publication type of a reference known only by its text */
  guessType(text) {
    let t = text || "";
    if (/\b(?:thesis|dissertation)\b/i.test(t)) return "Thesis";
    if (/\b(?:arxiv|ssrn|preprint|biorxiv|medrxiv|research square)\b/i.test(t)) return "Preprint";
    if (CONFERENCE_RE.test(t)) return "Conference paper";
    if (/\b(?:working paper|technical report|tech\. rep|report no|discussion paper)\b/i.test(t)) return "Report";
    if (/\(eds?\.?\)|\beds?\.,|\beditors?\b|\bpress\b|\bpublishers?\b|\bisbn\b|\b\d+(?:st|nd|rd|th) ed(?:\.|ition)|\bIn:/i.test(t)) {
      return "Book / chapter";
    }
    // Volume(issue) or volume, pages: "24(3), 10–20", "52:4351–4363", "vol. 12"
    if (/\b\d+\s*\(\d+\)|\bvol\.\s*\d|\b\d+\s*[:,]\s*\d+\s*[–\-]\s*\d+/i.test(t)) return "Journal article";
    return "Other";
  },

  /** Type and journal of a row: from the library item when matched, otherwise from the reference */
  rowFacets(row) {
    let ref = row.ref || {};
    let item = row.status?.item;
    let type = item ? ITEM_TYPE_TO_PUB[item.itemType] || "Other" : ref.type || this.guessType(ref.text);
    let journal = "";
    if (type === "Journal article") {
      journal = (item && this.field(item, "publicationTitle")) || ref.journal || "";
    }
    return { type, journal: journal.replace(/\s+/g, " ").trim() };
  },

  /**
   * "Type" and "Journal" chip rows for a list of rows.
   * @param {{ type: string, journal: string }} state - current choice, updated in place
   * @returns {{ element, test: (row) => boolean }}
   */
  facetFilters(el, rows, state, onChange) {
    rows.forEach((row) => { row.facets ||= this.rowFacets(row); });
    let journalKey = (name) => this.compact(name.replace(/^the\s+/i, ""));
    rows.forEach((row) => { row.facets.journalKey = row.facets.journal ? journalKey(row.facets.journal) : ""; });

    let box = el("div", "refcheck-facets");
    let typeCounts = new Map();
    for (let row of rows) typeCounts.set(row.facets.type, (typeCounts.get(row.facets.type) || 0) + 1);
    let types = PUB_TYPES.filter((t) => typeCounts.has(t));
    if (!types.includes(state.type)) state.type = "";
    if (types.length > 1) {
      let line = el("div", "refcheck-section-filter");
      line.append(
        el("div", "refcheck-source-label", "Type:"),
        this.chips(el, [{ value: "", label: "All types" }, ...types.map((t) => ({ value: t, label: `${t} (${typeCounts.get(t)})` }))],
          state.type, (value) => {
            state.type = value;
            onChange();
          })
      );
      box.append(line);
    }

    // Journals by number of references; the spelling seen first is shown
    let journals = new Map();
    for (let row of rows) {
      let key = row.facets.journalKey;
      if (!key) continue;
      let j = journals.get(key) || { name: row.facets.journal, count: 0 };
      j.count++;
      journals.set(key, j);
    }
    let sorted = [...journals.entries()].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));
    if (!journals.has(state.journal)) state.journal = "";
    if (sorted.length) {
      let line = el("div", "refcheck-section-filter");
      let chipBox = this.chips(el, [
        { value: "", label: "All journals" },
        ...sorted.map(([key, j]) => ({ value: key, label: `${j.name} (${j.count})`, title: j.name })),
      ], state.journal, (value) => {
        state.journal = value;
        onChange();
      });
      line.append(el("div", "refcheck-source-label", "Journal:"), chipBox);
      // Keep the list short: the most frequent journals, plus the selected one
      let extra = [...chipBox.children].slice(TOP_JOURNALS + 1).filter((c) => c.dataset.value !== state.journal);
      if (extra.length) {
        extra.forEach((c) => { c.style.display = "none"; });
        let more = el("button", "refcheck-chip refcheck-more", `More (${extra.length})`);
        more.addEventListener("click", () => {
          extra.forEach((c) => { c.style.display = ""; });
          more.remove();
        });
        chipBox.append(more);
      }
      box.append(line);
    }

    return {
      element: box,
      test: (row) => (!state.type || row.facets.type === state.type)
        && (!state.journal || row.facets.journalKey === state.journal),
    };
  },

  // ---------------------------------------------------------------------------
  // Cited by: articles that cite the current one (from OpenAlex)
  // ---------------------------------------------------------------------------

  /** GET an OpenAlex API path; null on 404 */
  async openAlexRequest(path, params = {}) {
    let key = (Zotero.Prefs.get(PREF_OPENALEX_KEY, true) || "").trim();
    let email = (Zotero.Prefs.get(PREF_CROSSREF_EMAIL, true) || "").trim();
    if (key) params.api_key = key;
    if (email) params.mailto = email;
    let query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    let xhr = await Zotero.HTTP.request("GET", `https://api.openalex.org/${path}?${query}`, {
      responseType: "json",
      timeout: 30000,
      successCodes: false,
      headers: { Accept: "application/json" },
    });
    if (xhr.status === 404) return null;
    if (xhr.status === 200) return xhr.response;
    let detail = xhr.response?.message || xhr.response?.error || `HTTP ${xhr.status}`;
    if (xhr.status === 429) {
      throw new Error("OpenAlex's free daily limit for your network has been reached. "
        + "Add a free OpenAlex API key in Settings → Reference Checker, or try again tomorrow.");
    }
    if (xhr.status === 401 || xhr.status === 403) {
      throw new Error("OpenAlex refused the request (check the API key in Settings → Reference Checker): " + detail);
    }
    throw new Error("OpenAlex: " + detail);
  },

  /** OpenAlex work ID ("W123…") for a DOI, or "" if OpenAlex doesn't know it */
  async getOpenAlexID(doi) {
    if (this._openAlexIDs.has(doi)) return this._openAlexIDs.get(doi);
    let work = await this.openAlexRequest("works/doi:" + encodeURIComponent(doi), { select: "id" });
    let id = (work?.id || "").replace(/^https?:\/\/openalex\.org\//, "");
    this._openAlexIDs.set(doi, id);
    return id;
  },

  /** An OpenAlex work in the shape of a parsed reference */
  openAlexWork(w) {
    let authors = (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean);
    let names = authors.length > 2 ? authors[0] + " et al." : authors.join(" & ");
    let year = w.publication_year ? String(w.publication_year) : "";
    let title = (w.display_name || w.title || "").replace(/<[^>]+>/g, "");
    let source = w.primary_location?.source;
    let venue = source?.display_name || "";
    let type = ["book", "book-chapter"].includes(w.type) ? "Book / chapter"
      : w.type === "dissertation" ? "Thesis"
        : w.type === "report" ? "Report"
          : w.type === "preprint" || source?.type === "repository" ? "Preprint"
            : source?.type === "conference" ? "Conference paper"
              : source?.type === "journal" ? "Journal article" : "Other";
    let text = [names + (year ? ` (${year})` : ""), title, venue].filter(Boolean).join(". ");
    return {
      text,
      title,
      doi: this.cleanDOI(w.doi),
      author: (authors[0] || "").split(/\s+/).pop(),
      year,
      citedBy: w.cited_by_count || 0,
      journal: type === "Journal article" ? venue : "",
      type,
    };
  },

  /**
   * Articles citing a DOI, one page at a time; pages already loaded are kept.
   * Uses page numbers: OpenAlex only allows cursor paging with an API key.
   * @param {"cited"|"newest"|"oldest"} sort
   * @returns {Promise<{ works, total, nextPage, error? }>}
   */
  async getCitingWorks(doi, sort, { more = false } = {}) {
    let key = doi + "|" + sort;
    let cached = this._citedByCache.get(key);
    if (cached && (!more || !cached.nextPage)) return cached;
    try {
      let id = await this.getOpenAlexID(doi);
      if (!id) {
        return { works: [], total: 0, nextPage: null, error: "OpenAlex doesn't know this DOI, so the articles citing it can't be listed." };
      }
      let order = { cited: "cited_by_count:desc", newest: "publication_date:desc", oldest: "publication_date:asc" }[sort]
        || "cited_by_count:desc";
      let res = await this.openAlexRequest("works", {
        filter: "cites:" + id,
        sort: order,
        "per-page": CITEDBY_PAGE_SIZE,
        page: cached?.nextPage || 1,
        select: "id,doi,display_name,publication_year,authorships,cited_by_count,primary_location,type",
      });
      let works = (res?.results || []).map((w) => this.openAlexWork(w));
      let all = [...(cached?.works || []), ...works];
      let total = res?.meta?.count ?? all.length;
      let data = {
        works: all,
        total,
        nextPage: works.length && all.length < total ? (cached?.nextPage || 1) + 1 : null,
      };
      if (this._citedByCache.size > 20) this._citedByCache.delete(this._citedByCache.keys().next().value);
      this._citedByCache.set(key, data);
      return data;
    }
    catch (e) {
      this.log(`OpenAlex lookup failed for ${doi}: ${e}`);
      return { ...(cached || { works: [], total: 0 }), nextPage: cached?.nextPage || null, error: e.message || String(e) };
    }
  },

  /**
   * Fill the "Cited by" view of the references panel with the articles citing this one.
   * @param {object} opts.only - the panel's "Only in library" checkbox
   * @param {Function} opts.rerender - re-renders the whole panel (after an item is saved)
   * @param {Function} opts.onTotal - called with the number of citing articles
   */
  async renderCitedBy(box, el, { props, doi, parent, only, force, rerender, onTotal }) {
    let item = props.item;
    let refill = (clear) => {
      box.refcheckApply = null;
      this.renderCitedBy(box, el, { props, doi, parent, only, force: clear, rerender, onTotal });
    };
    if (!doi) {
      box.replaceChildren(el("div", "refcheck-status", "This item has no DOI, so the articles citing it can't be looked up."));
      return;
    }

    let sort = Zotero.Prefs.get(PREF_CITEDBY_SORT, true) || "cited";
    if (force) {
      for (let key of [...this._citedByCache.keys()]) {
        if (key.startsWith(doi + "|")) this._citedByCache.delete(key);
      }
    }
    box.replaceChildren(el("div", "refcheck-status", "Looking for articles that cite this one…"));

    let index, data;
    try {
      [index, data] = await Promise.all([this.getIndex(), this.getCitingWorks(doi, sort)]);
    }
    catch (e) {
      Zotero.logError(e);
      box.replaceChildren(el("div", "refcheck-status", "Error: " + e.message));
      return;
    }
    if (!box.isConnected) return;
    onTotal?.(data.total);

    let excludeIDs = new Set([parent?.id, item.id].filter(Boolean));
    let rows = data.works.map((ref) => ({
      ref,
      match: this.matchText(ref.text, index, excludeIDs, ref),
      note: `Cited ${ref.citedBy} time${ref.citedBy === 1 ? "" : "s"}`,
    }));
    await Promise.all(rows.map(async (row) => {
      if (row.match) row.status = await this.resolveStatus(row.match.entry, index);
    }));
    if (!box.isConnected) return;
    this.markRelated(rows, parent);

    let inLib = rows.filter((r) => r.status);
    let withFile = inLib.filter((r) => r.status.attachment);
    let loaded = rows.length < data.total ? ` (${rows.length} loaded)` : "";

    let controls = el("div", "refcheck-controls");
    controls.append(
      el("span", "refcheck-source-label", "Sort:"),
      this.chips(el, [
        { value: "cited", label: "Most cited" },
        { value: "newest", label: "Newest" },
        { value: "oldest", label: "Oldest" },
      ], sort, (value) => {
        Zotero.Prefs.set(PREF_CITEDBY_SORT, value, true);
        refill(false);
      })
    );
    box.replaceChildren(
      el("div", "refcheck-summary", `${data.total} article${data.total === 1 ? "" : "s"} cite this one${loaded}`
        + ` · ${inLib.length} in your library · ${withFile.length} with PDF`),
      controls,
      el("div", "refcheck-note", "Citing articles from OpenAlex")
    );

    if (data.error) box.append(el("div", "refcheck-status", data.error));
    if (!rows.length) {
      if (!data.error) box.append(el("div", "refcheck-status", "No citing articles found."));
      return;
    }

    let list = el("ol", "refcheck-list");
    rows.forEach((row, i) => list.append(this.buildRow(el, row, i, props, rerender)));
    let body = props.body;
    let facetState = body.refcheckCitedFacets?.itemID === item.id ? body.refcheckCitedFacets : { itemID: item.id, type: "", journal: "" };
    body.refcheckCitedFacets = facetState;
    let facets = this.facetFilters(el, rows, facetState, () => box.refcheckApply());
    box.refcheckApply = () => {
      rows.forEach((row, i) => {
        list.children[i].style.display = (only.checked && !row.status) || !facets.test(row) ? "none" : "";
      });
    };
    box.refcheckApply();
    box.append(facets.element, list);

    if (data.nextPage) {
      let more = el("button", "refcheck-scan", `Load more (${data.total - rows.length} left)`);
      more.addEventListener("click", async () => {
        more.disabled = true;
        more.textContent = "Loading…";
        let result = await this.getCitingWorks(doi, sort, { more: true });
        if (result.error) {
          more.disabled = false;
          more.textContent = "Load more (failed, try again)";
          more.title = result.error;
        }
        else if (box.isConnected) refill(false);
      });
      box.append(more);
    }
  },

  buildRow(el, row, i, props, rerender) {
    let { ref, status, match } = row;
    let state = status ? (status.attachment ? "pdf" : "lib") : "none";
    let li = el("li", "refcheck-row refcheck-" + state);
    li.dataset.n = String(i + 1);

    let dot = el("span", "refcheck-dot");
    dot.title = state === "pdf" ? "In your library, PDF available"
      : state === "lib" ? "In your library, no file attached"
        : "Not in your library";

    let main = el("div", "refcheck-main");
    // Numbered articles: show the reference's number, to check jumps land on "[12]"
    let number = row.useNumeric && row.key?.num ? el("span", "refcheck-num", `[${row.key.num}]`) : null;
    if (status) {
      let item = status.item;
      let title = el("div", "refcheck-title", item.getField("title") || "(untitled)");
      if (number) title.prepend(number, " ");
      let creator = item.getCreators()[0];
      let year = (this.field(item, "date").match(/\d{4}/) || [""])[0];
      let meta = [creator && (creator.lastName || creator.firstName), year].filter(Boolean).join(", ");
      main.append(title);
      let metaLine = el("div", "refcheck-meta", [meta, `matched by ${match.how}`].filter(Boolean).join(" · "));
      if (row.related) metaLine.append(el("span", "refcheck-related", " · ↔ Related"));
      main.append(metaLine);
    }
    else {
      let text = number ? ref.text.replace(/^(?:\[\d{1,3}\]|\d{1,3}[.)])\s*/, "") : ref.text;
      if (text.length > 260) text = text.slice(0, 257) + "…";
      let line = el("div", "refcheck-text", text);
      if (number) line.prepend(number, " ");
      main.append(line);
    }
    if (row.note) main.append(el("div", "refcheck-meta", row.note));
    if (ref.text) li.title = ref.text;

    let actions = el("div", "refcheck-actions");
    let button = (label, tip, fn) => {
      let b = el("button", "refcheck-btn", label);
      b.title = tip;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        fn(b);
      });
      actions.append(b);
      return b;
    };

    // Leaving for the library or another tab: come back to this row on return
    let remember = () => this.rememberRow(props.body, props.item.id, i);

    if (status) {
      if (status.attachment) {
        button("Open PDF", "Open the attachment", () => {
          remember();
          this.openAttachment(status.attachment);
        });
      }
      else {
        button("Find PDF", "Download the PDF (Elsevier API if configured, then open-access sources)", async (b) => {
          b.disabled = true;
          let { attachment, reason } = await this.findPDF(status.item, (msg) => { b.textContent = msg; });
          if (attachment) {
            rerender();
          }
          else {
            b.textContent = "No PDF found";
            if (reason) b.title = reason;
            main.append(el("div", "refcheck-meta", reason || "No PDF found"));
          }
        });
      }
      if (!status.attachment) {
        button("Open in browser", "Open the article page, then save the PDF with the Zotero Connector", () => {
          this.openForConnector(this.articleURL({ text: "", doi: this.field(status.item, "DOI"), title: status.item.getField("title") }));
        });
      }
      button("Show", "Select this item in the library", () => {
        remember();
        this.showInLibrary(status.item);
      });
      let parent = row.parent;
      if (parent && parent.id !== status.item.id) {
        let sameLibrary = parent.libraryID === status.item.libraryID;
        let relBtn = button(row.related ? "Remove from Related" : "Add to Related",
          sameLibrary ? "Link this item and the open article as related items (both ways)"
            : "Related items must be in the same library",
          async (b) => {
            b.disabled = true;
            try {
              await this.setRelated(parent, status.item, !row.related);
              row.related = !row.related;
              b.textContent = row.related ? "Remove from Related" : "Add to Related";
              main.querySelector(".refcheck-related")?.remove();
              if (row.related) main.querySelector(".refcheck-meta")?.append(el("span", "refcheck-related", " · ↔ Related"));
            }
            catch (e) {
              Zotero.logError(e);
              b.title = String(e);
            }
            b.disabled = false;
          });
        relBtn.disabled = !sameLibrary;
      }
      li.classList.add("refcheck-clickable");
      li.addEventListener("click", () => {
        remember();
        if (status.attachment) this.openAttachment(status.attachment);
        else this.showInLibrary(status.item);
      });
    }
    else {
      let doi = ref.doi || this.cleanDOI(ref.text);
      if (doi) {
        button("Check PDF", "Look for the PDF (Elsevier API if a key is set, then the article page); if found, choose a collection and save it", async (b) => {
          b.disabled = true;
          try {
            let { status: result, reason } = await this.checkAndSave(doi, (msg) => { b.textContent = msg; });
            if (result === "saved") {
              this._index = null;
              rerender();
            }
            else {
              b.textContent = result === "cancelled" ? "Check PDF" : "No PDF found — try Add";
              b.disabled = result === "notfound";
              if (reason) main.append(el("div", "refcheck-meta", reason));
            }
          }
          catch (e) {
            Zotero.logError(e);
            b.textContent = "Failed — try Add";
            b.title = String(e);
          }
        });
      }
      let url = this.articleURL(ref);
      button("Add", "Open the article in your browser, then click the Zotero Connector icon to save it with its PDF", (b) => {
        this.openForConnector(url);
        b.textContent = "Save it with the Zotero Connector in your browser…";
        b.disabled = true;
      });
    }

    // In the reader: jump to where the reference is cited, or to its entry in the list
    if (props.tabType === "reader" && row.key) {
      let cite = button("Cited in text ›", "Go to where this reference is cited (click again for the next place)",
        (b) => this.jumpTo(row, "citation", b, "Cited in text"));
      // Number of citations, in the chosen section or in the whole text; called when the section changes
      row.updateCiteButton = (section) => {
        let total = 0;
        for (let n of row.citeCounts?.values() || []) total += n;
        let count = /^\d+$/.test(section ?? "") ? row.citeCounts?.get(parseInt(section)) : total;
        cite.textContent = row.citeCounts && count ? `Cited in text (${count}) ›` : "Cited in text ›";
      };
      row.updateCiteButton(row.currentSection?.());
    }
    if (props.tabType === "reader" && (row.key || ref.title)) {
      button("In reference list", "Go to this reference in the article's reference list",
        (b) => this.jumpTo(row, "entry", b, "In reference list"));
    }

    li.append(dot, main, actions);
    return li;
  },

  async openAttachment(attachment) {
    let win = Zotero.getMainWindow();
    await win.ZoteroPane.viewAttachment(attachment.id);
  },

  /** Link two items as related, both ways (as Zotero's Related box does), or unlink them */
  async setRelated(a, b, on) {
    if (on) {
      a.addRelatedItem(b);
      b.addRelatedItem(a);
    }
    else {
      a.removeRelatedItem(b);
      b.removeRelatedItem(a);
    }
    await a.saveTx();
    await b.saveTx();
  },

  /** Remember which row was used before leaving the reader, to scroll back to it on return */
  rememberRow(body, itemID, index) {
    let tabID = body.ownerDocument.defaultView.Zotero_Tabs?.selectedID;
    this._focus = { body, itemID, index, tabID, pending: true, away: true };
  },

  /**
   * After "Show" or "Open PDF", put a "← Back to …" button at the top of the panel in every
   * other tab, to return to the article (and its row). Removed once back, or if its tab closes.
   */
  updateBackButtons(doc) {
    let f = this._focus;
    let tabs = doc.defaultView.Zotero_Tabs;
    let tab = tabs?._tabs?.find((t) => t.id === f?.tabID);
    let show = !!(f?.away && f.body.isConnected && tab && tabs.selectedID !== f.tabID);
    let name = show && (f.tabID === "zotero-pane" ? "library" : `“${tab.title || "article"}”`);

    for (let root of doc.querySelectorAll(".refcheck")) {
      root.querySelector(":scope > .refcheck-back")?.remove();
      if (!show || f.body.contains(root)) continue;
      let btn = this.elementMaker(doc)("button", "refcheck-back", `← Back to ${name}`);
      btn.title = "Return to the article you came from, at the reference you used";
      btn.addEventListener("click", () => this.goBack(doc.defaultView));
      root.prepend(btn);
    }
    for (let body of doc.querySelectorAll(".refcheck-back-body")) this.renderBackSection(body);
  },

  /** Return to the article that "Show" / "Open PDF" was used from */
  goBack(win) {
    let f = this._focus;
    let tabs = win.Zotero_Tabs;
    if (f?.away && tabs?._tabs?.some((t) => t.id === f.tabID)) tabs.select(f.tabID);
  },

  /** Body of the temporary "Back to article" section */
  renderBackSection(body) {
    let doc = body.ownerDocument;
    let el = this.elementMaker(doc);
    let f = this._focus;
    let tab = doc.defaultView.Zotero_Tabs?._tabs?.find((t) => t.id === f?.tabID);
    body.classList.add("refcheck-back-body");
    if (!f?.away || !tab) {
      body.replaceChildren(el("div", "refcheck-status", "Nothing to go back to."));
      return;
    }
    let name = f.tabID === "zotero-pane" ? "library" : `“${tab.title || "article"}”`;
    let btn = el("button", "refcheck-back", `← Back to ${name}`);
    btn.addEventListener("click", () => this.goBack(doc.defaultView));
    body.replaceChildren(btn);
  },

  /** Scroll the panel back to the remembered row and flash it (once) */
  restoreRow(body, itemID, list) {
    let f = this._focus;
    if (!f?.pending || f.body !== body || f.itemID !== itemID) return;
    let li = list.children[f.index];
    if (!li?.isConnected) return;
    f.pending = false;
    li.scrollIntoView({ block: "center" });
    li.classList.add("refcheck-flash");
    body.ownerDocument.defaultView.setTimeout(() => li.classList.remove("refcheck-flash"), 1500);
  },

  async showInLibrary(item) {
    let win = Zotero.getMainWindow();
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.selectItem(item.id);
  },

  /**
   * Look for the PDF on the article's web page (same logic as Zotero's "Find Full Text":
   * DOI page → PDF link in the HTML, then open-access copies). Requests go through the
   * computer's network, so a VPN's access applies. If a PDF is found, ask for a collection,
   * then save the metadata (from the DOI) and attach the PDF.
   * @returns {Promise<{ status: "saved"|"notfound"|"cancelled", reason?: string }>}
   */
  async checkAndSave(doi, onProgress = () => {}) {
    let tmpDir = (await Zotero.Attachments.createTemporaryStorageDirectory()).path;
    try {
      let tmpFile = PathUtils.join(tmpDir, "file.tmp");
      let reasons = [];

      // 1. Elsevier API, when a key is set and this is an Elsevier DOI
      let els = await this.fetchElsevierPDF(doi, onProgress);
      if (els.reason) reasons.push(els.reason);
      let found = null;
      if (els.bytes) {
        await IOUtils.write(tmpFile, els.bytes);
        found = { url: "https://api.elsevier.com", mimeType: "application/pdf" };
      }

      // 2. The article page and open-access copies
      if (!found) onProgress("Checking article page…");
      let resolvers = [
        { pageURL: "https://doi.org/" + doi, accessMethod: "doi" },
        async () => (await Zotero.Utilities.Internal.getOpenAccessPDFURLs(doi)).map((o) => ({
          url: o.url, pageURL: o.pageURL, articleVersion: o.version, accessMethod: "oa",
        })),
      ];
      if (!found) {
        found = await Zotero.Attachments.downloadFirstAvailableFile(resolvers, tmpFile, {
          enforceFileType: true,
          shouldDisplayCaptcha: true,
        });
      }
      let mimeType = found?.url && (found.mimeType || await Zotero.MIME.getMIMETypeFromFile(tmpFile));
      if (mimeType !== "application/pdf") {
        reasons.push("No PDF on the article page or in open-access sources");
        return { status: "notfound", reason: reasons.join(" · ") };
      }

      onProgress("PDF found — choose a collection…");
      let target = this.pickCollection(doi);
      if (!target) return { status: "cancelled" };

      onProgress("Saving…");
      let translate = new Zotero.Translate.Search();
      translate.setIdentifier({ DOI: doi });
      let translators = await translate.getTranslators();
      if (!translators.length) throw new Error("No metadata found for DOI " + doi);
      translate.setTranslator(translators);
      let items = await translate.translate({
        libraryID: target.libraryID,
        collections: target.collectionID ? [target.collectionID] : false,
        saveAttachments: false,
      });
      let item = (items || []).find((i) => i.isRegularItem());
      if (!item) throw new Error("Nothing was imported for DOI " + doi);

      await Zotero.Attachments.importFromFile({
        file: tmpFile,
        parentItemID: item.id,
        contentType: "application/pdf",
        title: "Full Text PDF",
        fileBaseName: Zotero.Attachments.getFileBaseNameFromItem(item),
      });
      await this.enforceHttps(item);
      return { status: "saved" };
    }
    finally {
      await IOUtils.remove(tmpDir, { recursive: true, ignoreAbsent: true }).catch(() => {});
    }
  },

  /** Ask where to save, like the Connector's collection menu. Returns { libraryID, collectionID } or null */
  pickCollection(doi) {
    let win = Zotero.getMainWindow();
    let choices = [];
    let current = win?.ZoteroPane?.getSelectedCollection?.();
    if (current) {
      choices.push({ label: `★ ${current.name} (current collection)`, libraryID: current.libraryID, collectionID: current.id });
    }
    let byName = (a, b) => a.name.localeCompare(b.name);
    for (let library of Zotero.Libraries.getAll()) {
      if (library.libraryType === "feed" || !library.editable) continue;
      choices.push({ label: library.name, libraryID: library.libraryID, collectionID: null });
      let walk = (collections, depth) => {
        for (let c of [...collections].sort(byName)) {
          choices.push({ label: "\u2003".repeat(depth) + "└ " + c.name, libraryID: library.libraryID, collectionID: c.id });
          walk(c.getChildCollections(false), depth + 1);
        }
      };
      walk(Zotero.Collections.getByLibrary(library.libraryID, false), 1);
    }
    let selection = { value: 0 };
    let ok = Services.prompt.select(
      win,
      "Save to Zotero",
      `PDF found for ${doi}.\nChoose where to save it:`,
      choices.map((c) => c.label),
      selection
    );
    return ok ? choices[selection.value] : null;
  },

  /** Article page for a reference: its DOI link, or a Google Scholar search on its text */
  articleURL(ref) {
    let doi = ref.doi || this.cleanDOI(ref.text);
    if (doi) return "https://doi.org/" + doi;
    let query = (ref.title || ref.text).replace(/\s+/g, " ").slice(0, 250);
    return "https://scholar.google.com/scholar?q=" + encodeURIComponent(query);
  },

  /**
   * Open the article in the default browser so the user can save it with the
   * Zotero Connector (which uses the browser's own access: VPN, campus login…).
   * The references panel refreshes by itself when the new item arrives.
   */
  openForConnector(url) {
    this._waitingForConnector = true;
    Zotero.launchURL(url);
  },

  /** Called by the notifier: refresh the visible panel shortly after items were added */
  scheduleRefresh() {
    if (!this._waitingForConnector || !this._lastProps) return;
    let win = Zotero.getMainWindow();
    if (!win) return;
    win.clearTimeout(this._refreshTimer);
    // The Connector saves the item first and the PDF a moment later; wait for both
    this._refreshTimer = win.setTimeout(() => {
      let props = this._lastProps;
      if (props?.body?.isConnected) {
        this.renderSection(props, { force: false });
      }
    }, 2500);
  },

  /**
   * Import a reference by DOI, then try to download its PDF
   * (same sources as Zotero's "Find Full Text": DOI landing page, open-access copies, custom resolvers)
   * @returns {Promise<{ item, attachment }>} attachment is null when no PDF could be found
   */
  async addByDOI(doi, libraryID, onProgress = () => {}) {
    onProgress("Adding…");
    let translate = new Zotero.Translate.Search();
    translate.setIdentifier({ DOI: doi });
    let translators = await translate.getTranslators();
    if (!translators.length) throw new Error("No translator for DOI " + doi);
    translate.setTranslator(translators);
    let items = await translate.translate({ libraryID, saveAttachments: true });
    let item = (items || []).find((i) => i.isRegularItem());
    if (!item) throw new Error("Nothing was imported for DOI " + doi);

    let { attachment, reason } = await this.findPDF(item, onProgress);
    return { item, attachment, reason };
  },

  /**
   * Get a PDF for an item: existing file → Elsevier API (if a key is set) → Zotero's open-access lookup
   * @returns {Promise<{ attachment, reason }>}
   */
  async findPDF(item, onProgress = () => {}) {
    let attachment = await this.getFileAttachment(item);
    let reasons = [];
    if (!attachment) {
      let els = await this.downloadFromElsevier(item, onProgress);
      attachment = els.attachment;
      if (els.reason) reasons.push(els.reason);
    }
    if (!attachment) {
      onProgress("Downloading PDF…");
      attachment = await Zotero.Attachments.addAvailableFile(item).catch((e) => {
        Zotero.logError(e);
        return null;
      });
      if (!attachment) reasons.push("No open-access PDF found");
    }
    await this.enforceHttps(item);
    return { attachment, reason: attachment ? "" : reasons.join(" · ") };
  },

  elsevierHeaders(accept) {
    let headers = { "X-ELS-APIKey": (Zotero.Prefs.get(PREF_ELS_KEY, true) || "").trim(), Accept: accept };
    let token = (Zotero.Prefs.get(PREF_ELS_TOKEN, true) || "").trim();
    if (token) headers["X-ELS-Insttoken"] = token;
    return headers;
  },

  /**
   * Download the full-text PDF through Elsevier's official Article Retrieval API.
   * Only works for articles the user's network/institution is entitled to.
   */
  isElsevierDOI(doi) {
    return !!doi && ELSEVIER_PREFIXES.some((p) => doi.startsWith(p));
  },

  /** Elsevier's own error text, e.g. "Requestor configuration settings insufficient…" */
  elsevierError(res) {
    let body = res.response;
    if (body instanceof ArrayBuffer) {
      try {
        body = JSON.parse(new TextDecoder().decode(body));
      }
      catch (e) {
        body = null;
      }
    }
    let status = body?.["service-error"]?.status;
    return status ? `${status.statusCode}: ${status.statusText}` : `HTTP ${res.status}`;
  },

  /**
   * Fetch a full-text PDF through Elsevier's official Article Retrieval API.
   * Only works for articles the user's network/institution is entitled to.
   * @returns {Promise<{ bytes: Uint8Array|null, reason: string }>} reason is "" when no key is set or the DOI isn't Elsevier's
   */
  async fetchElsevierPDF(doi, onProgress = () => {}) {
    let key = (Zotero.Prefs.get(PREF_ELS_KEY, true) || "").trim();
    if (!key || !this.isElsevierDOI(doi)) return { bytes: null, reason: "" };

    onProgress("Checking Elsevier access…");
    let path = encodeURIComponent(doi).replace(/%2F/g, "/");
    try {
      // Without entitlement Elsevier returns only the first page, so check first
      let ent = await Zotero.HTTP.request(
        "GET",
        `https://api.elsevier.com/content/article/entitlement/doi/${path}`,
        { headers: this.elsevierHeaders("application/json"), responseType: "json", successCodes: false, timeout: 20000 }
      );
      if (ent.status !== 200) {
        return { bytes: null, reason: "Elsevier API: " + this.elsevierError(ent) };
      }
      let entitled = ent.response?.["entitlement-response"]?.["document-entitlement"]?.entitled;
      if (!(entitled === true || entitled === "true")) {
        return { bytes: null, reason: "Elsevier API: no full-text access from this network (institutional token needed?)" };
      }

      onProgress("Downloading PDF (Elsevier API)…");
      let res = await Zotero.HTTP.request(
        "GET",
        `https://api.elsevier.com/content/article/doi/${path}`,
        { headers: this.elsevierHeaders("application/pdf"), responseType: "arraybuffer", successCodes: false, timeout: 90000 }
      );
      let bytes = new Uint8Array(res.response || new ArrayBuffer(0));
      let isPDF = bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";
      if (res.status !== 200 || !isPDF) {
        return { bytes: null, reason: "Elsevier API: " + this.elsevierError(res) };
      }
      return { bytes, reason: "" };
    }
    catch (e) {
      Zotero.logError(e);
      return { bytes: null, reason: "Elsevier API: " + e.message };
    }
  },

  /** Attach a PDF from the Elsevier API to an existing item */
  async downloadFromElsevier(item, onProgress = () => {}) {
    let doi = this.cleanDOI(this.field(item, "DOI") || this.field(item, "extra"));
    let { bytes, reason } = await this.fetchElsevierPDF(doi, onProgress);
    if (!bytes) return { attachment: null, reason };

    let tmpPath = PathUtils.join(Zotero.getTempDirectory().path, `refcheck-${Date.now()}.pdf`);
    await IOUtils.write(tmpPath, bytes);
    try {
      let attachment = await Zotero.Attachments.importFromFile({
        file: tmpPath,
        parentItemID: item.id,
        contentType: "application/pdf",
        title: "Full Text PDF",
        fileBaseName: Zotero.Attachments.getFileBaseNameFromItem(item),
      });
      return { attachment, reason: "" };
    }
    finally {
      await IOUtils.remove(tmpPath, { ignoreAbsent: true });
    }
  },

  /** Used by the "Test" button in the preferences pane */
  async testElsevierKey() {
    let key = (Zotero.Prefs.get(PREF_ELS_KEY, true) || "").trim();
    if (!key) return "Enter an API key first.";
    try {
      let res = await Zotero.HTTP.request(
        "GET",
        "https://api.elsevier.com/content/serial/title?title=operations&count=1",
        { headers: this.elsevierHeaders("application/json"), successCodes: false, timeout: 20000 }
      );
      if (res.status === 200) return "✓ API key is valid.";
      if (res.status === 401) return "✗ Invalid API key (HTTP 401).";
      if (res.status === 403) return "✗ Key not authorized for this request (HTTP 403). Check the institutional token.";
      return `Unexpected answer from Elsevier (HTTP ${res.status}).`;
    }
    catch (e) {
      return "✗ Could not reach api.elsevier.com: " + e.message;
    }
  },

  async getFileAttachment(item) {
    let att = await item.getBestAttachment();
    return att && await att.fileExists() ? att : null;
  },

  /** Rewrite any http:// URL on an item and its attachments to https:// */
  async enforceHttps(item) {
    let targets = [item];
    if (item.isRegularItem()) {
      targets.push(...Zotero.Items.get(item.getAttachments()));
    }
    for (let target of targets) {
      let url = this.field(target, "url");
      if (/^http:\/\//i.test(url)) {
        target.setField("url", url.replace(/^http:/i, "https:"));
        await target.saveTx();
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Reader: select a reference in the PDF → popup says whether it's in the library
  // ---------------------------------------------------------------------------

  /**
   * Filter the references panel of this PDF to the references cited in the selected text,
   * and go back to the previous list once the text is deselected (the popup then closes)
   */
  selectInPanel(reader, text, doc, append) {
    let body = this._lastProps?.body;
    let panelItem = this._lastProps?.item;
    let readerItem = Zotero.Items.get(reader.itemID);
    if (!body?.isConnected || !body.refcheckSelect || !panelItem || !readerItem) return;
    if (panelItem.id !== readerItem.id && panelItem.id !== readerItem.parentItemID) return;
    try {
      if (text.trim().length < 3) {
        body.refcheckClearSelection?.();
        return;
      }
      body.refcheckSelect(text);
    }
    catch (e) {
      Zotero.logError(e);
      return;
    }

    let id = this._selectionID = (this._selectionID || 0) + 1;
    let marker = doc.createElement("div");
    marker.hidden = true;
    append(marker);
    let win = doc.defaultView;
    let shown = false;
    let started = Date.now();
    let timer = win.setInterval(() => {
      if (marker.isConnected) {
        shown = true;
        return;
      }
      // Not attached yet: wait a little; if it never shows up, stop watching
      if (!shown && Date.now() - started < 3000) return;
      win.clearInterval(timer);
      // A newer selection replaced this one: it is in charge now
      if (shown && this._selectionID === id && body.isConnected) body.refcheckClearSelection?.();
    }, 300);
  },

  onTextSelectionPopup({ reader, doc, params, append }) {
    let text = params?.annotation?.text || "";
    this.selectInPanel(reader, text, doc, append);
    if (text.length < 20) return;

    let looksLikeRef = DOI_RE.test(text) || /\(?\b(1[89]|20)\d{2}[a-z]?\b\)?/.test(text);
    DOI_RE.lastIndex = 0;

    let box = doc.createElement("div");
    box.style.cssText = "padding:6px 8px;border-top:1px solid rgba(128,128,128,.25);font-size:12px;"
      + "display:flex;flex-direction:column;gap:4px;max-width:320px";
    append(box);

    (async () => {
      let index = await this.getIndex();
      let readerItem = Zotero.Items.get(reader.itemID);
      let exclude = new Set([readerItem?.id, readerItem?.parentItemID].filter(Boolean));
      let match = this.matchText(text, index, exclude);
      if (!match) {
        if (!looksLikeRef) {
          box.remove();
          return;
        }
        box.style.color = "gray";
        box.textContent = "○ Not in your library";
        let add = doc.createElement("button");
        add.textContent = "Add (open in browser)";
        add.title = "Open the article in your browser, then click the Zotero Connector icon to save it with its PDF";
        add.addEventListener("click", () => {
          this.openForConnector(this.articleURL({ text, doi: this.cleanDOI(text) }));
          add.textContent = "Save it with the Zotero Connector in your browser…";
          add.disabled = true;
        });
        box.append(add);
        return;
      }
      let status = await this.resolveStatus(match.entry, index);
      if (!status) {
        box.remove();
        return;
      }
      let label = doc.createElement("div");
      label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      label.textContent = (status.attachment ? "● " : "◐ ") + "In library: " + (status.item.getField("title") || "");
      label.title = status.item.getField("title");
      label.style.color = status.attachment ? "#2e9e44" : "#c77c02";
      box.append(label);

      let btn = doc.createElement("button");
      btn.textContent = status.attachment ? "Open PDF" : "Show in library";
      btn.addEventListener("click", () => {
        if (status.attachment) this.openAttachment(status.attachment);
        else this.showInLibrary(status.item);
      });
      box.append(btn);
    })().catch((e) => {
      Zotero.logError(e);
      box.remove();
    });
  },
};
