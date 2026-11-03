import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as JSXRuntime from 'react/jsx-runtime';
import Modal from '../Modal.jsx';
import PopupMenu from '../PopupMenu.jsx';
import RichTextField from '../RichTextField.jsx';

const KEY = Symbol.for('organon.plugins.host.v1');
// Packages compiled by plugins-build.mjs import these exact host instances.
export function exposePluginHost() {
  if (!globalThis[KEY]) Object.defineProperty(globalThis, KEY, {
    value: Object.freeze({ abi: 1, React, ReactDOM, JSXRuntime, Modal, PopupMenu, RichTextField }),
    writable: false, configurable: false, enumerable: false,
  });
  return globalThis[KEY];
}

export function pluginBridge() { return globalThis.window?.desktop?.plugins; }

const styles = new Map();
function attachStyle(url) {
  if (!url) return () => {};
  let entry = styles.get(url);
  if (!entry) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url;
    document.head.appendChild(link); entry = { link, count: 0 }; styles.set(url, entry);
  }
  entry.count++;
  return () => { if (--entry.count === 0) { entry.link.remove(); styles.delete(url); } };
}

// Never import the domain sources here: the initial app contains only this loader.
export async function loadPlugin(id, bridge = pluginBridge()) {
  if (!['financeiro', 'mei'].includes(id) || !bridge) throw new Error('Plugin indisponível nesta instalação.');
  exposePluginHost();
  const entry = await bridge.entry(id);
  const expected = new RegExp(`^organon-plugin://modules/${id}/[a-f0-9]{64}/index\\.js$`);
  if (!expected.test(entry.url) || (entry.css && entry.css !== entry.url.replace(/index\.js$/, 'style.css'))) throw new Error('Entrada de plugin inválida.');
  const module = await import(/* @vite-ignore */ entry.url);
  if (typeof module.default !== 'function') throw new Error('A página do plugin é inválida.');
  return { Component: module.default, version: entry.version, mountStyles: () => attachStyle(entry.css) };
}
