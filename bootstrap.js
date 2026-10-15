/* global Services, Zotero, IOUtils, PathUtils, RefCheck */
var RefCheck;

function install() {}

async function startup({ id, version, rootURI }) {
  try {
    Services.scriptloader.loadSubScript(rootURI + "content/refcheck.js");
    RefCheck.init({ id, version, rootURI });
  }
  catch (e) {
    // Leave a trace in the Zotero data folder: errors here happen before RefCheck can log
    Zotero.logError(e);
    let path = PathUtils.join(Zotero.DataDirectory.dir, "reference-checker-startup.log");
    await IOUtils.writeUTF8(path, `Reference Checker ${version} failed to load:\n${e}\n${e.stack || ""}\n`).catch(() => {});
    return;
  }
  await RefCheck.register();
  await RefCheck.step("window setup", () => RefCheck.addToAllWindows());
  await RefCheck.writeStartupLog();
}

function onMainWindowLoad({ window }) {
  RefCheck?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  RefCheck?.removeFromWindow(window);
}

function shutdown() {
  if (!RefCheck) return;
  RefCheck.removeFromAllWindows();
  RefCheck.unregister();
  RefCheck = undefined;
}

function uninstall() {}
