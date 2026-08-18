/* Minimal stub of the Obsidian API so main.js can be required in plain Node. */

/*
 * Only what the tests reach. The lifecycle helpers are real methods on
 * Obsidian's own Plugin, so they are given no-op bodies here rather than being
 * guarded for in main.js.
 */
class Plugin {
  registerEvent(ref) { return ref; }
  registerDomEvent() {}
  registerInterval(id) { return id; }
  register() {}
  addChild(child) { return child; }
  removeChild(child) { return child; }
}
class PluginSettingTab {}
class Setting {}
class Modal {}
class Notice {}
class TFile {}
class ItemView {}
class MarkdownRenderChild {}
const MarkdownRenderer = {};
const Platform = { isMobile: false, isMacOS: true };
function normalizePath(p) { return p; }
module.exports = {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  TFile,
  ItemView,
  MarkdownRenderChild,
  MarkdownRenderer,
  Platform,
  normalizePath,
};
