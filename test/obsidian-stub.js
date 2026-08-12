/* Minimal stub of the Obsidian API so main.js can be required in plain Node. */
class Plugin {}
class PluginSettingTab {}
class Setting {}
class Modal {}
class Notice {}
class TFile {}
const Platform = { isMobile: false, isMacOS: true };
function normalizePath(p) { return p; }
module.exports = { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, Platform, normalizePath };
