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

// A line that looks like the start of a new reference entry
var REF_START_RE = new RegExp(
  "^(?:[•▪◦·\\-–]\\s*)?(?:"
    + "\\[\\d{1,3}\\]"                                             // [12]
    + "|\\d{1,3}[.)]\\s+\\S"                                       // 12. / 12)
    + "|\\p{Lu}[\\p{L}'’\\-]+(?:\\s(?:van|von|de|der|den|da|di|du|le|la|dos|del)(?=\\s))*"
    + "(?:\\s\\p{Lu}[\\p{L}'’\\-]+)?,\\s*(?:\\p{Lu}\\.|\\p{Lu}\\p{Ll}+)" // Smith, J. / Smith, John
    + "|\\p{Lu}\\.\\s?(?:\\p{Lu}\\.\\s?)*\\p{Lu}[\\p{L}'’\\-]+,"   // J. Smith,
    + "|\\p{Lu}[\\p{L}'’\\-]+\\s(?:\\p{Lu}\\.\\s?)+[,(]"                // Smith J., / Smith J. A. (
  + ")",
  "u"
);

// Inline split points when several entries run together on one line:
// APA/Harvard "…, 1–10. Smith, J." and Springer/Vancouver "…, 52:4351–4363 Smith AB, Jones C"
var INLINE_SPLIT_RES = [
  new RegExp(
    "(?<=[.)\\]])\\s+(?=(?:\\d{1,3}\\.\\s+)?\\p{Lu}[\\p{L}'’\\-]+(?:\\s\\p{Lu}[\\p{L}'’\\-]+)?,\\s(?:\\p{Lu}\\.|\\p{Lu}\\p{Ll}+,))",
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
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
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
    let particles = ["van", "von", "de", "der", "den", "da", "di", "du", "le", "la", "dos", "del", "ten", "ter"];
    let surname = words[0] || "";
    if (particles.includes(surname.toLowerCase()) && words[1]) {
      surname = words[1];
    }
    let year = String(ref.year || (text.match(/\b(?:1[89]|20)\d{2}[a-z]?\b/) || [""])[0]);
    return { num: num || index + 1, surname: surname.length >= 2 ? surname : "", year };
  },

  /** Citation key of every row, and whether the article uses numeric citations ([3], [2–5]) */
  citationInfo(rows, body) {
    rows.forEach((row, i) => { row.key = this.citationKey(row.ref, i); });
    // Decide the citation style by which one actually locates more references:
    // brackets like [0, 1] in formulas must not make an author–year paper look numeric
    let cited = new Set();
    for (let m of body.matchAll(/\[(\d{1,3}(?:\s*[–\-,;]\s*\d{1,3})*)\]/g)) {
      for (let n of this.bracketNumbers(m[1])) if (n <= rows.length) cited.add(n);
    }
    let flat = this.searchable(body.replace(/\s+/g, " ")).s;
    let byAuthorYear = rows.filter((row) => this.authorYearRegex(row.key)?.test(flat)).length;
    return {
      useNumeric: cited.size > byAuthorYear,
      byNum: new Map(rows.map((row, i) => [row.key.num, i])),
    };
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
    let regexes = info.useNumeric ? [] : rows.map((row) => this.authorYearRegex(row.key));

    rows.forEach((row) => { row.sections = new Set(); });
    sections.forEach((sec, si) => {
      let text = flat.slice(Math.floor(sec.start * scale), Math.ceil(sec.end * scale));
      if (info.useNumeric) {
        for (let cm of text.matchAll(/\[(\d{1,3}(?:\s*[–\-,;]\s*\d{1,3})*)\]/g)) {
          for (let n of this.bracketNumbers(cm[1])) {
            let i = info.byNum.get(n);
            if (i !== undefined) rows[i].sections.add(si);
          }
        }
        return;
      }
      regexes.forEach((re, i) => {
        if (re && re.test(text)) rows[i].sections.add(si);
      });
    });
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
   * @returns {{ pageIndex, rects }[]}
   */
  findInPDF(data, key, useNumeric, what) {
    let { pages, refsAt } = data;
    let inBody = (p, offset) => !refsAt || p < refsAt.page || (p === refsAt.page && offset < refsAt.offset);
    let numericRe = /\[(\d{1,3}(?:\s*[–\-,;]\s*\d{1,3})*)\]/g;

    // Matches of one method over all pages; author–year methods search the accent-free text
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
            for (let m of page.text.matchAll(numericRe)) {
              if (this.bracketNumbers(m[1]).includes(key.num)) hits.push([m.index, m.index + m[0].length]);
            }
          }
          else {
            collect(new RegExp(`\\[${key.num}\\]`, "g"));
            collect(new RegExp(`(?<![\\d.])${key.num}\\.\\s+\\p{Lu}`, "gu"));
          }
        }
        else if (method === "authorYear") collect(this.authorYearRegex(key, "gu"), true);
        else if (method === "etAl") collect(this.etAlRegex(key, "gu"), true);

        hits = hits.filter(([a]) => (what === "citation" ? inBody(p, a) : !inBody(p, a)));
        for (let [a, b] of hits) {
          let rects = this.rectsFor(page, a, b);
          if (rects.length) found.push({ pageIndex: p, rects });
        }
      });
      return found;
    };

    // Most likely style first, then the other one, then the name without a year
    let methods = useNumeric ? ["numeric", "authorYear"] : ["authorYear", "numeric"];
    if (what === "citation") methods.push("etAl");
    for (let method of methods) {
      if (method === "numeric" && !key.num) continue;
      let found = search(method);
      if (found.length) return what === "entry" ? found.slice(0, 1) : found;
    }
    return [];
  },

  /** Button handler: go to the next place where this reference appears */
  async jumpTo(row, what, button) {
    let win = Zotero.getMainWindow();
    let reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
    if (!reader) return;
    let original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    try {
      if (!row.hits?.[what]) {
        button.textContent = "Searching…";
        let data = await this.getPageTexts(reader);
        row.hits = row.hits || {};
        row.hits[what] = this.findInPDF(data, row.key, row.useNumeric, what);
        row.hitIndex = row.hitIndex || {};
        row.hitIndex[what] = -1;
      }
      let hits = row.hits[what];
      if (!hits.length) {
        // Diagnostic for unsupported layouts: what was searched and what the page text looks like
        let data = reader._refcheckPages;
        let mid = data?.pages[Math.floor(data.pages.length / 2)];
        this.logErrorToFile(`not found (${what})`, new Error(JSON.stringify({
          key: row.key, useNumeric: row.useNumeric, pages: data?.pages.length,
          refsAt: data?.refsAt, sample: mid?.text.slice(0, 300),
        })));
        button.textContent = what === "citation" ? "Citation not found" : "Entry not found";
        return;
      }
      row.hitIndex[what] = (row.hitIndex[what] + 1) % hits.length;
      let hit = hits[row.hitIndex[what]];
      await reader.navigate({ position: { pageIndex: hit.pageIndex, rects: hit.rects } });
      button.textContent = hits.length > 1 ? `${original} ${row.hitIndex[what] + 1}/${hits.length}` : original;
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
          let text = r.unstructured
            || [r.author, r.year && `(${r.year})`, title, r["journal-title"]].filter(Boolean).join(". ");
          return {
            text: text || r.DOI || "", title, doi: r.DOI ? this.cleanDOI(r.DOI) : "",
            author: r.author || "", year: r.year || "",
          };
        });
      }
    }
    catch (e) {
      this.log(`Crossref lookup failed for ${doi}: ${e}`);
    }
    this._crossrefCache.set(doi, refs);
    return refs;
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

    let doc = body.ownerDocument;
    let el = (tag, cls, text) => {
      let e = doc.createElementNS(HTML_NS, tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };

    let { parent, attachment } = await this.resolveTarget(item, tabType);
    if (stale()) return;

    let root = el("div", "refcheck");
    body.replaceChildren(root);

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
        rows.forEach((row) => { row.useNumeric = info.useNumeric; });
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
    setSectionSummary?.(`${inLib.length} in library · ${withFile.length} PDF`);
    toolbar.append(summary);

    let controls = el("div", "refcheck-controls");
    let onlyLabel = el("label", "refcheck-only");
    let only = el("input");
    only.type = "checkbox";
    only.checked = !!Zotero.Prefs.get(PREF_ONLY_LIB, true);
    onlyLabel.append(only, " Only in library");
    controls.append(onlyLabel);

    // Zotero's window doesn't support HTML <select> dropdowns reliably, so use clickable chips
    let chips = (options, current, onPick) => {
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
    };

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

    // Section filter (kept when the panel re-renders for the same item)
    let wantedSection = body.refcheckSection?.itemID === item.id ? body.refcheckSection.value : "";
    if (wantedSection !== "" && wantedSection !== "none" && !sections[parseInt(wantedSection)]) wantedSection = "";
    let sectionRow = null;
    if (sections.length) {
      sectionRow = el("div", "refcheck-section-filter");
      let options = [{ value: "", label: `All (${rows.length})` }];
      sections.forEach((sec, si) => {
        let count = rows.filter((r) => r.sections?.has(si)).length;
        options.push({ value: String(si), label: `${sec.title} (${count})`, disabled: !count });
      });
      let notCited = rows.filter((r) => !r.sections?.size).length;
      if (notCited) {
        options.push({ value: "none", label: `Citation not located (${notCited})`,
          title: "References whose citation could not be found in the text" });
      }
      sectionRow.append(
        el("div", "refcheck-source-label", "Cited in section:"),
        chips(options, wantedSection, (value) => {
          wantedSection = value;
          body.refcheckSection = { itemID: item.id, value };
          applyFilter();
        })
      );
    }
    toolbar.append(controls);
    if (sectionRow) toolbar.append(sectionRow);
    root.replaceChildren(toolbar);

    let sourceNote = el("div", "refcheck-note", "References from " + result.source
      + (result.mode === "matches" ? " (individual entries could not be separated; showing library matches only)" : ""));
    root.append(sourceNote);

    if (result.error) {
      root.append(el("div", "refcheck-status", result.error));
      return;
    }
    if (!rows.length) {
      root.append(el("div", "refcheck-status", "No references found."));
      return;
    }

    // ---- list
    let list = el("ol", "refcheck-list");
    let applyFilter = () => {
      rows.forEach((row, i) => {
        let li = list.children[i];
        if (!li) return;
        let show = !(only.checked && !row.status);
        if (wantedSection === "none") show = show && !row.sections?.size;
        else if (wantedSection !== "") show = show && !!row.sections?.has(parseInt(wantedSection));
        // Inline style so no stylesheet rule can override it
        li.style.display = show ? "" : "none";
      });
    };
    only.addEventListener("change", () => {
      Zotero.Prefs.set(PREF_ONLY_LIB, only.checked, true);
      applyFilter();
    });
    applyFilter();

    rows.forEach((row, i) => {
      list.append(this.buildRow(el, row, i, props, parent));
    });
    applyFilter();
    root.append(list);
  },

  buildRow(el, row, i, props, parent) {
    let { ref, status, match } = row;
    let state = status ? (status.attachment ? "pdf" : "lib") : "none";
    let li = el("li", "refcheck-row refcheck-" + state);
    li.dataset.n = String(i + 1);

    let dot = el("span", "refcheck-dot");
    dot.title = state === "pdf" ? "In your library, PDF available"
      : state === "lib" ? "In your library, no file attached"
        : "Not in your library";

    let main = el("div", "refcheck-main");
    if (status) {
      let item = status.item;
      let title = el("div", "refcheck-title", item.getField("title") || "(untitled)");
      let creator = item.getCreators()[0];
      let year = (this.field(item, "date").match(/\d{4}/) || [""])[0];
      let meta = [creator && (creator.lastName || creator.firstName), year].filter(Boolean).join(", ");
      main.append(title);
      if (meta) main.append(el("div", "refcheck-meta", meta + ` · matched by ${match.how}`));
    }
    else {
      let text = ref.text.length > 260 ? ref.text.slice(0, 257) + "…" : ref.text;
      main.append(el("div", "refcheck-text", text));
    }
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

    if (status) {
      if (status.attachment) {
        button("Open PDF", "Open the attachment", () => this.openAttachment(status.attachment));
      }
      else {
        button("Find PDF", "Download the PDF (Elsevier API if configured, then open-access sources)", async (b) => {
          b.disabled = true;
          let { attachment, reason } = await this.findPDF(status.item, (msg) => { b.textContent = msg; });
          if (attachment) {
            this.renderSection(props, { force: false });
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
      button("Show", "Select this item in the library", () => this.showInLibrary(status.item));
      li.classList.add("refcheck-clickable");
      li.addEventListener("click", () => {
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
              this.renderSection(props, { force: false });
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
      button("Cited in text ›", "Go to where this reference is cited (click again for the next place)",
        (b) => this.jumpTo(row, "citation", b));
      button("In reference list", "Go to this reference in the article's reference list",
        (b) => this.jumpTo(row, "entry", b));
    }

    li.append(dot, main, actions);
    return li;
  },

  async openAttachment(attachment) {
    let win = Zotero.getMainWindow();
    await win.ZoteroPane.viewAttachment(attachment.id);
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

  onTextSelectionPopup({ reader, doc, params, append }) {
    let text = params?.annotation?.text || "";
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
